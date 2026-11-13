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

/** 释放全部本地资源（幂等；任何单步异常都不许阻断收尾） */
function resetLocal() {
  clearRingTimeout()
  stopTick()
  stopPoll()
  clearDialTimeout()
  stopRing()
  releaseWakeLock()
  if (pc) {
    try {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.close()
    } catch (e) { /* 已关闭 */ }
    pc = null
  }
  if (localStream) {
    localStream.getTracks().forEach(t => { try { t.stop() } catch (e) { /* 忽略 */ } })
    localStream = null
  }
  remoteStream = null
  callKey = null
  ephPair = null
  peerIKPub = ''
  currentCallId = null
  incomingInvite = null
  incomingCallKey = null
  incomingSdp = null
  remoteDescSet = false
  localIceQueue = []
  pendingRemoteIce = []
  if (iceTimer) { clearTimeout(iceTimer); iceTimer = null }
  callState.localStream = null
  callState.remoteStream = null
  callState.callId = null
}

/**
 * 收尾并展示结果。phase 用 'ended'（正常）或 'failed'（出错），1.8s 后回 idle。
 * 用户能看到的只有 reason 文案，绝不带 SDP / 密钥等敏感内容。
 */
function finish(phase, reason, text) {
  resetLocal()
  callState.status = ''
  callState.endedReason = reason || ''
  callState.error = text || ''
  callState.phase = phase
  const snapshot = phase
  setTimeout(() => {
    if (callState.phase !== snapshot) return
    callState.phase = 'idle'
    callState.endedReason = ''
    callState.error = ''
    callState.duration = 0
  }, 1800)
}

/** 出错收尾：message 已是中文（后端 message 或 errText 翻译） */
function fail(e) {
  callState.muted = false
  callState.camOff = false
  finish('failed', 'error', typeof e === 'string' ? e : errText(e))
}

/** 对端媒体真正连通：进 active + 开始计时 */
function markActive() {
  if (callState.phase === 'active') return
  clearRingTimeout()
  clearDialTimeout()
  stopPoll()
  stopRing()
  callState.phase = 'active'
  callState.status = ''
  callState.startedAt = Date.now()
  callState.duration = 0
  startTick()
}

/* ══════════ 计时器 ══════════ */

/** 通话时长（1s 一跳，UI 直接读 callState.duration） */
function startTick() {
  stopTick()
  tickTimer = setInterval(() => {
    if (!callState.startedAt) return
    callState.duration = Math.max(0, Math.floor((Date.now() - callState.startedAt) / 1000))
  }, 1000)
}

function stopTick() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null }
}

/**
 * 被叫振铃超时。**必须由前端自己跑**：后端 45s 超时只推 call:rejected(timeout) 给主叫，
 * 被叫收不到任何事件，界面会一直响下去。
 */
function startRingTimeout() {
  clearRingTimeout()
  ringTimer = setTimeout(() => {
    if (callState.phase !== 'incoming') return
    resetLocal()
    callState.phase = 'idle'
    showToast('来电未接听')
  }, RING_TIMEOUT_MS)
}

function clearRingTimeout() {
  if (ringTimer) { clearTimeout(ringTimer); ringTimer = null }
}

/** 主叫拨号兜底（防 call:accepted 丢失导致界面卡在「正在呼叫」） */
function startDialTimeout() {
  clearDialTimeout()
  dialTimer = setTimeout(() => {
    if (callState.phase !== 'dialing') return
    const id = currentCallId
    if (id) api.hangupCall(id, 'hangup').catch(() => {})
    finish('ended', 'timeout', '无人接听')
  }, DIAL_TIMEOUT_MS)
}

function clearDialTimeout() {
  if (dialTimer) { clearTimeout(dialTimer); dialTimer = null }
}

