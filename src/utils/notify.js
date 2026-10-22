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
