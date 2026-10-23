/**
 * 原生前后台切换监听（Capacitor @capacitor/app）
 *
 * 为什么不能只靠 document.visibilitychange：
 * Android WebView 在 Activity 切到后台时，document.hidden 并不总会更新（不同 ROM / WebView 版本行为不一致），
 * 会导致「切后台不断开 WS」→ 后端 socket_count 仍为 1 → 判定在线 → 不推极光。
 * Capacitor 的 appStateChange 由原生 onPause/onResume 驱动，可靠得多。
 *
 * 浏览器 / dev / demo 环境自动跳过（isNativePlatform 为 false）。
 */
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

let installed = false

/**
 * @param {() => void} onHide 切到后台
 * @param {() => void} onWake 回到前台
 */
export async function setupAppState(onHide, onWake) {
  if (installed || !Capacitor.isNativePlatform()) return
  installed = true
  try {
    await CapApp.addListener('appStateChange', ({ isActive }) => {
      try {
        if (isActive) onWake()
        else onHide()
      } catch (e) {
        console.warn('[appstate] 前后台回调失败', e)
      }
    })
  } catch (e) {
    console.warn('[appstate] 监听注册失败', e)
  }
}
