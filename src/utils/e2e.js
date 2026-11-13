/**
 * 端到端加密（V4.0 §E2E 方案B简化版，仅单聊）
 * X25519 identity key + 每条消息 ephemeral key → 双路 ECDH → HKDF-SHA256(salt=convId, info='burnmsg-e2e-v1') → AES-256-GCM
 * 私钥只存本地（localStorage，raw 32 字节 base64），永不上传；服务端零接触明文。
 * 引擎双路：优先 WebCrypto 原生（快、硬件加速）；老 WebView / http 非安全上下文（subtle 缺失）兜底 @noble 纯 JS，
 *           两引擎算法输出逐字节一致，跨引擎互通（原生加密 ↔ noble 解密均可）。
 * 注意 1：协议上发送方事后无法再解密自己发的消息（ephemeral 私钥用完即弃），
 *         因此发送/解密成功后的明文会缓存到本地，重拉历史时直接读缓存展示。
 * 注意 2：WebCrypto 的 X25519 私钥不支持 raw 导入导出（规范仅公钥支持 raw），
 *         本地统一存 raw 字节，走原生时转 JWK（d=私钥 x=公钥）导入。
 */

const PRIV_RAW = 'bm_e2e_priv_raw'        // 本地 identity 私钥（raw 32 字节 base64）
const PRIV_JWK_LEGACY = 'bm_e2e_priv_jwk' // 旧版 JWK 存储（首次运行自动迁移到 raw）
const PUB_KEY = 'bm_e2e_pub_b64'          // 本地 identity 公钥 base64
const PT_CACHE = 'bm_e2e_pt'              // 明文缓存 { msgId: text }
const FAIL_CACHE = 'bm_e2e_fail'          // 解密失败缓存 { msgId: true }：轮询重拉时同步回填稳定态，避免已点开的失败消息闪回中间态
const ALGO = { name: 'X25519' }

const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
// identity 公钥上传（keys 接口）要求无 '=' 填充（43 字符），上传前 stripPad；解码时 unb64 自动补回。
// 注意：messages 接口的 sender_ephemeral_pubkey 是 @MinLength(44)，必须保留 '=' 的 44 字符，勿 stripPad。
const stripPad = s => s.replace(/=+$/, '')
const unb64 = s => Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), c => c.charCodeAt(0))
const b64url = buf => b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64urlToBytes = s => unb64(s.replace(/-/g, '+').replace(/_/g, '/'))
const te = new TextEncoder()
const td = new TextDecoder()

/* ── 引擎检测：优先 WebCrypto 原生 X25519；subtle 缺失（http 非安全上下文）或算法不支持（老 WebView）时兜底 noble ── */
let _engine = null
async function engine() {
  if (_engine) return _engine
  try {
    if (!crypto.subtle) throw new Error('no webcrypto')
    const kp = await crypto.subtle.generateKey(ALGO, true, ['deriveBits'])
    if (!kp || !kp.privateKey) throw new Error('no x25519')
    _engine = 'native'
  } catch (e) { _engine = 'noble' }
  return _engine
}

/** 当前环境是否支持 E2E（noble 纯 JS 兜底后恒支持；保留接口兼容旧调用） */
export async function e2eSupported() { await engine(); return true }

/* ── 原语双路封装（native / noble 输出一致，可跨引擎互通） ── */
// pair 形态：{ priv: Uint8Array, pub: Uint8Array, nativePriv?: CryptoKey }

/** X25519 私钥无 raw 导入（规范限制），转 JWK（d=私钥，x=公钥）导入 */
function nativeImportPriv(privBytes, pubBytes) {
  return crypto.subtle.importKey('jwk',
    { kty: 'OKP', crv: 'X25519', d: b64url(privBytes), x: b64url(pubBytes), key_ops: ['deriveBits'], ext: false },
    ALGO, false, ['deriveBits'])
}

