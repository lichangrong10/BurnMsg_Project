/**
 * 全局状态 + 业务动作（轻量 store，无第三方依赖）
 * 视图组件通过 import { state, ...actions } 使用
 */
import { reactive, watch } from 'vue'
import { storage } from '../utils/storage'
import { http, setBaseURL } from '../utils/request'
import { api } from '../api'
import { DEMO } from '../mock/demo'
import { burnLabelOf, convName, memberUid, memberUser, memberName, messagePreview } from '../utils/format'
import { notifyNewMessage, notifySystem } from '../utils/notify'
import { connectWs, disconnectWs, reconnectWs, onWs, WS_EVENTS, isWsConnected } from '../utils/ws'
import { bindPushAlias, unbindPushAlias, isPushActive } from '../utils/push'
import { setupAppState } from '../utils/appstate'
import { enableKeepAlive, disableKeepAlive } from '../utils/keepalive'

/**
 * 是否让本地通知给极光让位。
 * 默认 false：极光只推离线用户，而 WS 活着=在线，后端不推，二者不重叠（PUSH_JPUSH.md §0/§8）。
 * 仅当实测出现「同一条消息弹两次」才改 true。
 */
const NOTIFY_SUPPRESS_LOCAL = false
import { e2eSupported, ensureIdentity, encryptText, decryptMessage, cachePlaintext, getPlaintext, cachePlaintextFail, getPlaintextFail, clearE2E } from '../utils/e2e'
import { verifyPeerKey, confirmNewKey, syncPinnedKeys } from '../utils/tofu'
import { Capacitor } from '@capacitor/core'

/* ─── 焚毁时长（V6.1）───
   时长不再由客户端编码后塞进 app_users.default_burn_ttl_seconds，也不再随消息传：
   私聊存「我对 TA 的设置」、群/频道存「我在本群的设置」，统一落在服务端 burn_settings；
   生效值 = 会话设置 → 全局默认（app_users.default_burn_ttl_seconds，只读）→ 不焚毁。 */

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
  loadingEarlier: false,  // 正在向上加载更早历史消息（滚顶分页）
  hasMore: true,          // 当前会话是否还有更早的历史消息可加载
  msgSeq: 0,             // 非静默加载消息完成时 +1，聊天页据此强制滚到底部
  newMsgSeq: 0,          // 轮询发现「更新的消息」时 +1（按最新时间戳判定，不依赖条数变化）
  burnSeconds: 0,        // 当前会话生效的焚毁时长（秒），0 = 不焚毁；进会话时由 GET /burn-settings/conversations/:cid 解析
  burnOff: false,        // 当前会话「关闭焚毁」开关（本机记忆，仅影响本机发送）：true 时发送带 burn_ttl_seconds=0
  burnSource: 'none',    // 生效来源：contact_setting | conversation_setting | global_default | none
  burnGlobalDefault: 0,  // 服务端全局默认（app_users.default_burn_ttl_seconds），只读展示
  burnMySetting: null,   // 我在本会话的个人设置 { ttl_seconds, updated_at }，null = 未单独设置
  mediaBurnOn: false,    // 语音视频焚毁模式（只作用于本次会话的音视频发送，纯前端状态，不写服务端）
  burnLeft: {},          // 焚毁本地倒计时：消息 id -> 剩余秒数（种入后端 remain_seconds，摆脱两端时钟偏差）
  burnMsgs: {},          // 焚毁消息快照：id -> {id,sender_id,created_at,conversation_id}（切走会话后焚毁也能持久化占位）
  mediaPending: {},      // 音视频焚毁消息待消费登记：id -> message 对象（已 reveal 未 consume，离开聊天页时批量 consume）
  readers: {},           // 群聊已读进度缓存：消息 id -> { total, revealed, burned, readers:[] }（api.getReaders，进操作菜单/长按时拉取）
  presence: {},          // 用户在线态缓存：userId -> { is_online, online_devices, last_active_at }（api.getPresenceUsers）
  presenceMe: null,      // 本人多设备在线态（api.getPresenceMe）：{ is_online, current_device_id, devices:[] }
  sessionConflict: null, // 登录冲突弹窗：{ reason:'kicked_by_new_login'|'notify', title, text, blocking }（App.vue 渲染）
  destroyAcking: {},     // 两阶段销毁 ack 去重：会话 id -> 进行中标记（防并发重复 POST）
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
  groupMembersAt: 0,      // 群成员列表拉取时间（群已读进度据此判断是否要重拉）
  readWatermark: 0,       // 私聊对方已读水位线（ms 时间戳）：本人消息 created_at ≤ 此值即已读
  receiptSeq: 0,          // 收到 receipt:read 时 +1（驱动群聊「3/4 已读」重新聚合）
  showAnnouncements: false, // 公告中心页（覆盖层）
  announcements: [],      // 公告列表（含 is_read 标记）
  annUnread: 0,           // 未读公告数（首页铃铛角标）
  annPopup: null,         // 首页弹窗展示的最新未读公告
  annFocusId: null,       // 进公告中心后自动展开的公告 id（从紧急横幅跳入时用）
  showFeedback: false,    // 意见反馈页（覆盖层）
  feedbackList: [],       // 我的反馈列表（含管理员回复）
  feedbackLoading: false, // 反馈列表加载中
  showGlobalSearch: false, // 全局消息搜索页（覆盖层）
  showNotifyGuide: false,  // 通知设置指引页（覆盖层，PUSH_JPUSH.md §9）
  targetMessageId: null,   // 全局搜索跳转定位：目标消息 id（ChatRoom 消费后清空）
  layout: 'mobile'         // 布局模式：mobile(默认/原生App) | tablet(web中屏) | desktop(web宽屏双栏)
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

/* 焚毁截止时间表（id → 绝对时间戳 epochMs）：内存态，重进会话时由后端 remain_seconds 重新种入。
   ⚠️ 倒计时必须按「截止时间 − 现在」重算，绝不能每个滴答 −1：
   WebView / 浏览器在切后台、锁屏、省电模式下会暂停或节流 setInterval，漏掉的滴答不可恢复，
   用递减法时 7 天档（604800 次滴答）永远跑不完，用户看到的就是「一周到了却没焚毁」。 */
const burnDeadline = {}

/* 焚毁本地倒计时种入：优先用后端返回的 remain_seconds（相对剩余秒数），
   彻底摆脱 burn_at 绝对时间与客户端本地时钟不同步导致的倒计时偏移（如 10 秒变 20 秒）。
   只在尚未种入时种入一次，之后由 tickBurn 按 burnDeadline 重算，避免轮询重拉时倒计时回跳。

   ⚠️ 两条「防复活」规则（否则倒计时末尾会「闪两下 + 凭空多一两秒」）：
   ① 已焚毁的消息不得再种入 —— 后端整行还没删时，4s 轮询会把同一份数据当新对象带回来（无 is_burned 字段）；
   ② remain_seconds ≤ 0（已过期）不得再被 Math.max(1, …) 钳到 1 秒重新起跳，直接落成「此消息已焚毁」占位。 */
function seedBurnLeft(m) {
  if (!m || m.id == null || m.is_blurred) return false
  if (m.is_burned) return false // ① 已焚毁：轮询带回来的同 id 消息不得重新起跳
  if (state.burnLeft[m.id] != null || burnDeadline[m.id] != null) return false
  let left = 0
  if (m.remain_seconds != null) {
    // ceil 而非 round：宁晚勿早。round 向下取整时客户端常比后端先归零，正好打开「已焚毁 → 复活」的闪烁窗口
    const v = Math.ceil(Number(m.remain_seconds))
    if (Number.isFinite(v)) {
      if (v <= 0) { markBurned(m); return false } // ② 已过期：立即焚毁，不显示正文，也不再凭空补 1 秒
      left = v
    }
  }
  if (left <= 0 && m.burn_at) { // 兜底：后端未返回 remain_seconds 时用绝对时间换算一次
    const v = Math.ceil((new Date(m.burn_at) - Date.now()) / 1000)
    if (Number.isFinite(v) && v > 0) left = v
  }
  if (left <= 0) {
    // 绝对时间也已过期（关页面 / 离线期间烧完的）：直接落「此消息已焚毁」占位并持久化。
    // 否则重进页面时后端已不再返回该行、本地又没有占位记录 → 整条消息凭空消失（用户说的「气泡哪去了」）
    const endStr = m.burn_at || m.destroy_at
    const t = endStr ? Date.parse(endStr) : NaN
    if (Number.isFinite(t) && t <= Date.now()) markBurned(m)
    return false
  }
  state.burnMsgs[String(m.id)] = { id: String(m.id), sender_id: m.sender_id, created_at: m.created_at, conversation_id: (m.conversation_id != null ? m.conversation_id : (state.chat && state.chat.id)) }
  burnDeadline[m.id] = Date.now() + left * 1000 // 记绝对截止时间：秒表按它重算，漏掉多少次滴答都能自愈
  state.burnLeft[m.id] = left
  return true
}

/* 焚毁秒表：每次触发都用截止时间重算剩余秒（自愈式），到点就地焚毁。
   回到前台的第一跳会把后台期间漏掉的时间一次性补齐，因此长档位（1 小时 / 1 天 / 1 周）也能准点焚毁。 */
