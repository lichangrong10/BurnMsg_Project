/**
 * 全局状态 + 业务动作（轻量 store，无第三方依赖）
 * 视图组件通过 import { state, ...actions } 使用
 */
import { reactive } from 'vue'
import { storage } from '../utils/storage'
import { http, setBaseURL } from '../utils/request'
import { api } from '../api'
import { DEMO } from '../mock/demo'
import { BURN_OPTIONS, memberUid, memberUser, memberName, messagePreview } from '../utils/format'
import { connectWs, disconnectWs, reconnectWs, onWs, WS_EVENTS } from '../utils/ws'
import { e2eSupported, ensureIdentity, encryptText, decryptMessage, cachePlaintext, getPlaintext, cachePlaintextFail, getPlaintextFail, clearE2E } from '../utils/e2e'
import { verifyPeerKey, confirmNewKey, syncPinnedKeys } from '../utils/tofu'

export const state = reactive({
  view: storage.forceChangePwd ? 'changePwd' : (storage.token ? 'main' : 'login'), // login | changePwd | main
  tab: 'chats',                           // chats | channels | contacts | me
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
  burnLeft: {},          // 焚毁本地倒计时：消息 id -> 剩余秒数（种入后端 remain_seconds，摆脱两端时钟偏差）
  burnMsgs: {},          // 焚毁消息快照：id -> {id,sender_id,created_at,conversation_id}（切走会话后焚毁也能持久化占位）
  tofuAlerts: [],        // TOFU 公钥变更告警横幅队列：[{user_id,name,oldPubkey,newPubkey}]
  pendingKeyChanges: {}, // 待处理密钥变更清单（「稍后处理」收纳处，进会话不再弹横幅）：Map<userId,{user_id,name,oldPubkey,newPubkey,created_at}>
  e2eOn: false,          // 当前会话「明文加密」开关（会话级记忆，仅单聊可开）
  e2eReady: false,       // 本机 E2E 密钥已就绪（已生成并上传公钥）
  pwdForm: { old: '', n1: '', n2: '' },
  pwdErr: '',
  pwdLoading: false,
  toast: '',
  nowTick: Date.now(),   // 每秒刷新，驱动焚毁倒计时
  showServerDialog: false,
  showCreateGroup: false, // 建群/频道页（覆盖层）
  createGroupAsChannel: false, // CreateGroup 打开时预设「频道」模式（openCreateGroup 设置，CreateGroup 挂载后消费复位）
  showChatInfo: false,    // 聊天信息/群管理页（覆盖层）
  showAdmin: false,       // 管理后台页（覆盖层，admin 可见入口）
  groupMembers: [],       // 当前群成员列表（含角色与用户信息）
  readWatermark: 0,       // 私聊对方已读水位线（ms 时间戳）：本人消息 created_at ≤ 此值即已读
  showAnnouncements: false, // 公告中心页（覆盖层）
  announcements: [],      // 公告列表（含 is_read 标记）
  annUnread: 0,           // 未读公告数（首页铃铛角标）
  urgentBanner: null,     // 首页紧急跑马灯展示的公告（最新未读 urgent）
  annFocusId: null,       // 进公告中心后自动展开的公告 id（从紧急横幅跳入时用）
  showFeedback: false,    // 意见反馈页（覆盖层）
  feedbackList: [],       // 我的反馈列表（含管理员回复）
  feedbackLoading: false  // 反馈列表加载中
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

/* 焚毁本地倒计时种入：优先用后端返回的 remain_seconds（相对剩余秒数），
   彻底摆脱 burn_at 绝对时间与客户端本地时钟不同步导致的倒计时偏移（如 10 秒变 20 秒）。
   只在尚未种入时种入一次，之后由全局秒表本地递减，避免轮询重拉时倒计时回跳。 */
function seedBurnLeft(m) {
  if (!m || m.id == null || m.is_blurred) return false
  if (state.burnLeft[m.id] != null) return false
  state.burnMsgs[String(m.id)] = { id: String(m.id), sender_id: m.sender_id, created_at: m.created_at, conversation_id: (m.conversation_id != null ? m.conversation_id : (state.chat && state.chat.id)) }
  if (m.remain_seconds != null) {
    state.burnLeft[m.id] = Math.max(1, Math.round(m.remain_seconds))
    return true
  }
  if (m.burn_at) { // 兜底：后端未返回 remain_seconds 时用绝对时间换算一次
    const left = Math.ceil((new Date(m.burn_at) - Date.now()) / 1000)
    if (left > 0) { state.burnLeft[m.id] = Math.max(1, left); return true }
  }
  return false
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
  storage.deviceRowId = (d.device && d.device.id) || '' // 登录成功后存后端设备表主键
  storage.demo = false
  state.demoMode = false
  state.me = d.user
  if (d.force_change_pwd || d.user.force_change_pwd) {
    state.view = 'changePwd'
    storage.forceChangePwd = true
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
    storage.forceChangePwd = false
    showToast('演示模式：密码已修改（模拟）')
    return true
  }
  state.pwdLoading = true
  try {
    await api.changePassword(state.pwdForm.old, state.pwdForm.n1)
    if (state.view === 'changePwd') { state.view = 'main'; bootstrap() }
    storage.forceChangePwd = false
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
  clearE2E() // 清除本机密钥对与明文缓存，防同设备切换账号串钥
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
  state.showAnnouncements = false
  state.announcements = []
  state.annUnread = 0
  state.urgentBanner = null
  state.annFocusId = null
  state.showFeedback = false
  state.feedbackList = []
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

/* ─── 会话删除（本地隐藏，不调用后端删除；收到新消息也不恢复显示） ─── */
export function hiddenConvIds() {
  try { return JSON.parse(localStorage.getItem('bm_hidden_convs') || '[]') } catch { return [] }
}
export function deleteConversation(c) {
  if (!c) return
  const id = String(c.id)
  const ids = hiddenConvIds().map(String)
  if (!ids.includes(id)) ids.push(id)
  try { localStorage.setItem('bm_hidden_convs', JSON.stringify(ids)) } catch { /* 忽略 */ }
  state.convs = state.convs.filter(x => String(x.id) !== id)
  if (state.chat && String(state.chat.id) === id) closeChat()
  showToast('已删除会话')
}
export function unhideConversation(id) {
  if (id == null) return
  const sid = String(id)
  try {
    const ids = hiddenConvIds().map(String).filter(x => x !== sid)
    localStorage.setItem('bm_hidden_convs', JSON.stringify(ids))
  } catch { /* 忽略 */ }
}

/* ─── 焚毁占位持久化（像撤回一样常驻：后端焚毁后不再返回该消息，本地记占位，轮询重拉时补回「此消息已焚毁」） ─── */
export function burnedMsgMap() {
  try { return JSON.parse(localStorage.getItem('bm_burned_msgs') || '{}') } catch { return {} }
}
export function markBurned(m) {
  if (!m || m.id == null) return
  if (m.is_burned !== undefined) m.is_burned = true
  if (m.is_blurred !== undefined) m.is_blurred = false
  const cid = String(m.conversation_id != null ? m.conversation_id : (state.chat && state.chat.id))
  if (!cid || cid === 'null' || cid === 'undefined') return
  const map = burnedMsgMap()
  const arr = (map[cid] || []).filter(x => String(x.id) !== String(m.id))
  arr.push({ id: String(m.id), sender_id: m.sender_id, created_at: m.created_at, conversation_id: cid })
  map[cid] = arr
  try { localStorage.setItem('bm_burned_msgs', JSON.stringify(map)) } catch { /* 忽略 */ }
}

/* ─── TOFU 公钥防替换：告警状态机（实际钉住/比对逻辑在 utils/tofu.js，这里只管 UI 触发的告警队列） ─── */
/** 用户 id → 可读名字（告警文案用），依次查：自己 / 当前私聊对方 / 群成员 / 通讯录 */
function tofuDisplayName(uid) {
  if (uid == null) return '对方'
  const sid = String(uid)
  if (state.me && String(state.me.id) === sid) return '我'
  if (state.chat && state.chat.type === 'private' && state.chat.other_user && String(state.chat.other_user.id) === sid) {
    return memberName(state.chat.other_user) || '对方'
  }
  const gm = state.groupMembers.find(x => String(memberUid(x)) === sid)
  if (gm) return memberName(gm) || '对方'
  const ct = (state.contacts || []).find(x => String(x.id) === sid)
  if (ct) return memberName(ct) || '对方'
  return '对方'
}

/* ─── 待处理密钥变更（「稍后处理」收纳处）：持久化，跨会话/重启保留，进会话不再弹横幅 ─── */
const PENDING_KEY = 'bm_pending_key_changes'
function readPendingKeys() {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '{}') } catch (e) { return {} }
}
function writePendingKeys(map) {
  state.pendingKeyChanges = map
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(map)) } catch (e) { /* 忽略 */ }
}
// 启动即读入内存（供聊天页右上角「密钥待办」与 raiseTofuAlert 拦截判断）
state.pendingKeyChanges = readPendingKeys()