async function genKeyPair() {
  if ((await engine()) === 'native') {
    const kp = await crypto.subtle.generateKey(ALGO, true, ['deriveBits'])
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    return {
      priv: b64urlToBytes(jwk.d),
      pub: new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey)),
      nativePriv: kp.privateKey
    }
  }
  const { x25519 } = await import('@noble/curves/ed25519')
  const priv = x25519.utils.randomPrivateKey()
  return { priv, pub: x25519.getPublicKey(priv) }
}

async function dh(pair, pubBytes) {
  if ((await engine()) === 'native') {
    const priv = pair.nativePriv || await nativeImportPriv(pair.priv, pair.pub)
    const pub = await crypto.subtle.importKey('raw', pubBytes, ALGO, false, [])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pub }, priv, 256))
  }
  const { x25519 } = await import('@noble/curves/ed25519')
  return x25519.getSharedSecret(pair.priv, pubBytes)
}

/** shared1 || shared2 → HKDF-SHA256 → 32 字节会话密钥 */
async function deriveSessionKey(shared1, shared2, convId) {
  const shared = new Uint8Array(shared1.length + shared2.length)
  shared.set(shared1, 0)
  shared.set(shared2, shared1.length)
  const salt = te.encode(String(convId))
  const info = te.encode('burnmsg-e2e-v1')
  if ((await engine()) === 'native') {
    const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, hkdfKey, 256))
  }
  const { hkdf } = await import('@noble/hashes/hkdf')
  const { sha256 } = await import('@noble/hashes/sha256')
  return hkdf(sha256, shared, salt, info, 32)
}

async function aesGcmEncrypt(keyBytes, nonce, plainBytes) {
  if ((await engine()) === 'native') {
    const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['encrypt'])
    return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, plainBytes))
  }
  const { gcm } = await import('@noble/ciphers/aes')
  return gcm(keyBytes, nonce).encrypt(plainBytes)
}

async function aesGcmDecrypt(keyBytes, nonce, cipherBytes) {
  if ((await engine()) === 'native') {
    const k = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, k, cipherBytes))
  }
  const { gcm } = await import('@noble/ciphers/aes')
  return gcm(keyBytes, nonce).decrypt(cipherBytes) // tag 校验失败抛异常，与原生行为一致
}

/* ── identity 密钥对 ── */
function loadPrivRaw() {
  const raw = localStorage.getItem(PRIV_RAW)
  if (raw) return unb64(raw)
  // 旧版 JWK 迁移：jwk.d 即私钥 32 字节（base64url），纯 JS 转换，无需 webcrypto
  const jwkStr = localStorage.getItem(PRIV_JWK_LEGACY)
  if (jwkStr) {
    try {
      const bytes = b64urlToBytes(JSON.parse(jwkStr).d)
      localStorage.setItem(PRIV_RAW, b64(bytes))
      localStorage.removeItem(PRIV_JWK_LEGACY)
      return bytes
    } catch (e) { /* 迁移失败按重新生成处理 */ }
  }
  return null
}

function loadIdentity() {
  // 设备级 identity 优先（E2E_SECRET_CHAT v1.1：私密会话按设备绑密钥）
  const dev = getDeviceIdentity()
  if (dev) return dev
  const priv = loadPrivRaw()
  const pubStr = localStorage.getItem(PUB_KEY)
  return priv && pubStr ? { priv, pub: unb64(pubStr) } : null
}

/** 确保本地 identity key pair 存在，返回公钥 base64（无填充，匹配后端正则） */
export async function ensureIdentity() {
  const id = loadIdentity()
  if (id) return stripPad(b64(id.pub))
  const kp = await genKeyPair()
  const pub = stripPad(b64(kp.pub))
  localStorage.setItem(PRIV_RAW, b64(kp.priv))
  localStorage.setItem(PUB_KEY, pub)
  return pub
}

/**
 * 加密文本（发送方）：ECDH(esk,IK_B) || ECDH(ik_a,IK_B)
 * @returns {{cipher_text:string, cipher_nonce:string, sender_ephemeral_pubkey:string}}
 */