function tickBurn() {
  const now = Date.now()
  const ids = Object.keys(burnDeadline)
  for (const id of ids) {
    const left = Math.ceil((burnDeadline[id] - now) / 1000)
    if (left > 0) { state.burnLeft[id] = left; continue }
    delete burnDeadline[id]
    delete state.burnLeft[id]
    const burned = state.messages.find(x => String(x.id) === String(id))
    const snap = state.burnMsgs[id]
    const snapCid = snap && snap.conversation_id
    if (burned) { if (!burned.is_burned) markBurned(burned, snapCid) }
    else if (snap) markBurned(snap, snapCid)
    delete state.burnMsgs[id]
  }
  // ── 对账（关键）：把「持久化判定」对齐到「展示判定」 ──
  // isBurned() 有三条路能让气泡变成「此消息已焚毁」：本地秒表归零 / is_burned 字段 / 后端绝对时间到期。
  // 原来只有前两条会调 markBurned 写占位，第三条（burn_at、destroy_at 到期）是纯展示判定、不落本地记录，
  // 于是出现「刚焚毁能看到气泡」→「后端把该行删掉后下一轮轮询整条抹掉，气泡消失」。
  // 这里每秒兜一次底：绝对时间到期即落占位（幂等，dedupe 按 id）。
  if (!state.messages.length) return
  const curCid = state.chat && state.chat.id
  for (const m of state.messages) {
    if (!m || m.id == null || m.is_burned || m.is_recalled) continue
    const end = m.burn_at || m.destroy_at
    if (!end) continue
    const t = Date.parse(end)
    if (Number.isFinite(t) && t <= now) markBurned(m, curCid != null ? curCid : undefined)
  }
}

/* 焚毁倒计时重同步：清掉本地冻结值，用后端最新 remain_seconds 重新种入。
   触发时机：回到前台（App 切后台期间 setInterval 被挂起）、收到 message:destroyed、重进会话。
   不重同步时，长时间切后台再回来，本地秒表会落后于服务端，出现「僵尸消息」（用户能看到已过期内容）。 */
export function resyncBurnCountdown(list) {
  const arr = Array.isArray(list) ? list : state.messages
  for (const m of arr) {
    if (!m || m.id == null) continue
    if (m.burn_ttl_seconds == null && m.burn_at == null && m.destroy_at == null) continue
    delete state.burnLeft[m.id] // 清掉冻结值
    delete burnDeadline[m.id]
  }
  arr.forEach(seedBurnLeft) // 用最新 remain_seconds 重新种
}

/* 两阶段销毁的第二阶段：后端只标记 is_destroyed，真正删行要前端进会话时确认一次。
   静默执行：此时用户看到的已经是墓碑，确认只是让服务端释放存储，不改变可见性。 */
export async function confirmDestroyed(cid) {
  const id = cid != null ? cid : (state.chat && state.chat.id)
  if (id == null || state.demoMode) return
  const key = String(id)
  if (state.destroyAcking[key]) return // 并发去重：进会话 + WS 事件 + 回前台可能同时触发
  state.destroyAcking[key] = true
  try {
    const d = await api.getPendingDestroy(id)
    const pending = (d && (d.pending || d.list || d.items)) || []
    const ids = (Array.isArray(pending) ? pending : [])
      .map(p => (p && (p.message_id != null ? p.message_id : p.id)))
      .filter(x => x != null)
    if (!ids.length) return
    const r = await api.ackDestroy(id, { message_ids: ids })
    const purged = new Set((((r && r.purged_ids) || [])).map(String))
    for (const m of state.messages) {
      if (purged.has(String(m.id))) {
        m.is_destroyed = true
        m.is_burned = true
        m.purged = true // 服务端已真删：本地保留墓碑渲染，不再等待后端数据
        delete state.burnLeft[m.id]
        delete burnDeadline[m.id]
      }
    }
  } catch (e) {
    /* 静默：断网/后端未升级都不影响聊天，下次进会话再试 */
  } finally {
    delete state.destroyAcking[key]
  }
}

/* 群聊已读进度（自己的消息「N/M 已读」）。
   后端已移除 /messages/{id}/readers，且 receipt.is_read 目前不会被 read 接口更新，
   所以真实来源是成员的 last_read_message_id（/groups/{cid}/members）：
   成员的最后已读消息时间 ≥ 本条消息时间 → 该成员已读。
   结果缓存到 state.readers，供气泡下方进度和明细面板使用。失败静默。 */
const READER_NAME_OK = n => !!(n && n !== '成员')

/** 用一份成员列表算出单条消息的已读聚合（纯本地计算，不发请求）。
 *  ctx = { times: Map(消息id → ms), missing: Set(找不到的消息id) }
 *  墓碑消息（已焚毁）也用同一个规则：按 created_at 与成员 last_read 位置比较，得到「焚毁前最后已知」的已读状态。 */
function computeReaderAgg(m, members, ctx) {
  const mTime = msgTime(m)
  const times = (ctx && ctx.times) || new Map()
  const missing = (ctx && ctx.missing) || new Set()
  const readers = (members || [])
    .filter(x => String(memberUid(x)) !== String(state.me.id))
    .map(x => {
      const lr = x && x.last_read_message_id
      let read = false
      if (lr != null) {
        const key = String(lr)
        if (key === String(m.id)) read = true
        else if (times.has(key)) read = mTime > 0 && times.get(key) >= mTime
        // 定位不到那条消息（多已被焚毁销毁）：视为已读，否则「读过了却显示未读」
        else if (missing.has(key)) read = true
      }
      const nm = memberName(x)
      return { user_id: memberUid(x), user_display_name: READER_NAME_OK(nm) ? nm : '', is_read: read, is_revealed: false, read_at: null, burn_at: null }
    })
  return { total: readers.length, revealed: readers.filter(r => r.is_read).length, burned: 0, readers }
}

/* last_read 指向的消息经常不在当前加载窗口里（更早、或已被焚毁删除），
   这里把它的时间解析出来：本地消息 → 焚毁墓碑 → 往前翻页；都找不到的记为 missing。
   结果按「会话|消息id」缓存在内存里，避免每次刷新重复翻页。 */
const lrTimeCache = {}
async function resolveLastReadCtx(cid, members) {
  const times = new Map()
  const unknown = []
  const ghostAll = burnedMsgMap()
  const ghosts = Array.isArray(ghostAll[String(cid)]) ? ghostAll[String(cid)] : []
  for (const mb of members || []) {
    const lr = mb && mb.last_read_message_id
    if (!lr) continue
    const id = String(lr)
    if (times.has(id)) continue
    const cacheKey = String(cid) + '|' + id
    if (lrTimeCache[cacheKey] != null) { times.set(id, lrTimeCache[cacheKey]); continue }
    const local = state.messages.find(y => String(y.id) === id)
    const lt = local ? msgTime(local) : 0
    if (lt) { lrTimeCache[cacheKey] = lt; times.set(id, lt); continue }
    const g = ghosts.find(x => String(x.id) === id)
    const gt = g && g.created_at ? Date.parse(g.created_at) : 0
    if (gt) { lrTimeCache[cacheKey] = gt; times.set(id, gt); continue }
    unknown.push(id)
  }
  if (!unknown.length) return { times, missing: new Set() }
  // 往前翻页找（最多 5 页 × 100 条）
  const oldest = state.messages.reduce((acc, m) => { const t = msgTime(m); return (t && (!acc || t < acc)) ? t : acc }, 0)
  let before = oldest ? new Date(oldest).toISOString() : null
  for (let page = 0; page < 5 && unknown.length && before; page++) {
    let list = []
    try { list = asArray(await api.getMessages(cid, { limit: 100, before })) } catch (e) { break }
    if (!list.length) break
    for (const m of list) {
      const id = String(m.id)
      const i = unknown.indexOf(id)
      if (i >= 0) {
        const t = msgTime(m)
        if (t) { lrTimeCache[String(cid) + '|' + id] = t; times.set(id, t) }
        unknown.splice(i, 1)
      }
    }
    const pageOldest = list.reduce((acc, m) => { const t = msgTime(m); return (t && (!acc || t < acc)) ? t : acc }, 0)
    if (!pageOldest) break
    before = new Date(pageOldest).toISOString()
  }
  return { times, missing: new Set(unknown) }
}

/** 取成员列表：force 或缓存超过 8 秒才重拉；重拉走 enrichMemberList，避免原始行覆盖导致姓名丢失 */
async function ensureMembersForReaders(force) {
  const cid = state.chat && state.chat.id
  if (!cid) return null
  let members = state.groupMembers
  if (force || !members || !members.length || (Date.now() - (state.groupMembersAt || 0)) > 8000) {
    members = enrichMemberList(asArray(await api.getGroupMembers(cid)))
    state.groupMembers = members
    state.groupMembersAt = Date.now()
  }
  return members
}

/** 批量计算多条消息的已读进度：一次成员请求 + 本地循环，避免逐条发请求 */
export async function loadReadersMany(msgs, force) {
  const list = (msgs || []).filter(m => m && m.id != null)
  if (!list.length) return
  const cid = state.chat && state.chat.id
  if (!cid || state.chat.type === 'private' || state.demoMode) return
  try {
    const members = await ensureMembersForReaders(force)
    if (!members) return
    const ctx = await resolveLastReadCtx(cid, members)
    for (const m of list) state.readers[String(m.id)] = computeReaderAgg(m, members, ctx)
  } catch (e) { /* 静默 */ }
}

