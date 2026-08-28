/**
 * localStorage 持久化层
 * token / refresh_token / 后端地址 / 当前用户 / 演示模式标记
 */
export const storage = {
  get token()    { return localStorage.getItem('bm_access_token') || '' },
  set token(v)   { v ? localStorage.setItem('bm_access_token', v) : localStorage.removeItem('bm_access_token') },
  get refresh()  { return localStorage.getItem('bm_refresh_token') || '' },
  set refresh(v) { v ? localStorage.setItem('bm_refresh_token', v) : localStorage.removeItem('bm_refresh_token') },
  get baseURL()  { return localStorage.getItem('bm_base_url') || 'http://192.168.9.116:9091/api/v1' },
  set baseURL(v) { localStorage.setItem('bm_base_url', v) },
  get user()     { try { return JSON.parse(localStorage.getItem('bm_user') || 'null') } catch { return null } },
  set user(v)    { v ? localStorage.setItem('bm_user', JSON.stringify(v)) : localStorage.removeItem('bm_user') },
  get demo()     { return localStorage.getItem('bm_demo') === '1' },
  set demo(v)    { localStorage.setItem('bm_demo', v ? '1' : '0') },
  clear() { ['bm_access_token', 'bm_refresh_token', 'bm_user', 'bm_demo'].forEach(k => localStorage.removeItem(k)) }
}