/** 新增/更新一条公钥变更告警（同 user 去重，仅刷新密钥字段）；已纳入「待办」的 user 不再弹横幅，只刷新待办里的最新密钥 */
export function raiseTofuAlert(user_id, oldPubkey, newPubkey) {
  if (user_id == null) return
  const sid = String(user_id)
  const pend = state.pendingKeyChanges[sid]
  if (pend) {
    pend.oldPubkey = oldPubkey
    pend.newPubkey = newPubkey
    writePendingKeys({ ...state.pendingKeyChanges })
    return
  }
  const exist = state.tofuAlerts.find(a => String(a.user_id) === sid)
  if (exist) {
    exist.oldPubkey = oldPubkey
    exist.newPubkey = newPubkey
    return
  }
  state.tofuAlerts.unshift({ user_id: sid, name: tofuDisplayName(sid), oldPubkey, newPubkey })
}

/** 用户点「确认信任新密钥」→ 更新本地钉住 + 关横幅，加密发送恢复 */
export function confirmTofuKey(user_id) {
  const sid = String(user_id)
  const a = state.tofuAlerts.find(x => String(x.user_id) === sid)
  if (!a || !a.newPubkey) return
  confirmNewKey(sid, a.newPubkey)
  state.tofuAlerts = state.tofuAlerts.filter(x => String(x.user_id) !== sid)
  showToast('已信任新密钥，加密发送恢复')
}