/** 拨号期状态轮询：WS 重连窗口期可能丢 call:accepted，用 REST 对齐 */
function startDialPoll() {
  stopPoll()
  pollTimer = setInterval(async () => {
    if (callState.phase !== 'dialing' || !currentCallId) return
    try {
      const view = await api.getCall(currentCallId)
      if (!view) return
      if (view.state === 'ended' || view.state === 'rejected' || view.state === 'missed') {
        finish('ended', view.end_reason || view.state, view.state === 'missed' ? '无人接听' : '通话已结束')
      }
    } catch (e) { /* 网络抖动忽略，下一轮再试 */ }
  }, DIAL_POLL_MS)
}

function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

/* ══════════ 来电提示（提示音 + 震动） ══════════
 * 不用音频文件：WebAudio 双音就够，且不受打包资源影响。
 * iOS/Android 可能因未获用户手势而静音，静默失败不影响来电可用性。
 */
let ringCtx = null
let ringBeepTimer = null

function startRing() {
  stopRing()
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400]) } catch (e) { /* 忽略 */ }
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    ringCtx = ringCtx || new Ctx()
    if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {})
    beepOnce()
    ringBeepTimer = setInterval(beepOnce, 1600)
  } catch (e) { /* 无声也能接 */ }
}

function beepOnce() {
  try {
    const t = ringCtx.currentTime
    ;[0, 0.45].forEach(off => {
      const osc = ringCtx.createOscillator()
      const gain = ringCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 780
      gain.gain.setValueAtTime(0, t + off)
      gain.gain.linearRampToValueAtTime(0.12, t + off + 0.05)
      gain.gain.linearRampToValueAtTime(0, t + off + 0.35)
      osc.connect(gain)
      gain.connect(ringCtx.destination)
      osc.start(t + off)
      osc.stop(t + off + 0.4)
    })
  } catch (e) { /* 忽略 */ }
}

function stopRing() {
  if (ringBeepTimer) { clearInterval(ringBeepTimer); ringBeepTimer = null }
  try { if (navigator.vibrate) navigator.vibrate(0) } catch (e) { /* 忽略 */ }
}

/* ══════════ 屏幕常亮 ══════════ */

async function acquireWakeLock() {
  try {
    if (!navigator.wakeLock) return
    wakeLock = await navigator.wakeLock.request('screen')
  } catch (e) { wakeLock = null }
}

function releaseWakeLock() {
  try { wakeLock && wakeLock.release() } catch (e) { /* 忽略 */ }
  wakeLock = null
}

/** 连接状态 → UI 阶段（active 计时、失败收尾） */
function onPcStateChange(conn) {
  const st = conn.connectionState
  if (st === 'connected') markActive()
  else if (st === 'failed') fail('网络连接中断，通话已结束')
  else if (st === 'disconnected') {
    // 弱网瞬断很常见，给 5s 自愈窗口，仍未 connected 才收尾
    setTimeout(() => {
      if (pc === conn && conn.connectionState !== 'connected') fail('连接中断，通话已结束')
    }, 5000)
  }
}

/* ══════════ 主叫：发起 ══════════ */

/**
 * 发起通话（仅私密会话：call_key 依赖对端设备级 IK 公钥）。
 * @param {{conversationId:string, kind:'audio'|'video', peerName?:string, peerUserId?:string}} opts
 */