export async function loadReaders(m, force) {
  if (!m || m.id == null) return null
  const key = String(m.id)
  if (state.demoMode) {
    const members = (state.groupMembers || []).filter(x => String(memberUid(x)) !== String(m.sender_id))
    const readers = members.map((x, i) => ({ user_id: memberUid(x), user_display_name: memberName(x), is_read: i < Math.ceil(members.length * 0.7) }))
    const mock = { total: members.length, revealed: readers.filter(r => r.is_read).length, burned: 0, readers }
    state.readers[key] = mock
    return mock
  }
  const cid = state.chat && state.chat.id
  if (!cid || state.chat.type === 'private') return null
  try {
    const members = await ensureMembersForReaders(force)
    if (!members) return null
    const ctx = await resolveLastReadCtx(cid, members)
    const agg = computeReaderAgg(m, members, ctx)
    state.readers[key] = agg
    return agg
  } catch (e) {
    return null
  }
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
    bindPushAlias(d.user && d.user.id) // 极光 alias = userId（PUSH_JPUSH.md §4.2），离线推送靠它投递
    bootstrap()
    maybeShowNotifyGuide() // 首次装好登录后引导一次通知设置（§9）；不能在 App 挂载时判，那时还在登录页
    enableKeepAlive() // 登录后开启前台服务保活，让极光长连接在后台存活更久（否则切后台一会儿就收不到）
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
  state.annPopup = null
  state.showAnnPopup = false
  state.annFocusId = null
  state.showFeedback = false
  state.feedbackList = []
  // 焚毁倒计时状态一并清空：换号后残留条目会把新账号的消息误标成已焚毁
  state.burnLeft = {}
  state.burnMsgs = {}
  state.mediaPending = {}
  state.readers = {}
  state.destroyAcking = {}
  state.sessionConflict = null
  for (const k of Object.keys(burnDeadline)) delete burnDeadline[k]
  unbindPushAlias() // 解绑极光 alias：否则换人登录仍会收到上一个人的消息（PUSH_JPUSH.md §8）
  disableKeepAlive() // 退出登录后关掉保活前台服务（常驻通知不该在未登录时还挂着）
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

/* ─── 本机「已读到哪」标记（按会话）───
   后端 unread_count 不随已读减少（实测读完后仍是旧值），刷新会把已读又显示成未读；
   这里记住本机最后一次读到的时间点，会话最后一条消息不晚于它就算已读。 */
function readMarkKey(cid) { return 'bm_read_mark_' + cid }
export function getReadMark(cid) {
  if (cid == null) return 0
  try { return Number(localStorage.getItem(readMarkKey(cid))) || 0 } catch (e) { return 0 }
}
export function setReadMark(cid, iso) {
  if (cid == null) return
  const t = Date.parse(iso || '') || Date.now()
  try { localStorage.setItem(readMarkKey(cid), String(t)) } catch (e) { /* 忽略 */ }
}

/* ─── 本机未读计数 ───
   后端 unread_count 只增不减（实测读完仍是旧值），跨端不可信；这里完全由本机维护：
   收到 WS 消息 +1、进会话清零；没有本地记录的会话在首次加载时按「上次读到的时间点」数一遍。 */
function unreadStore() {
  try { return JSON.parse(localStorage.getItem('bm_unread_local') || '{}') } catch (e) { return {} }
}
function saveUnreadStore(m) {
  try { localStorage.setItem('bm_unread_local', JSON.stringify(m)) } catch (e) { /* 忽略 */ }
}
export function getLocalUnread(cid) {
  if (cid == null) return null
  const v = unreadStore()[String(cid)]
  return v == null ? null : Math.max(0, Number(v) || 0)
}
export function setLocalUnread(cid, n) {
  if (cid == null) return
  const m = unreadStore()
  m[String(cid)] = Math.max(0, Math.floor(Number(n) || 0))
  saveUnreadStore(m)
}

/* 未读补算：以服务端「我读到哪条」为准（成员表的 last_read_message_id，私聊/群聊都有效），
   数出该会话里这条之后、别人发的消息条数。这样即使清缓存/重新登录、本地标记全没了，
   也不会把历史消息全算成未读；本地标记只负责运行期的即时增减。 */
const unreadFilledAt = {} // cid -> 上次补算时间（避免每次 loadConvs 都重算）
async function computeUnreadFromServer(cid, conv) {
  try {
    const members = asArray(await api.getGroupMembers(cid))
    const mine = members.find(m => String(memberUid(m)) === String(state.me.id))
    const lr = mine && mine.last_read_message_id
    const msgs = asArray(await api.getMessages(cid, { limit: 200 }))
    let after = msgs
    if (lr) {
      const idx = msgs.findIndex(m => String(m.id) === String(lr))
      // 找得到 → 只数它之后的；找不到（更早/已销毁）→ 整页都在它之后
      if (idx >= 0) after = msgs.slice(idx + 1)
    }
    const n = after.filter(m => String(m.sender_id) !== String(state.me.id) && !m.is_recalled).length
    setLocalUnread(cid, n)
    unreadFilledAt[String(cid)] = Date.now()
    const cur = state.convs.find(x => String(x.id) === String(cid)) || conv
    if (cur && (!state.chat || String(state.chat.id) !== String(cid))) cur.unread = n
    return n
  } catch (e) {
    unreadFilledAt[String(cid)] = Date.now() // 失败也记时间，别每轮都重试
    // 补算失败：退回服务端计数（可能偏大），总比一直 0 漏掉真未读强
    const srv = Number(conv && (conv.unread_count ?? conv.unread)) || 0
    setLocalUnread(cid, srv)
    const cur = state.convs.find(x => String(x.id) === String(cid)) || conv
    if (cur && (!state.chat || String(state.chat.id) !== String(cid))) cur.unread = srv
    return null
  }
}

/** 给「缺本地记录 / 本地显示为 0 但服务端还有新消息」的会话补算未读（顺序执行，避免并发打爆接口） */
async function fillLocalUnread(list) {
  const now = Date.now()
  const need = (list || []).filter(c => {
    if (state.demoMode || !c || c.id == null) return false
    if (now - (unreadFilledAt[String(c.id)] || 0) < 30000) return false // 30 秒内算过就不再算
    const local = getLocalUnread(c.id)
    if (local == null) return true // 清缓存/新登录：必须用服务端位置重算
    const lastAt = Date.parse(c.last_message_at || '') || 0
    const mark = getReadMark(c.id)
    return local === 0 && lastAt > mark // 本地记 0 但服务端有更新的消息 → 可能漏算
  })
  for (const c of need.slice(0, 6)) {
    if (state.demoMode) return
    await computeUnreadFromServer(c.id, c)
  }
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
export function markBurned(m, convId) {
  if (!m || m.id == null) return
  // 无条件写 true：后端返回的消息对象本来就没有 is_burned 字段，旧的 `!== undefined` 守卫会让它保持 undefined，
  // 导致倒计时归零后 isBurned() 判不出来、气泡翻回正文（闪烁的另一半原因）
  m.is_burned = true
  if (m.is_blurred !== undefined) m.is_blurred = false
  // 会话 id 优先级：显式传入 > 消息自带 > 当前会话。调用方（tickBurn）会把种入时记下的会话 id 传进来，
  // 避免「焚毁时用户已退出该会话、消息对象又没带 conversation_id」导致占位写不进去
  const rawCid = convId != null ? convId : (m.conversation_id != null ? m.conversation_id : (state.chat && state.chat.id))
  const cid = String(rawCid)
  if (!cid || cid === 'null' || cid === 'undefined') return
  const map = burnedMsgMap()
  const arr = (map[cid] || []).filter(x => String(x.id) !== String(m.id))
  // created_at 走字段别名兜底：取不到时间会让占位排序时落到列表最顶上，看起来就像「气泡没了」
  const createdAt = m.created_at ?? m.createdAt ?? m.sent_at ?? m.sentAt ?? m.timestamp ?? m.updated_at ?? m.updatedAt ?? null
  arr.push({ id: String(m.id), sender_id: m.sender_id, created_at: createdAt, conversation_id: cid })
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
  loadAnnouncements(true).then(maybeAutoPopup)
  if (!state.demoMode) {
    if (storage.token) connectWs(storage.token) // 刷新页面后凭本地 token 恢复 WS 连接
    try {
      state.me = await api.getProfile()
      storage.user = state.me
      // 冷启动 / 刷新页面恢复登录时也要绑一次 alias：
      // 只有走 login() 才绑的话，重装 APK 或清数据后 alias 会丢，推送静默失效（PUSH_JPUSH.md §4.2）
      bindPushAlias(state.me && state.me.id)
      enableKeepAlive() // 冷启动恢复登录时同样开启保活（前台服务是进程级的，重启后需要重新拉起）
      if (state.me && typeof state.me.topic === 'string' && state.me.topic.startsWith('#')) applyTheme(state.me.topic) // 以服务端保存的主题色为准
      // 焚毁时长不再从账号字段解析：进会话时按 burn_settings 查生效值（见 loadBurnSetting）
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

/* ─── 标签页标题：跟随未读消息数变化 ───
   无未读：焚信 BurnMsg · 企业加密通讯
   有未读：焚信 · 您收到了 N 条消息
   N = 各会话未读之和（与首页「会话」页签的角标同口径：新消息 +1、点开会话清零、服务端回填） */
const DEFAULT_TITLE = '焚信 BurnMsg · 企业加密通讯'

/** 各会话未读总和 */
function convUnreadTotal() {
  let n = 0
  for (const c of state.convs) n += Math.max(0, Number(c.unread) || 0)
  return n
}

/** 按当前未读数同步标签页标题（纯文字，不涉及图标） */
export function refreshTitle() {
  if (typeof document === 'undefined') return
  const n = convUnreadTotal()
  document.title = n > 0 ? ('焚信 · 您收到了' + n + '条消息') : DEFAULT_TITLE
}

// 未读数变化即刷新：新消息 +1、打开会话清零、会话列表从服务端重拉
watch(convUnreadTotal, refreshTitle)

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
        // 未读数以服务端为准（unread_count：换设备/重装后不丢未读）；后端未升级时回退本地计数。
        // ⚠️ 实测后端 unread_count 不随已读减少（读完后仍是旧值），刷新会把已读又显示成未读，
        // 所以这里叠加一层本机「已读到哪条」标记：会话最后一条消息不晚于该标记 → 视为已读。
        const serverUnread = c.unread_count ?? c.unread
        const lastAt = Date.parse(c.last_message_at || '') || 0
        const mark = getReadMark(c.id)
        const locallyRead = mark > 0 && lastAt > 0 && lastAt <= mark
        // 未读数一律用本机计数：后端 unread_count 是累计值（读完不减）；
        // 本地没有记录（清缓存/新登录）时先显示 0，随后由 fillLocalUnread 按服务端「我读到哪条」补算
        const local = getLocalUnread(c.id)
        const unread = locallyRead ? 0 : (local != null ? local : 0)
        const lastMsgObj = c.last_message ?? c.lastMessage ?? c.last_msg ?? null
        const preview = extractConvoPreview(c) || getLastMsg(c.id) || (old && old.lastMsg) || ''
        let mentionFlag = (old && old.mentionFlag) ? 1 : 0
        if (!mentionFlag && unread > 0) {
          const mentioned = (lastMsgObj && typeof lastMsgObj === 'object')
            ? mentionsMe(lastMsgObj)
            : preview ? mentionsMe({ content: preview }) : false
          if (mentioned) mentionFlag = 1
        }
        return {
          ...c,
          unread,
          lastMsg: preview,
          pinned: ids.includes(c.id),
          mentionFlag
        }
      })
      .filter(c => !hidden.includes(String(c.id)))
    // 缺本地未读记录的会话（清缓存/新登录）：按服务端「我读到哪条」重算，不把历史消息算成未读
    fillLocalUnread(state.convs)
    if (!quiet) await fillMissingPreviews()
    refreshVisiblePresence() // 会话列表的在线圆点：拉一遍所有私聊对方的在线态（静默、异步）
  } catch (e) { if (!quiet) showToast(e.message) }
}

export async function loadContacts() {
  if (state.demoMode) { state.contacts = DEMO.users; return }
  try {
    state.contacts = asArray(await api.getContacts())
    refreshVisiblePresence() // 通讯录在线圆点
  } catch (e) { /* 静默 */ }
}

/* ─── 在线状态（V6.0 用户端）───
   用户在线态的**唯一正确入口**是 /presence/*（数据来自 devices.is_online，由 WS 连接数 + 心跳维护）。
   /auth/devices 是「本人设备管理」接口，语义不同，不要拿它当"对方是否在线"。 */
let presenceWarned = false // 接口不可用只告警一次
export async function loadPresence(ids) {
  if (state.demoMode) return
  const list = (Array.isArray(ids) ? ids : [ids]).filter(x => x != null && x !== '').map(String)
  if (!list.length) return
  try {
    const data = asArray(await api.getPresenceUsers(list))
    for (const p of data) {
      if (!p || p.user_id == null) continue
      state.presence[String(p.user_id)] = {
        is_online: p.is_online === true,
        online_devices: p.online_devices != null ? Number(p.online_devices) : 0,
        last_active_at: p.last_active_at || null
      }
    }
  } catch (e) {
    // 后端未部署 /presence/*（404）或后端地址填错时会走到这里：只提示一次，避免轮询刷屏
    if (!presenceWarned) {
      presenceWarned = true
      console.warn('[焚信] 在线状态接口不可用（/presence/*）：后端可能未升级，或「后端地址」指向了不支持该接口的环境 →', (e && e.message) || e)
    }
  }
}

/** 本人多设备在线态（设备管理页用，含 is_current 标识本机） */
export async function loadPresenceMe() {
  if (state.demoMode) return null
  try {
    const d = await api.getPresenceMe()
    if (d && typeof d === 'object') state.presenceMe = d
    return d
  } catch (e) { return null }
}

/** 当前会话对方的在线态（仅私聊；群聊/频道返回 null） */
export function peerPresence() {
  const c = state.chat
  if (!c || c.type !== 'private' || !c.other_user || c.other_user.id == null) return null
  return state.presence[String(c.other_user.id)] || null
}

/** 刷新当前会话对方的在线态（打开会话 / 定时刷新时调用） */
export function refreshPeerPresence() {
  const c = state.chat
  if (!c || c.type !== 'private' || !c.other_user || c.other_user.id == null) return
  loadPresence([c.other_user.id])
}

/** 批量刷新「界面上一眼可见的人」的在线态：私聊会话对方 + 通讯录联系人（分批，每批 100） */
export async function refreshVisiblePresence() {
  if (state.demoMode) return
  const ids = new Set()
  for (const c of state.convs || []) {
    if (c && c.type === 'private' && c.other_user && c.other_user.id != null) ids.add(String(c.other_user.id))
  }
  for (const u of state.contacts || []) {
    if (u && u.id != null) ids.add(String(u.id))
  }
  if (!ids.size) return
  const arr = [...ids]
  for (let i = 0; i < arr.length; i += 100) {
    await loadPresence(arr.slice(i, i + 100))
  }
}

/** 某人是否在线（读 presence 缓存；未知返回 null，便于调用方决定不显示） */
export function isUserOnline(userId) {
  if (userId == null) return null
  const p = state.presence[String(userId)]
  return p ? p.is_online === true : null
}

/* ─── 聊天 ─── */
// ---- 草稿暂存：输入框未发送内容按会话持久化，退出会话再进入时恢复 ----
export function convDraftKey(cid) { return 'bm_draft_' + cid }
export function getConvDraft(cid) {
  if (cid == null) return ''
  try { return localStorage.getItem(convDraftKey(cid)) || '' } catch (e) { return '' }
}
export function setConvDraft(cid, text) {
  if (cid == null) return
  try { const k = convDraftKey(cid); if (text) localStorage.setItem(k, text); else localStorage.removeItem(k) } catch (e) {}
}

/**
 * 按会话 id 打开会话 —— 供极光推送点击跳转使用（本工程无 vue-router，见 utils/push.js 顶部说明）
 * 冷启动时推送可能先到、会话列表还没拉到，这里会先补拉一次列表再找。
 * @returns {Promise<boolean>} 是否找到并打开
 */
export async function openChatById(cid) {
  if (cid == null || cid === '') return false
  const find = () => (state.convs || []).find(x => String(x.id) === String(cid))
  let c = find()
  if (!c) {
    try { await loadConvs(true) } catch (e) { /* 忽略：拉不到就当找不到 */ }
    c = find()
  }
  if (!c) return false
  state.tab = 'chats'
  await openChat(c)
  return true
}

export async function openChat(c) {
  state.chat = c
  c.unread = 0
  c.mentionFlag = 0
  state.messages = []
  state.groupMembers = []
  state.readWatermark = 0
  state.loadingEarlier = false
  state.hasMore = true // 重置已读水位线，私聊随后按回执重建
  state.e2eOn = c.type === 'private' && localStorage.getItem('bm_e2e_on_' + c.id) === '1' // 恢复本会话加密开关
  // 焚毁时长：进会话按人/按会话解析生效值（V6.1，异步不阻塞消息加载）
  state.burnSeconds = 0
  state.burnOff = false // 稍后由 loadBurnSetting 按本机开关回填
  state.burnSource = 'none'
  state.burnMySetting = null
  state.mediaBurnOn = false
  if (!state.demoMode) loadBurnSetting(c.id)
  if (c.type !== 'private') loadGroupMembers() // 预取群成员：消息发送者名称/头像、群管理页共用
  await loadMessages()
  // 已读上报：后端 up_to_message_id 是「不含该条」的（实测差一条，最后一条永远读不掉），
  // 所以打开会话时整会话标记（不带 body），并把本机已读时间点记下来抵消后端不减少的 unread_count。
  if (!state.demoMode) {
    setReadMark(c.id, new Date().toISOString())
    setLocalUnread(c.id, 0)
    api.markRead(c.id).catch(() => { /* 静默 */ })
  }
  // 两阶段销毁：拉完首屏后静默确认上一批墓碑，让服务端真正释放存储（失败不影响主流程）
  if (!state.demoMode) confirmDestroyed(c.id)
  if (!state.demoMode && c.type === 'private') loadReadWatermark()
  if (!state.demoMode && c.type === 'private') refreshPeerPresence() // 拉对方的真实在线态（/presence/users）
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

/**
 * 私聊已读水位线（刷新后恢复的关键）。
 * 后端把「已读」记在会话成员的 last_read_message_id 上（回执行 is_read 不更新、
 * unread_count 也不随之减少），所以恢复水位必须读成员列表：
 * GET /groups/{cid}/members 对私聊同样有效，能拿到对方读到哪一条。
 */
async function loadReadWatermark() {
  if (!state.chat || state.chat.type !== 'private') return
  try {
    const members = asArray(await api.getGroupMembers(state.chat.id))
    const peer = members.find(m => String(m.user_id) !== String(state.me.id))
    if (!peer || !peer.last_read_message_id) return
    const idx = state.messages.findIndex(m => String(m.id) === String(peer.last_read_message_id))
    if (idx < 0) return
    const t = msgTime(state.messages[idx])
    if (t > state.readWatermark) state.readWatermark = t
  } catch (e) { /* 静默：恢复失败只影响「已读」标签，不影响聊天 */ }
}

export function closeChat() {
  state.chat = null
  state.messages = []
  // 焚毁时长是「按会话」的：离开就清空，避免下一个会话串用上一个的档位
  state.burnSeconds = 0
  state.burnOff = false
  state.burnSource = 'none'
  state.burnMySetting = null
  state.mediaBurnOn = false
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
    state.hasMore = list.length >= 200 // 首拉不满 200 说明已到最早，关闭滚顶加载
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
    const ghostIds = new Set(ghosts.map(g => String(g.id)))
    for (const g of ghosts) {
      if (!sorted.some(x => String(x.id) === String(g.id))) {
        sorted.push({ id: g.id, conversation_id: cid, sender_id: g.sender_id, created_at: g.created_at, is_burned: true })
      }
    }
    // 已本地焚毁的消息：后端整行还没删时轮询会把同一份数据当新对象带回来（无 is_burned）→ 强制打回焚毁态。
    // 否则气泡会「此消息已焚毁」→ 翻回正文 + 倒计时从 1~2 秒重新起跳 → 再焚毁，即用户看到的「闪两下 + 多一两秒」。
    for (const m of sorted) { if (ghostIds.has(String(m.id))) m.is_burned = true }
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
/** 滚顶加载更早历史消息：以当前最旧一条的 created_at 为 before 游标，前置插入更早一页（去重 + 保序） */
export async function loadMoreMessages() {
  if (!state.chat || state.loadingEarlier || !state.hasMore || state.demoMode) return
  const cid = state.chat.id
  const earliest = state.messages[0]
  const before = earliest && (earliest.created_at || earliest.createdAt)
  if (!before) { state.hasMore = false; return }
  state.loadingEarlier = true
  try {
    const list = asArray(await api.getMessages(cid, { limit: 100, before }))
    const sorted = sortByTimeAsc(list.map(normalizeMsg))
    const existing = {}
    state.messages.forEach(m => { existing[String(m.id)] = true })
    const fresh = sorted.filter(m => !existing[String(m.id)])
    if (list.length < 100) state.hasMore = false // 返回不满一页说明已到最早
    if (fresh.length) {
      // 同 loadMessages：翻出来的更早消息里若有已本地焚毁的，直接打回焚毁态，避免复活起跳
      const ghostIds = new Set((burnedMsgMap()[String(cid)] || []).map(g => String(g.id)))
      for (const m of fresh) { if (ghostIds.has(String(m.id))) m.is_burned = true }
      state.messages = sortByTimeAsc(fresh.concat(state.messages))
      fresh.forEach(seedBurnLeft)
      syncRestorePlaintext(fresh)
      decryptMessagesInList(fresh, cid)
    }
  } catch (e) {
    console.error('[焚信] 加载更早消息失败:', cid, e)
  } finally {
    state.loadingEarlier = false
  }
}

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


/** 判断消息是否 @ 了当前用户：优先用后端 Message.mentions（被@成员 uid 数组）精确判定，兜底按文本「@昵称」匹配 */
function mentionsMe(m) {
  if (!m) return false
  const me = state.me || {}
  if (Array.isArray(m.mentions) && m.mentions.length && me.id != null) {
    if (m.mentions.some(uid => [String(me.id), 'all', 'everyone', '全部', '所有人'].includes(String(uid)))) return true
  }
  const text = m.content || ''
  if (/[＠@]所有人/.test(String(text))) return true // @所有人：全体成员都算被 @
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
  // 有人 @ 我：无论是否正在看该会话，都打上会话 @ 标记（会话列表显示红字「有人@我」）并弹强提示
  if (!mine && mentionsMe(m)) {
    const mc = state.convs.find(x => String(x.id) === String(cid))
    if (mc) mc.mentionFlag = (mc.mentionFlag || 0) + 1
    showToast('有人@你：' + (messagePreview(m) || '').slice(0, 30))
  }
  if (state.chat && String(state.chat.id) === String(cid)) {
    // 去重：本人发送时 sendText 已 push 过同一条（WS 也会推给发送方多端）
    if (!state.messages.some(x => String(x.id) === String(m.id))) {
      state.messages.push(m)
      state.newMsgSeq++ // 驱动吸附滚底 / 新消息浮钮（ChatRoom watch）
      if (!mine) {
        api.markRead(cid).catch(() => { /* 静默 */ })
        setReadMark(cid, new Date().toISOString()) // 本机已读时间点：抵消后端不减少的 unread_count
        setLocalUnread(cid, 0)
      }
    }
    syncChatPreview()
  } else {
    // 未打开的会话：未读+1（本人其他端发的除外），预览与排序靠重拉列表兜底
    if (!mine) {
      const c = state.convs.find(x => String(x.id) === String(cid))
      // 未读数本机累加并持久化（服务端 unread_count 不可信）
      const nextUnread = (getLocalUnread(cid) ?? ((c && c.unread) || 0)) + 1
      setLocalUnread(cid, nextUnread)
      if (c) c.unread = nextUnread
      // 右下角通知卡片（点击直达该会话）；@ 我的带前缀
      const popCard = conv => {
        // 私聊且会话详情没带 other_user 时，用发送者信息补个显示名，避免标题只剩「私聊」
        if (conv && conv.type === 'private' && !conv.other_user && m.sender_id) {
          const sender = state.contacts.find(u => String(u.id) === String(m.sender_id))
          conv = { ...conv, other_user: sender || { id: m.sender_id } }
        }
        const mention = mentionsMe(m)
        // 标题统一加「焚信 · 」前缀，多标签/通知中心里一眼能认出是哪个应用；@我 放在名字后面
        const title = '焚信 · ' + convName(conv) + (mention ? '（@我）' : '')
        const body = messagePreview(m) || ''
        // 页面在后台 → 系统通知（Windows 通知中心）；前台或未开启 → 右下角卡片
        const hidden = typeof document !== 'undefined' && document.hidden
        // tag 带上消息 id：同会话的每条消息各自成一条通知，避免被系统按 tag 替换成"只出现一次"
        if (hidden && notifySystem({ title, body, tag: String(cid) + ':' + String(m.id), onClick: () => openChat(conv) })) return
        // 移动端（含 APK / 窄屏）不弹右下角卡片：会压住聊天内容；未读数/标题已经能提示
        if (state.layout === 'mobile') return
        try {
          // 本地通知：默认始终弹。
          // 极光只对「离线」用户推送（PUSH_JPUSH.md §0），WS 活着就等于在线、后端不会推，
          // 所以两者正常不会重叠。仅当实测出现「同一条消息弹两次」时，才把 NOTIFY_SUPPRESS_LOCAL 改 true。
          if (!NOTIFY_SUPPRESS_LOCAL || !isPushActive()) {
            notifyNewMessage({ title, message: body, onClick: () => openChat(conv) })
          }
        } catch (e) { /* 通知失败不影响消息处理 */ }
      }
      if (c) popCard(c)
      else if (!state.demoMode) {
        // 全新会话的首条消息：本地列表里还没有它，拉一次详情拿到名字再弹
        api.getConversation(cid).then(conv => {
          if (conv && conv.id) popCard(conv)
          else showToast('新消息：' + (messagePreview(m) || '').slice(0, 30))
        }).catch(() => showToast('新消息：' + (messagePreview(m) || '').slice(0, 30)))
      } else {
        showToast('新消息：' + (messagePreview(m) || '').slice(0, 30))
      }
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
  // 群聊/频道：有人读了，触发「N/M 已读」重新聚合（私聊行走水位，不需要）
  if (state.chat.type !== 'private') state.receiptSeq++
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

/** message:destroyed：后端判定焚毁（到期 / 对方点开 / 播完）→ 就地切墓碑，实时生效，不必等 4s 轮询 */
function onWsDestroyed(p) {
  if (!p || state.demoMode) return
  const ids = new Set((Array.isArray(p.message_ids) ? p.message_ids : []).map(String))
  if (p.message_id != null) ids.add(String(p.message_id))
  if (!ids.size) return
  const cid = p.conversation_id != null ? p.conversation_id : (state.chat && state.chat.id)
  // 当前会话内的消息：直接打墓碑（保留占位，不从前端列表移除）
  for (const m of state.messages) {
    if (!ids.has(String(m.id))) continue
    m.is_destroyed = true
    m.is_burned = true
    if (p.destroyed_at) m.destroyed_at = p.destroyed_at
    if (p.destroy_reason) m.destroy_reason = p.destroy_reason
    delete state.burnLeft[m.id]
    delete state.burnMsgs[String(m.id)]
    delete burnDeadline[m.id]
  }
  // 刚产生新墓碑：顺带确认上一批（两阶段销毁第二阶段），并刷新会话列表预览
  if (cid != null) { confirmDestroyed(cid); scheduleConvReload() }
}

/** session:conflict：登录冲突。kicked_by_new_login 必须阻断（本机已被踢下线），其余仅提醒 */
function onWsSessionConflict(p) {
  if (!p) return
  const nd = p.new_device || {}
  if (p.reason === 'kicked_by_new_login') {
    state.sessionConflict = {
      reason: p.reason,
      blocking: true,
      title: '账号已在其他设备登录',
      text: '当前设备已被下线，请重新登录。',
      newDevice: p.new_device || null
    }
    return
  }
  state.sessionConflict = {
    reason: p.reason || 'notify',
    blocking: false,
    title: '账号在另一台设备登录',
    text: (nd.name || nd.device_name || '未知设备') + (nd.ip ? ' · ' + nd.ip : ''),
    newDevice: p.new_device || null
  }
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
onWs(WS_EVENTS.MESSAGE_DESTROYED, onWsDestroyed)
onWs(WS_EVENTS.SESSION_CONFLICT, onWsSessionConflict)

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
    updateAnnPopup()
    refreshAnnUnread()
    return
  }
  try {
    const d = await api.getAnnouncements()
    state.announcements = asArray(d)
    updateAnnPopup()
    refreshAnnUnread()
  } catch (e) {
    if (!quiet) showToast(e.message)
  }
}

/** 从公告列表取最新未读公告，用于首页弹窗 */
function updateAnnPopup() {
  const list = state.announcements || []
  const unread = list.filter(a => !a.is_read)
  const latest = sortByTimeAsc(unread).pop() || null
  state.annPopup = latest
}

/** 进入主页时若有最新未读公告则自动弹出 */
function maybeAutoPopup() {
  if (!state.annPopup) return
  if (state.view !== 'main' || state.chat) return
  state.showAnnPopup = true
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

/** 弹窗「知道了」：标记已读并关闭 */
export function ackAnnPopup() {
  const a = state.annPopup
  state.annPopup = null
  state.showAnnPopup = false
  if (a) readAnnouncement(a)
}

/** 弹窗「待会处理」：仅关闭，不标记已读（下次进入仍会弹出） */
export function laterAnnPopup() {
  state.annPopup = null
  state.showAnnPopup = false
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
  state.annPopup = null
  state.showAnnPopup = false
  if (state.demoMode) return
  await Promise.all(unread.map(a => api.markAnnouncementRead(a.id).catch(() => {})))
}

/** announcement:new：公告实时推送 → 提示音 + toast + 角标/列表联动 */
onWs(WS_EVENTS.ANNOUNCEMENT_NEW, p => {
  if (state.demoMode) return
  playMsgDing()
  const ann = (p && (p.announcement || p.data || p)) || {}
  showToast('新公告：' + (ann.title || '点击查看'))
  if (state.showAnnouncements) loadAnnouncements()
  else refreshAnnUnread()
  loadAnnouncements(true)
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

/**
 * 打开「通知设置指引」页（PUSH_JPUSH.md §9）
 * 国产 ROM 光有通知权限还不够：电池优化/自启动/后台锁定不配，App 过一会儿就收不到推送。
 */
export function openNotifyGuide() {
  state.showNotifyGuide = true
  try { storage.notifyGuideSeen = true } catch (e) { /* 忽略 */ }
}

/**
 * 首次进入主界面时自动引导一次（只弹一次）。
 * 必须在「登录成功之后」调用：首次安装时 App 挂载那一刻还停在登录页，那时判断 state.view 会直接失败。
 */
let notifyGuideTried = false
export function maybeShowNotifyGuide() {
  if (notifyGuideTried) return
  if (state.demoMode || state.view !== 'main') return
  if (!isPushActive()) return          // 极光都没起来，先按 §7 第 1 步查初始化，别急着引导
  if (storage.notifyGuideSeen) return
  notifyGuideTried = true
  setTimeout(() => {
    if (!state.showNotifyGuide && state.view === 'main' && !storage.notifyGuideSeen) openNotifyGuide()
  }, 800)
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

/* 播完即焚：发送语音/视频时 burn_ttl = 媒体实际时长 + 3s 缓冲（点开即计时，播完正好到点焚毁），时长读取失败兜底 300s；consume（播完/退出提前焚毁）保留，后端接口就绪后自动增强 */
const MEDIA_BURN_FALLBACK_TTL = 300
// 播完即焚：burn_ttl = 媒体实际时长 + 3s 缓冲（点开即计时，播完正好到点焚毁），时长读取失败兜底 300s
function mediaBurnTtlFor(seconds) {
  const d = Number(seconds)
  if (Number.isFinite(d) && d > 0) return Math.min(Math.max(1, Math.ceil(d) + 3), 86400)
  return MEDIA_BURN_FALLBACK_TTL
}
// 读视频文件真实时长（秒）；拿不到 metadata 返回 0（交由 mediaBurnTtlFor 兜底）
function readVideoDurationSeconds(file) {
  return new Promise(function (resolve) {
    try {
      const url = URL.createObjectURL(file)
      const v = document.createElement('video')
      v.preload = 'metadata'
      let done = false
      const finish = function (d) {
        if (done) return
        done = true
        try { URL.revokeObjectURL(url) } catch (e) { /* 忽略 */ }
        resolve(d || 0)
      }
      v.onloadedmetadata = function () { finish(v.duration) }
      v.onerror = function () { finish(0) }
      v.src = url
      setTimeout(function () { finish(0) }, 4000)
    } catch (e) { resolve(0) }
  })
}
/* 本机「关闭焚毁」开关：按会话记在 localStorage（与 E2E 开关同一套写法），只影响本机发送 */
function burnOffKey(cid) { return 'bm_burn_off_' + cid }
function readBurnOff(cid) {
  if (cid == null) return false
  try { return localStorage.getItem(burnOffKey(cid)) === '1' } catch (e) { return false }
}
function writeBurnOff(cid, on) {
  if (cid == null) return
  try { on ? localStorage.setItem(burnOffKey(cid), '1') : localStorage.removeItem(burnOffKey(cid)) } catch (e) { /* 忽略 */ }
}

/**
 * 读取当前会话的焚毁设置（V6.1：私聊按人、群/频道按会话）。
 * 规则：没有单独设过人/群的，就是「关闭」——不再回落到账号全局默认（全局默认这一层已废弃）。
 * 关闭状态下发送消息会显式带 burn_ttl_seconds=0，保证后端也不按默认值焚毁。
 */
export async function loadBurnSetting(conversationId) {
  if (!conversationId) return
  if (state.demoMode) { state.burnOff = true; return } // 演示模式没有服务端设置 → 默认关闭
  try {
    const d = await api.getBurnSetting(conversationId)
    // 期间已切走会话：丢弃过期结果
    if (!state.chat || String(state.chat.id) !== String(conversationId)) return
    const src = (d && d.source) || 'none'
    const set = src === 'contact_setting' || src === 'conversation_setting' // 只有显式设置过才算开启
    state.burnSeconds = set ? (Number(d && d.effective_ttl_seconds) || 0) : 0
    state.burnSource = src
    state.burnMySetting = set ? ((d && d.my_setting) || null) : null
    state.burnGlobalDefault = 0 // 全局默认不再参与判定（保留字段仅为兼容旧引用）
    state.burnOff = !set || readBurnOff(conversationId) // 没设置过 = 关闭
  } catch (e) { /* 静默：接口异常时按「不焚毁」展示，不打断聊天 */ }
}

/**
 * 设置当前会话的焚毁时长（V6.1 + 本机「关闭」）：
 *   v > 0：私聊 PUT /burn-settings/users/:对方id，群/频道 PUT /burn-settings/conversations/:cid，并清除本机「关闭」标记
 *   v = 0：本机记住该会话不焚毁（发送时显式带 burn_ttl_seconds=0），同时清掉服务端的按人/按会话设置
 * 写成功后回读一次生效值，界面显示以后端为准。
 */
export async function setBurn(v) {
  const c = state.chat
  if (!c) return
  const ttl = Number(v) || 0
  state.mediaBurnOn = false // 选档位即退出「语音视频焚毁模式」（互斥单选）
  const peerId = c.type === 'private' ? (c.other_user && c.other_user.id) : null

  if (!ttl) {
    // 关闭：本机按会话记住，并清掉服务端设置（避免换设备后仍按旧设置焚毁）
    state.burnOff = true
    writeBurnOff(c.id, true)
    if (!state.demoMode) {
      try {
        if (c.type === 'private' && peerId) await api.clearUserBurn(peerId)
        else if (c.type !== 'private') await api.clearConversationBurn(c.id)
        await loadBurnSetting(c.id)
      } catch (e) { showToast((e && e.message) || '清除焚毁设置失败') ; return }
    }
    showToast('已关闭阅后即焚：该会话的消息不再焚毁（本机生效）')
    return
  }

  state.burnOff = false
  writeBurnOff(c.id, false)
  if (state.demoMode) {
    state.burnSeconds = ttl
    state.burnSource = 'contact_setting'
    state.burnMySetting = { ttl_seconds: ttl }
    showToast('阅后即焚：' + burnLabelOf(ttl))
    return
  }
  try {
    if (c.type === 'private') {
      if (!peerId) throw new Error('缺少聊天对象，无法设置焚毁时长')
      await api.setUserBurn(peerId, ttl)
    } else {
      await api.setConversationBurn(c.id, ttl)
    }
    await loadBurnSetting(c.id)
    const label = burnLabelOf(ttl)
    showToast(state.e2eOn ? '已同时开启阅后焚毁与明文加密：密文将在 ' + label + ' 后销毁' : '阅后即焚：' + label)
  } catch (e) {
    showToast((e && e.message) || '焚毁时长设置失败')
  }
}

/** 语音视频焚毁模式（播完即焚）：只作用于本会话的语音/视频发送；普通消息保持不焚毁 */
export function setMediaBurn(v) {
  if (!state.chat) return
  state.mediaBurnOn = !!v
  // 注意：不修改 burnOff —— 普通消息的焚毁与否仍由该会话的焚毁设置决定，
  // 媒体模式只让语音/视频"播完即焚"（发送时带消息级 ttl），不影响文字/图片。
  showToast(v ? '语音视频焚毁模式已开启：语音/视频播放完毕后即焚毁（文字、图片不受影响）' : '语音视频焚毁模式已关闭')
}

/** 追加消息到当前会话列表：按 id 去重，防 WS 推送先于 HTTP 响应到达造成的双条闪现 */
function pushMsgDedup(m) {
  if (!m || m.id == null) return false
  if (state.messages.some(x => String(x.id) === String(m.id))) return false
  state.messages.push(m)
  return true
}

/** 发送文本消息，失败返回 false（调用方恢复草稿）。replyToId：引用回复时传入被回复消息 id（对应后端 reply_to_id 字段） */
export async function sendText(text, mentions, replyToId) {
  const payload = { conversation_id: state.chat.id, type: 'text', content: text }
  if (replyToId) payload.reply_to_id = replyToId // 引用回复：被回复的 Message.id
  if (Array.isArray(mentions) && mentions.length) payload.mentions = mentions // @提及：被@成员 uid 数组
  // 普通消息（文字/图片/文件）不参与「语音视频播完即焚」：
  // 本机「关闭焚毁」或正处于媒体焚毁模式时，显式传 0 = 这条不焚毁（否则后端会按全局默认把它变成焚毁消息）
  if (state.burnOff || state.mediaBurnOn) payload.burn_ttl_seconds = 0
  else if (state.demoMode && state.burnSeconds) payload.burn_ttl_seconds = state.burnSeconds // 演示模式无后端解析，本地兜底
  if (state.demoMode) {
    // demo 无后端 reveal，本地用 destroy_at 兜底倒计时（真实后端走 burn_ttl_seconds + reveal）
    const m = { id: DEMO.uid(), sender_id: state.me.id, created_at: new Date().toISOString(), is_recalled: false, is_edited: false, ...payload, destroy_at: (!state.burnOff && !state.mediaBurnOn && state.burnSeconds) ? new Date(Date.now() + state.burnSeconds * 1000).toISOString() : undefined }
    ;(DEMO.messages[state.chat.id] = DEMO.messages[state.chat.id] || []).push(m)
    state.messages.push(m)
    state.chat.lastMsg = messagePreview(m) || text // 焚毁消息只显示占位，不把明文写进列表预览
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
      // 加密消息：列表预览只显示占位，不写明文
      state.chat.lastMsg = '加密消息'
      setLastMsg(state.chat.id, '加密消息')
      return true
    } catch (e) {
      showToast(e.message)
      return false
    }
  }
  try {
    const m = await api.sendMessage(payload)
    pushMsgDedup(m)
    seedBurnLeft(m) // 自己发的焚毁消息立刻起倒计时，不必等下一轮 4s 轮询（也堵住「发完马上关页面没种入」的窗口）
    // 会话列表预览统一走 messagePreview：焚毁/加密消息只显示占位，不能把明文写进去
    const preview = messagePreview(m) || (payload.burn_ttl_seconds != null ? '焚毁消息' : text)
    state.chat.lastMsg = preview
    setLastMsg(state.chat.id, preview)
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/** 图片压缩（v5.8.7 双上传）：canvas 重绘长边 ≤1440 JPEG q0.82，典型 3~8MB 手机原图 → 200~600KB。
 *  聊天流/大图查看器加载压缩版（5Mbps 出带宽下 <1s 秒开），「保存到相册」走原图。
 *  返回 null = 不压缩走原图直传：gif（canvas 重绘丢动画）/ 小图 ≤300KB（压缩无收益）/ HEIC 等解码失败。
 *  EXIF 方向：现代 Chromium WebView 的 <img> 解码默认按 EXIF 摆正，drawImage 遵循同方向，竖拍不旋转。 */
async function compressImage(file) {
  if (!/^image\//.test(file.type) || file.type === 'image/gif') return null
  if (file.size <= 300 * 1024) return null
  try {
    const blob = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        try {
          let w = img.naturalWidth, h = img.naturalHeight
          if (!w || !h) throw new Error('bad dimensions')
          const MAX = 1440
          if (w > MAX || h > MAX) {
            const r = Math.min(MAX / w, MAX / h)
            w = Math.round(w * r); h = Math.round(h * r)
          }
          const cv = document.createElement('canvas')
          cv.width = w; cv.height = h
          const ctx = cv.getContext('2d')
          ctx.drawImage(img, 0, 0, w, h)
          cv.toBlob(b => { URL.revokeObjectURL(url); resolve(b) }, 'image/jpeg', 0.82)
        } catch (e) { URL.revokeObjectURL(url); reject(e) }
      }
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')) }
      img.src = url
    })
    if (!blob || !blob.size || blob.size >= file.size) return null // 压不动（如已是高压缩小图）→ 放弃压缩版
    return blob
  } catch (e) { return null }
}

/** 发送图片/文件（先上传再发消息，50MB 前端预校验）。
 *  v5.8.7 图片双上传：压缩版先传先发（消息立即可见、聊天流秒开），
 *  原图随后后台补传并 PATCH 回填 file_original_url（接收方「保存到相册」下载原图）。
 *  原图补传失败静默降级：消息保持可下载（拿到的是压缩版）。视频/文件/gif 走原图直传。 */
export async function sendFile(file) {
  if (!state.chat) return
  if (file.size > 50 * 1024 * 1024) { showToast('文件不能超过 50MB'); return }
  const isImg = /^image\//.test(file.type)
  const isVideo = !isImg && /\.(mp4|webm|mov|m4v|mkv|avi|3gp)$/i.test(file.name || '') // 音视频焚毁：视频文件（按扩展名，与后端 is_media_burn 一致）
  if (state.demoMode) {
    const url = isImg ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file) }) : null
    const m = { id: DEMO.uid(), conversation_id: state.chat.id, sender_id: state.me.id, type: isImg ? 'image' : 'file', content: '', file_url: url, file_name: file.name, file_size: file.size, created_at: new Date().toISOString(), is_recalled: false, is_edited: false }
    ;(DEMO.messages[state.chat.id] = DEMO.messages[state.chat.id] || []).push(m)
    state.messages.push(m)
    return
  }
  const compressed = isImg ? await compressImage(file) : null
  showToast('上传中…')
  try {
    if (!compressed) {
      // 非图片 / gif / 小图 / 压缩失败：原逻辑单上传（file_original_url 不填，下载即该文件）
      const up = await api.upload(file)
      const payload = { conversation_id: state.chat.id, type: isImg ? 'image' : 'file', file_url: up.url, file_name: up.file_name, file_size: up.file_size }
      // 音视频「播完才焚」仍是消息级参数（V6.1 未改动）；普通消息的时长走后端 burn_settings 解析
      if (isVideo && state.mediaBurnOn) {
        const _dv = await readVideoDurationSeconds(file)
        payload.burn_ttl_seconds = mediaBurnTtlFor(_dv)
        if (_dv > 0) payload.media_duration_seconds = Math.max(1, Math.round(_dv))
      } else if (state.burnOff || state.mediaBurnOn) {
        payload.burn_ttl_seconds = 0 // 关闭焚毁 / 仅媒体焚毁模式：图片、文件不焚毁
      }
      const m = await api.sendMessage(payload)
      if (isImg) m.thumb_url = up.thumb_url || null // 上传响应的缩略图存到消息对象（消息接口不传输该字段，仅本地回声用）
      pushMsgDedup(m)
      return
    }
    // ── 图片双上传：压缩版先行发消息，原图后台补传 ──
    const cf = new File([compressed], ((file.name || 'image').replace(/\.[^.]+$/, '') || 'image') + '.jpg', { type: 'image/jpeg' })
    const up = await api.upload(cf)
    const payload = { conversation_id: state.chat.id, type: 'image', file_url: up.url, file_name: file.name, file_size: up.file_size }
    if (state.burnOff || state.mediaBurnOn) payload.burn_ttl_seconds = 0 // 关闭焚毁 / 仅媒体焚毁模式：图片不焚毁
    const m = await api.sendMessage(payload)
    m.thumb_url = up.thumb_url || null
    pushMsgDedup(m)
    // 原图补传（不阻塞、失败静默）：成功后本机立即生效，其他设备下次拉历史时可见
    api.upload(file).then(ou => {
      if (!ou || !ou.url) return
      return api.updateMessageOriginal(m.id, ou.url).then(() => { m.file_original_url = ou.url }).catch(() => {})
    }).catch(() => {})
  } catch (e) {
    showToast(e.message)
  }
}

/** 发送语音消息（V5.8.4）：file 为录音 Blob 包装的 File，duration 秒。
 *  约定：voice 消息的 content 存时长秒数（纯数字字符串，ChatRoom.voiceDur parseInt 渲染气泡）；
 *  openapi.yaml 待补该约定（V5.8.4 文档项）。语音同样支持阅后即焚（burn_ttl_seconds）。 */
export async function sendVoice(file, duration) {
  if (!state.chat) return
  if (state.demoMode) { showToast('演示模式暂不支持语音'); return }
  showToast('发送中…')
  try {
    const up = await api.upload(file)
    const payload = { conversation_id: state.chat.id, type: 'voice', file_url: up.url, file_name: up.file_name, file_size: up.file_size, content: String(duration) }
    if (state.mediaBurnOn) { payload.burn_ttl_seconds = mediaBurnTtlFor(duration); const _d = Number(duration); if (_d > 0) payload.media_duration_seconds = Math.max(1, Math.round(_d)) }
    else if (state.burnOff) payload.burn_ttl_seconds = 0 // 本机关闭焚毁：显式不焚毁
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
    // 音视频焚毁消息：reveal 时补传媒体时长（秒）放宽消费窗口；语音 content 约定存秒数可提前带，拿不到时后端用发送时存储的 media_duration/默认 300s 兜底
    const body = {}
    if (m.type === 'voice') {
      const d = parseInt(m.content, 10)
      if (Number.isFinite(d) && d > 0 && d <= 7200) body.media_duration_seconds = d
    }
    const full = await api.revealMessage(m.id, body) // 拦截器已解包 {code,message,data}，返回完整 Message
    if (!full || typeof full !== 'object') throw new Error('reveal 返回异常')
    Object.assign(m, normalizeMsg(full))
    m.is_blurred = false
    if (needConsume(m)) state.mediaPending[String(m.id)] = m // 音视频焚毁：登记待 consume（播完/退出时消费，窗口内未消费由后端调度器兜底焚毁）
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

/* ─── 音视频焚毁（v5.8.9 播完才焚）：媒体消息 reveal 后进入「消费窗口」，播放完成 / 中途退出播放器 / 离开聊天页时调 consume 提前焚毁 ─── */

/** 是否「音视频」类型消息（不判焚毁）：type=voice/video，或 type=file 且视频扩展名（与后端 is_media_burn 判断一致） */
export function isMediaBurnMsg(m) {
  if (!m) return false
  if (m.type === 'voice' || m.type === 'video') return true
  if (m.type === 'file') {
    const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
    return ['mp4', 'webm', 'mov', 'm4v', 'mkv', 'avi', '3gp'].includes(ext)
  }
  return false
}

/** 是否「音视频焚毁且需要 consume」：后端 reveal 响应带 media_burn_pending=true；旧消息兜底 = 焚毁 + 音视频 + 已点开（非占位） */
export function needConsume(m) {
  if (!m || m.is_recalled || m.is_burned) return false
  if (m.media_burn_pending === true) return true
  const isBurn = !!(m.burn_ttl_seconds != null || m.burn_at != null || m.destroy_at != null)
  return isBurn && m.is_blurred !== true && isMediaBurnMsg(m)
}

/** 消费单条音视频焚毁消息：调 POST /messages/{id}/consume 把本人这份 burn_at 提前到当下（幂等，对端/其他设备实时切「已焚毁」） */
export async function consumeBurn(m) {
  if (!m || m.id == null || state.demoMode) return
  const id = String(m.id)
  try {
    await api.consumeMessage(m.id)
    delete burnDeadline[id]
    delete state.burnLeft[id]
    delete state.burnMsgs[id]
    delete state.mediaPending[id]
    markBurned(m)
  } catch (e) { console.warn('[焚信] 播完焚毁失败:', e && e.message); showToast('焚毁失败：' + ((e && e.message) || '网络异常')) }
}

/** 按消息 id 消费（语音 ended / 视频 ended / 关闭视频层时调用，内部自判是否需要 consume） */
export async function consumeMediaById(id) {
  if (id == null) return
  const m = state.messages.find(x => String(x.id) === String(id))
  if (m && needConsume(m)) await consumeBurn(m)
}

/** 批量消费所有已登记待 consume 的音视频焚毁消息（离开聊天页 / 切换会话收尾，用对象引用不依赖 messages 仍在列表） */
export async function flushPendingMedia() {
  const list = Object.values(state.mediaPending || {})
  for (const m of list) await consumeBurn(m)
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
    // 编辑的是会话最后一条消息时，同步会话列表预览（焚毁/加密消息仍走占位文案）
    if (state.chat && state.messages[state.messages.length - 1] === m) {
      state.chat.lastMsg = messagePreview(m) || content
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

/** 成员列表补全：本人用 state.me；其余优先用通讯录补 user 对象（后端直出行只有 user_display_name） */
function enrichMemberList(list) {
  const cmap = {}
  for (const c of state.contacts || []) if (c && c.id) cmap[c.id] = c
  return (list || []).map(m => {
    const uid = memberUid(m)
    if (state.me && uid !== '' && String(uid) === String(state.me.id)) return { ...m, user: state.me }
    const u = memberUser(m)
    const hasName = u && (u.display_name || u.name || u.username || u.nickname || u.phone)
    if (hasName || !uid || !cmap[uid]) return m
    return { ...m, user: cmap[uid] }
  })
}

export async function loadGroupMembers() {
  if (!state.chat) return
  if (state.demoMode) {
    state.groupMembers = (DEMO.groupMembers[state.chat.id] || []).slice()
    return
  }
  try {
    const list = asArray(await api.getGroupMembers(state.chat.id))
    state.groupMembers = enrichMemberList(list)
    state.groupMembersAt = Date.now()
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

/** 修改频道资料：name / description（仅频道主）走 PATCH /channels/{id} */
export async function renameChannel(name, description) {
  const payload = {}
  if (name) payload.name = name
  if (description !== undefined) payload.description = description
  if (state.demoMode) {
    if (payload.name) state.chat.name = payload.name
    if (description !== undefined) state.chat.description = description
    showToast('频道资料已更新（模拟）')
    return true
  }
  try {
    const c = await api.updateMyChannel(state.chat.id, payload)
    if (c) Object.assign(state.chat, c)
    else {
      if (payload.name) state.chat.name = payload.name
      if (description !== undefined) state.chat.description = description
    }
    loadConvs(true)
    showToast('频道资料已更新')
    return true
  } catch (e) {
    showToast(e.message || '更新失败')
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
    const isCh = state.chat && (state.chat.is_channel || state.chat.type === 'channel')
    if (isCh && isMe) {
      // 频道退订：DELETE /channels/{id}/subscribe
      const res = await api.unsubscribeChannel(state.chat.id)
      // 从会话列表移除该频道
      const i = state.convs.findIndex(cv => String(cv.id) === String(state.chat.id))
      if (i >= 0) state.convs.splice(i, 1)
      state.showChatInfo = false
      closeChat()
      showToast('已退订频道')
      return true
    }
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
    const isCh = state.chat && (state.chat.is_channel || state.chat.type === 'channel')
    // 频道解散走 DELETE /channels/{id}（v5.9.3 频道专用）；群组解散走 DELETE /groups/{id}
    if (isCh) { await api.dissolveChannel(cid) } else { await api.dissolveGroup(cid) }
    mark()
    state.showChatInfo = false
    closeChat()
    showToast(isCh ? '频道已解散' : '群组已解散')
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

/* ─── 定时器：秒表 / 会话 15s 轮询 / 消息 4s 轮询 / 在线心跳 60s ─── */
const timers = []
let burnWakeHandler = null
let wakeTimer = null
let msgPolling = false // 消息轮询在途标记：轮询慢于间隔时不叠加请求

/** 在线状态心跳：设备表主键（storage.deviceRowId），静默失败（后端未升级心跳接口时不影响业务） */
function sendHeartbeat() {
  const id = storage.deviceRowId
  if (!id || state.demoMode) return
  api.heartbeat(id).catch(() => { /* 忽略：下一次心跳再补 */ })
}

/**
 * App 切到后台：主动断开 WS。
 *
 * 为什么必须断开：后端按「WS 是否连着」判断在线，在线就不推极光（PUSH_JPUSH.md §0「在线用户不推」）。
 * 不断开的话后端永远认为在线 → 业务消息永远不会走极光推送 → 后台/锁屏收不到任何系统通知；
 * 而「本地通知」是画在页面里的卡片，后台根本看不见，于是用户感知不到任何提醒。
 * 断开后后端判离线 → 发消息时才会真正调极光 → 后台能收到系统通知栏通知。
 * 回到前台由 onWake() 重连并补拉数据，不会丢消息。
 */
function onHide() {
  if (state.view !== 'main' || state.demoMode) return
  disconnectWs()
}

/** 回到前台：重拉数据 + 重同步倒计时 + 心跳 + 确认墓碑。
    后台/锁屏期间 setInterval 被系统挂起，本地秒表会落后于服务端，这一步把状态拉回一致（修「僵尸消息」）。 */
function onWake() {
  if (typeof document !== 'undefined' && document.hidden) return
  state.nowTick = Date.now()
  tickBurn()
  clearTimeout(wakeTimer)
  wakeTimer = setTimeout(() => {
    if (state.view !== 'main' || state.demoMode) return
    // 后台时 WS 被主动断开（见 onHide），回前台第一件事是重连，否则实时消息收不到
    if (!isWsConnected()) connectWs(storage.token)
    if (state.chat) {
      loadMessages(true).then(() => { resyncBurnCountdown(); confirmDestroyed() }).catch(() => { /* 静默 */ })
    } else {
      loadConvs(true)
    }
    refreshAnnUnread()
    sendHeartbeat()
  }, 300) // 去抖：visibilitychange 与 focus 常常同时触发
}

/** visibilitychange：后台断开 WS、前台走 onWake（focus 事件单独绑 onWake，避免切走时误触发） */
function onVisibilityChange() {
  if (typeof document !== 'undefined' && document.hidden) onHide()
  else onWake()
}

export function startTimers() {
  timers.push(setInterval(() => { state.nowTick = Date.now() }, 1000))
  // 焚毁秒表：按绝对截止时间重算（tickBurn 内部自愈），到点就地焚毁，不再靠「每滴答 -1」
  timers.push(setInterval(tickBurn, 1000))
  timers.push(setInterval(() => { if (state.view === 'main' && !state.chat) { loadConvs(true); refreshAnnUnread() } }, 15000))
  // 消息轮询：后台不轮询 + 在途不叠加
  timers.push(setInterval(async () => {
    if (msgPolling) return
    if (typeof document !== 'undefined' && document.hidden) return
    if (!state.chat || state.demoMode) return
    msgPolling = true
    try { await loadMessages(true) } finally { msgPolling = false }
  }, 4000))
  // 在线状态心跳（60s）：后台不发，回前台时 onWake 会立即补一次
  timers.push(setInterval(() => { if (typeof document === 'undefined' || !document.hidden) sendHeartbeat() }, 60000))
  // 对方在线态定时刷新（30s）：私聊标题栏 + 会话列表/通讯录的在线圆点
  timers.push(setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return
    refreshPeerPresence()
    refreshVisiblePresence()
  }, 30000))
  // 切后台/回前台：后台断 WS（让后端判离线→走极光推送），回前台重连+补拉（见 onHide / onWake）
  if (!burnWakeHandler && typeof document !== 'undefined') {
    burnWakeHandler = onWake
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', burnWakeHandler)
    // 原生侧再挂一层：Android WebView 的 document.hidden 不一定随 app 切后台更新，
    // 只靠 visibilitychange 可能永远不断开 WS（后端 socket_count 保持 1 → 判在线 → 不推极光）
    setupAppState(onHide, onWake)
  }
}
export function stopTimers() {
  timers.forEach(clearInterval)
  timers.length = 0
  clearTimeout(wakeTimer)
  wakeTimer = null
  if (burnWakeHandler) {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('focus', burnWakeHandler)
    burnWakeHandler = null
  }
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
    const isCh = state.chat.is_channel || state.chat.type === 'channel'
    const c = isCh
      ? await api.updateMyChannel(state.chat.id, { avatar_url: url })
      : await api.updateGroup(state.chat.id, { avatar_url: url })
    Object.assign(state.chat, c)
    loadConvs(true)
    showToast('群头像已更新')
    return true
  } catch (e) {
    showToast(e.message)
    return false
  }
}

/* ─── 响应式布局：按屏幕可视宽度自动适配；App 端（Capacitor 原生）强制 mobile 不变 ─── */
const LAYOUT_MQ_WIDE = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(min-width: 768px)') : null
const LAYOUT_MQ_DESKTOP = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(min-width: 800px)') : null

/**
 * 初始化布局模式并监听视口变化。
 * - Capacitor 原生平台（APK）→ 永远 mobile，html 不加任何 bm-* class，App 端样式 100% 不变
 * - Web 浏览器：≥1024px → desktop（左列表 + 右操作区双栏）；768~1023px → tablet（单列放宽）；<768px → mobile（原样）
 * 通过 html.bm-wide / html.bm-desktop 两个 class 驱动 main.css 中的响应式规则。
 */
export function initLayout() {
  const root = document.documentElement
  const apply = () => {
    if (Capacitor.isNativePlatform()) {
      // 原生 App：剥离响应式 class，锁定 mobile（确保 APK 内样式与原有完全一致）
      root.classList.remove('bm-wide', 'bm-desktop')
      state.layout = 'mobile'
      return
    }
    const wide = !!(LAYOUT_MQ_WIDE && LAYOUT_MQ_WIDE.matches)
    const desktop = !!(LAYOUT_MQ_DESKTOP && LAYOUT_MQ_DESKTOP.matches)
    root.classList.toggle('bm-wide', wide)
    root.classList.toggle('bm-desktop', desktop)
    state.layout = desktop ? 'desktop' : (wide ? 'tablet' : 'mobile')
  }
  apply()
  // 监听视口变化实时切换（兼容旧版 Safari 的 addListener）
  const bind = mq => {
    if (!mq) return
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply)
    else if (typeof mq.addListener === 'function') mq.addListener(apply)
  }
  bind(LAYOUT_MQ_WIDE)
  bind(LAYOUT_MQ_DESKTOP)
}