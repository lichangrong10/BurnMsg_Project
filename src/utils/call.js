/**
 * 通话会话引擎（V7.0 · 1:1 语音 / 视频）
 *
 * 信令走向（与后端约定一致）：客户端 → 服务端走 HTTP，服务端 → 客户端走 WS。
 *
 *   主叫 ──POST /calls──▶ 服务端 ──call:incoming──▶ 被叫
 *   被叫 ──POST /calls/:id/accept──▶ 服务端 ──call:accepted──▶ 主叫
 *   双方 ──POST /calls/:id/ice──▶ 服务端 ──call:ice──▶ 对端
 *   任一方 ──POST /calls/:id/hangup──▶ 服务端 ──call:ended──▶ 双方
 *
 * 安全要点（文档 §7，逐条落实）：
 *  1. 先解密 SDP 取出 DTLS 指纹 → 校验 fp_mac → 通过了才 setRemoteDescription；
 *  2. 服务端返回的 call_id 只做路径参数，call_key 的 salt 用「会话 + 主叫 eph_pub」；
 *  3. 仅私密会话（e2e_state=2）的绑定设备能通话，本模块不做额外放行；
 *  4. 收尾必须 pc.close() + track.stop()，避免麦克风/摄像头常驻；
 *  5. ICE 乱序：本地候选等 callId、远端候选等 setRemoteDescription，两个队列都要有；
 *  6. 被叫自己起 45s 超时（后端超时只通知主叫，被叫收不到事件）。
 */
import { reactive, markRaw } from 'vue'
import { api } from '../api'
import { genKeyPair, b64, stripPad } from './e2e'
import {
  deriveCallKey,
  deriveCallKeyAsCallee,
  fingerprintMac,
  verifyFingerprintMac,
  dtlsFingerprintOf,
  seal,
  open,
  iceServersFrom,
} from './callCrypto'
import { onWs, WS_EVENTS } from './ws'
import { showToast } from '../store'

/** 振铃超时：与后端 CALL_RING_TIMEOUT_SECONDS 默认值保持一致（被叫侧必须自己跑） */
const RING_TIMEOUT_MS = 45000
/** 主叫兜底：超过这个时间还没等到 call:accepted 就收尾（防丢事件） */
const DIAL_TIMEOUT_MS = 60000
/** 拨号期轮询间隔：WS 重连窗口期可能丢事件，用 GET /calls/:id 对齐 */
const DIAL_POLL_MS = 15000
/** ICE 批量：每 120ms 或攒满 8 条发一次，避免撞 200/min 限流 */
const ICE_BATCH_MS = 120
const ICE_BATCH_MAX = 8

/**
 * 通话 UI 状态（CallView 直接绑定）。
 * phase: idle | incoming | dialing | connecting | active | ended | failed
 * status: 更细的进度文案（preparing | media | ringing | answering）
 */
export const callState = reactive({
  phase: 'idle',
  status: '',
  callId: null,
  conversationId: null,
  kind: 'audio',
  peer: { id: null, name: '' },
  startedAt: 0,
  duration: 0,
  endedReason: '',
  error: '',
  muted: false,
  camOff: false,
  localStream: null,
  remoteStream: null,
})

/* ─── 非 reactive 的会话资源（MediaStream 放进 reactive 会被 Proxy 包裹，必须 markRaw） ─── */
let pc = null
let callKey = null
let ephPair = null
let peerIKPub = ''
let currentCallId = null
let localStream = null
let remoteStream = null
let incomingInvite = null       // 来电上下文：{ call_id, conversation_id, kind, eph_pub, payload, fp_mac }
let incomingCallKey = null      // 来电时预先派生的 call_key（校验通过后接听复用）
let incomingSdp = null          // 来电已解密的 offer SDP
let remoteDescSet = false
let localIceQueue = []          // 等 callId 的本地候选
let pendingRemoteIce = []       // 等 setRemoteDescription 的远端候选
let iceTimer = null
let ringTimer = null
let dialTimer = null
let pollTimer = null
let tickTimer = null
let wakeLock = null

/** 当前环境能否发起/接听通话（WebRTC + getUserMedia 都在） */
export function callSupported() {
  return typeof RTCPeerConnection === 'function'
    && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
}

