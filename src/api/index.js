/**
 * API 定义（按 swagger.json / OpenAPI 3.0 文档，后端前缀 /api/v1）
 */
import { http } from '../utils/request'

export const api = {
  // ── 认证 ──
  login: (phone, password) => http.post('/auth/login', {
    phone, password,
    device_name: /Android/.test(navigator.userAgent) ? 'Android App' : (/iPhone|iPad/.test(navigator.userAgent) ? 'iOS App' : 'Web'),
    device_type: /Android|iPhone|iPad/.test(navigator.userAgent) ? 'mobile' : 'web'
  }),
  changePassword: (old_password, new_password) => http.post('/auth/change-password', { old_password, new_password }),
  getProfile: () => http.get('/auth/profile'),
  updateProfile: payload => http.put('/auth/profile', payload),
  getDevices: () => http.get('/auth/devices'),
  offlineDevice: deviceId => http.post(`/auth/devices/${deviceId}/offline`),
  // ── 通讯录 ──
  getContacts: (params = {}) => http.get('/contacts', { params: { pageSize: 200, ...params } }),
  searchContacts: keyword => http.get('/contacts/search', { params: { keyword } }),
  // ── 会话 ──
  getConversations: () => http.get('/conversations'),
  createPrivate: user_id => http.post('/conversations/private', { user_id }),
  getConversation: id => http.get(`/conversations/${id}`),
  createGroup: payload => http.post('/groups', payload),
  // ── 消息 ──
  getMessages: (conversationId, params = {}) => http.get(`/messages/${conversationId}`, { params: { limit: 50, ...params } }),
  sendMessage: payload => http.post('/messages', payload),
  // ── 端到端加密（E2E） ──
  uploadIdentityKey: identity_pubkey => http.post('/keys', { identity_pubkey }), // 上传自己的 X25519 公钥（覆盖语义）
  getIdentityKey: userId => http.get(`/keys/${userId}`), // 查对方公钥（需同会话，404=对方未上传）
  editMessage: (id, content) => http.put(`/messages/${id}`, { content }),
  recallMessage: id => http.post(`/messages/${id}/recall`),
  markRead: conversationId => http.post(`/messages/${conversationId}/read`), // 注意：文档约定此处 id 为会话 ID
  getReceipt: id => http.get(`/messages/${id}/receipt`),
  // ── 群组管理 ──
  updateGroup: (id, payload) => http.put(`/groups/${id}`, payload),
  getGroupMembers: id => http.get(`/groups/${id}/members`),
  addGroupMembers: (id, member_ids) => http.post(`/groups/${id}/members`, { member_ids }),
  removeGroupMember: (id, userId) => http.delete(`/groups/${id}/members/${userId}`),
  dissolveGroup: id => http.delete(`/groups/${id}`), // 群主解散群（解散即焚）
  transferGroup: (id, newOwnerId) => http.post(`/groups/${id}/transfer`, { new_owner_id: newOwnerId }), // 群主转让群
  // ── 群组管理（admin） ──
  getAdminGroups: (params = {}) => http.get('/groups/admin/all', { params: { page: 1, pageSize: 20, ...params } }),
  adminDissolveGroup: id => http.delete(`/groups/admin/${id}`), // 管理员强制解散（留痕）
  // ── 健康检查 ──
  health: () => http.get('/health'),
  // ── 账号管理（admin） ──
  getAccounts: (params = {}) => http.get('/accounts', { params: { page: 1, pageSize: 20, ...params } }),
  getAccountDetail: id => http.get(`/accounts/${id}`),
  getDepartments: () => http.get('/accounts/departments'),
  createAccount: payload => http.post('/accounts', payload),
  batchCreateAccounts: accounts => http.post('/accounts/batch', { accounts }),
  importAccounts: file => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/accounts/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  resetAccountPassword: (id, new_password) => http.post(`/accounts/${id}/reset-password`, new_password ? { new_password } : {}),
  toggleAccountStatus: (id, status) => http.post(`/accounts/${id}/toggle-status`, { status }),
  // ── 系统公告（App 端只读展示；发布/删除在管理后台） ──
  getAnnouncements: (params = {}) => http.get('/announcements', { params: { page: 1, pageSize: 50, ...params } }),
  getAnnouncementUnread: () => http.get('/announcements/unread-count'),
  markAnnouncementRead: id => http.post(`/announcements/${id}/read`),
  // ── 意见反馈（App 端：提交 + 我的列表；回复在管理后台） ──
  submitFeedback: payload => http.post('/feedback', payload),
  getMyFeedback: (params = {}) => http.get('/feedback/my', { params: { page: 1, pageSize: 50, ...params } }),
  // ── 文件 ──
  upload: file => {
    const fd = new FormData()
    fd.append('file', file)
    return http.post('/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
  }
}
