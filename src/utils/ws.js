/**
 * WebSocket 实时推送（socket.io v4 客户端）
 * - 后端网关：与 REST 同源，路径 /api/v1/socket.io
 * - 握手鉴权：auth.token = REST access token
 * - 断线由 socket.io 自动重连（指数退避 1s~10s）
 * - token 刷新后必须 reconnect（旧 token 握手会持续失败）
 */
import { io } from 'socket.io-client'
import { storage } from './storage'

export const WS_EVENTS = {
  MESSAGE_NEW: 'message:new',
  MESSAGE_EDITED: 'message:edited',
  MESSAGE_RECALLED: 'message:recalled',
  RECEIPT_READ: 'receipt:read',
  CONVERSATION_UPDATED: 'conversation:updated',
  ANNOUNCEMENT_NEW: 'announcement:new'
}

let socket = null
const handlers = {} // event -> Set<fn>，重连后逐事件重新挂上

/** 由 baseURL 推导 WS 源：绝对地址取 origin；相对路径（vite 代理）返回 undefined 表示同源 */
function wsOrigin() {
  const b = (storage.baseURL || '').replace(/\/+$/, '')
  if (!b || b.startsWith('/')) return undefined
  const m = b.match(/^(https?:\/\/[^/]+)/)
  return m ? m[1] : undefined
}

/** 由 baseURL 推导 socket.io 路径：取 baseURL 的 path 部分 + /socket.io */
function wsPath() {
  const b = (storage.baseURL || '').replace(/\/+$/, '')
  if (b.startsWith('/')) return b + '/socket.io'
  const m = b.match(/^https?:\/\/[^/]+(\/.*)?$/)
  return ((m && m[1]) || '/api/v1') + '/socket.io'
}

/** 建立连接（已连接时先断开）。token 缺省时直接跳过 */
export function connectWs(token) {
  disconnectWs()
  if (!token) return
  const opts = {
    path: wsPath(),
    transports: ['websocket', 'polling'],
    auth: { token },
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000
  }
  const origin = wsOrigin()
  socket = origin ? io(origin, opts) : io(opts)
  for (const ev of Object.keys(handlers)) {
    for (const fn of handlers[ev]) socket.on(ev, fn)
  }
  socket.on('connect', () => console.log('[焚信] WS 已连接，实时推送开启'))
  socket.on('disconnect', reason => console.log('[焚信] WS 断开:', reason))
  socket.on('connect_error', e => console.warn('[焚信] WS 连接失败:', (e && e.message) || e))
}

export function disconnectWs() {
  if (socket) {
    try { socket.disconnect() } catch (e) { /* 忽略 */ }
    socket = null
  }
}

/** 用新 token 重建连接（token 刷新后调用） */
export function reconnectWs(token) {
  connectWs(token)
}

/** 订阅事件，返回取消订阅函数；连接未建立时也先登记，建连后自动挂上 */
export function onWs(event, fn) {
  if (!handlers[event]) handlers[event] = new Set()
  handlers[event].add(fn)
  if (socket) socket.on(event, fn)
  return () => offWs(event, fn)
}

export function offWs(event, fn) {
  const set = handlers[event]
  if (set) set.delete(fn)
  if (socket) socket.off(event, fn)
}