export async function encryptText(text, peerPubB64, convId) {
  const peerPub = unb64(peerPubB64)
  const my = loadIdentity()
  if (!my) throw new Error('本地密钥未初始化')
  const epk = await genKeyPair()
  const key = await deriveSessionKey(await dh(epk, peerPub), await dh(my, peerPub), convId)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await aesGcmEncrypt(key, nonce, te.encode(text))
  return {
    cipher_text: b64(cipher),
    cipher_nonce: b64(nonce),
    sender_ephemeral_pubkey: b64(epk.pub) // messages 接口 @MinLength(44)：须保留 '=' 的 44 字符，勿 stripPad
  }
}

/**
 * 解密消息（接收方）：ECDH(ik_b,EPK_A) || ECDH(ik_b,IK_A)
 * @param m 消息对象（需含 sender_ephemeral_pubkey / cipher_nonce / cipher_text）
 * @param senderPubB64 发送方 identity 公钥（GET /keys/:senderId）
 */
export async function decryptMessage(m, senderPubB64, convId) {
  const my = loadIdentity()
  if (!my) throw new Error('本地密钥未初始化')
  const key = await deriveSessionKey(await dh(my, unb64(m.sender_ephemeral_pubkey)), await dh(my, unb64(senderPubB64)), convId)
  return td.decode(await aesGcmDecrypt(key, unb64(m.cipher_nonce), unb64(m.cipher_text)))
}

/* ── 明文本地缓存 ── */
function ptCache() { try { return JSON.parse(localStorage.getItem(PT_CACHE) || '{}') } catch (e) { return {} } }
export function cachePlaintext(msgId, text) {
  if (msgId == null || text == null) return
  const c = ptCache()
  c[msgId] = text
  const keys = Object.keys(c)
  if (keys.length > 800) delete c[keys[0]] // 容量粗控
  try { localStorage.setItem(PT_CACHE, JSON.stringify(c)) } catch (e) { /* 写满则静默 */ }
}
export function getPlaintext(msgId) {
  if (msgId == null) return null
  const v = ptCache()[msgId]
  return v == null ? null : v
}

/* ── 解密失败缓存（与明文缓存同理，持久化到 localStorage，轮询重拉时同步回填，避免失败消息每轮重新解密闪中间态） ── */
function failCache() { try { return JSON.parse(localStorage.getItem(FAIL_CACHE) || '{}') } catch (e) { return {} } }
export function cachePlaintextFail(msgId) {
  if (msgId == null) return
  const c = failCache()
  c[msgId] = true
  const keys = Object.keys(c)
  if (keys.length > 800) delete c[keys[0]] // 容量粗控
  try { localStorage.setItem(FAIL_CACHE, JSON.stringify(c)) } catch (e) { /* 写满则静默 */ }
}
export function getPlaintextFail(msgId) {
  if (msgId == null) return false
  return failCache()[msgId] === true
}

/** 登出/强制登出时清除密钥对与明文缓存（防同设备切换账号串钥） */
export function clearE2E() {
  localStorage.removeItem(PRIV_RAW)
  localStorage.removeItem(PRIV_JWK_LEGACY)
  localStorage.removeItem(PUB_KEY)
  localStorage.removeItem(PT_CACHE)
}

/* ══════════ 设备级 identity（私密会话 / E2E_SECRET_CHAT v1.1） ══════════
 * 每台设备一把 X25519 identity，存 bm_e2e_id_<deviceRowId>；
 * 首次升级时若存在旧用户级密钥，直接沿用（同一对密钥，避免已有会话失效）。
 */
const DEV_ID_PREFIX = 'bm_e2e_id_'

function deviceRowId() {
  try { return localStorage.getItem('bm_device_row_id') || '' } catch (e) { return '' }
}

/** 设备 identity 的 localStorage 键（无设备行 ID 时返回空串） */
export function deviceIdentityStorageKey() {
  const d = deviceRowId()
  return d ? DEV_ID_PREFIX + d : ''
}

/** 读本设备 identity（{priv,pub} 或 null） */
export function getDeviceIdentity() {
  const k = deviceIdentityStorageKey()
  if (!k) return null
  try {
    const o = JSON.parse(localStorage.getItem(k) || 'null')
    if (!o || !o.priv || !o.pub) return null
    return { priv: unb64(o.priv), pub: unb64(o.pub) }
  } catch (e) { return null }
}

