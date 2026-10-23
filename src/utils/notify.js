/**
 * 右下角新消息通知（Element Plus 的 ElNotification）
 *
 * 规则：
 * - 只对「当前没打开的会话」的新消息弹卡片，正在看的会话不打扰
 * - 卡片显示「会话名 + 消息预览」，@我的会带前缀
 * - 点击卡片：关闭通知并跳到该会话
 * - 同时最多 3 条，超出自动关掉最早的一条
 */
import { ElNotification } from 'element-plus'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-notification.css'
import './notify.css'

const MAX = 3
const live = []

/** 弹出新消息通知；onClick 用于点击跳转（通常是 openChat(conv)） */
export function notifyNewMessage({ title, message, onClick }) {
  const inst = ElNotification({
    title: String(title || '新消息'),
    message: String(message || ''),
    position: 'bottom-right',
    duration: 5000,
    showClose: true,
    offset: 16,
    customClass: 'bm-notify',
    onClick: () => {
      try { if (typeof onClick === 'function') onClick() } finally {
        try { inst.close() } catch (e) { /* 已关闭 */ }
      }
    },
    onClose: () => {
      const i = live.indexOf(inst)
      if (i >= 0) live.splice(i, 1)
    }
  })
  live.push(inst)
  while (live.length > MAX) {
    try { live.shift().close() } catch (e) { /* 忽略 */ }
  }
  return inst
}

/* ─── 系统通知（Windows 通知中心气泡，Notification API）───
   只在"桌面浏览器 + 安全上下文 + 已授权 + 用户在设置里打开"时使用；
   页面在后台/最小化时走系统通知，前台仍用上面的右下角卡片。 */

const SYS_KEY = 'bm_sys_notify' // 用户开关（设置页）

/** 是否支持系统通知：桌面 Chrome/Edge；安卓 Chrome 的 new Notification() 会抛错，Capacitor WebView 也没有 */
export function sysNotifySupported() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false
  if (window.isSecureContext === false) return false
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '')) return false
  if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return false
  return true
}

/** 用户是否在设置里打开了桌面通知 */
export function sysNotifyOn() {
  if (!sysNotifySupported()) return false
  try { return localStorage.getItem(SYS_KEY) === '1' } catch (e) { return false }
}

export function setSysNotifyOn(on) {
  try { on ? localStorage.setItem(SYS_KEY, '1') : localStorage.removeItem(SYS_KEY) } catch (e) { /* 忽略 */ }
}

/** 当前授权状态：granted / denied / default / unsupported */
export function sysNotifyPermission() {
  return sysNotifySupported() ? Notification.permission : 'unsupported'
}

/** 主动申请通知权限（设置页开关点击时调用，有用户手势，Chrome 才会真正弹框） */
export async function requestSysNotifyPermission() {
  if (!sysNotifySupported()) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  try { return await Notification.requestPermission() } catch (e) { return 'denied' }
}

/** 发一条系统通知；返回 true 表示已发出（调用方据此决定要不要再弹页面内卡片） */
export function notifySystem({ title, body, tag, onClick }) {
  if (!sysNotifyOn() || sysNotifyPermission() !== 'granted') return false
  try {
    // tag：唯一标识这条通知（调用方传「会话id:消息id」）。同一 tag 的新通知会被系统替换而不是再弹，
    // 所以这里必须每条消息一个 tag，否则连续消息看起来只会提醒一次。
    const n = new Notification(String(title || '焚信'), {
      body: String(body || ''),
      tag: tag ? String(tag) : undefined
    })
    n.onclick = () => {
      try {
        window.focus()
        if (typeof onClick === 'function') onClick()
      } finally {
        try { n.close() } catch (e) { /* 已关闭 */ }
      }
    }
    return true
  } catch (e) { return false }
}
