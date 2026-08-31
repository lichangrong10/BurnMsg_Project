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
  let remote
  try {
    remote = await api.getIdentityKey(peerId) // 拦截器已解包 {user_id, identity_pubkey, ...}
  } catch (e) {
    // 404=对方未上传公钥 / 403=无共同会话，统一按「服务端无此公钥」处理；其余异常继续抛给调用方
    if (/404|403|不存在|未上传|not\s*found|无权|无权限/i.test(e && e.message || '')) return { status: 'missing' }
    throw e
  }
  const rb = remote && remote.identity_pubkey
  if (!rb) return { status: 'missing' }
  const local = getPinnedKey(peerId)
  if (!local) {
    putPinnedKey(peerId, rb) // 首次信任：钉住
    return { status: 'first_trust', pubkey: rb }
  }
  if (local.identity_pubkey === rb) return { status: 'ok', pubkey: rb }
  return { status: 'changed', oldPubkey: local.identity_pubkey, newPubkey: rb }
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
  const changed = []
  const ids = (memberIds || []).filter(Boolean).map(String)
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500)
    let data
    try { data = await api.queryIdentityKeys(batch) } catch (e) { continue }
    for (const k of (data || [])) {
      if (!k || k.user_id == null || !k.identity_pubkey) continue
      if (String(k.user_id) === String(myUserId)) continue
      const local = getPinnedKey(k.user_id)
      if (!local) putPinnedKey(k.user_id, k.identity_pubkey)
      else if (local.identity_pubkey !== k.identity_pubkey) changed.push({ user_id: k.user_id, newPubkey: k.identity_pubkey })
    }
  }
  return changed
}