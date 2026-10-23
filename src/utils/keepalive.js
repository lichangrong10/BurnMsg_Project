/**
 * 后台保活开关（Android 前台服务）
 *
 * 为什么需要：极光「自有通道」依赖 App 进程存活。切后台一段时间后系统会冻结进程，
 * 长连接被回收 → 收不到推送，只能等重新打开 App 时由极光补发（表现为"一股脑弹出来"）。
 * 前台服务能让进程保持活跃，从而让长连接存活更久。
 *
 * 代价：通知栏常驻一条低优先级通知（不响不吵），用户可以关掉这个开关。
 * 不影响「被杀后收到」—— 那个必须靠厂商通道。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'
import { storage } from './storage'

const KeepAlive = registerPlugin('KeepAlive')
const isNative = Capacitor.isNativePlatform()

/** 开启保活（受用户偏好开关控制；Web 端 no-op） */
export async function enableKeepAlive() {
  if (!isNative || !storage.keepAliveEnabled) return false
  try {
    await KeepAlive.enable()
    return true
  } catch (e) {
    console.warn('[keepalive] 开启失败', e)
    return false
  }
}

/** 关闭保活（退出登录 / 用户手动关闭时调用） */
export async function disableKeepAlive() {
  if (!isNative) return false
  try {
    await KeepAlive.disable()
    return true
  } catch (e) {
    return false
  }
}

/** 用户偏好：是否允许后台保活（默认开） */
export function isKeepAliveOn() {
  return storage.keepAliveEnabled
}

/** 用户在「我的」里切换开关 */
export async function setKeepAlive(on) {
  storage.keepAliveEnabled = !!on
  return on ? enableKeepAlive() : disableKeepAlive()
}
