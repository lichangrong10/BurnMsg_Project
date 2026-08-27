/**
 * 全局状态 + 业务动作（轻量 store，无第三方依赖）
 * 视图组件通过 import { state, ...actions } 使用
 */
import { reactive } from 'vue'
import { storage } from '../utils/storage'
import { http, setBaseURL } from '../utils/request'
import { api } from '../api'
import { DEMO } from '../mock/demo'
import { BURN_OPTIONS, memberUid, memberUser, messagePreview } from '../utils/format'
import { connectWs, disconnectWs, reconnectWs, onWs, WS_EVENTS } from '../utils/ws'

export const state = reactive({
  view: storage.token ? 'main' : 'login', // login | changePwd | main
  tab: 'chats',                           // chats | contacts | me
  keyword: '',
  me: storage.user || {},
  baseURL: storage.baseURL,
  demoMode: storage.demo,
  convs: [],
  contacts: [],
  chat: null,            // 当前打开的会话（非 null 时聊天页覆盖显示）
  messages: [],
  msgLoading: false,
  msgSeq: 0,             // 非静默加载消息完成时 +1，聊天页据此强制滚到底部
  newMsgSeq: 0,          // 轮询发现「更新的消息」时 +1（按最新时间戳判定，不依赖条数变化）
  burnSeconds: 0,        // 阅后即焚档位（秒），0 = 关闭
  pwdForm: { old: '', n1: '', n2: '' },
  pwdErr: '',
  pwdLoading: false,
  toast: '',
  nowTick: Date.now(),   // 每秒刷新，驱动焚毁倒计时
  showServerDialog: false,
  showCreateGroup: false, // 建群/频道页（覆盖层）
  showChatInfo: false,    // 聊天信息/群管理页（覆盖层）
  showAdmin: false,       // 管理后台页（覆盖层，admin 可见入口）
  groupMembers: [],       // 当前群成员列表（含角色与用户信息）
  readWatermark: 0        // 私聊对方已读水位线（ms 时间戳）：本人消息 created_at ≤ 此值即已读
})

/** 从接口返回值中稳妥提取数组：兼容直接数组，以及 {list}/{users}/{items}/{records}/{data} 等分页/包装结构 */
export function asArray(d) {
  if (Array.isArray(d)) return d
  if (d && typeof d === 'object') {
    for (const k of ['list', 'users', 'items', 'records', 'data', 'members']) {
      if (Array.isArray(d[k])) return d[k]
    }
  }
  console.warn('[焚信] 接口返回非数组结构，已按空列表处理：', d)
  return []
}

/* 消息时间戳归一化（兼容 ISO 字符串/秒级/毫秒级，时间字段名多别名兜底：created_at/createdAt/timestamp 等） */
function msgTime(m) {
  if (!m) return 0
  const v = m.created_at ?? m.createdAt ?? m.sent_at ?? m.sentAt ?? m.timestamp ?? m.updated_at ?? m.updatedAt
  if (v == null) return 0
  const t = typeof v === 'number' ? v : Date.parse(v)
  if (!Number.isFinite(t)) return 0
  return t < 1e12 ? t * 1000 : t
}
/* 升序排序（旧→新），兼容后端返回正序/倒序 */
function sortByTimeAsc(list) {
  return (list || []).slice().sort((a, b) => msgTime(a) - msgTime(b))
}

/* 消息字段归一化：后端若返回 camelCase/别名字段，统一补成 snake_case，保证排序/时间显示/渲染 key 一致可用 */
function normalizeMsg(m) {
  if (!m || typeof m !== 'object') return m
  if (m.created_at == null && m.createdAt != null) m.created_at = m.createdAt
  if (m.id == null) {
    const alt = m.message_id ?? m.messageId ?? m.msg_id
    if (alt != null) m.id = alt
  }
  if (m.sender_id == null) {
    const alt = m.senderId ?? m.from_user_id ?? m.user_id
    if (alt != null) m.sender_id = alt
  }
  return m
}