/** 把各种异常翻成能直接给用户看的中文；尽量保留后端 message（已是中文） */
export function errText(e) {
  const raw = String((e && e.message) || e || '')
  const name = (e && e.name) || ''
  if (name === 'NotAllowedError' || /Permission denied|Permission dismissed/i.test(raw)) return '需要麦克风 / 摄像头权限'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return '未检测到麦克风或摄像头'
  if (name === 'NotReadableError') return '麦克风 / 摄像头被其他应用占用'
  if (name === 'SecurityError') return '当前页面不是安全上下文，请在 HTTPS 或 App 内通话'
  if (/TURN_NOT_CONFIGURED|中继未配置/.test(raw)) return '通话中继（TURN）未配置，暂时无法通话'
  if (/CALL_NOT_BOUND_DEVICE|绑定设备/.test(raw)) return '本设备不是该私密会话的绑定设备，无法通话'
  if (/CALL_PEER_OFFLINE|不在线/.test(raw)) return '对方当前不在线'
  if (/CALL_STATE_INVALID|已结束|已被处理/.test(raw)) return '该通话已结束或被处理'
  if (/CALL_NOT_FOUND/.test(raw)) return '通话不存在'
  return raw || '通话失败'
}

/** 取对端设备级 identity 公钥（私密会话里唯一入口，服务端反查对方绑定设备） */
async function peerIKOf(conversationId) {
  const r = await api.getPeerDeviceKey(conversationId)
  if (!r || !r.identity_pubkey) throw new Error('对方尚未上传设备公钥，无法加密通话')
  return { userId: r.user_id, pub: r.identity_pubkey }
}

/** TURN 凭据 → RTCConfiguration.iceServers；未配置直接抛错，不做 STUN 降级 */
async function turnIceServers() {
  return iceServersFrom(await api.getTurnCredentials())
}

/** 建 PeerConnection：1:1 一律 max-bundle，省候选也省 TURN 带宽 */
function createPC(iceServers) {
  const cfg = { iceServers: [iceServers], bundlePolicy: 'max-bundle', iceTransportPolicy: 'all' }
  const conn = new RTCPeerConnection(cfg)
  // 本地候选：callId 未知或还没 setRemoteDescription 时先排队
  conn.onicecandidate = (ev) => {
    if (!ev.candidate) return
    try { localIceQueue.push(ev.candidate.toJSON()) } catch (e) { return }
    scheduleIceFlush()
  }
  // 远端媒体：audio 只有音轨、video 有音视频轨，都从同一个 stream 取
  conn.ontrack = (ev) => {
    remoteStream = ev.streams && ev.streams[0] ? ev.streams[0] : null
    if (remoteStream) callState.remoteStream = markRaw(remoteStream)
  }
  conn.onconnectionstatechange = () => onPcStateChange(conn)
  return conn
}

/** 打开麦克风（视频再带摄像头，720p 上限，留带宽给弱网） */
async function getUserMediaFor(kind) {
  const constraints = kind === 'video'
    ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } }
    : { audio: true }
  return navigator.mediaDevices.getUserMedia(constraints)
}

/* ══════════ ICE 收发管线 ══════════ */

function scheduleIceFlush() {
  if (iceTimer) return
  iceTimer = setTimeout(() => { iceTimer = null; flushIce().catch(() => {}) }, ICE_BATCH_MS)
}

/** 把排队中的本地候选打包加密后发出（一批一个 payload，服务端只转发） */
async function flushIce() {
  if (!currentCallId || !callKey || !localIceQueue.length) return
  const batch = localIceQueue.splice(0, ICE_BATCH_MAX)
  try {
    await api.sendCallIce(currentCallId, await seal(callKey, JSON.stringify(batch)))
  } catch (e) {
    // 限流/超时都当「这批丢了」处理：后续候选或 host 候选仍能打通，不打断通话
  }
  if (localIceQueue.length) scheduleIceFlush()
}

/** 远端候选：setRemoteDescription 之前一律排队，之后补齐（弱网乱序很常见） */
function addRemoteIce(cand) {
  if (!pc) return
  if (!remoteDescSet) { pendingRemoteIce.push(cand); return }
  pc.addIceCandidate(cand).catch(() => { /* 无效/重复候选忽略即可 */ })
}

function flushRemoteIce() {
  const list = pendingRemoteIce.splice(0)
  if (!pc) return
  list.forEach(c => pc.addIceCandidate(c).catch(() => {}))
}

/* ══════════ 生命周期 ══════════ */
/* 说明：resetLocal / cleanup / finish / fail / markActive / 计时器 在后续提交实现，
 * 这里先接上连接状态回调（同模块内函数声明会提升，不存在 TDZ 问题）。 */

/** 连接状态 → UI 阶段（active 计时、失败收尾） */
function onPcStateChange(conn) {
  const st = conn.connectionState
  if (st === 'connected') markActive()
  else if (st === 'failed') fail('网络连接中断，通话已结束')
}
