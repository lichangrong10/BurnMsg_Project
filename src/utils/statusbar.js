// 状态栏适配：禁用 WebView 悬浮(overlay)状态栏，避免 Android 新机型(edge-to-edge)内容顶到状态栏后头
// 方案A：让系统把 WebView 内容区压在状态栏下方，两端统一不复用 env(safe-area-inset-top) 在 Android 上不可靠的问题
// 依赖 @capacitor/status-bar（本地需 npm install）；仅在 Capacitor 原生平台生效，浏览器/dev/demo 自动跳过
import { Capacitor } from '@capacitor/core'
import { StatusBar } from '@capacitor/status-bar'

let installed = false

export async function setupStatusBar() {
  if (installed || !Capacitor.isNativePlatform()) return
  installed = true
  try {
    await StatusBar.setOverlaysWebView({ overlay: false })
    // 状态栏底色与顶部标题栏主题蓝一致（--tg-blue #3390EC）
    await StatusBar.setBackgroundColor({ color: '#3390EC' })
  } catch (e) {
    // 状态栏插件异常不影响主流程，仅记录
    console.warn('[焚信] 状态栏初始化失败：', e)
  }
}