/** 用户点「稍后处理」→ 关横幅并收纳进右上角「密钥待办」，此后进会话/收到 key:changed 都不再弹横幅（对方再次轮换仅刷新待办） */
export function dismissTofuAlert(user_id) {
  const sid = String(user_id)
  const a = state.tofuAlerts.find(x => String(x.user_id) === sid)
  state.tofuAlerts = state.tofuAlerts.filter(x => String(x.user_id) !== sid)
  if (a) {
    state.pendingKeyChanges[sid] = { user_id: sid, name: a.name, oldPubkey: a.oldPubkey, newPubkey: a.newPubkey, created_at: Date.now() }
    writePendingKeys({ ...state.pendingKeyChanges })
  }
  showToast('已收纳至聊天页右上角「密钥待办」')
}

/** 密钥待办：确认信任新密钥 → 更新本地钉住 + 移出待办，加密发送恢复 */
export function confirmPendingKey(user_id) {
  const sid = String(user_id)
  const p = state.pendingKeyChanges[sid]
  if (!p || !p.newPubkey) return
  confirmNewKey(sid, p.newPubkey)
  const map = { ...state.pendingKeyChanges }
  delete map[sid]
  writePendingKeys(map)
  showToast('已信任新密钥，加密发送恢复')
}

/** 密钥待办：忽略本次变更 → 移出待办，不更新钉住（保持阻断，下次再检测到变更仍会提醒） */
export function ignorePendingKey(user_id) {
  const sid = String(user_id)
  const map = { ...state.pendingKeyChanges }
  delete map[sid]
  writePendingKeys(map)
  showToast('已忽略')
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
  applyTheme(curThemeColor) // 进主界面先按本地已存主题色恢复，避免等接口期间闪回默认蓝
  await Promise.all([loadConvs(), loadContacts()])
  refreshAnnUnread()
  if (!state.demoMode) {
    if (storage.token) connectWs(storage.token) // 刷新页面后凭本地 token 恢复 WS 连接
    try {
      state.me = await api.getProfile()
      storage.user = state.me
      if (state.me && typeof state.me.topic === 'string' && state.me.topic.startsWith('#')) applyTheme(state.me.topic) // 以服务端保存的主题色为准
    } catch (e) { /* 忽略，沿用登录返回的用户信息 */ }
    initE2E() // 异步：确保密钥对存在并上传公钥，不阻塞启动
  }
}

/** E2E 初始化：本地无密钥对则生成 X25519 key pair，随后上传公钥（覆盖语义，静默失败） */
async function initE2E() {
  try {
    if (!(await e2eSupported())) { console.warn('[焚信] 当前环境不支持 X25519，端到端加密不可用'); return }
    const pubB64 = await ensureIdentity()
    await api.uploadIdentityKey(pubB64)
    state.e2eReady = true
  } catch (e) { console.warn('[焚信] E2E 初始化失败:', e && e.message) }
}

