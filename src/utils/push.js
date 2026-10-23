/**
 * 极光推送（JPush）前端封装 —— 按《PUSH_JPUSH.md》§4.1 实现
 *
 * 与文档的差异（本工程适配，非偏离）：
 * 1) 文档 §3.1 建议「先试路线 A（Cordova 插件 jpush-cordova-plugin），不行再走路线 B（自写 Capacitor 插件）」，
 *    所以这里做双路线兼容：优先 window.JPush（Cordova），其次 registerPlugin('Jpush')（自写插件）。
 * 2) 文档 §4.1 的 onPushOpened(router) 用 router.push('/chat/:cid') 跳转，
 *    但本工程没有 vue-router（路由靠 state.view / state.chat），改为回调 conversation_id，
 *    由调用方（App.vue）用 store 的 openChatById(cid) 打开会话。
 *
 * 非原生环境（浏览器/开发）下一律 no-op，不会影响 Web 端。
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

const NativeJpush = registerPlugin('Jpush') // 路线 B：自写 Capacitor 插件
const NotifyPermission = registerPlugin('NotifyPermission') // 自写插件：Android 13+ 运行时通知权限
const isNative = Capacitor.isNativePlatform()

/** 极光是否已成功初始化（用于和本地通知做互斥，避免同一条消息弹两次） */
let active = false
export function isPushActive() {
  return active
}

/** 路线 A：jpush-cordova-plugin 注入的全局对象 */
function cordovaJpush() {
  if (typeof window === 'undefined') return null
  const p = window.JPush || (window.plugins && window.plugins.JPush)
  return p && typeof p.init === 'function' ? p : null
}

/** 从各种可能的入参里取出 extras（Cordova 事件对象/自写插件 JSObject） */
function extrasOf(input) {
  if (!input || typeof input !== 'object') return {}
  const d = input.detail && typeof input.detail === 'object' ? input.detail : input
  // Cordova 有时把 extras 塞在 alert / message 里，统一兜一层
  if (d.extras && typeof d.extras === 'object') return d.extras
  return d
}

/**
 * App 启动时调用一次（文档 §4.2 第 1 行）
 * 幂等：内部缓存 promise，setAlias 可能在 init 之前被调用（登录很快 / 冷启动恢复登录），等它完成即可
 * @returns {Promise<boolean>} 是否初始化成功
 */
let initPromise = null
export function initPush() {
  if (!isNative) return Promise.resolve(false)
  if (!initPromise) initPromise = doInit()
  return initPromise
}

async function doInit() {
  const c = cordovaJpush()
  if (c) {
    try {
      c.init()
      // Android 13+ 必须运行时申请通知权限（manifest 里声明了 POST_NOTIFICATIONS，还要动态申请一次）
      try { c.requestPermission() } catch (e) { console.warn('[push] requestPermission 失败', e) }
      console.log('[push] 初始化成功（Cordova 路线 A）')
      diag.mode = 'cordova'
      active = true
      return true
    } catch (e) {
      console.warn('[push] Cordova 插件初始化失败，改试自写插件', e)
    }
  }
  try {
    await NativeJpush.init()
    console.log('[push] 初始化成功（自写插件路线 B）')
    diag.mode = 'native'
    active = true
    return true
  } catch (e) {
    // 插件未安装 / 原生未注册：只告警，不影响 App 其它功能
    console.warn('[push] 极光插件不可用（是否还没接 Android 侧？）', (e && e.message) || e)
    return false
  }
}

/**
 * 申请通知权限（Android 13+ 运行时弹窗）
 *
 * 为什么不用 Cordova 插件的 requestPermission()：它内部读 Cordova 全局 `device` 对象，
 * App 挂载那一刻往往还没注入 → 抛异常被吞 → 系统弹窗从来没出现过。
 * 这里用自写的 Capacitor 插件（MainActivity.NotifyPermissionPlugin），已授权时不会重复弹。
 *
 * @returns {Promise<boolean>} 用户最终是否授权
 */
export function ensureNotificationPermission(timeoutMs = 30000) {
  if (!isNative) return Promise.resolve(false)
  return new Promise(resolve => {
    let done = false
    const finish = ok => {
      if (done) return
      done = true
      diag.notifyPerm = ok ? 'granted' : 'denied'
      resolve(ok)
    }
    try {
      NotifyPermission.addListener('permissionResult', d => finish(!!(d && d.granted)))
    } catch (e) { /* 插件不存在（Web/旧包） */ }
    NotifyPermission.ensure()
      .then(r => {
        if (r && r.granted) finish(true)
        else if (r && !r.needRequest) finish(false)
        // needRequest=true：系统弹窗已弹出，等 permissionResult 回调
      })
      .catch(e => {
        console.warn('[push] 通知权限插件不可用，回退 Cordova 插件', e)
        diag.notifyPerm = 'fallback'
        // 兜底：极光 Cordova 插件的 requestPermission（内部调 JPushInterface.requestPermission）
        try {
          const c = cordovaJpush()
          if (c && typeof c.requestPermission === 'function') c.requestPermission()
        } catch (e2) { /* 忽略 */ }
        finish(false)
      })
    setTimeout(() => finish(false), timeoutMs)
  })
}

