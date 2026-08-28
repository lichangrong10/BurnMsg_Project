/**
 * 演示模式数据（后端不可达时用于预览完整 UI；登录页可切换）
 * 数据结构严格对齐接口文档 SafeUser / Conversation / Message
 */
export const DEMO = (() => {
  const uid = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
  const me = { id: uid(), phone: '13800138000', display_name: '李长荣', avatar_url: null, signature: '保持热爱，奔赴山海', department: '技术部', role: 'admin', status: 'active', force_change_pwd: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
  // 内置 SVG 头像（data URI，无需网络），用于演示图片头像渲染
  const svgAvatar = bg => 'data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'%3E%3Crect width=\'100\' height=\'100\' fill=\'' + bg + '\'/%3E%3Ccircle cx=\'50\' cy=\'37\' r=\'16\' fill=\'%23f2f2f4\'/%3E%3Cpath d=\'M20 92c4-22 16-31 30-31s26 9 30 31z\' fill=\'%23f2f2f4\'/%3E%3C/svg%3E'
  const users = [
    { id: uid(), phone: '13911112222', display_name: '张伟', avatar_url: svgAvatar('%23111111'), signature: '在忙，有事留言', department: '技术部', role: 'user', status: 'active' },
    { id: uid(), phone: '13733334444', display_name: '王芳', avatar_url: null, signature: null, department: '产品部', role: 'user', status: 'active' },
    { id: uid(), phone: '13655556666', display_name: '刘洋', avatar_url: svgAvatar('%23585860'), signature: '安全无小事 🔥', department: '安全部', role: 'user', status: 'active' },
    { id: uid(), phone: '13577778888', display_name: '陈晓', avatar_url: null, signature: null, department: '市场部', role: 'user', status: 'active' },
    { id: uid(), phone: '13499990000', display_name: '赵敏', avatar_url: null, signature: '今天也要加油鸭', department: '人事部', role: 'user', status: 'active' }
  ].map(u => ({ created_at: new Date().toISOString(), updated_at: new Date().toISOString(), force_change_pwd: false, ...u }))
  const now = Date.now(), min = 60000
  const convs = [
    { id: uid(), type: 'private', name: null, avatar_url: null, is_channel: false, member_count: 2, last_message_at: new Date(now - 3 * min).toISOString(), other_user: users[0], unread: 2, lastMsg: '好的，方案我再看下细节，一会儿发你' },
    { id: uid(), type: 'group', name: '技术部 · 核心研发群', description: '技术部内部沟通', avatar_url: null, is_channel: false, member_count: 5, last_message_at: new Date(now - 26 * min).toISOString(), unread: 5, lastMsg: '刘洋：服务端 v2.0 已部署到测试环境' },
    { id: uid(), type: 'private', name: null, avatar_url: null, is_channel: false, member_count: 2, last_message_at: new Date(now - 2 * 60 * min).toISOString(), other_user: users[1], unread: 0, lastMsg: '🔥 阅后即焚消息', burning: true },
    { id: uid(), type: 'channel', name: '公司公告', description: '全员公告频道', avatar_url: null, is_channel: true, member_count: 156, last_message_at: new Date(now - 25 * 60 * min).toISOString(), unread: 1, lastMsg: '【通知】本周五 18:00 机房例行维护' },
    { id: uid(), type: 'private', name: null, avatar_url: null, is_channel: false, member_count: 2, last_message_at: new Date(now - 26 * 60 * min).toISOString(), other_user: users[3], unread: 0, lastMsg: '收到，谢谢！' }
  ]
  const msgOf = (conv, arr) => arr.map((m, i) => ({
    id: uid(), conversation_id: conv.id, reply_to_id: null, is_edited: false, is_recalled: false,
    file_url: null, file_name: null, file_size: null,
    created_at: new Date(now - (arr.length - i) * 8 * min).toISOString(),
    updated_at: new Date(now - (arr.length - i) * 8 * min).toISOString(),
    is_destroyed: false, destroy_at: null, ...m
  }))
  const messages = {}
  messages[convs[0].id] = msgOf(convs[0], [
    { sender_id: users[0].id, type: 'text', content: '长荣，前端页面今天能出一版吗？' },
    { sender_id: me.id, type: 'text', content: '可以，Telegram 风格的已经在做了，下午给你看效果' },
    { sender_id: users[0].id, type: 'text', content: '太好了 👍 记得把阅后即焚的定时器加上' },
    { sender_id: users[0].id, type: 'text', content: '好的，方案我再看下细节，一会儿发你' }
  ])
  messages[convs[1].id] = msgOf(convs[1], [
    { sender_id: users[2].id, type: 'text', content: '各位，服务端 v2.0 已部署到测试环境' },
    { sender_id: users[1].id, type: 'text', content: '收到，我下午回归一下消息链路' },
    { sender_id: me.id, type: 'text', content: '赞，我这边联调登录和会话列表' }
  ])
  messages[convs[2].id] = msgOf(convs[2], [
    { sender_id: users[1].id, type: 'text', content: '这条消息 1 分钟后自动销毁 🔥', destroy_at: new Date(now + 60 * 1000).toISOString() },
    { sender_id: me.id, type: 'text', content: '收到，阅后即焚模式已开启' }
  ])
  messages[convs[3].id] = msgOf(convs[3], [
    { sender_id: users[4].id, type: 'text', content: '【通知】本周五 18:00 机房例行维护，请大家提前保存工作。' }
  ])
  messages[convs[4].id] = msgOf(convs[4], [
    { sender_id: me.id, type: 'text', content: '陈晓，上次说的市场物料准备好了吗' },
    { sender_id: users[3].id, type: 'text', content: '收到，谢谢！' }
  ])
  // 群成员（演示群管理）：key 为群/频道会话 ID，结构对齐「ConversationMember + 用户信息」
  const groupMembers = {}
  groupMembers[convs[1].id] = [
    { user_id: me.id, role: 'owner', user: me },
    { user_id: users[0].id, role: 'admin', user: users[0] },
    { user_id: users[1].id, role: 'member', user: users[1] },
    { user_id: users[2].id, role: 'member', user: users[2] },
    { user_id: users[4].id, role: 'member', user: users[4] }
  ]
  groupMembers[convs[3].id] = [
    { user_id: users[4].id, role: 'owner', user: users[4] },
    { user_id: me.id, role: 'member', user: me },
    { user_id: users[0].id, role: 'member', user: users[0] }
  ]
  // 系统公告（演示公告中心）
  const announcements = [
    { id: uid(), title: '服务器例行维护通知', content: '本周六 22:00-24:00 服务器升级维护，期间消息可能延迟，请提前保存重要工作。', priority: 'urgent', target_type: 'all', target_departments: null, created_by: me.id, is_read: false, created_at: new Date(now - 5 * 60 * min).toISOString(), updated_at: new Date(now - 5 * 60 * min).toISOString() },
    { id: uid(), title: '焚信 v1.2 版本上线', content: '本次更新：\n1. 新增系统公告中心\n2. 支持群组解散留痕\n3. 修复若干已知问题\n欢迎大家体验反馈。', priority: 'normal', target_type: 'all', target_departments: null, created_by: me.id, is_read: false, created_at: new Date(now - 26 * 60 * min).toISOString(), updated_at: new Date(now - 26 * 60 * min).toISOString() },
    { id: uid(), title: '信息安全提醒', content: '请勿在聊天中传输明文密码等敏感信息，敏感内容请使用阅后即焚。', priority: 'normal', target_type: 'all', target_departments: null, created_by: me.id, is_read: true, created_at: new Date(now - 3 * 24 * 60 * min).toISOString(), updated_at: new Date(now - 3 * 24 * 60 * min).toISOString() }
  ]
  // 意见反馈（演示）
  const feedbacks = [
    { id: uid(), content: '希望群聊支持按部门批量拉人，每次手动加人太麻烦了。', contact: null, status: 'processed', admin_reply: '已收到，该功能已列入下个版本计划，感谢反馈！', replied_by: null, replied_at: new Date(now - 5 * 60 * min).toISOString(), created_at: new Date(now - 26 * 60 * min).toISOString(), updated_at: new Date(now - 5 * 60 * min).toISOString() },
    { id: uid(), content: '建议增加夜间模式，晚上加班用太刺眼了。', contact: null, status: 'pending', admin_reply: null, replied_by: null, replied_at: null, created_at: new Date(now - 2 * 60 * min).toISOString(), updated_at: new Date(now - 2 * 60 * min).toISOString() }
  ]
  return { me, users, convs, messages, groupMembers, announcements, feedbacks, uid }
})()
