/**
 * 私密会话（设备配对 Secret Chat）前端对接层
 * 依据：后端文档 E2E_SECRET_CHAT(1).md v1.1（2026-10-30 已实现）
 *
 * 设计要点（详见《前端私密会话设计方案.md》）：
 * - 设备级：每条私密会话绑定两台设备（发起 e2e_device_a / 接受 e2e_device_b），其他设备不可见
 * - 只持有两种持久状态：pending(1) / active(2)；结束 = 物理删除，前端无 closed/rejected 分支
 * - 公钥按 conversationId 取（GET /keys/device/:conversationId），前端无需知道对方 deviceId
 * - 私密会话恒加密：仅文本，附件/语音/焚毁不可用
 *
 * 当前阶段：P2（接口封装 + 错误码 + 设备级 TOFU），尚未接入 store/UI。
 * 后续：P1 重写 utils/e2e.js 为设备级 identity；P3 接 UI；P4 WS 事件与清理；P5 联调。
 */
import { api } from '../api'

/* ── 状态常量（对齐后端 e2e_state） ── */
export const E2E_STATE = { PENDING: 1, ACTIVE: 2 }

/** 是否为私密会话 */
export function isSecretConv(c) { return !!(c && c.e2e_mode === 1) }
/** 是否待接受 */
export function isSecretPending(c) { return isSecretConv(c) && c.e2e_state === E2E_STATE.PENDING }
/** 是否已开启 */
export function isSecretActive(c) { return isSecretConv(c) && c.e2e_state === E2E_STATE.ACTIVE }
/** 当前设备是否为绑定设备（后端已过滤，这里仅用于 UI 判断） */
export function isBoundDevice(c) { return isSecretConv(c) && c.is_bound_device === true }

/* ── 错误码 → 中文文案 + 建议动作（对齐设计稿 §13） ── */
const ERR_MAP = {
  E2E_SELF_REQUEST: { text: '不能和自己发起加密聊天', action: null },
  E2E_NOT_SECRET: { text: '该会话不是加密聊天', action: 'refresh' },
  E2E_NOT_MEMBER: { text: '你不是该会话成员', action: 'refresh' },
  E2E_NOT_BOUND_DEVICE: { text: '当前设备不是绑定设备，无法查看', action: 'leave' },
  E2E_KEY_MISSING: { text: '对方设备密钥尚未准备好，请稍后重试', action: 'retry' },
  E2E_PAIR_EXISTS: { text: '你们已有一条进行中的加密聊天', action: 'goto' },
  E2E_STATE_INVALID: { text: '当前状态不支持此操作', action: 'refresh' },
  E2E_EXPIRED: { text: '加密聊天请求已过期（7 天）', action: 'close' },
  E2E_SESSION_GONE: { text: '加密聊天已结束', action: 'cleanup' }
}

/** 从异常中解析业务错误码（request.js 已把 code/message 提到 error 上） */
export function parseE2eError(e) {
  const msg = String((e && (e.code || e.message)) || '')
  const key = Object.keys(ERR_MAP).find(k => msg.includes(k))
  return key
    ? { code: key, ...ERR_MAP[key] }
    : { code: '', text: (e && e.message) || '操作失败，请重试', action: null }
}

/* ── 设备级 TOFU：以 conversationId 为键钉住对方绑定设备公钥 ── */
const PIN_KEY = 'bm_pinned_dev_keys_v1'

function readPins() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY) || '{}') } catch (e) { return {} }
}
function writePins(m) {
  try { localStorage.setItem(PIN_KEY, JSON.stringify(m)) } catch (e) { /* 忽略 */ }
}
export function getPinnedPeerKey(conversationId) {
  return readPins()[String(conversationId)] || null
}
function pinPeerKey(conversationId, key) {
  const m = readPins()
  m[String(conversationId)] = key
  writePins(m)
}
/** 清理某会话的 pin（会话关闭时调用，做到无痕） */
export function clearPinnedPeerKey(conversationId) {
  const m = readPins()
  delete m[String(conversationId)]
  writePins(m)
}

/**
 * 取对方绑定设备公钥 + TOFU 比对。
 * 返回：
 *  - { status:'first_trust' | 'ok', pubkey, deviceId, userId }
 *  - { status:'changed', oldPubkey, newPubkey, deviceId }   （阻断，需用户确认后重新发起）
 *  - { status:'missing' }                                   （pending / 对方未上传 → 404）
 */
export async function fetchPeerKey(conversationId) {
  let remote
  try {
    remote = await api.getPeerDeviceKey(conversationId)
  } catch (e) {
    const err = parseE2eError(e)
    if (err.code === 'E2E_KEY_MISSING' || /404|未上传|not\s*found/i.test(err.text)) return { status: 'missing' }
    throw e
  }
  const pubkey = remote && remote.identity_pubkey
  if (!pubkey) return { status: 'missing' }

  const local = getPinnedPeerKey(conversationId)
  const info = { pubkey, deviceId: remote.device_id, userId: remote.user_id }
  if (!local) {
    pinPeerKey(conversationId, info)
    return { status: 'first_trust', ...info }
  }
  if (local.pubkey === pubkey) return { status: 'ok', ...info }
  return { status: 'changed', oldPubkey: local.pubkey, newPubkey: pubkey, deviceId: remote.device_id }
}

/** 用户确认「对方换了设备」后重新钉住（正常情况下应改为重新发起新会话） */
export function trustPeerKey(conversationId, info) {
  pinPeerKey(conversationId, info)
}

/* ── 私密会话生命周期（薄封装，统一错误转换） ── */
export async function requestSecret(targetUserId) {
  try {
    return await api.e2eRequest(targetUserId)
  } catch (e) {
    const err = parseE2eError(e)
    if (err.code === 'E2E_PAIR_EXISTS' && e && e.data && e.data.conversation_id) {
      return { already: true, conversation_id: e.data.conversation_id }
    }
    const ex = new Error(err.text)
    ex.e2e = err
    throw ex
  }
}

export async function acceptSecret(conversationId) {
  try { return await api.e2eAccept(conversationId) }
  catch (e) { const err = parseE2eError(e); const ex = new Error(err.text); ex.e2e = err; throw ex }
}

export async function rejectSecret(conversationId) {
  try { return await api.e2eReject(conversationId) }
  catch (e) { const err = parseE2eError(e); const ex = new Error(err.text); ex.e2e = err; throw ex }
}

/** 关闭（reason: 'user' | 'lost_device'）；成功后清本地 pin，保证无痕 */
export async function closeSecret(conversationId, reason = 'user') {
  try {
    const r = await api.e2eClose(conversationId, reason)
    clearPinnedPeerKey(conversationId)
    return r
  } catch (e) {
    const err = parseE2eError(e)
    // 已结束（幂等）也按成功处理并清理
    if (err.code === 'E2E_SESSION_GONE' || err.code === 'E2E_EXPIRED') { clearPinnedPeerKey(conversationId); return { already: true } }
    const ex = new Error(err.text)
    ex.e2e = err
    throw ex
  }
}

/* ── 本设备密钥自检（P1 接入设备级 identity 后使用） ── */
export async function selfCheckDeviceKey() {
  try {
    const r = await api.getMyDeviceKey()
    return { exists: !!(r && r.exists), deviceId: r && r.device_id, pubkey: r && r.identity_pubkey }
  } catch (e) {
    return { exists: false, error: parseE2eError(e) }
  }
}

/** 上传本设备公钥（identity 由 utils/e2e.js 生成） */
export async function uploadDeviceKey(identityPubkey) {
  return api.uploadDeviceKey(identityPubkey)
}