/**
 * 只查询通知权限状态，不弹任何框（供「我的」页展示）
 * @returns {Promise<boolean>} 是否已授权
 */
export async function checkNotificationPermission() {
  if (!isNative) return false
  try {
    const r = await NotifyPermission.check()
    const granted = !!(r && r.granted)
    diag.notifyPerm = granted ? 'granted' : 'denied'
    return granted
  } catch (e) {
    return false
  }
}

/**
 * 直接跳到系统的「焚信 通知设置」页（用户拒绝过授权、系统不再弹框时用这个）
 * Android 8+：ACTION_APP_NOTIFICATION_SETTINGS（直达本应用通知页，比应用详情页少点两层）
 */
export async function openNotificationSettings() {
  if (!isNative) return false
  try {
    await NotifyPermission.openSettings()
    return true
  } catch (e) {
    console.warn('[push] 打开通知设置页失败', e)
    return false
  }
}

/**
 * 取当前设备在极光侧绑定的 alias —— 联调诊断用。
 * 应该等于登录用户的 userId（uuid）。为空 = 绑定没成功 → 后端按 alias 推送必然投递不到。
 */
export async function getPushAlias() {
  if (!isNative) return ''
  await initPush()
  const c = cordovaJpush()
  if (!c || typeof c.getAlias !== 'function') return ''
  const got = await new Promise(resolve => {
    try {
      c.getAlias({ sequence: Math.floor(Math.random() * 100000) }, res => {
        if (!res) return resolve('')
        if (typeof res === 'string') return resolve(res)
        resolve(res.alias || res.registrationId || '')
      }, () => resolve(''))
    } catch (e) { resolve('') }
  })
  diag.alias = got
  return got
}

/**
 * 取 registration_id —— 只用于联调诊断（PUSH_JPUSH.md §7 第 1 步：返回非空才算 SDK 初始化成功）
 * 空串 = AppKey/包名不匹配，或插件没装好
 */
export async function getPushRegistrationId() {
  if (!isNative) return ''
  const c = cordovaJpush()
  if (c && typeof c.getRegistrationID === 'function') {
    const id = await new Promise(resolve => {
      try { c.getRegistrationID(v => resolve(v || '')) } catch (e) { resolve('') }
    })
    if (id) diag.regId = id
    return id
  }
  try {
    const r = await NativeJpush.getRegistrationId()
    const id = (r && r.registrationId) || ''
    if (id) diag.regId = id
    return id
  } catch (e) {
    return ''
  }
}

/**
 * 联调诊断：记录每一步的真实结果，供「我的 → 已登录设备 → 推送诊断」显示。
 * 出问题时能一眼看出卡在「插件没起来 / registration_id 没就绪 / setAlias 报错」哪一步。
 */
const diag = {
  mode: 'none',        // cordova | native | none
  regId: '',
  alias: '',
  setAlias: '未调用',  // 未调用 | 等待注册 | ok | 失败原因
  notifyPerm: '',      // granted | denied | fallback | ''
  at: ''
}
export function pushDiag() {
  return { ...diag }
}
function markSetAlias(msg) {
  diag.setAlias = msg
  diag.at = new Date().toTimeString().slice(0, 8)
}

/** 等 registration_id 就绪（极光要求注册完成后再 setAlias，否则静默失败） */
async function waitRegistrationId(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const id = await getPushRegistrationId()
    if (id) return id
    await new Promise(r => setTimeout(r, 500))
  }
  return ''
}

/**
 * 极光 alias 字符限制：只允许字母 / 数字 / 下划线（超过 40 字节或含 '-' 等符号会报 6003「alias 不合法」）。
 * 我们的 userId 是带连字符的 UUID，必须清洗后再绑，否则 setAlias 必然失败。
 * ⚠️ 后端推送时必须用同样的规则生成 audience.alias，两边不一致会收不到。
 */
export function normalizeAlias(userId) {
  return String(userId || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)
}

/** 把原生回调里的错误对象转成可读文本（Cordova 常返回 {code,msg} 或字符串） */
function errText(e) {
  if (!e) return '未知错误'
  if (typeof e === 'string') return e
  if (typeof e === 'object') {
    const parts = []
    for (const k of ['code', 'errorCode', 'msg', 'message', 'errorMessage', 'error']) {
      if (e[k] != null && e[k] !== '') parts.push(k + '=' + e[k])
    }
    return parts.length ? parts.join(' ') : JSON.stringify(e)
  }
  return String(e)
}

