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

/** 登出/强制登出时清除密钥对与明文缓存（防同设备切换账号串钥） */
export function clearE2E() {
  localStorage.removeItem(PRIV_RAW)
  localStorage.removeItem(PRIV_JWK_LEGACY)
  localStorage.removeItem(PUB_KEY)
  localStorage.removeItem(PT_CACHE)
}
