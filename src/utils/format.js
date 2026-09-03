/**
 * 展示工具函数：头像配色、会话名、时间/文件大小格式化、阅后即焚档位
 */
import { storage } from './storage'

export const BURN_OPTIONS = [
  { v: 0, label: '关闭' }, { v: 5, label: '5 秒' }, { v: 10, label: '10 秒' },
  { v: 30, label: '30 秒' }, { v: 60, label: '1 分钟' }, { v: 300, label: '5 分钟' },
  { v: 3600, label: '1 小时' }, { v: 86400, label: '1 天' }, { v: 604800, label: '1 周' }
]

/* Telegram 蓝色系：无头像时的首字符底色（按名字哈希在蓝色族内取稳定色） */
export const AVATAR_COLORS = ['var(--tg-av-0)', 'var(--tg-av-1)', 'var(--tg-av-2)', 'var(--tg-av-3)', 'var(--tg-av-4)', 'var(--tg-av-5)', 'var(--tg-av-6)'] /* 主题色派生的 7 档明暗（CSS 变量由 store applyTheme 随主题色自动更新，默认值见 main.css --tg-av-*） */

/** 按名字哈希出稳定头像底色 */
export function avatarColor(name) {
  let h = 0
  for (const ch of String(name || '?')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function convName(c) {
  if (!c) return ''
  if (c.type === 'private') {
    const u = c.other_user || {}
    return u.display_name || u.name || u.username || '私聊'
  }
  return c.name || '群聊'
}

export function convInitial(c) {
  return (convName(c) || '?')[0]
}

/** 相对路径文件地址补全为完整 URL（upload 返回的 file_url 为相对路径） */
export function fileURL(u) {
  return /^https?:|^data:/.test(u) ? u : storage.baseURL.replace(/\/api\/v1\/?$/, '') + u
}

/** 图片缩略图路径推导（V5.8.3 服务端约定）：/uploads/<uuid>.<ext> → /uploads/thumb/<uuid>_thumb.webp；
    gif / 非 uploads 路径返回 null（调用方回退用原图 url）。消息接口不传输 thumb_url，
    接收方与老消息都靠这个约定推导，加载 404 时由 <img @error> 回退原图 */
export function thumbURLOf(fileUrl) {
  if (!fileUrl || typeof fileUrl !== 'string') return null
  const mm = fileUrl.match(/^(.*\/uploads\/)([^/?#]+)\.([a-zA-Z0-9]+)(\?.*)?$/)
  if (!mm || mm[3].toLowerCase() === 'gif') return null
  return `${mm[1]}thumb/${mm[2]}_thumb.webp`
}

/** 用户头像完整 URL；无头像返回 null（调用方回落为首字符底色块） */
export function avatarSrc(u) {
  const url = u && u.avatar_url
  return url ? fileURL(url) : null
}

/** 会话头像：私聊取对方头像，群/频道取会话自身 avatar_url */
export function convAvatar(c) {
  if (!c) return null
  return c.type === 'private' ? avatarSrc(c.other_user) : avatarSrc(c)
}

/**
 * 从群成员记录中提取用户对象。
 * 兼容多种后端返回：嵌套 user / user_info / profile / member / member_info / account，或 SafeUser 字段直接平铺在成员记录上
 */
export function memberUser(m) {
  if (!m || typeof m !== 'object') return {}
  for (const k of ['user', 'user_info', 'profile', 'member', 'member_info', 'account']) {
    const v = m[k]
    if (v && typeof v === 'object' && !Array.isArray(v)) return v
  }
  return m
}

/** 成员显示名：多字段名兼容，display_name 优先，兜底手机号，再退『成员』 */
const MEMBER_NAME_KEYS = ['display_name', 'name', 'username', 'nickname', 'nick_name', 'real_name', 'user_name', 'member_name', 'full_name', 'phone']
export function memberName(m) {
  const u = memberUser(m)
  for (const k of MEMBER_NAME_KEYS) {
    const v = u[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return '成员'
}

/** 成员头像 URL（无则 null） */
export function memberAvatar(m) {
  return avatarSrc(memberUser(m))
}

/** 成员用户 ID：user_id 优先，兼容嵌套结构，最后才退到记录 id */
export function memberUid(m) {
  if (!m || typeof m !== 'object') return ''
  return m.user_id || memberUser(m).id || m.id
}

/** 会话列表时间：今天显示 HH:mm，昨天显示"昨天"，更早显示 月/日 */
export function fmtTime(t) {
  if (!t) return ''
  const d = new Date(t), now = new Date()
  if (d.toDateString() === now.toDateString()) return d.toTimeString().slice(0, 5)
  const yest = new Date(now - 86400000)
  if (d.toDateString() === yest.toDateString()) return '昨天'
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function fmtClock(t) {
  return t ? new Date(t).toTimeString().slice(0, 5) : ''
}

/** 公告时间：始终显示 X月X日 HH:mm，跨年补年份 */
export function fmtDateTime(t) {
  if (!t) return ''
  const d = new Date(t), now = new Date()
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  const hm = d.toTimeString().slice(0, 5)
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`
}

export function fmtSize(s) {
  if (!s) return ''
  if (s < 1024) return s + ' B'
  if (s < 1048576) return (s / 1024).toFixed(1) + ' KB'
  if (s < 1073741824) return (s / 1048576).toFixed(1) + ' MB'
  return (s / 1073741824).toFixed(2) + ' GB'
}
/** 消息 → 会话列表预览文本（撤回/媒体类型做占位文案） */
export function messagePreview(m) {
  if (!m || typeof m !== 'object') return ''
  if (m.is_recalled) return '此消息已撤回'
  if (m.is_blurred) return '焚毁消息'
  if (m.is_encrypted || m.e2e === true || m.e2eFail === true) return '加密消息'
  switch (m.type) {
    case 'text': return m.content || ''
    case 'image': return '[图片]'
    case 'file': return '[文件]'
    case 'voice': return '[语音]'
    case 'video': return '[视频]'
    default: return m.content || '[消息]'
  }
}