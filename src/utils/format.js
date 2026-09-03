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
    case 'voice': return '[语音]' + (/^\d+$/.test(m.content || '') ? ` ${m.content}″` : '')
    case 'video': return '[视频]'
    default: return m.content || '[消息]'
  }
}

/* ===================== 文件类型分类与配色 ===================== */
/** 文件大类：label 是图标右下角的角标文字，bg 是图标底色，lightBg 是浅色气泡版（自己发的消息用） */
const FILE_TYPE_MAP = {
  // Word
  doc:   { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  docx:  { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  docm:  { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  rtf:   { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  odt:   { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  wps:   { cat: 'word',   label: 'W',    bg: '#2B579A', lightBg: '#DEE6F4' },
  // Excel
  xls:   { cat: 'excel',  label: 'X',    bg: '#1D6F42', lightBg: '#D8EBDC' },
  xlsx:  { cat: 'excel',  label: 'X',    bg: '#1D6F42', lightBg: '#D8EBDC' },
  xlsm:  { cat: 'excel',  label: 'X',    bg: '#1D6F42', lightBg: '#D8EBDC' },
  csv:   { cat: 'excel',  label: 'CSV',  bg: '#1D6F42', lightBg: '#D8EBDC' },
  ods:   { cat: 'excel',  label: 'X',    bg: '#1D6F42', lightBg: '#D8EBDC' },
  et:    { cat: 'excel',  label: 'X',    bg: '#1D6F42', lightBg: '#D8EBDC' },
  // PPT
  ppt:   { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  pptx:  { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  pptm:  { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  pps:   { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  ppsx:  { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  odp:   { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  dps:   { cat: 'ppt',    label: 'P',    bg: '#D24726', lightBg: '#F9DDD5' },
  // PDF
  pdf:   { cat: 'pdf',    label: 'PDF',  bg: '#E53935', lightBg: '#FBD7D6' },
  // 图片
  jpg:   { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  jpeg:  { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  png:   { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  gif:   { cat: 'image',  label: 'GIF',  bg: '#EC407A', lightBg: '#FCD6E1' },
  webp:  { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  bmp:   { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  svg:   { cat: 'image',  label: 'SVG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  ico:   { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  tiff:  { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  tif:   { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  heic:  { cat: 'image',  label: 'IMG',  bg: '#EC407A', lightBg: '#FCD6E1' },
  psd:   { cat: 'image',  label: 'PSD',  bg: '#EC407A', lightBg: '#FCD6E1' },
  ai:    { cat: 'image',  label: 'AI',   bg: '#EC407A', lightBg: '#FCD6E1' },
  // 视频
  mp4:   { cat: 'video',  label: 'MP4',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  mov:   { cat: 'video',  label: 'MOV',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  avi:   { cat: 'video',  label: 'AVI',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  mkv:   { cat: 'video',  label: 'MKV',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  flv:   { cat: 'video',  label: 'FLV',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  wmv:   { cat: 'video',  label: 'WMV',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  webm:  { cat: 'video',  label: 'WEB',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  m4v:   { cat: 'video',  label: 'M4V',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  '3gp': { cat: 'video',  label: '3GP',  bg: '#7B61FF', lightBg: '#E4DFFF' },
  rmvb:  { cat: 'video',  label: 'RM',   bg: '#7B61FF', lightBg: '#E4DFFF' },
  rm:    { cat: 'video',  label: 'RM',   bg: '#7B61FF', lightBg: '#E4DFFF' },
  // 音频
  mp3:   { cat: 'audio',  label: 'MP3',  bg: '#00ACC1', lightBg: '#CCECEF' },
  wav:   { cat: 'audio',  label: 'WAV',  bg: '#00ACC1', lightBg: '#CCECEF' },
  m4a:   { cat: 'audio',  label: 'M4A',  bg: '#00ACC1', lightBg: '#CCECEF' },
  flac:  { cat: 'audio',  label: 'FLAC', bg: '#00ACC1', lightBg: '#CCECEF' },
  aac:   { cat: 'audio',  label: 'AAC',  bg: '#00ACC1', lightBg: '#CCECEF' },
  ogg:   { cat: 'audio',  label: 'OGG',  bg: '#00ACC1', lightBg: '#CCECEF' },
  wma:   { cat: 'audio',  label: 'WMA',  bg: '#00ACC1', lightBg: '#CCECEF' },
  ape:   { cat: 'audio',  label: 'APE',  bg: '#00ACC1', lightBg: '#CCECEF' },
  mid:   { cat: 'audio',  label: 'MID',  bg: '#00ACC1', lightBg: '#CCECEF' },
  midi:  { cat: 'audio',  label: 'MID',  bg: '#00ACC1', lightBg: '#CCECEF' },
  // 压缩包
  zip:   { cat: 'archive',label: 'ZIP',  bg: '#FFA000', lightBg: '#FFE8B8' },
  rar:   { cat: 'archive',label: 'RAR',  bg: '#FFA000', lightBg: '#FFE8B8' },
  '7z':  { cat: 'archive',label: '7Z',   bg: '#FFA000', lightBg: '#FFE8B8' },
  tar:   { cat: 'archive',label: 'TAR',  bg: '#FFA000', lightBg: '#FFE8B8' },
  gz:    { cat: 'archive',label: 'GZ',   bg: '#FFA000', lightBg: '#FFE8B8' },
  bz2:   { cat: 'archive',label: 'BZ2',  bg: '#FFA000', lightBg: '#FFE8B8' },
  xz:    { cat: 'archive',label: 'XZ',   bg: '#FFA000', lightBg: '#FFE8B8' },
  '001': { cat: 'archive',label: '001',  bg: '#FFA000', lightBg: '#FFE8B8' },
  // 代码
  js:    { cat: 'code',   label: 'JS',   bg: '#1976D2', lightBg: '#D1E3F6' },
  ts:    { cat: 'code',   label: 'TS',   bg: '#1976D2', lightBg: '#D1E3F6' },
  jsx:   { cat: 'code',   label: 'JSX',  bg: '#1976D2', lightBg: '#D1E3F6' },
  tsx:   { cat: 'code',   label: 'TSX',  bg: '#1976D2', lightBg: '#D1E3F6' },
  vue:   { cat: 'code',   label: 'VUE',  bg: '#1976D2', lightBg: '#D1E3F6' },
  py:    { cat: 'code',   label: 'PY',   bg: '#1976D2', lightBg: '#D1E3F6' },
  java:  { cat: 'code',   label: 'JAVA', bg: '#1976D2', lightBg: '#D1E3F6' },
  c:     { cat: 'code',   label: 'C',    bg: '#1976D2', lightBg: '#D1E3F6' },
  cpp:   { cat: 'code',   label: 'CPP',  bg: '#1976D2', lightBg: '#D1E3F6' },
  h:     { cat: 'code',   label: 'H',    bg: '#1976D2', lightBg: '#D1E3F6' },
  cs:    { cat: 'code',   label: 'CS',   bg: '#1976D2', lightBg: '#D1E3F6' },
  go:    { cat: 'code',   label: 'GO',   bg: '#1976D2', lightBg: '#D1E3F6' },
  rs:    { cat: 'code',   label: 'RS',   bg: '#1976D2', lightBg: '#D1E3F6' },
  php:   { cat: 'code',   label: 'PHP',  bg: '#1976D2', lightBg: '#D1E3F6' },
  rb:    { cat: 'code',   label: 'RB',   bg: '#1976D2', lightBg: '#D1E3F6' },
  swift: { cat: 'code',   label: 'SWIFT',bg: '#1976D2', lightBg: '#D1E3F6' },
  kt:    { cat: 'code',   label: 'KT',   bg: '#1976D2', lightBg: '#D1E3F6' },
  html:  { cat: 'code',   label: 'HTML', bg: '#1976D2', lightBg: '#D1E3F6' },
  htm:   { cat: 'code',   label: 'HTML', bg: '#1976D2', lightBg: '#D1E3F6' },
  css:   { cat: 'code',   label: 'CSS',  bg: '#1976D2', lightBg: '#D1E3F6' },
  scss:  { cat: 'code',   label: 'SCSS', bg: '#1976D2', lightBg: '#D1E3F6' },
  less:  { cat: 'code',   label: 'LESS', bg: '#1976D2', lightBg: '#D1E3F6' },
  json:  { cat: 'code',   label: 'JSON', bg: '#1976D2', lightBg: '#D1E3F6' },
  xml:   { cat: 'code',   label: 'XML',  bg: '#1976D2', lightBg: '#D1E3F6' },
  yaml:  { cat: 'code',   label: 'YAML', bg: '#1976D2', lightBg: '#D1E3F6' },
  yml:   { cat: 'code',   label: 'YML',  bg: '#1976D2', lightBg: '#D1E3F6' },
  sql:   { cat: 'code',   label: 'SQL',  bg: '#1976D2', lightBg: '#D1E3F6' },
  sh:    { cat: 'code',   label: 'SH',   bg: '#1976D2', lightBg: '#D1E3F6' },
  bat:   { cat: 'code',   label: 'BAT',  bg: '#1976D2', lightBg: '#D1E3F6' },
  // 文本/文档
  txt:   { cat: 'text',   label: 'TXT',  bg: '#78909C', lightBg: '#E0E6EB' },
  md:    { cat: 'text',   label: 'MD',   bg: '#78909C', lightBg: '#E0E6EB' },
  log:   { cat: 'text',   label: 'LOG',  bg: '#78909C', lightBg: '#E0E6EB' },
  ini:   { cat: 'text',   label: 'INI',  bg: '#78909C', lightBg: '#E0E6EB' },
  cfg:   { cat: 'text',   label: 'CFG',  bg: '#78909C', lightBg: '#E0E6EB' },
  conf:  { cat: 'text',   label: 'CONF', bg: '#78909C', lightBg: '#E0E6EB' },
  // 安装包
  exe:   { cat: 'app',    label: 'EXE',  bg: '#E53935', lightBg: '#FBD7D6' },
  msi:   { cat: 'app',    label: 'MSI',  bg: '#E53935', lightBg: '#FBD7D6' },
  dmg:   { cat: 'app',    label: 'DMG',  bg: '#E53935', lightBg: '#FBD7D6' },
  apk:   { cat: 'app',    label: 'APK',  bg: '#E53935', lightBg: '#FBD7D6' },
  ipa:   { cat: 'app',    label: 'IPA',  bg: '#E53935', lightBg: '#FBD7D6' },
  deb:   { cat: 'app',    label: 'DEB',  bg: '#E53935', lightBg: '#FBD7D6' },
  rpm:   { cat: 'app',    label: 'RPM',  bg: '#E53935', lightBg: '#FBD7D6' },
  // 字体
  ttf:   { cat: 'font',   label: 'TTF',  bg: '#9C27B0', lightBg: '#E8D4ED' },
  otf:   { cat: 'font',   label: 'OTF',  bg: '#9C27B0', lightBg: '#E8D4ED' },
  woff:  { cat: 'font',   label: 'WOFF', bg: '#9C27B0', lightBg: '#E8D4ED' },
  woff2: { cat: 'font',   label: 'WOF2', bg: '#9C27B0', lightBg: '#E8D4ED' },
  eot:   { cat: 'font',   label: 'EOT',  bg: '#9C27B0', lightBg: '#E8D4ED' },
  // 设计
  sketch:{ cat: 'design', label: 'SKETCH',bg: '#FFB300',lightBg: '#FFE8B8' },
  fig:   { cat: 'design', label: 'FIG',  bg: '#A259FF', lightBg: '#EAD9FF' },
  xd:    { cat: 'design', label: 'XD',   bg: '#FF61F6', lightBg: '#FFD5FC' },
  cdr:   { cat: 'design', label: 'CDR',  bg: '#00C172', lightBg: '#CCEEDE' },
  // 3D
  obj:   { cat: '3d',     label: 'OBJ',  bg: '#FB8C00', lightBg: '#FDE0BD' },
  fbx:   { cat: '3d',     label: 'FBX',  bg: '#FB8C00', lightBg: '#FDE0BD' },
  stl:   { cat: '3d',     label: 'STL',  bg: '#FB8C00', lightBg: '#FDE0BD' },
  blend: { cat: '3d',     label: 'BLEND',bg: '#FB8C00', lightBg: '#FDE0BD' },
  '3ds': { cat: '3d',     label: '3DS',  bg: '#FB8C00', lightBg: '#FDE0BD' },
  max:   { cat: '3d',     label: 'MAX',  bg: '#FB8C00', lightBg: '#FDE0BD' },
  // 数据
  db:    { cat: 'data',   label: 'DB',   bg: '#795548', lightBg: '#E6DED9' },
  sqlite:{ cat: 'data',   label: 'SQLIT',bg: '#795548', lightBg: '#E6DED9' },
  mdb:   { cat: 'data',   label: 'MDB',  bg: '#795548', lightBg: '#E6DED9' },
  // 电子书
  epub:  { cat: 'book',   label: 'EPUB', bg: '#43A047', lightBg: '#DAEEDB' },
  mobi:  { cat: 'book',   label: 'MOBI', bg: '#43A047', lightBg: '#DAEEDB' },
  azw:   { cat: 'book',   label: 'AZW',  bg: '#43A047', lightBg: '#DAEEDB' },
  azw3:  { cat: 'book',   label: 'AZW3', bg: '#43A047', lightBg: '#DAEEDB' },
}

const FILE_TYPE_DEFAULT = { cat: 'other', label: 'FILE', bg: '#90A4AE', lightBg: '#E4EAEE' }

/** 根据文件名返回文件类型信息：分类、角标文字、图标底色（深色/浅色两套） */
export function getFileTypeInfo(fileName) {
  const name = String(fileName || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1) : ''
  return FILE_TYPE_MAP[ext] || FILE_TYPE_DEFAULT
}