/* 调试日志用：一条消息的 id + 解析后的时间（解析失败时打印原始值，便于定位后端字段名/格式问题） */
function fmtMsgDbg(m) {
  const t = msgTime(m)
  const raw = m.created_at ?? m.createdAt ?? m.timestamp ?? '?'
  return `id=${m.id ?? '?'} time=${t ? new Date(t).toLocaleTimeString('zh-CN', { hour12: false }) : '无法解析(' + raw + ')'}`
}

/* 轮询新消息检测基线：记录当前会话已见到的最新时间戳（不依赖列表长度，条数顶到上限恒定时也能发现新消息） */
let lastMsgConv = null
let lastNewestStamp = 0

/* ─── Toast ─── */
let toastTimer = null
export function showToast(t) {
  state.toast = t
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { state.toast = '' }, 2200)
}

/* ─── 登录 / 改密 / 登出 ─── */
export async function login(phone, password) {
  http.defaults.baseURL = state.baseURL
  const d = await api.login(phone, password)
  storage.token = d.access_token
  storage.refresh = d.refresh_token
  storage.user = d.user
  storage.demo = false
  state.demoMode = false
  state.me = d.user
  if (d.force_change_pwd || d.user.force_change_pwd) {
    state.view = 'changePwd'
    state.pwdForm.old = password
  } else {
    state.view = 'main'
    connectWs(d.access_token)
    bootstrap()
  }
  return d
}

export function enterDemo() {
  disconnectWs()
  storage.demo = true
  state.demoMode = true
  state.me = DEMO.me
  storage.user = DEMO.me
  state.view = 'main'
  bootstrap()
  showToast('已进入演示模式（数据为本地模拟）')
}

/** 修改密码（首次强制改密 + 「我的」里主动改密共用），成功返回 true */
export async function changePassword() {
  state.pwdErr = ''
  if (state.pwdForm.n1.length < 8) { state.pwdErr = '新密码至少 8 位'; return false }
  if (state.pwdForm.n1 !== state.pwdForm.n2) { state.pwdErr = '两次输入的新密码不一致'; return false }
  if (state.demoMode) {
    if (state.view === 'changePwd') { state.view = 'main'; bootstrap() }
    showToast('演示模式：密码已修改（模拟）')
    return true
  }
  state.pwdLoading = true
  try {
    await api.changePassword(state.pwdForm.old, state.pwdForm.n1)
    if (state.view === 'changePwd') { state.view = 'main'; bootstrap() }
    showToast('密码修改成功')
    return true
  } catch (e) {
    state.pwdErr = e.message
    return false
  } finally {
    state.pwdLoading = false
  }
}

export function logout() {
  storage.clear()
  forceLogout()
}

/** request.js 刷新 token 失败时也会通过 bm-logout 事件走到这里 */
export function forceLogout() {
  state.view = 'login'
  state.chat = null
  state.convs = []
  state.messages = []
  state.showCreateGroup = false
  state.showChatInfo = false
  state.showAdmin = false
  state.groupMembers = []
  disconnectWs()
}

/* ─── 数据加载 ─── */

/* ─── 会话置顶（本地持久化） ─── */
export function pinnedIds() {
  try { return JSON.parse(localStorage.getItem('bm_pinned_ids') || '[]') } catch { return [] }
}
export function setPinned(id, on) {
  const ids = pinnedIds().filter(x => x !== id)
  if (on) ids.push(id)
  try { localStorage.setItem('bm_pinned_ids', JSON.stringify(ids)) } catch { /* 忽略 */ }
}
export function togglePin(c) {
  c.pinned = !c.pinned
  setPinned(c.id, c.pinned)
  showToast(c.pinned ? '已置顶' : '已取消置顶')
}

/* ─── 会话最新消息预览（缓存 + 从接口提取） ─── */
const lastMsgCache = {}
function getLastMsg(id) { return lastMsgCache[id] || '' }
function setLastMsg(id, text) { if (text) lastMsgCache[id] = text }

