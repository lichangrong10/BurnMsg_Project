/**
 * TOFU（Trust On First Use）公钥防替换：首次拿到对方公钥就本地钉住，之后每次使用前比对，变了就阻断+告警。
 * 公钥非机密，明文存本地即可；每台设备各自维护，不进服务端。
 * 参考：fenxin-server docs/TOFU_FRONTEND.md（后端 v5.7：POST /keys/query + WS key:changed）
 */
import { api } from '../api'

const PINNED_KEY = 'bm_pinned_keys' // Map<userId, {user_id, identity_pubkey, first_seen_at}>

function readPinned() {
  try { return JSON.parse(localStorage.getItem(PINNED_KEY) || '{}') } catch (e) { return {} }
}
function writePinned(map) {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify(map)) } catch (e) { /* 忽略 */ }
}

export function getPinnedKey(userId) {
  return readPinned()[String(userId)] || null
}
export function putPinnedKey(userId, pubkey) {
  const k = String(userId)
  const map = readPinned()
  const prev = map[k]
  map[k] = { user_id: k, identity_pubkey: pubkey, first_seen_at: prev ? prev.first_seen_at : Date.now() }
  writePinned(map)
}

/**
 * 取对方公钥并做 TOFU 比对。加密发送前必须调这个，不要直接裸调 GET /keys/:userId。
 * 返回三态：
 *  - { status:'first_trust', pubkey }  首次见到，已钉住，放行
 *  - { status:'ok', pubkey }           与本地一致，放行
 *  - { status:'changed', oldPubkey, newPubkey } 变了！阻断+告警（不更新本地，等用户确认）
 *  - { status:'missing' }              服务端无该公钥（未上传等）
 */
export async function verifyPeerKey(peerId) {
  // 旧「用户级公钥」接口已下线（/keys/:id 404），改为设备级密钥模型，
  // 这里保留函数签名以兼容调用方，直接返回 missing 不发起请求
  return { status: 'missing' }
}

/** 用户点了「确认信任新密钥」→ 更新钉住，加密发送自动恢复 */
export function confirmNewKey(peerId, newPubkey) {
  putPinnedKey(peerId, newPubkey)
}

/**
 * 批量比对（启动/进会话兜底）：POST /keys/query 一次拉一组，缺人（未上传/无共同会话）不报错。
 * @returns 变了的 [{user_id, newPubkey}]（首次见面直接钉住，不打扰用户）
 */
export async function syncPinnedKeys(memberIds, myUserId) {
  // 旧接口已下线：不再发起 /keys/query 请求
  return []
}