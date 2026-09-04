// v5.8.7 图片双上传前端补丁（一次性脚本，执行后可删除）
// 用法：node _v587_patch.js —— 在 fenxin 项目根目录执行
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url); const fs = require('fs')

function patch(file, pairs, label) {
  let s = fs.readFileSync(ROOT + '/' + file, 'utf8')
  let n = 0
  for (const [oldS, newS] of pairs) {
    // 行尾兼容：把模板统一转成文件当前行尾风格再匹配
    const crlf = s.includes('\r\n')
    const o = crlf ? oldS.replace(/\n/g, '\r\n') : oldS
    const nw = crlf ? newS.replace(/\n/g, '\r\n') : newS
    const cnt = s.split(o).length - 1
    if (cnt !== 1) { console.log(`FAIL [${label}] 命中 ${cnt} 次: ${oldS.slice(0, 60)}...`); process.exit(1) }
    s = s.replace(o, nw)
    n++
  }
  fs.writeFileSync(ROOT + '/' + file, s)
  console.log(`OK [${label}] ${n} 处`)
}

// ═══ 1. store/index.js：compressImage 函数 + sendFile 双上传改造 ═══
const NEW_STORE = `/** 图片压缩（v5.8.7 双上传）：canvas 重绘长边 ≤1440 JPEG q0.82，典型 3~8MB 手机原图 → 200~600KB。
 *  聊天流/大图查看器加载压缩版（5Mbps 出带宽下 <1s 秒开），「保存到相册」走原图。
 *  返回 null = 不压缩走原图直传：gif（canvas 重绘丢动画）/ 小图 ≤300KB（压缩无收益）/ HEIC 等解码失败。
 *  EXIF 方向：现代 Chromium WebView 的 <img> 解码默认按 EXIF 摆正，drawImage 遵循同方向，竖拍不旋转。 */
async function compressImage(file) {
  if (!/^image\\//.test(file.type) || file.type === 'image/gif') return null
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
  const isImg = /^image\\//.test(file.type)
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
      if (state.burnSeconds) payload.burn_ttl_seconds = state.burnSeconds // 点开才焚：传点开后多少秒焚毁（后端据此下发马赛克占位，点开 reveal 才给内容）
      const m = await api.sendMessage(payload)
      if (isImg) m.thumb_url = up.thumb_url || null // 上传响应的缩略图存到消息对象（消息接口不传输该字段，仅本地回声用）
      pushMsgDedup(m)
      return
    }
    // ── 图片双上传：压缩版先行发消息，原图后台补传 ──
    const cf = new File([compressed], ((file.name || 'image').replace(/\\.[^.]+$/, '') || 'image') + '.jpg', { type: 'image/jpeg' })
    const up = await api.upload(cf)
    const payload = { conversation_id: state.chat.id, type: 'image', file_url: up.url, file_name: file.name, file_size: file.size }
    if (state.burnSeconds) payload.burn_ttl_seconds = state.burnSeconds
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
}`

const storeSrc = fs.readFileSync('src/store/index.js', 'utf8')
const m = storeSrc.match(/\/\*\* 发送图片\/文件（先上传再发消息，50MB 前端预校验） \*\/\r?\nexport async function sendFile\(file\) \{[\s\S]*?\r?\n\}/)
if (!m) { console.log('FAIL: sendFile 函数定位失败'); process.exit(1) }
const crlfStore = storeSrc.includes('\r\n')
fs.writeFileSync(ROOT + '/src/store/index.js', storeSrc.replace(m[0], crlfStore ? NEW_STORE.replace(/\n/g, '\r\n') : NEW_STORE))
console.log('OK [store/index.js] sendFile 双上传改造')

// ═══ 2. ChatRoom.vue：大图查看器（压缩版显示 + 原图下载）═══
patch('src/views/ChatRoom.vue', [
  [`    openImageView(m) {
      if (!m || !m.file_url) return
      this.viewer = { show: true, url: fileURL(m.file_url), name: m.file_name || '', scale: 1, tx: 0, ty: 0 }
    },`,
`    openImageView(m) {
      if (!m || !m.file_url) return
      // v5.8.7 双上传：大图默认加载压缩版（file_url，秒开）；originalUrl 为原图，供「下载原图」
      this.viewer = { show: true, url: fileURL(m.file_url), originalUrl: m.file_original_url ? fileURL(m.file_original_url) : '', name: m.file_name || '', scale: 1, tx: 0, ty: 0 }
    },`],
  [`        const blob = await http.get(this.viewer.url, { responseType: 'blob', timeout: 60000 })`,
`        // v5.8.7：优先下载原图（originalUrl），无原图（老消息/压缩失败直传）回退当前显示图
        const blob = await http.get(this.viewer.originalUrl || this.viewer.url, { responseType: 'blob', timeout: 60000 })`],
  [`{{ viewer.saving ? '保存中…' : '保存到相册' }}`,
`{{ viewer.saving ? '保存中…' : (viewer.originalUrl ? '下载原图' : '保存到相册') }}`],
], 'ChatRoom.vue')

console.log('ALL DONE — 全部补丁应用成功')
'ALL DONE — 全部补丁应用成功')
