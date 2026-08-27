/**
 * axios 请求模块
 * - baseURL 可配置（localStorage 持久化，App 内「后端地址」可改）
 * - 请求拦截：自动注入 JWT Bearer token
 * - 响应拦截：统一解包 { code, message, data }
 * - 401 自动刷新：单例 Promise 防止并发刷新，刷新成功后重放原请求；刷新失败强制登出
 */
import axios from 'axios'
import { storage } from './storage'

export const http = axios.create({ baseURL: storage.baseURL, timeout: 15000 })

/** 更新后端地址（同步持久化 + 更新实例） */
export function setBaseURL(url) {
  storage.baseURL = url
  http.defaults.baseURL = url
}

// ── 请求拦截：自动注入 JWT ─────────────────────────────
http.interceptors.request.use(cfg => {
  if (storage.token) cfg.headers.Authorization = 'Bearer ' + storage.token
  return cfg
})

// ── 401 刷新：单例 Promise + 失败请求队列重放 ─────────────
let refreshing = null
async function doRefreshToken() {
  const { data } = await axios.post(storage.baseURL + '/auth/refresh-token',
    { refresh_token: storage.refresh }, { timeout: 15000 })
  const d = data.data || data
  storage.token = d.access_token
  storage.refresh = d.refresh_token
  window.dispatchEvent(new Event('bm-token-refreshed')) // 通知 WS 用新 token 重建连接
  return d.access_token
}

http.interceptors.response.use(
  resp => {
    // 统一响应格式 { code, message, data }：code!==0 视为业务错误
    if (resp.data && typeof resp.data === 'object' && 'code' in resp.data) {
      if (resp.data.code === 0) return resp.data.data
      return Promise.reject(new Error(resp.data.message || '请求失败'))
    }
    return resp.data
  },
  async err => {
    const cfg = err.config || {}
    // 登录/刷新接口本身的 401 不做刷新重试
    const isAuthApi = /\/auth\/(login|refresh-token)/.test(cfg.url || '')
    if (err.response && err.response.status === 401 && !isAuthApi && !cfg.__retried) {
      cfg.__retried = true
      try {
        refreshing = refreshing || doRefreshToken().finally(() => { refreshing = null })
        const newToken = await refreshing
        cfg.headers = cfg.headers || {}
        cfg.headers.Authorization = 'Bearer ' + newToken
        return http(cfg) // 重放原请求
      } catch (e) {
        storage.clear() // 刷新失败 → 强制登出
        window.dispatchEvent(new Event('bm-logout'))
        return Promise.reject(new Error('登录已过期，请重新登录'))
      }
    }
    const msg = (err.response && err.response.data && err.response.data.message)
      || (err.code === 'ECONNABORTED' ? '请求超时，请检查网络' : '')
      || (err.message === 'Network Error' ? '无法连接服务器，请检查后端地址' : err.message)
    return Promise.reject(new Error(msg))
  }
)