/** 从会话接口返回中提取最后一条消息预览（兼容对象/字符串与多种字段名） */
function extractConvoPreview(c) {
  if (!c || typeof c !== 'object') return ''
  const raw = c.last_message ?? c.lastMessage ?? c.last_msg ?? c.preview ?? c.last_message_text ?? c.lastMsg
  if (raw == null || raw === '') return ''
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') return messagePreview(raw)
  return String(raw)
}

/** 用当前消息列表最新一条，回填会话预览（chat 对象 + 缓存） */
function syncChatPreview() {
  if (!state.chat) return
  const arr = state.messages || []
  const last = arr[arr.length - 1]
  const p = last ? messagePreview(last) : ''
  if (p) {
    state.chat.lastMsg = p
    setLastMsg(state.chat.id, p)
  }
}

/** 冷启动/刷新时对缺预览的会话补拉最新消息（静默，失败不打扰） */
async function fillMissingPreviews() {
  const need = state.convs.filter(c => !c.lastMsg)
  if (!need.length) return
  await Promise.allSettled(need.map(async c => {
    try {
      const list = asArray(await api.getMessages(c.id, { limit: 20 }))
      const sorted = sortByTimeAsc(list)
      const last = sorted[sorted.length - 1]
      if (last) {
        const p = messagePreview(last)
        c.lastMsg = p
        setLastMsg(c.id, p)
      }
    } catch (e) { /* 静默 */ }
  }))
}

export async function bootstrap() {
  await Promise.all([loadConvs(), loadContacts()])
  if (!state.demoMode) {
    if (storage.token) connectWs(storage.token) // 刷新页面后凭本地 token 恢复 WS 连接
    try {
      state.me = await api.getProfile()
      storage.user = state.me
    } catch (e) { /* 忽略，沿用登录返回的用户信息 */ }
  }
}

export async function loadConvs(quiet) {
  if (state.demoMode) {
    const ids = pinnedIds()
    DEMO.convs.forEach(c => { c.pinned = ids.includes(c.id) })
    state.convs = DEMO.convs
    return
  }
  try {
    const list = asArray(await api.getConversations())
    const ids = pinnedIds()
    const prev = {}
    state.convs.forEach(c => { prev[c.id] = c })
    state.convs = list.map(c => {
      const old = prev[c.id]
      return {
        ...c,
        unread: (old && old.unread) ?? c.unread ?? 0,
        lastMsg: extractConvoPreview(c) || getLastMsg(c.id) || (old && old.lastMsg) || '',
        pinned: ids.includes(c.id)
      }
    })
    if (!quiet) await fillMissingPreviews()
  } catch (e) { if (!quiet) showToast(e.message) }
}

export async function loadContacts() {
  if (state.demoMode) { state.contacts = DEMO.users; return }
  try {
    state.contacts = asArray(await api.getContacts())
  } catch (e) { /* 静默 */ }
}

/* ─── 聊天 ─── */
export async function openChat(c) {
  state.chat = c
  c.unread = 0
  state.messages = []
  state.groupMembers = []
  state.readWatermark = 0 // 重置已读水位线，私聊随后按回执重建
  if (c.type !== 'private') loadGroupMembers() // 预取群成员：消息发送者名称/头像、群管理页共用
  if (!state.demoMode) { try { await api.markRead(c.id) } catch (e) { /* 静默 */ } }
  await loadMessages()
  if (!state.demoMode && c.type === 'private') loadReadWatermark()
}

/** 私聊初始已读水位线：取本人最近一条消息的对方回执，已读则以该消息时间为水位 */
async function loadReadWatermark() {
  try {
    const mine = state.messages.filter(m => String(m.sender_id) === String(state.me.id) && !m.is_recalled)
    if (!mine.length) return
    const rs = asArray(await api.getReceipt(mine[mine.length - 1].id))
    const other = rs.find(r => String(r.user_id) !== String(state.me.id) && r.is_read)
    if (other) {
      const t = Date.parse(other.read_at || '') || msgTime(mine[mine.length - 1])
      if (t > state.readWatermark) state.readWatermark = t
    }
  } catch (e) { /* 静默：回执不可用时仅不显示已读 */ }
}