export async function loadConvs(quiet) {
  if (state.demoMode) {
    const ids = pinnedIds()
    const hidden = hiddenConvIds().map(String)
    DEMO.convs.forEach(c => { c.pinned = ids.includes(c.id) })
    state.convs = DEMO.convs.filter(c => !hidden.includes(String(c.id)))
    return
  }
  try {
    const list = asArray(await api.getConversations())
    const ids = pinnedIds()
    const hidden = hiddenConvIds().map(String)
    const prev = {}
    state.convs.forEach(c => { prev[c.id] = c })
    state.convs = list
      .map(c => {
        const old = prev[c.id]
        return {
          ...c,
          unread: (old && old.unread) ?? c.unread ?? 0,
          lastMsg: extractConvoPreview(c) || getLastMsg(c.id) || (old && old.lastMsg) || '',
          pinned: ids.includes(c.id)
        }
      })
      .filter(c => !hidden.includes(String(c.id)))
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
  state.e2eOn = c.type === 'private' && localStorage.getItem('bm_e2e_on_' + c.id) === '1' // 恢复本会话加密开关
  if (c.type !== 'private') loadGroupMembers() // 预取群成员：消息发送者名称/头像、群管理页共用
  if (!state.demoMode) { try { await api.markRead(c.id) } catch (e) { /* 静默 */ } }
  await loadMessages()
  if (!state.demoMode && c.type === 'private') loadReadWatermark()
  // TOFU：进单聊会话时批量比对对方公钥（兜底 WS 断线期间对方轮换；changed 则告警横幅）
  if (!state.demoMode && c.type === 'private' && c.other_user && c.other_user.id) {
    syncPinnedKeys([c.other_user.id], state.me.id).then(changed => {
      for (const it of changed) raiseTofuAlert(it.user_id, null, it.newPubkey)
    }).catch(() => {})
  }
}

/** 切换当前会话「明文加密」开关（仅单聊、非演示、设备支持时可用） */
export function toggleE2E() {
  const c = state.chat
  if (!c) return
  if (state.demoMode) { showToast('演示模式不支持端到端加密'); return }
  if (c.type !== 'private') { showToast('群聊/频道暂不支持端到端加密'); return }
  if (!state.e2eReady) { showToast('当前设备不支持端到端加密'); return }
  state.e2eOn = !state.e2eOn
  localStorage.setItem('bm_e2e_on_' + c.id, state.e2eOn ? '1' : '0')
  if (state.e2eOn && state.burnSeconds) showToast('已同时开启阅后焚毁与明文加密模式')
  else showToast(state.e2eOn ? '已开启明文加密：消息将端到端加密发送' : '已关闭明文加密')
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
    const ghosts = burnedMsgMap()[String(cid)] || []
    for (const g of ghosts) {
      if (!sorted.some(x => String(x.id) === String(g.id))) {
        sorted.push({ id: g.id, conversation_id: cid, sender_id: g.sender_id, created_at: g.created_at, is_burned: true })
      }
    }
    state.messages = sortByTimeAsc(sorted)
    sorted.forEach(seedBurnLeft) // 已点开未到期的焚毁消息：用后端 remain_seconds 种入本地倒计时
    syncRestorePlaintext(sorted) // 同步回填已缓存明文，避免轮询重拉时已解密消息闪回密文/占位
    decryptMessagesInList(sorted, cid) // 加密消息后台就地解密（有明文缓存时近乎零开销），不阻塞渲染
    syncChatPreview()
    if (!quiet) state.msgSeq++
  } catch (e) {
    console.error('[焚信] 拉取消息失败:', cid, e)
    if (!quiet) showToast(e.message)
  } finally {
    state.msgLoading = false
  }
}

/** 同步恢复已缓存的加密明文：重拉/替换消息列表后先就地回填，避免渲染瞬间明文闪回密文（getPlaintext 为同步读 localStorage） */
function syncRestorePlaintext(list) {
  for (const m of list) {
    if (m.is_encrypted && !m.is_blurred) {
      const cached = getPlaintext(m.id)
      if (cached != null) { m.content = cached; m.e2e = true }
      else if (getPlaintextFail(m.id)) { m.content = '加密消息（本设备无法解密）'; m.e2eFail = true }
    }
  }
}

/** 批量解密列表中的加密消息：先查本地明文缓存，无缓存则拉发送者公钥走 ECDH 解密；失败置占位文案 */
async function decryptMessagesInList(list, cid) {
  const targets = list.filter(m => m.is_encrypted && !m.is_recalled && !m.is_blurred) // 马赛克占位的焚毁消息等 reveal 后再解密
  if (!targets.length || !(await e2eSupported())) return
  const pubCache = {} // 同一发送者公钥只查一次
  const getPub = async uid => {
    const k = String(uid)
    if (!(k in pubCache)) {
      try { pubCache[k] = (await api.getIdentityKey(uid)).identity_pubkey } catch (e) { pubCache[k] = null }
    }
    return pubCache[k]
  }
  const run = async m => {
    const cached = getPlaintext(m.id)
    if (cached != null) { m.content = cached; m.e2e = true; return }
    if (getPlaintextFail(m.id)) { m.content = '加密消息（本设备无法解密）'; m.e2eFail = true; return }
    try {
      const pub = await getPub(m.sender_id)
      if (!pub) throw new Error('no pubkey')
      const text = await decryptMessage(m, pub, cid)
      cachePlaintext(m.id, text)
      m.content = text
      m.e2e = true
    } catch (e) {
      cachePlaintextFail(m.id)
      m.content = '加密消息（本设备无法解密）'
      m.e2eFail = true
    }
  }
  const queue = targets.slice()
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await run(queue.shift()) })) // 并发 4
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


/** 判断消息文本是否 @ 了当前用户（按本人展示名匹配） */
function mentionsMe(text) {
  if (!text) return false
  const me = state.me || {}
  const names = [me.display_name, me.name, me.username, me.nickname, me.real_name].filter(Boolean)
  if (!names.length) return false
  const s = String(text)
  return names.some(n => s.indexOf('@' + n) !== -1)
}