export async function startCall({ conversationId, kind = 'audio', peerName = '', peerUserId = '' }) {
  if (callState.phase !== 'idle') { showToast('当前已有通话进行中'); return }
  if (!callSupported()) { showToast('当前环境不支持通话（需 HTTPS 或 App 内使用）'); return }
  resetLocal()
  callState.phase = 'dialing'
  callState.status = 'preparing'
  callState.kind = kind
  callState.conversationId = conversationId
  callState.peer = { id: peerUserId, name: peerName || '对方' }
  callState.duration = 0
  callState.error = ''
  callState.muted = false
  callState.camOff = false

  try {
    // ① 对端设备公钥（私密会话唯一入口）——没有它算不出 call_key
    const peer = await peerIKOf(conversationId)
    peerIKPub = peer.pub
    // ② TURN 凭据：未配置直接抛错（不降级 STUN）
    const ice = await turnIceServers()
    // ③ 临时密钥 + call_key：salt = 会话 + 主叫 eph_pub，POST 之前就能算
    ephPair = await genKeyPair()
    const ephPub = stripPad(b64(ephPair.pub))
    callKey = await deriveCallKey(ephPair, peerIKPub, conversationId, ephPub)
    // ④ 采集 → 建连 → offer
    callState.status = 'media'
    localStream = markRaw(await getUserMediaFor(kind))
    callState.localStream = localStream
    pc = createPC(ice)
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
    await pc.setLocalDescription(await pc.createOffer())
    const sdp = (pc.localDescription && pc.localDescription.sdp) || ''
    const fp = dtlsFingerprintOf(sdp)
    if (!fp) throw new Error('本地 SDP 缺少 DTLS 指纹，无法建立加密通话')
    // ⑤ 发请求；此时 callId 未知，本地候选在队列里等，拿到后补发
    callState.status = 'ringing'
    const res = await api.createCall({
      conversation_id: conversationId,
      kind,
      eph_pub: ephPub,
      fp_mac: await fingerprintMac(callKey, fp),
      payload: await seal(callKey, sdp),
    })
    currentCallId = res && res.call_id
    callState.callId = currentCallId
    if (!currentCallId) throw new Error('服务端未返回 call_id')
    flushIce().catch(() => {})
    startDialTimeout()
    startDialPoll()
    acquireWakeLock()
  } catch (e) {
    fail(e)
  }
}

/* ══════════ 通话内操作 ══════════ */

/** 挂断（振铃中挂断 = 取消；服务端幂等，重复调用也不会报错） */
export async function endCall() {
  const id = currentCallId
  const wasDialing = callState.phase === 'dialing'
  if (!id) { finish('ended', 'hangup', ''); return }
  try { await api.hangupCall(id, 'hangup') } catch (e) { /* 已结束也无所谓 */ }
  finish('ended', wasDialing ? 'cancel' : 'hangup', '')
}

/** 拒接来电（busy 用于本机已有通话时自动忙线） */
export async function rejectCurrent(reason = 'decline') {
  const invite = incomingInvite
  const id = (invite && invite.call_id) || currentCallId
  currentCallId = id
  if (id) { try { await api.rejectCall(id, reason) } catch (e) { /* 已处理 */ } }
  finish('ended', reason, reason === 'busy' ? '对方忙线中' : '已拒接')
}

/** 静音 / 取消静音（只切音轨 enabled，不动采集，避免反复开关设备） */
export function toggleMute() {
  if (!localStream) return
  callState.muted = !callState.muted
  localStream.getAudioTracks().forEach(t => { t.enabled = !callState.muted })
}

/** 关闭 / 打开本地摄像头（视频通话；只切 enabled 保留轨道） */
export function toggleCamera() {
  if (!localStream) return
  const tracks = localStream.getVideoTracks()
  if (!tracks.length) return
  callState.camOff = !callState.camOff
  tracks.forEach(t => { t.enabled = !callState.camOff })
}

/** 前后摄像头切换（失败静默：部分 WebView 不支持 applyConstraints 的 facingMode） */
export async function switchCamera() {
  if (!localStream) return
  const track = localStream.getVideoTracks()[0]
  if (!track) return
  const cur = (track.getSettings && track.getSettings().facingMode) || 'user'
  const next = cur === 'environment' ? 'user' : 'environment'
  try { await track.applyConstraints({ facingMode: { exact: next } }) } catch (e) {
    try { await track.applyConstraints({ facingMode: next }) } catch (e2) { /* 该设备不支持切换 */ }
  }
}

/* ══════════ 被叫：来电与接听 ══════════ */