export function closeChat() {
  state.chat = null
  state.messages = []
  loadConvs(true)
}

export async function loadMessages(quiet) {
  const cid = state.chat.id
  if (state.demoMode) {
    state.messages = (DEMO.messages[cid] || []).filter(m => !m.destroy_at || new Date(m.destroy_at) > new Date())
    if (!quiet) state.msgSeq++
    return
  }
  if (!quiet) state.msgLoading = true
  try {
    // limit 取 200（接口上限）：后端若按正序返回，limit=50 只会拿到最早 50 条，新消息根本拉不到
    const list = asArray(await api.getMessages(cid, { limit: 200 }))
    // 稳健排序：字段名归一化后显式按时间升序（旧→新）渲染，后端正序/倒序/字段别名都安全
    const sorted = sortByTimeAsc(list.map(normalizeMsg))
    const last = sorted[sorted.length - 1]
    const newestStamp = last ? msgTime(last) : 0
    if (cid !== lastMsgConv) {
      // 切换会话后的首次拉取：打印一条最新消息的原始样例（确认后端真实字段名/时间格式），并重建新消息基线
      if (last) { try { console.log('[焚信] 消息字段样例:', JSON.stringify(last).slice(0, 600)) } catch (e) { /* 忽略 */ } }
      lastMsgConv = cid
      lastNewestStamp = newestStamp
    }
    console.log('[焚信] 拉取消息', cid, '共', sorted.length, '条' + (quiet ? '（轮询）' : ''),
      '| 最早:', sorted.length ? fmtMsgDbg(sorted[0]) : '-', '| 最新:', last ? fmtMsgDbg(last) : '-')
    // 最新时间戳超过基线 → 有新消息到达（首次加载不算，滚底由 msgSeq 负责）
    if (newestStamp > lastNewestStamp) state.newMsgSeq++
    lastNewestStamp = Math.max(lastNewestStamp, newestStamp)
    state.messages = sorted
    syncChatPreview()
    if (!quiet) state.msgSeq++
  } catch (e) {
    console.error('[焚信] 拉取消息失败:', cid, e)
    if (!quiet) showToast(e.message)
  } finally {
    state.msgLoading = false
  }
}

/* ─── WebSocket 实时事件 ─── */
/** 收到消息提示音：WebAudio 合成短促「叮」声，无需音频文件；浏览器要求首次交互后才允许出声 */
let audioCtx = null
export function playMsgDing() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    const t0 = audioCtx.currentTime
    const osc = audioCtx.createOscillator()
    const gain = audioCtx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.frequency.setValueAtTime(660, t0 + 0.09)
    gain.gain.setValueAtTime(0.18, t0)
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.28)
    osc.connect(gain).connect(audioCtx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.3)
  } catch (e) { /* 无声环境下静默 */ }
}

/* 会话列表刷新防抖（conversation:updated 是信号事件，收到后重拉列表） */
let convReloadTimer = null
function scheduleConvReload() {
  clearTimeout(convReloadTimer)
  convReloadTimer = setTimeout(() => { loadConvs(true) }, 500)
}

