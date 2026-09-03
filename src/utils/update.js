/**
 * App 版本更新检查
 * - 启动时 + WS app:update 事件触发时调用
 * - 通过 Capacitor App.getInfo() 获取当前 versionCode
 * - APK 下载安装通过原生桥接（MainActivity 中的 AppUpdater 插件）
 */
import { registerPlugin } from '@capacitor/core'
import { api } from '../api'
import { storage } from './storage'

// 注册原生插件（懒加载，仅在实际调用时才会初始化）
const AppUpdater = registerPlugin('AppUpdater')

/** 获取当前 App versionCode */
export async function getCurrentVersionCode() {
  try {
    const cap = window.Capacitor
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      const { App } = await import('@capacitor/app')
      const info = await App.getInfo()
      return Number(info.build) || 0
    }
  } catch (e) {
    console.warn('[焚信] 获取版本号失败:', e)
  }
  return 0
}

/** 获取 APK 完整下载地址（相对路径拼后端 origin） */
export function resolveApkUrl(apkUrl) {
  if (!apkUrl) return ''
  if (/^https?:\/\//i.test(apkUrl)) return apkUrl
  const base = (storage.baseURL || '').replace(/\/+$/, '').replace(/\/api\/v1$/, '')
  return base + apkUrl
}

/** 检查更新，返回新版本信息或 null */
export async function checkAppUpdate() {
  const currentCode = await getCurrentVersionCode()
  if (currentCode <= 0) return null
  try {
    const data = await api.checkUpdate('android', currentCode)
    // 防御：后端可能返回当前版本或更低版本，只有真正的新版本才弹窗
    if (data && Number(data.version_code) > currentCode) return data
    return null
  } catch (e) {
    console.warn('[焚信] 检查更新失败:', e)
    return null
  }
}

/** 触发 APK 下载安装（通过原生桥接） */
export async function downloadAndInstallApk(url, onProgress) {
  const fullUrl = resolveApkUrl(url)
  const cap = window.Capacitor
  if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
    let progressListener = null
    let errorListener = null
    let completeListener = null
    try {
      return await new Promise((resolve, reject) => {
        progressListener = AppUpdater.addListener('downloadProgress', data => {
          if (onProgress && data && typeof data.progress === 'number') onProgress(data.progress)
        })
        errorListener = AppUpdater.addListener('downloadError', data => {
          reject(new Error((data && data.error) || '下载失败'))
        })
        completeListener = AppUpdater.addListener('downloadComplete', () => {
          resolve({ success: true, message: '下载完成，正在安装' })
        })
        AppUpdater.downloadAndInstall({ url: fullUrl }).catch(reject)
      })
    } catch (e) {
      console.error('[焚信] 原生安装 APK 失败:', e)
      throw e
    } finally {
      if (progressListener) progressListener.remove()
      if (errorListener) errorListener.remove()
      if (completeListener) completeListener.remove()
    }
  }
  // 浏览器调试环境：直接打开下载链接
  window.open(fullUrl, '_blank')
  return { success: true, message: '浏览器环境，已打开下载链接' }
}