/**
 * 登录成功后调用：把 userId 绑成极光 alias（文档 §4.2 第 2 行）
 * 关键点：① alias 必须是极光合法字符（UUID 的 '-' 要去掉）
 *         ② 必须等 registration_id 就绪再绑（极光注册是异步的，登录时常常还没完成）
 *         ③ 失败自动退避重试
 */
export async function bindPushAlias(userId, retries = 3) {
  if (!isNative || userId == null || userId === '') return false
  await initPush()
  const alias = normalizeAlias(userId)
  diag.mode = cordovaJpush() ? 'cordova' : 'native'
  if (!alias) { markSetAlias('失败：alias 清洗后为空'); return false }
  markSetAlias('等待注册')
  const regId = await waitRegistrationId()
  diag.regId = regId
  if (!regId) {
    markSetAlias('失败：registration_id 为空（AppKey/包名不匹配或插件未就绪）')
    return false
  }
  const c = cordovaJpush()
  if (c && typeof c.setAlias === 'function') {
    try {
      await new Promise((resolve, reject) => {
        c.setAlias({ alias, sequence: Math.floor(Math.random() * 100000) }, resolve, reject)
      })
      diag.alias = alias
      markSetAlias('ok')
      return true
    } catch (e) {
      console.warn('[push] setAlias 原始错误 =', JSON.stringify(e))
      markSetAlias('失败：' + errText(e))
    }
  } else {
    try {
      await NativeJpush.setAlias({ alias })
      diag.alias = alias
      markSetAlias('ok')
      return true
    } catch (e) {
      console.warn('[push] setAlias 原始错误 =', JSON.stringify(e))
      markSetAlias('失败：' + errText(e))
    }
  }
  // 退避重试（2s / 4s / 6s）
  if (retries > 0) {
    setTimeout(() => { bindPushAlias(userId, retries - 1) }, (4 - retries) * 2000)
  }
  return false
}

/** 退出登录 / 切换账号时解绑（文档 §8：不解绑会收到上一个人的消息） */
export async function unbindPushAlias() {
  if (!isNative) return false
  await initPush() // 同理：先确保 SDK 起来了，否则 deleteAlias 无意义
  const c = cordovaJpush()
  if (c && typeof c.deleteAlias === 'function') {
    try {
      await new Promise((resolve, reject) => {
        c.deleteAlias({ sequence: 2 }, resolve, reject)
      })
      return true
    } catch (e) { /* 忽略 */ }
  }
  try {
    await NativeJpush.deleteAlias()
    return true
  } catch (e) {
    return false
  }
}

/**
 * 点击通知 → 回调 extras（文档 §4.1 的 onPushOpened，跳转逻辑交给调用方）
 * 注意：冷启动时事件可能在会话列表拉取之前就到，调用方需自行兜底（openChatById 会先刷列表）
 */
export function onPushOpened(handler) {
  if (!isNative || typeof handler !== 'function') return
  const emit = payload => {
    try {
      // 联调用：打印点击回调的原始结构，确认 extras 到底在哪一层
      // （后端 extras 是 snake_case 的 conversation_id，插件可能原样透传，也可能包在 extras 字段里）
      console.log('[push] opened raw =', JSON.stringify(payload))
      const extras = extrasOf(payload)
      const cid = extras && extras.conversation_id
      if (cid) handler(String(cid), extras)
      else console.warn('[push] 通知点击未取到 conversation_id，原始结构见上一条')
    } catch (e) {
      console.warn('[push] 处理通知点击失败', e)
    }
  }
  // 路线 B：自写 Capacitor 插件 notifyListeners('notificationOpened', data)
  try { NativeJpush.addListener('notificationOpened', emit) } catch (e) { /* 忽略：插件不存在 */ }
  // 路线 A：jpush-cordova-plugin 的事件
  if (typeof document !== 'undefined') {
    document.addEventListener('jpush.openNotification', emit)
    document.addEventListener('jpush.receiveNotification', emit)
  }
  // 冷启动兜底：App 被杀时点通知，插件可能在 Vue 挂载前就已 fire 过事件，
  // 但插件会把最近一次 extras 留在 JPush.openNotification 属性上（见 www/JPushPlugin.js），这里补处理一次。
  // 属性默认值是 {}，没有 conversation_id 时 emit 内部会自动忽略，不会误跳。
  try {
    const pending = window.JPush && window.JPush.openNotification
    if (pending && pending.conversation_id) emit(pending)
  } catch (e) { /* 忽略 */ }
}