/** message:new：当前会话去重追加 + 滚动吸附；其他会话只更新预览/未读并重拉列表 */
function onWsNewMessage(p) {
  if (!p || state.demoMode) return
  const m = normalizeMsg({ ...(p.message || {}) })
  const cid = p.conversation_id || m.conversation_id
  if (!m.id || !cid) return
  const mine = String(m.sender_id) === String(state.me.id)
  if (!mine) playMsgDing() // 收到对方消息：提示音（当前会话内外都播）
  if (state.chat && String(state.chat.id) === String(cid)) {
    // 去重：本人发送时 sendText 已 push 过同一条（WS 也会推给发送方多端）
    if (!state.messages.some(x => String(x.id) === String(m.id))) {
      state.messages.push(m)
      state.newMsgSeq++ // 驱动吸附滚底 / 新消息浮钮（ChatRoom watch）
      if (!mine) api.markRead(cid).catch(() => { /* 静默 */ })
    }
    syncChatPreview()
  } else {
    // 未打开的会话：未读+1（本人其他端发的除外），预览与排序靠重拉列表兜底
    if (!mine) {
      const c = state.convs.find(x => String(x.id) === String(cid))
      if (c) c.unread = (c.unread || 0) + 1
      showToast('新消息：' + (messagePreview(m) || '').slice(0, 30)) // 会话外收到消息的文字提示
    }
    setLastMsg(cid, messagePreview(m))
  }
  scheduleConvReload()
}

/** message:edited：就地覆盖当前会话中的同 id 消息 */
function onWsEdited(p) {
  if (!p || !p.message || state.demoMode) return
  const nm = normalizeMsg({ ...p.message })
  const t = state.messages.find(x => String(x.id) === String(nm.id))
  if (t) Object.assign(t, nm)
  syncChatPreview()
}

/** message:recalled：就地置为已撤回（渲染为灰条） */
function onWsRecalled(p) {
  if (!p || state.demoMode) return
  const t = state.messages.find(x => String(x.id) === String(p.message_id))
  if (t) t.is_recalled = true
}

/** receipt:read：推进当前私聊的已读水位线（对方读到 last_read_message_id） */
function onWsReceiptRead(p) {
  if (!p || state.demoMode) return
  if (!state.chat || String(state.chat.id) !== String(p.conversation_id)) return
  if (String(p.user_id) === String(state.me.id)) return // 自己的回执不影响「对方已读」展示
  const t = Date.parse(p.read_at || '') || 0
  if (t > state.readWatermark) state.readWatermark = t
}

/* 模块加载时注册一次（WS 连接由 login/bootstrap 建立，断线重连后事件仍生效） */
onWs(WS_EVENTS.MESSAGE_NEW, onWsNewMessage)
onWs(WS_EVENTS.MESSAGE_EDITED, onWsEdited)
onWs(WS_EVENTS.MESSAGE_RECALLED, onWsRecalled)
onWs(WS_EVENTS.CONVERSATION_UPDATED, () => { if (!state.demoMode) scheduleConvReload() })
onWs(WS_EVENTS.RECEIPT_READ, onWsReceiptRead)

/* token 刷新成功后用新 token 重建 WS（旧 token 握手会持续失败） */
window.addEventListener('bm-token-refreshed', () => {
  if (!state.demoMode && storage.token) reconnectWs(storage.token)
})

export function setBurn(v) {
  state.burnSeconds = v
  if (v) {
    const o = BURN_OPTIONS.find(x => x.v === v)
    showToast('阅后即焚：' + (o ? o.label : ''))
  }
}

/** 追加消息到当前会话列表：按 id 去重，防 WS 推送先于 HTTP 响应到达造成的双条闪现 */
function pushMsgDedup(m) {
  if (!m || m.id == null) return false
  if (state.messages.some(x => String(x.id) === String(m.id))) return false
  state.messages.push(m)
  return true
}