/**
 * 处理 call:incoming。
 *
 * 关键：**接听前**就派生 call_key 并校验主叫的 DTLS 指纹 MAC，校验不过直接挂断，
 * 绝不让被中间人替换的 SDP 进到 PeerConnection。被叫侧必须用 deriveCallKeyAsCallee。
 * 派生好的 call_key / SDP 缓存起来，接听时复用（否则要重新协商，指纹也对不上）。
 */
async function onIncoming(p) {
  if (!p || !p.call_id) return
  // 本机已有通话 → 直接回忙线（服务端也拦，但前端先拦省一次状态机冲突与提示）
  if (callState.phase !== 'idle' || !callSupported()) {
    api.rejectCall(p.call_id, 'busy').catch(() => {})
    return
  }
  try {
    const peer = await peerIKOf(p.conversation_id)
    peerIKPub = peer.pub
    ephPair = await genKeyPair()
    incomingCallKey = await deriveCallKeyAsCallee(p.eph_pub, peerIKPub, p.conversation_id, p.eph_pub)
    incomingSdp = await open(incomingCallKey, p.payload)
    const fp = dtlsFingerprintOf(incomingSdp)
    if (!fp || !(await verifyFingerprintMac(incomingCallKey, fp, p.fp_mac))) {
      api.hangupCall(p.call_id, 'hangup').catch(() => {})
      showToast('通话密钥校验失败，已拒绝（可能存在中间人）')
      return
    }
    incomingInvite = p
    currentCallId = p.call_id
    callState.phase = 'incoming'
    callState.status = ''
    callState.kind = p.kind === 'video' ? 'video' : 'audio'
    callState.conversationId = p.conversation_id
    callState.callId = p.call_id
    callState.peer = {
      id: (p.from_user && p.from_user.id) || null,
      name: (p.from_user && p.from_user.display_name) || '对方',
    }
    callState.duration = 0
    callState.error = ''
    startRing()
    startRingTimeout()
  } catch (e) {
    // 解密失败 / 公钥缺失 / payload 损坏：直接拒绝，不留半死界面
    api.rejectCall(p.call_id, 'decline').catch(() => {})
    showToast('来电解析失败，已拒绝')
  }
}

/**
 * 接听：复用来电时已校验的 call_key 与 offer SDP，采集后回 answer。
 * 必须在用户手势里调用（否则 getUserMedia 与音频播放都会被拦）。
 */
export async function acceptCall() {
  if (callState.phase !== 'incoming' || !incomingInvite || !incomingCallKey || !incomingSdp) return
  stopRing()
  clearRingTimeout()
  callState.phase = 'connecting'
  callState.status = 'answering'
  try {
    const ice = await turnIceServers()
    callKey = incomingCallKey
    localStream = markRaw(await getUserMediaFor(callState.kind))
    callState.localStream = localStream
    pc = createPC(ice)
    localStream.getTracks().forEach(t => pc.addTrack(t, localStream))
    await pc.setRemoteDescription({ type: 'offer', sdp: incomingSdp })
    remoteDescSet = true
    flushRemoteIce()
    await pc.setLocalDescription(await pc.createAnswer())
    const sdp = (pc.localDescription && pc.localDescription.sdp) || ''
    const fp = dtlsFingerprintOf(sdp)
    if (!fp) throw new Error('本地 SDP 缺少 DTLS 指纹')
    await api.acceptCall(currentCallId, {
      eph_pub: stripPad(b64(ephPair.pub)), // 被叫临时公钥（服务端仅存，不参与 salt）
      fp_mac: await fingerprintMac(callKey, fp),
      payload: await seal(callKey, sdp),
    })
    flushIce().catch(() => {})
    acquireWakeLock()
  } catch (e) {
    // 接听失败要通知对端，否则主叫一直停在「正在连接」
    if (currentCallId) api.hangupCall(currentCallId, 'hangup').catch(() => {})
    fail(e)
  }
}