/**
 * 确保本设备 identity 存在，返回上传用的公钥 base64（无填充）。
 * 无设备行 ID（老的登录态）时返回 null —— 调用方应等下次登录再启用私密会话。
 */
export async function ensureDeviceIdentity() {
  const k = deviceIdentityStorageKey()
  if (!k) return null
  const exist = getDeviceIdentity()
  if (exist) return stripPad(b64(exist.pub))

  // 迁移：旧用户级密钥直接继承为设备密钥（同一对密钥，历史会话不受影响）
  const legacyPriv = loadPrivRaw()
  const legacyPub = localStorage.getItem(PUB_KEY)
  let priv, pub
  if (legacyPriv && legacyPub) {
    priv = legacyPriv
    pub = unb64(legacyPub)
  } else {
    const kp = await genKeyPair()
    priv = kp.priv
    pub = kp.pub
  }
  // 注意：本地存「带填充」的 base64（atob 不接受无填充），仅上传时才 stripPad
  localStorage.setItem(k, JSON.stringify({ priv: b64(priv), pub: b64(pub), createdAt: Date.now() }))
  return stripPad(b64(pub))
}

/** 清除本设备 identity（登出/设备被下线时调用） */
export function clearDeviceIdentity() {
  const k = deviceIdentityStorageKey()
  if (k) localStorage.removeItem(k)
}

/** 清除指定消息的明文/失败缓存（关闭私密会话时做无痕清理） */
export function clearPlaintextFor(msgIds) {
  const ids = (msgIds || []).map(String)
  if (!ids.length) return
  const pt = ptCache()
  const fail = failCache()
  let changedPt = false, changedFail = false
  ids.forEach(id => {
    if (id in pt) { delete pt[id]; changedPt = true }
    if (id in fail) { delete fail[id]; changedFail = true }
  })
  try { if (changedPt) localStorage.setItem(PT_CACHE, JSON.stringify(pt)) } catch (e) { /* 忽略 */ }
  try { if (changedFail) localStorage.setItem(FAIL_CACHE, JSON.stringify(fail)) } catch (e) { /* 忽略 */ }
}

/**
 * 一次性迁移（v2）：把旧的「用户级加密」残留清干净
 * - bm_e2e_priv_raw / bm_e2e_pub_b64：旧用户级 identity（现改设备级）
 * - bm_e2e_pt / bm_e2e_fail：旧明文缓存（官方口径：旧加密消息已不可解，本地不该还能看）
 * - bm_pinned_keys：旧用户级 TOFU 钉
 * - bm_pending_key_changes：旧密钥变更待办（不清会一直冒红点/假提示）
 * - bm_e2e_on_<cid>：已下线的「明文加密」开关
 * - bm_pinned_dev_keys：仅清理旧格式（键不是会话 ID 的），保留新格式
 */
const MIGRATED_FLAG = 'bm_e2e_migrated_v2'

export function migrateE2EStorage() {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === '1') return false
    const hasDeviceIdentity = !!deviceIdentityStorageKey() && !!localStorage.getItem(deviceIdentityStorageKey())
    // 只有设备级 identity 已就绪时才删旧私钥，否则会导致当前设备无钥匙可用
    if (hasDeviceIdentity) {
      localStorage.removeItem(PRIV_RAW)
      localStorage.removeItem(PUB_KEY)
    }
    localStorage.removeItem(PT_CACHE)
    localStorage.removeItem(FAIL_CACHE)
    localStorage.removeItem('bm_pinned_keys')
    localStorage.removeItem('bm_pending_key_changes')
    // 旧「明文加密」开关
    Object.keys(localStorage)
      .filter(k => k.indexOf('bm_e2e_on_') === 0)
      .forEach(k => localStorage.removeItem(k))
    localStorage.setItem(MIGRATED_FLAG, '1')
    return true
  } catch (e) {
    console.warn('[焚信] E2E 存储迁移失败:', e && e.message)
    return false
  }
}