/** 发送文本消息，失败返回 false（调用方恢复草稿） */
export async function sendText(text) {
  const payload = { conversation_id: state.chat.id, type: 'text', content: text }
  if (state.burnSeconds) payload.destroy_at = new Date(Date.now() + state.burnSeconds * 1000).toISOString()
  if (state.demoMode) {
    const m = { id: DEMO.uid(), sender_id: state.me.id, created_at: new Date().toISOString(), is_recalled: false, is_edited: false, ...payload }
    ;(DEMO.messages[state.chat.id] = DEMO.messages[state.chat.id] || []).push(m)
    state.messages.push(m)
    state.chat.lastMsg = text
    state.chat.last_message_at = m.created_at
    return true
  }
  try {
    const m = await api.sendMessage(payload)
    pushMsgDedup(m)
    state.chat.lastMsg = text
    setLastMsg(state.chat.id, text)
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/** 发送图片/文件（先上传再发消息，50MB 前端预校验） */
export async function sendFile(file) {
  if (!state.chat) return
  if (file.size > 50 * 1024 * 1024) { showToast('文件不能超过 50MB'); return }
  const isImg = /^image\//.test(file.type)
  if (state.demoMode) {
    const url = isImg ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file) }) : null
    const m = { id: DEMO.uid(), conversation_id: state.chat.id, sender_id: state.me.id, type: isImg ? 'image' : 'file', content: '', file_url: url, file_name: file.name, file_size: file.size, created_at: new Date().toISOString(), is_recalled: false, is_edited: false }
    ;(DEMO.messages[state.chat.id] = DEMO.messages[state.chat.id] || []).push(m)
    state.messages.push(m)
    return
  }
  showToast('上传中…')
  try {
    const up = await api.upload(file)
    const payload = { conversation_id: state.chat.id, type: isImg ? 'image' : 'file', file_url: up.url, file_name: up.file_name, file_size: up.file_size }
    if (state.burnSeconds) payload.destroy_at = new Date(Date.now() + state.burnSeconds * 1000).toISOString()
    const m = await api.sendMessage(payload)
    pushMsgDedup(m)
  } catch (e) {
    showToast(e.message)
  }
}

export async function recallMessage(m) {
  if (state.demoMode) { m.is_recalled = true; return }
  try {
    await api.recallMessage(m.id)
    m.is_recalled = true
  } catch (e) {
    showToast(e.message)
  }
}

/** 从通讯录发起私聊 */
export async function startChatWith(u) {
  if (state.demoMode) {
    let c = DEMO.convs.find(x => x.type === 'private' && x.other_user && x.other_user.id === u.id)
    if (!c) {
      c = { id: DEMO.uid(), type: 'private', name: null, is_channel: false, member_count: 2, other_user: u, unread: 0, lastMsg: '', last_message_at: new Date().toISOString() }
      DEMO.convs.unshift(c)
    }
    state.tab = 'chats'
    openChat(c)
    return
  }
  try {
    const c = await api.createPrivate(u.id)
    state.tab = 'chats'
    await loadConvs(true)
    openChat({ ...c, other_user: u })
  } catch (e) {
    showToast(e.message)
  }
}

