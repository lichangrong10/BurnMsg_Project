/**
 * localStorage 持久化层
 * token / refresh_token / 后端地址 / 当前用户 / 设备编号 / 设备记录主键 / 演示模式标记
 */
export const storage = {
  get token() { return localStorage.getItem('bm_access_token') || '' },
  set token(v) { v ? localStorage.setItem('bm_access_token', v) : localStorage.removeItem('bm_access_token') },

  get refresh() { return localStorage.getItem('bm_refresh_token') || '' },
  set refresh(v) { v ? localStorage.setItem('bm_refresh_token', v) : localStorage.removeItem('bm_refresh_token') },

  get baseURL() { return localStorage.getItem('bm_base_url') || 'http://192.168.9.253:9091/api/v1' },
  set baseURL(v) { localStorage.setItem('bm_base_url', v) },

  // 设备编号：首次访问自动生成并永久保存（clear 不清除），服务端按 (用户, 设备编号) 复用设备记录
  get deviceId() {
    let id = localStorage.getItem('bm_device_id')
    if (!id) {
      // localhost 下用标准 UUID；局域网 http 非安全上下文中 randomUUID 不存在，用随机串兜底
      id = crypto.randomUUID
        ? crypto.randomUUID()
        : 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)
      localStorage.setItem('bm_device_id', id)
    }
    return id
  },

  // 设备记录主键：登录成功后从响应 d.device.id 存入（与 bm_device_id 不同，那是客户端编号，这是后端设备表主键）。
  // 用于 WS device:added / device:removed 事件判断「是不是本设备」：本设备登录不弹通知、本设备被下线直接回登录页。
  // clear 不清除——退出换号仍是同一物理设备，新账号登录后会覆盖为新主键。
  get deviceRowId() { return localStorage.getItem('bm_device_row_id') || '' },
  set deviceRowId(v) { v ? localStorage.setItem('bm_device_row_id', v) : localStorage.removeItem('bm_device_row_id') },

  get user() {
    try { return JSON.parse(localStorage.getItem('bm_user') || 'null') } catch { return null }
  },
  set user(v) { v ? localStorage.setItem('bm_user', JSON.stringify(v)) : localStorage.removeItem('bm_user') },

  get demo() { return localStorage.getItem('bm_demo') === '1' },
  set demo(v) { localStorage.setItem('bm_demo', v ? '1' : '0') },

  // 强制改密标记：登录时后端返回 force_change_pwd=true 则置 1，改密成功后清除
  get forceChangePwd() { return localStorage.getItem('bm_force_change_pwd') === '1' },
  set forceChangePwd(v) { v ? localStorage.setItem('bm_force_change_pwd', '1') : localStorage.removeItem('bm_force_change_pwd') },

  // 注意：bm_device_id 故意不在清理清单里——清了它，每次登录都会变成"新设备"
  clear() {
    ['bm_access_token', 'bm_refresh_token', 'bm_user', 'bm_demo', 'bm_force_change_pwd'].forEach(k => localStorage.removeItem(k))
  }
}
