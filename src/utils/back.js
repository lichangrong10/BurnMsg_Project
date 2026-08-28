// 安卓原生返回手势/按键处理：返回应用内上一级，而不是直接退出到桌面
// 仅在 Capacitor 原生平台生效；浏览器 / dev / demo 模式自动跳过
// 依赖 @capacitor/app（本地需 npm install）
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { state, closeChat, showToast } from '../store'

let installed = false
let lastBackAt = 0

/**
 * 返回键优先级（从视觉最顶层到底层逐级关闭）：
 *  0. 组件内部弹层（先派发 bm-back 可取消事件，各组件自行消费：
 *     消息菜单 / 回执详情 / 阅后即焚面板 / 编辑资料 / 添加成员 / 会话菜单 / Admin 各弹窗…）
 *  1. 后端地址弹窗
 *  2. 聊天信息/群管理页
 *  3. 建群/频道页
 *  4. 管理后台页
 *  5. 聊天页 → 回到会话列表
 *  6. 非「会话」底 tab → 切回「会话」
 *  7. 已在最外层 → 2 秒内再按一次退出 App
 */
export function setupBackHandler() {
  if (installed || !Capacitor.isNativePlatform()) return
  installed = true
  CapApp.addListener('backButton', () => {
    // 0. 组件内部弹层优先（组件监听 bm-back，有关闭动作则 preventDefault）
    const ev = new Event('bm-back', { cancelable: true })
    window.dispatchEvent(ev)
    if (ev.defaultPrevented) return

    // 1-4. 应用级覆盖层（顺序即层级，后渲染的在上，先关最上层）
    if (state.showServerDialog) { state.showServerDialog = false; return }
    if (state.showChatInfo)     { state.showChatInfo = false; return }
    if (state.showCreateGroup)  { state.showCreateGroup = false; return }
    if (state.showAdmin)        { state.showAdmin = false; return }

    // 5. 聊天页 → 会话列表
    if (state.chat)             { closeChat(); return }

    // 6. 非「会话」tab → 切回会话
    if (state.view === 'main' && state.tab && state.tab !== 'chats') { state.tab = 'chats'; return }

    // 7. 最外层：双击退出
    const now = Date.now()
    if (now - lastBackAt < 2000) { CapApp.exitApp(); return }
    lastBackAt = now
    showToast('再按一次退出焚信')
  })
}
