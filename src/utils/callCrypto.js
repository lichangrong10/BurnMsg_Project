/**
 * 通话信令加密（V7.0 · 1:1 语音 / 视频）
 *
 * 与消息 E2E 复用同一套原语（X25519 双路 ECDH → HKDF-SHA256 → AES-256-GCM），只换 info：
 *
 *   call_key = HKDF-SHA256(
 *     X25519(eph_self, IK_peer) ‖ X25519(IK_self, IK_peer),
 *     salt = `${conversationId}:${callerEphPub}`,
 *     info = 'burnmsg-call-v1',
 *     32 字节
 *   )
 *
 * - 服务端没有 IK 私钥，算不出 call_key，SDP/ICE 对它始终是密文；
 * - salt 用「会话 + 主叫临时公钥」：主叫在 POST /calls **之前**就能算（不需要服务端先发 call_id），
 *   被叫从 call:incoming.eph_pub 也能算，且每通电话的 salt 唯一（前向保密）；
 * - 引擎双路（WebCrypto / @noble 纯 JS）与 e2e.js 完全一致，输出逐字节相同，可跨引擎互通。
 *   服务端不可见的另一层保障：fp_mac 用 call_key 做 HMAC，接收方校验通过才 setRemoteDescription。
 */
import { dh, loadIdentity, unb64 } from './e2e'

const enc = new TextEncoder()
const CALL_INFO = 'burnmsg-call-v1'

/** call_key 的 salt：会话 ID + 主叫临时公钥（双方必须完全一致） */
export function callSalt(conversationId, callerEphPub) {
  return `${conversationId}:${callerEphPub}`
}

/**
 * 派生本通电话的 call_key。
 * @param {object} ephPair 本端临时密钥对（genKeyPair 的返回值）
 * @param {string} peerIKPubB64 对端设备级 identity 公钥（base64，可无填充）
 * @param {string} conversationId 会话 ID
 * @param {string} callerEphPub 主叫临时公钥（base64，无填充）——被叫传 call:incoming.eph_pub
 * @returns {Promise<Uint8Array>} 32 字节会话密钥
 */
export async function deriveCallKey(ephPair, peerIKPubB64, conversationId, callerEphPub) {
  const my = loadIdentity()
  if (!my) throw new Error('本地密钥未初始化，请重新登录后再通话')
  const peerPub = unb64(peerIKPubB64)
  const s1 = await dh(ephPair, peerPub)   // X25519(eph_self, IK_peer)
  const s2 = await dh(my, peerPub)        // X25519(IK_self, IK_peer)
  const ikm = new Uint8Array(64)
  ikm.set(s1, 0)
  ikm.set(s2, 32)
  return hkdf32(ikm, enc.encode(callSalt(conversationId, callerEphPub)), enc.encode(CALL_INFO))
}

/** HKDF-SHA256 → 32 字节（原生优先，subtle 缺失/不支持时走 @noble） */
async function hkdf32(ikm, salt, info) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
      const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, 256)
      return new Uint8Array(bits)
    } catch (e) { /* 落到 noble */ }
  }
  const { hkdf } = await import('@noble/hashes/hkdf')
  const { sha256 } = await import('@noble/hashes/sha256')
  return hkdf(sha256, ikm, salt, info, 32)
}

/** HMAC-SHA256（原生优先，noble 兜底），返回原始字节 */
async function hmacSha256(keyBytes, data) {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      return new Uint8Array(await crypto.subtle.sign('HMAC', k, data))
    } catch (e) { /* 落到 noble */ }
  }
  const { hmac } = await import('@noble/hashes/hmac')
  const { sha256 } = await import('@noble/hashes/sha256')
  return hmac(sha256, keyBytes, data)
}

/**
 * 对自身 DTLS 指纹做 HMAC（防信令服务器替换指纹做 MITM）。
 * 输出 base64 且去填充（43 字符），与后端 CALL_FP_MAC_RE 一致。
 */
export async function fingerprintMac(callKey, fingerprint) {
  const sig = await hmacSha256(callKey, enc.encode('fp:' + fingerprint))
  let s = ''
  for (let i = 0; i < sig.length; i++) s += String.fromCharCode(sig[i])
  return btoa(s).replace(/=+$/, '')
}

/** 常数时间比较：校验对端指纹 MAC，任何不一致（含长度）都返回 false */
export async function verifyFingerprintMac(callKey, fingerprint, macB64) {
  if (!fingerprint || !macB64) return false
  const expect = await fingerprintMac(callKey, fingerprint)
  const got = String(macB64).replace(/=+$/, '')
  if (expect.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

/**
 * 从 SDP 取 DTLS 指纹：`a=fingerprint:sha-256 AB:CD:...` → `"sha-256 AB:CD:..."`。
 * 双方必须用同一格式参与 HMAC（含算法名 + 一个空格），否则永远校验不过。
 */
export function dtlsFingerprintOf(sdp) {
  if (!sdp) return null
  const m = /a=fingerprint:(\S+)\s+(\S+)/.exec(String(sdp).replace(/\r\n/g, '\n'))
  return m ? `${m[1].toLowerCase()} ${m[2].toUpperCase()}` : null
}
