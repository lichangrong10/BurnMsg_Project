/**
 * 全站回归（API 层）：基础域巡检 + 加密聊天双账号全流程 + 设备识别字段校验
 */
const BASE = 'http://192.168.9.222:9091/api/v1'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const rows = []
const ok = (name, cond, extra = '') => { rows.push([cond ? 'PASS' : 'FAIL', name, extra]); console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (extra ? ' — ' + extra : '')) }

let TK = null
async function api(m, p, b) {
  const r = await fetch(BASE + p, { method: m, headers: { 'Content-Type': 'application/json', ...(TK ? { Authorization: 'Bearer ' + TK } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) })
  const txt = await r.text(); let j = {}
  try { j = JSON.parse(txt) } catch { }
  return { st: r.status, code: j.code, msg: j.message, data: j.data, txt: txt.slice(0, 100) }
}
async function login(u) {
  for (let i = 0; i < 4; i++) {
    const r = await api('POST', '/auth/login', { phone: u.ph, password: u.pw, device_id: u.dev, device_name: u.name, device_type: 'web' })
    if (r.data?.access_token) return { t: r.data.access_token, id: r.data.user.id }
    if (r.st === 429) { await sleep(15000); continue }
    throw new Error('login ' + r.st + ' ' + r.msg)
  }
  throw new Error('login retry')
}
const listOf = d => Array.isArray(d) ? d : ((d && (d.list || d.items)) || [])

const A = { ph: '13800000000', pw: '12345678', dev: 'r2aaaa00-1111-4222-8333-444455550001', name: '回归A' }
const B = { ph: '13800000088', pw: '88888888', dev: 'r2bbbb00-1111-4222-8333-444455550001', name: '回归B' }

console.log('=== 全站回归 ===')
// ── 1) 基础域 ──
const a = await login(A); TK = a.t
ok('登录', !!a.t)
const basics = [
  ['/health', '健康检查'], ['/auth/profile', '我的资料'], ['/auth/devices', '已登录设备'],
  ['/contacts?pageSize=20', '通讯录'], ['/conversations', '会话列表'],
  ['/announcements?page=1&pageSize=5', '公告'], ['/channels/discover?page=1&pageSize=5', '频道发现'],
  ['/presence/me', '在线态'], ['/keys/device/me', '设备密钥自检'],
]
for (const [p, n] of basics) { await sleep(250); const r = await api('GET', p); ok('GET ' + p + '（' + n + '）', r.st < 300, String(r.st)) }

// ── 2) 设备识别字段（新接口） ──
await sleep(250)
const dv = await api('GET', '/auth/devices')
const list = listOf(dv.data)
const first = list[0] || {}
ok('/auth/devices 返回 browser 字段', !!first.browser, String(first.browser))
ok('/auth/devices 返回 os 字段', !!first.os, String(first.os))
ok('/auth/devices 返回 is_online', typeof first.is_online === 'boolean', String(first.is_online))
ok('/auth/devices 条数 > 0', list.length > 0, 'count=' + list.length)

// ── 3) 加密聊天全流程 ──
const b = await login(B)
ok('B 登录', !!b.t)
await sleep(600)
// 清理历史
TK = a.t
for (const c of listOf((await api('GET', '/conversations')).data).filter(x => x.e2e_mode === 1)) {
  await api('POST', `/conversations/${c.id}/e2e-close`, { reason: 'user' }); await sleep(400)
}
await sleep(600)
const req = await api('POST', '/conversations/e2e-request', { target_user_id: b.id })
ok('A→B 发起加密聊天', [200, 201].includes(req.st) && !!req.data?.conversation_id, String(req.st) + ' ' + (req.msg || ''))
const cid = req.data?.conversation_id
await sleep(600)
TK = b.t
const bconv = listOf((await api('GET', '/conversations')).data).find(x => String(x.id) === String(cid))
ok('B 能看到 pending', !!bconv && bconv.e2e_state === 1)
const acc = await api('POST', `/conversations/${cid}/e2e-accept`)
ok('B 接受', [200, 201].includes(acc.st), String(acc.st) + ' ' + (acc.msg || ''))
await sleep(700)
TK = a.t
const aconv = listOf((await api('GET', '/conversations')).data).find(x => String(x.id) === String(cid))
ok('接受后 state=2 且 peer_device 有值', aconv?.e2e_state === 2 && !!aconv?.peer_device_id, 'state=' + aconv?.e2e_state)
const pk = await api('GET', '/keys/device/' + cid)
ok('取到对方绑定设备公钥', pk.st === 200 && !!pk.data?.identity_pubkey, String(pk.st))
// 明文发送应被拒
const plain = await api('POST', '/messages', { conversation_id: cid, type: 'text', content: '明文应被拒' })
ok('私密会话发明文 → 拒绝', plain.st >= 400, String(plain.st) + ' ' + (plain.msg || ''))
// 假密文发送（协议层校验通过即可）
const fake = { cipher_text: Buffer.from('x'.repeat(24)).toString('base64'), cipher_nonce: Buffer.from('y'.repeat(12)).toString('base64'), sender_ephemeral_pubkey: Buffer.from('z'.repeat(32)).toString('base64') }
const enc = await api('POST', '/messages', { conversation_id: cid, type: 'text', content: '[加密消息]', is_encrypted: true, burn_ttl_seconds: 0, ...fake })
ok('加密消息发送成功（含 burn=0）', [200, 201].includes(enc.st), String(enc.st) + ' ' + (enc.msg || ''))
ok('返回消息不含焚毁', !enc.data?.burn_ttl_seconds && !enc.data?.destroy_at, 'burn=' + enc.data?.burn_ttl_seconds)
// 搜索不泄露
const srch = await api('GET', '/messages/search?keyword=回归&limit=10')
ok('全局搜索不含私密会话', listOf(srch.data).every(x => String(x.conversation_id) !== String(cid)))
// 关闭
const cls = await api('POST', `/conversations/${cid}/e2e-close`, { reason: 'user' })
ok('结束加密会话', [200, 201].includes(cls.st), String(cls.st))
await sleep(700)
ok('结束后列表无该会话', listOf((await api('GET', '/conversations')).data).every(x => String(x.id) !== String(cid)))
const after = await api('GET', `/messages/${cid}?limit=5`)
ok('结束后取消息 → 拒绝', after.st >= 400, String(after.st))

const fails = rows.filter(r => r[0] === 'FAIL')
console.log('\n=== 汇总：' + rows.length + ' 项，失败 ' + fails.length + ' 项 ===')
fails.forEach(f => console.log('  ✗ ' + f[1] + ' ' + f[2]))