/* ─── 消息编辑 ─── */
export async function editMessage(m, content) {
  if (state.demoMode) {
    m.content = content
    m.is_edited = true
    // 编辑的是会话最后一条消息时，同步会话列表预览
    if (state.chat && state.messages[state.messages.length - 1] === m) state.chat.lastMsg = content
    showToast('消息已编辑（模拟）')
    return true
  }
  try {
    const nm = await api.editMessage(m.id, content)
    Object.assign(m, nm)
    // 编辑的是会话最后一条消息时，同步会话列表预览
    if (state.chat && state.messages[state.messages.length - 1] === m) {
      state.chat.lastMsg = m.content || content
      setLastMsg(state.chat.id, state.chat.lastMsg)
    }
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/* ─── 群组 / 频道 ─── */
export async function createGroupAction(name, memberIds, isChannel, description) {
  if (state.demoMode) {
    const c = { id: DEMO.uid(), type: isChannel ? 'channel' : 'group', name, description: description || null, avatar_url: null, is_channel: !!isChannel, member_count: memberIds.length + 1, last_message_at: new Date().toISOString(), unread: 0, lastMsg: '' }
    DEMO.convs.unshift(c)
    DEMO.groupMembers[c.id] = [
      { user_id: state.me.id, role: 'owner', user: state.me },
      ...memberIds.map(uid => ({ user_id: uid, role: 'member', user: DEMO.users.find(x => x.id === uid) }))
    ]
    DEMO.messages[c.id] = []
    state.showCreateGroup = false
    openChat(c)
    showToast(isChannel ? '频道已创建（模拟）' : '群组已创建（模拟）')
    return
  }
  try {
    const payload = { name, member_ids: memberIds, is_channel: !!isChannel }
    if (description) payload.description = description
    const c = await api.createGroup(payload)
    state.showCreateGroup = false
    await loadConvs(true)
    openChat(c)
    showToast(isChannel ? '频道已创建' : '群组已创建')
  } catch (e) {
    showToast(e.message)
  }
}

export function openChatInfo() {
  state.showChatInfo = true
  if (state.chat && state.chat.type !== 'private') loadGroupMembers()
}

export async function loadGroupMembers() {
  if (!state.chat) return
  if (state.demoMode) {
    state.groupMembers = (DEMO.groupMembers[state.chat.id] || []).slice()
    return
  }
  try {
    const list = asArray(await api.getGroupMembers(state.chat.id))
    // 用户信息兜底：成员未内联用户信息时按 user_id 用通讯录补齐；本人以 state.me 为准（通讯录不含自己）
    const cmap = {}
    for (const c of state.contacts || []) if (c && c.id) cmap[c.id] = c
    state.groupMembers = list.map(m => {
      const uid = memberUid(m)
      if (state.me && uid !== '' && String(uid) === String(state.me.id)) return { ...m, user: state.me }
      const u = memberUser(m)
      const hasName = u && (u.display_name || u.name || u.username || u.nickname || u.phone)
      if (hasName || !uid || !cmap[uid]) return m
      return { ...m, user: cmap[uid] }
    })
  } catch (e) {
    showToast(e.message)
  }
}

/** 当前会话里我的角色：owner | admin | member（私聊返回 member） */
export function myChatRole() {
  const list = Array.isArray(state.groupMembers) ? state.groupMembers : []
  const m = list.find(x => String(memberUid(x)) === String(state.me.id))
  return m ? m.role : 'member'
}

export async function renameGroup(name, description) {
  const payload = {}
  if (name) payload.name = name
  if (description !== undefined) payload.description = description
  if (state.demoMode) {
    if (payload.name) state.chat.name = payload.name
    if (description !== undefined) state.chat.description = description
    showToast('群资料已更新（模拟）')
    return true
  }
  try {
    const c = await api.updateGroup(state.chat.id, payload)
    Object.assign(state.chat, c)
    loadConvs(true)
    showToast('群资料已更新')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

export async function addMembers(ids) {
  if (!ids.length) return false
  if (state.demoMode) {
    const arr = DEMO.groupMembers[state.chat.id] = DEMO.groupMembers[state.chat.id] || []
    ids.forEach(uid => {
      if (!arr.some(m => m.user_id === uid)) {
        arr.push({ user_id: uid, role: 'member', user: DEMO.users.find(x => x.id === uid) })
      }
    })
    state.groupMembers = arr.slice()
    state.chat.member_count = arr.length
    showToast('已添加成员（模拟）')
    return true
  }
  try {
    await api.addGroupMembers(state.chat.id, ids)
    await loadGroupMembers()
    showToast('已添加成员')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/** 移除成员；uid 为本人时即退群（退群后关闭聊天页） */
export async function removeMember(uid) {
  const isMe = uid === state.me.id
  if (state.demoMode) {
    const arr = (DEMO.groupMembers[state.chat.id] || []).filter(m => m.user_id !== uid)
    DEMO.groupMembers[state.chat.id] = arr
    state.groupMembers = arr.slice()
    state.chat.member_count = arr.length
    if (isMe) {
      const i = DEMO.convs.findIndex(c => c.id === state.chat.id)
      if (i >= 0) DEMO.convs.splice(i, 1)
      state.showChatInfo = false
      closeChat()
      showToast('已退出（模拟）')
    } else {
      showToast('已移除成员（模拟）')
    }
    return true
  }
  try {
    await api.removeGroupMember(state.chat.id, uid)
    if (isMe) {
      state.showChatInfo = false
      closeChat()
      showToast('已退出')
    } else {
      await loadGroupMembers()
      showToast('已移除成员')
    }
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

export async function setMemberRole(uid, role) {
  if (state.demoMode) {
    const m = (DEMO.groupMembers[state.chat.id] || []).find(x => x.user_id === uid)
    if (m) m.role = role
    state.groupMembers = (DEMO.groupMembers[state.chat.id] || []).slice()
    showToast('角色已更新（模拟）')
    return true
  }
  try {
    await api.setGroupMemberRole(state.chat.id, uid, role)
    await loadGroupMembers()
    showToast('角色已更新')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/* ─── 我的 ─── */
export async function updateProfile(payload) {
  if (state.demoMode) {
    Object.assign(state.me, payload)
    showToast('已保存（模拟）')
    return true
  }
  try {
    state.me = await api.updateProfile(payload)
    storage.user = state.me
    showToast('资料已更新')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/** 保存后端地址：支持 http(s):// 完整地址，也支持 /api/v1（走 vite dev 代理） */
export function saveServer(url) {
  if (!/^https?:\/\/.+/.test(url) && !/^\//.test(url)) {
    showToast('请输入合法地址（http(s)://… 或 /api/v1 代理路径）')
    return false
  }
  const u = url.replace(/\/+$/, '')
  state.baseURL = u
  setBaseURL(u)
  showToast('后端地址已更新')
  return true
}

/* ─── 定时器：秒表 / 会话 15s 轮询 / 消息 4s 轮询 ─── */
const timers = []
export function startTimers() {
  timers.push(setInterval(() => { state.nowTick = Date.now() }, 1000))
  timers.push(setInterval(() => { if (state.view === 'main' && !state.chat) loadConvs(true) }, 15000))
  timers.push(setInterval(() => { if (state.chat && !state.demoMode) loadMessages(true) }, 4000))
}
export function stopTimers() {
  timers.forEach(clearInterval)
  timers.length = 0
}
/* ─── 头像上传更换（个人 / 群） ─── */
/** 将图片文件读成 DataURL（演示模式直接本地展示，不上传后端） */
function avatarFileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('图片读取失败'))
    fr.readAsDataURL(file)
  })
}

/** 校验并上传头像，返回可入库的头像地址（演示模式返回 DataURL） */
async function uploadAvatarURL(file) {
  if (!file) return null
  if (!/^image\//.test(file.type)) { showToast('请选择图片文件'); return null }
  if (file.size > 50 * 1024 * 1024) { showToast('图片大小不能超过 50MB'); return null }
  if (state.demoMode) return avatarFileToDataURL(file)
  const up = await api.upload(file)
  return (up && (up.url || up.file_url)) || (typeof up === 'string' ? up : null)
}

/** 更换本人头像：上传 → PUT /auth/profile，成功返回 true */
export async function changeMyAvatar(file) {
  let url
  try { url = await uploadAvatarURL(file) } catch (e) { showToast(e.message); return false }
  if (!url) return false
  return await updateProfile({ avatar_url: url })
}

/** 更换当前群/频道头像：上传 → PUT /groups/{id}（前端已按群主/管理员控权） */
export async function changeGroupAvatar(file) {
  if (!state.chat) return false
  let url
  try { url = await uploadAvatarURL(file) } catch (e) { showToast(e.message); return false }
  if (!url) return false
  if (state.demoMode) {
    state.chat.avatar_url = url
    const c = DEMO.convs.find(x => x.id === state.chat.id)
    if (c) c.avatar_url = url
    showToast('群头像已更新（模拟）')
    return true
  }
  try {
    const c = await api.updateGroup(state.chat.id, { avatar_url: url })
    Object.assign(state.chat, c)
    loadConvs(true)
    showToast('群头像已更新')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}