/** message:new：当前会话去重追加 + 滚动吸附；其他会话只更新预览/未读并重拉列表 */
async function onWsNewMessage(p) {
  if (!p || state.demoMode) return
  const m = normalizeMsg({ ...(p.message || {}) })
  const cid = p.conversation_id || m.conversation_id
  if (!m.id || !cid) return
  // 已删除（本地隐藏）的会话：新消息完全忽略，不响铃、不提示、不重新显示
  if (hiddenConvIds().map(String).includes(String(cid))) return
  const mine = String(m.sender_id) === String(state.me.id)
  // 加密消息：先解密（或读本地明文缓存）再入列表，预览/toast 同样用明文
  if (m.is_encrypted && !m.is_recalled && !m.is_blurred) {
    const cached = getPlaintext(m.id)
    if (cached != null) { m.content = cached; m.e2e = true }
    else if (!mine) {
      try {
        const pub = (await api.getIdentityKey(m.sender_id)).identity_pubkey
        const text = await decryptMessage(m, pub, cid)
        cachePlaintext(m.id, text)
        m.content = text
        m.e2e = true
      } catch (e) { cachePlaintextFail(m.id); m.content = '加密消息（本设备无法解密）'; m.e2eFail = true }
    } else {
      // 本人其他设备发的加密消息：协议上本设备无 ephemeral 私钥无法解密
      m.content = '加密消息（发送于其他设备）'
      m.e2eFail = true
    }
  }
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
      showToast(mentionsMe(m.content) ? '@了你：' + (messagePreview(m) || '').slice(0, 30) : '新消息：' + (messagePreview(m) || '').slice(0, 30)) // 会话外收到消息的文字提示
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

/** key:changed：对方轮换公钥 → 拉新公钥本地比对，不一致则告警（自己轮换忽略；payload 只有 user_id+updated_at，不带公钥） */
async function onWsKeyChanged(p) {
  if (!p || state.demoMode) return
  if (String(p.user_id) === String(state.me.id)) return // 自己轮换，忽略
  try {
    const vr = await verifyPeerKey(p.user_id)
    if (vr.status === 'changed') {
      raiseTofuAlert(p.user_id, vr.oldPubkey, vr.newPubkey)
      showToast('⚠️ 检测到对方安全密钥变更')
    }
  } catch (e) { /* 静默：拉取失败不打扰，启动/进会话批量比对兜底 */ }
}

/* 模块加载时注册一次（WS 连接由 login/bootstrap 建立，断线重连后事件仍生效） */
onWs(WS_EVENTS.MESSAGE_NEW, onWsNewMessage)
onWs(WS_EVENTS.MESSAGE_EDITED, onWsEdited)
onWs(WS_EVENTS.MESSAGE_RECALLED, onWsRecalled)
onWs(WS_EVENTS.CONVERSATION_UPDATED, p => {
  if (state.demoMode) return
  // 群被解散（群主解散/管理员强制解散）：实时给当前会话与列表打 dissolved 标记，禁止再发消息
  if (p && p.reason === 'dissolved') {
    const cid = p.conversation_id || (p.conversation && p.conversation.id)
    const at = p.dissolved_at || new Date().toISOString()
    const c = state.convs.find(x => String(x.id) === String(cid))
    if (c) c.dissolved_at = at
    if (state.chat && String(state.chat.id) === String(cid)) {
      state.chat.dissolved_at = at
    }
    // 通知：无论是否正打开该群，都提示用户群已被解散（提示音 + 文字）
    const name = (c && c.name) || (p.conversation && p.conversation.name)
      || (state.chat && String(state.chat.id) === String(cid) && state.chat.name) || ''
    const isChannel = (c && c.type === 'channel')
      || (state.chat && String(state.chat.id) === String(cid) && state.chat.type === 'channel')
    playMsgDing()
    showToast(name
      ? (isChannel ? `频道「${name}」已被解散` : `群聊「${name}」已被群主解散`)
      : '该群聊已被群主解散')
  }
  // 群主变更（owner 转让群）：当前打开的群重拉成员列表，界面角色徽标/操作菜单即时刷新
  if (p && p.reason === 'owner_changed') {
    const cid = p.conversation_id || (p.conversation && p.conversation.id)
    if (state.chat && String(state.chat.id) === String(cid)) {
      loadGroupMembers()
      showToast('群主已变更')
    }
  }
  scheduleConvReload()
})
onWs(WS_EVENTS.RECEIPT_READ, onWsReceiptRead)
onWs(WS_EVENTS.KEY_CHANGED, onWsKeyChanged)

/* ─── 系统公告（App 端只读展示） ─── */
/** 刷新未读公告角标（启动/轮询/收到推送时调用，静默失败） */
export async function refreshAnnUnread() {
  if (state.demoMode) {
    state.annUnread = (DEMO.announcements || []).filter(a => !a.is_read).length
    return
  }
  try {
    const d = await api.getAnnouncementUnread()
    state.annUnread = (d && d.unread) || 0
  } catch (e) { /* 静默：角标不打扰 */ }
}

/** 拉取公告列表并同步未读角标/首页紧急横幅（quiet=静默失败，用于后台刷新） */
export async function loadAnnouncements(quiet) {
  if (state.demoMode) {
    state.announcements = (DEMO.announcements || []).slice()
    updateUrgentBanner()
    refreshAnnUnread()
    return
  }
  try {
    const d = await api.getAnnouncements()
    state.announcements = asArray(d)
    updateUrgentBanner()
    refreshAnnUnread()
  } catch (e) {
    if (!quiet) showToast(e.message)
  }
}

/** 用户 × 掉的紧急横幅公告 id（本地持久化，防重拉列表后复活） */
function annDismissedId() {
  try { return localStorage.getItem('bm_ann_dismissed') || '' } catch { return '' }
}

/** 从公告列表计算首页紧急横幅：最新一条未读且未被 × 掉的 urgent 公告 */
function updateUrgentBanner() {
  const list = state.announcements || []
  state.urgentBanner = (list.find(a => a.priority === 'urgent' && !a.is_read && a.id !== annDismissedId()) || list.find(a => !a.is_read && a.id !== annDismissedId())) || null
}

/* 打开建群/频道弹窗；asChannel=true 预设「频道」模式（CreateGroup 挂载后消费复位） */
function openCreateGroup_X_DUPLICATE(asChannel = false) { /* 重复定义，已被下方群组区块版本取代 */
  state.createGroupAsChannel = asChannel
  state.showCreateGroup = true
}

/** 打开公告中心 */
export function openAnnouncements() {
  state.showAnnouncements = true
  loadAnnouncements()
}

/** 点击首页紧急横幅：进公告中心并自动展开该条公告详情卡片 */
export function openUrgentBanner() {
  if (!state.urgentBanner) return
  state.annFocusId = state.urgentBanner.id
  openAnnouncements()
}

/** × 掉首页紧急横幅：本地记录 + 标记已读 + 立即隐藏 */
export function dismissUrgentBanner() {
  const a = state.urgentBanner
  if (!a) return
  try { localStorage.setItem('bm_ann_dismissed', a.id) } catch { /* 忽略 */ }
  state.urgentBanner = null
  readAnnouncement(a)
}

/** 点开公告详情：未读则上报已读（一人一公告幂等），并本地同步角标 */
export async function readAnnouncement(a) {
  if (!a || a.is_read) return
  a.is_read = true
  state.annUnread = Math.max(0, state.annUnread - 1)
  if (state.demoMode) return
  try {
    await api.markAnnouncementRead(a.id)
  } catch (e) { /* 静默：已读上报失败不影响阅读 */ }
}

/** 全部已读：本地立即置已读并清首页横幅，后台并发上报（幂等静默） */
export async function markAllAnnouncementsRead() {
  const list = state.announcements || []
  const unread = list.filter(a => !a.is_read)
  if (!unread.length) return
  list.forEach(a => { a.is_read = true })
  state.annUnread = 0
  state.urgentBanner = null
  if (state.demoMode) return
  await Promise.all(unread.map(a => api.markAnnouncementRead(a.id).catch(() => {})))
}

/** announcement:new：公告实时推送 → 提示音 + toast + 角标/列表联动；urgent 立即上首页跑马灯 */
onWs(WS_EVENTS.ANNOUNCEMENT_NEW, p => {
  if (state.demoMode) return
  playMsgDing()
  const ann = (p && (p.announcement || p.data || p)) || {}
  showToast('新公告：' + (ann.title || '点击查看'))
  if (state.showAnnouncements) loadAnnouncements()
  else { refreshAnnUnread(); loadAnnouncements(true) }
  // urgent：payload 带完整公告时立即上首页跑马灯，并静默拉列表同步角标/横幅
  if (ann.priority === 'urgent') {
    if (ann.id && ann.title && ann.content && ann.id !== annDismissedId()) {
      state.urgentBanner = { ...ann, is_read: false }
    }
    loadAnnouncements(true)
  }
})

/* ─── 意见反馈 ─── */
/** 拉取我的反馈列表（含管理员回复；quiet=静默失败） */
export async function loadFeedback(quiet) {
  if (state.demoMode) {
    state.feedbackList = (DEMO.feedbacks || []).slice()
    return
  }
  state.feedbackLoading = true
  try {
    const d = await api.getMyFeedback()
    state.feedbackList = asArray(d)
  } catch (e) {
    if (!quiet) showToast(e.message)
  } finally {
    state.feedbackLoading = false
  }
}

/** 打开意见反馈页 */
export function openFeedback() {
  state.showFeedback = true
  loadFeedback(true)
}

/** 提交意见反馈（content 必填，contact 选填），成功后静默刷新列表 */
export async function submitFeedback(content, contact) {
  const c = (content || '').trim()
  if (!c) { showToast('请先填写反馈内容'); return false }
  const payload = { content: c }
  if (contact && contact.trim()) payload.contact = contact.trim()
  if (state.demoMode) {
    state.feedbackList.unshift({
      id: 'demo-fb-' + Date.now(),
      content: c,
      contact: payload.contact || null,
      status: 'pending',
      admin_reply: null,
      replied_at: null,
      created_at: new Date().toISOString()
    })
    showToast('反馈提交成功（演示）')
    return true
  }
  try {
    await api.submitFeedback(payload)
    showToast('反馈提交成功')
    loadFeedback(true)
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/* token 刷新成功后用新 token 重建 WS（旧 token 握手会持续失败） */
window.addEventListener('bm-token-refreshed', () => {
  if (!state.demoMode && storage.token) reconnectWs(storage.token)
})

export function setBurn(v) {
  state.burnSeconds = v
  if (v) {
    const o = BURN_OPTIONS.find(x => x.v === v)
    const label = o ? o.label : ''
    if (state.e2eOn) showToast('已同时开启阅后焚毁与明文加密模式：密文将在 ' + label + ' 后销毁')
    else showToast('阅后即焚：' + label)
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
  if (state.burnSeconds) payload.burn_ttl_seconds = state.burnSeconds // 点开才焚：传点开后多少秒焚毁（后端据此下发马赛克占位，点开 reveal 才给内容）
  if (state.demoMode) {
    // demo 无后端 reveal，本地用 destroy_at 兜底倒计时（真实后端走 burn_ttl_seconds + reveal）
    const m = { id: DEMO.uid(), sender_id: state.me.id, created_at: new Date().toISOString(), is_recalled: false, is_edited: false, ...payload, destroy_at: state.burnSeconds ? new Date(Date.now() + state.burnSeconds * 1000).toISOString() : undefined }
    ;(DEMO.messages[state.chat.id] = DEMO.messages[state.chat.id] || []).push(m)
    state.messages.push(m)
    state.chat.lastMsg = text
    state.chat.last_message_at = m.created_at
    return true
  }
  // 明文加密（E2E）：仅单聊 + 开关开启 + 密钥就绪；content 存占位，密文走 cipher_* 字段
  if (state.e2eOn && state.e2eReady && state.chat.type === 'private') {
    try {
      const peerId = state.chat.other_user && state.chat.other_user.id
      // TOFU：加密发送前必经公钥比对（首次钉住/一致放行/变更阻断+告警/缺失提示），不再裸调 GET /keys/:id
      const vr = await verifyPeerKey(peerId)
      if (vr.status === 'missing') {
        showToast('对方尚未启用加密，请点锁图标关闭后明文发送')
        return false
      }
      if (vr.status === 'changed') {
        raiseTofuAlert(peerId, vr.oldPubkey, vr.newPubkey)
        showToast('⚠️ 对方安全密钥已变更，本次发送已阻断，请在顶部横幅确认')
        return false
      }
      const enc = await encryptText(text, vr.pubkey, state.chat.id)
      const m = await api.sendMessage({ ...payload, content: '[加密消息]', ...enc })
      cachePlaintext(m.id, text) // 协议上发送方无法再解密自己的消息，明文本地缓存
      m.content = text
      m.e2e = true
      pushMsgDedup(m)
      state.chat.lastMsg = text
      setLastMsg(state.chat.id, text)
      return true
    } catch (e) {
      showToast(e.message)
      return false
    }
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
    if (state.burnSeconds) payload.burn_ttl_seconds = state.burnSeconds // 点开才焚：传点开后多少秒焚毁（后端据此下发马赛克占位，点开 reveal 才给内容）
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

/** 点开焚毁消息（点开才焚 v2）：调 reveal 拉取完整内容，就地回填明文/密文，开始个人焚毁倒计时 */
export async function revealBurn(m) {
  if (!m || m.id == null || state.demoMode) return false
  try {
    const full = await api.revealMessage(m.id) // 拦截器已解包 {code,message,data}，返回完整 Message
    if (!full || typeof full !== 'object') throw new Error('reveal 返回异常')
    Object.assign(m, normalizeMsg(full))
    m.is_blurred = false
    seedBurnLeft(m) // 用后端返回的 remain_seconds 启动本地倒计时（不用 burn_at 绝对时间，避免两端时钟不同步）
    // 焚毁消息本身可能是 E2E 加密的：拿到密文后走本地解密（有明文缓存则直读）
    if (m.is_encrypted && !m.is_recalled) {
      const cached = getPlaintext(m.id)
      if (cached != null) { m.content = cached; m.e2e = true }
      else {
        try {
          const pub = (await api.getIdentityKey(m.sender_id)).identity_pubkey
          const text = await decryptMessage(m, pub, state.chat && state.chat.id)
          cachePlaintext(m.id, text)
          m.content = text
          m.e2e = true
        } catch (e) { cachePlaintextFail(m.id); m.content = '加密消息（本设备无法解密）'; m.e2eFail = true }
      }
    }
    return true
  } catch (e) {
    const msg = (e && e.message) || ''
    // 已焚毁/非焚毁/已撤回等业务态：占位卡已无意义，就地移除；网络错误保留占位卡可重试
    if (/404|不存在|焚毁|400|非焚毁|撤回/i.test(msg)) {
      markBurned(m)
    }
    showToast(msg || '点开失败')
    return false
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
    unhideConversation(c.id) // 重新发起私聊：解除本地隐藏，会话回到列表
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
export function openCreateGroup(asChannel) {
  state.createGroupAsChannel = !!asChannel
  state.showCreateGroup = true
}

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

/** 当前会话里我的角色：owner | member（私聊返回 member） */
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

/** 群主解散群（解散即焚，不可恢复）：成功后给会话打 dissolved 标记并关闭聊天页 */
export async function dissolveGroup() {
  if (!state.chat) return false
  const cid = state.chat.id
  const mark = () => {
    const at = new Date().toISOString()
    const c = state.convs.find(x => String(x.id) === String(cid))
    if (c) c.dissolved_at = at
  }
  if (state.demoMode) {
    mark()
    state.showChatInfo = false
    closeChat()
    showToast('群组已解散（模拟）')
    return true
  }
  try {
    await api.dissolveGroup(cid)
    mark()
    state.showChatInfo = false
    closeChat()
    showToast('群组已解散')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/** 群主转让群：老群主自动降为管理员，新群主须为本群成员（不能转让给自己） */
export async function transferOwnership(uid) {
  if (!state.chat) return false
  if (state.demoMode) {
    const arr = DEMO.groupMembers[state.chat.id] || []
    const oldO = arr.find(x => x.role === 'owner')
    const newO = arr.find(x => String(x.user_id) === String(uid))
    if (oldO) oldO.role = 'member'
    if (newO) newO.role = 'owner'
    state.groupMembers = arr.slice()
    showToast('群主已转让（模拟）')
    return true
  }
  try {
    await api.transferGroup(state.chat.id, uid)
    await loadGroupMembers()
    showToast('群主已转让')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/* ─── 主题色：一个 CSS 变量驱动全局（顶栏/按钮/气泡/徽标/选中态随之联动） ─── */
const DEFAULT_THEME_COLOR = '#3390EC'
/** '#RRGGBB' → [r,g,b]，非法输入返回 null */
function hexToRgb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(typeof hex === 'string' ? hex.trim() : '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** [r,g,b] → '#RRGGBB' */
function rgbToHex(rgb) {
  const h = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return ('#' + h(rgb[0]) + h(rgb[1]) + h(rgb[2])).toUpperCase()
}
/** 派生色：ratio>0 向白混合（变亮），ratio<0 向黑混合（变暗） */
function shadeHex(hex, ratio) {
  const rgb = hexToRgb(hex)
  if (!rgb) return hex
  const t = ratio > 0 ? 255 : 0
  const p = Math.abs(ratio)
  return rgbToHex(rgb.map(v => v + (t - v) * p))
}

let curThemeColor = (storage.user && typeof storage.user.topic === 'string' && storage.user.topic.startsWith('#')) ? storage.user.topic : DEFAULT_THEME_COLOR

/** 应用主题色：改写 --tg-blue 系列 CSS 变量，全 App 引用处实时联动 */
export function applyTheme(color) {
  const rgb = hexToRgb(color)
  if (!rgb) return
  curThemeColor = rgbToHex(rgb)
  const st = document.documentElement.style
  st.setProperty('--tg-blue', curThemeColor)
  st.setProperty('--tg-blue-rgb', rgb.join(','))
  st.setProperty('--tg-blue-dark', shadeHex(curThemeColor, -0.1))
  st.setProperty('--tg-blue-light', shadeHex(curThemeColor, 0.14))
  /* 头像首字符底色：按主题色派生 7 档明暗（深浅交错，白字均可读） */
  const AV_SHADES = [0, -0.12, 0.12, -0.24, 0.22, -0.18, -0.06]
  AV_SHADES.forEach((r, i) => st.setProperty('--tg-av-' + i, shadeHex(curThemeColor, r)))
  /* 紧急公告色：主题色加深（比普通主题元素深一档，保持紧迫感但不脱离主题） */
  const urg = shadeHex(curThemeColor, -0.22)
  st.setProperty('--tg-urgent', urg)
  st.setProperty('--tg-urgent-rgb', hexToRgb(urg).join(','))
  st.setProperty('--tg-urgent-light', shadeHex(curThemeColor, -0.06))
}

/** 当前主题色（'#RRGGBB'） */
export function getThemeColor() { return curThemeColor }

/** 选定主题色：立即全局生效 + 本地持久化 + 同步后端 topic 字段（7 字符，满足 20 字限制） */
export function setTheme(color) {
  applyTheme(color)
  state.me = { ...state.me, topic: curThemeColor }
  storage.user = state.me
  if (!state.demoMode) api.updateProfile({ topic: curThemeColor }).catch(() => {})
}

// 模块加载即应用本地已存主题色（首屏渲染前生效，避免闪回默认蓝）
applyTheme(curThemeColor)

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
  // 焚毁本地倒计时秒表：每秒递减，到 0 移除消息（独立于绝对时钟，不受客户端-服务端时钟不同步影响）
  timers.push(setInterval(() => {
    const ids = Object.keys(state.burnLeft)
    if (!ids.length) return
    for (const id of ids) {
      state.burnLeft[id] -= 1
      if (state.burnLeft[id] <= 0) {
        delete state.burnLeft[id]
        const burned = state.messages.find(x => String(x.id) === String(id))
        const snap = state.burnMsgs[id]
        if (burned) { if (!burned.is_burned) markBurned(burned) }
        else if (snap) markBurned(snap)
        delete state.burnMsgs[id]
      }
    }
  }, 1000))
  timers.push(setInterval(() => { if (state.view === 'main' && !state.chat) { loadConvs(true); refreshAnnUnread() } }, 15000))
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