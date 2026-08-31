/**
 * 剪贴板复制工具。
 * 优先现代 Clipboard API（仅 https / localhost 等安全上下文可用）；
 * 内网 http / Capacitor WebView（访问如 192.168.x.x）下 navigator.clipboard 为 undefined，
 * 需兜底用隐藏 textarea + document.execCommand('copy')（同步执行，能吃到 click 的 user activation）。
 */
export async function copyText(text) {
  if (text == null || text === '') return false
  // 1) 现代 Clipboard API（安全上下文）
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch (e) { /* 继续走 execCommand 兜底 */ }
  }
  // 2) 隐藏 textarea + execCommand 兜底
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch (e) {
    return false
  }
}