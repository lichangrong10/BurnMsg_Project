<template>
  <div v-if="state.chat" class="chat-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="closeChat">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </div>
      <div class="avatar" :style="{ width: '38px', height: '38px', fontSize: '15px', background: avatarColor(convName(state.chat)) }"><img v-if="convAvatar(state.chat)" :src="convAvatar(state.chat)" alt=""><template v-else>{{ convInitial(state.chat) }}</template></div>
      <div class="chat-title-wrap" @click="openInfo">
        <div class="chat-title">{{ convName(state.chat) }}</div>
        <div class="chat-status">{{ chatStatus }}</div>
      </div>
      <div class="topbar-icon" @click="showBurnSheet = true" title="阅后即焚">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" :stroke="state.burnSeconds ? '#FFB020' : '#fff'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      </div>
    </div>

    <div v-if="state.burnSeconds" class="burn-banner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B25E00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      阅后即焚已开启：消息将在 {{ burnLabel }} 后销毁
    </div>

    <div class="msg-scroll" ref="msgBox" @scroll="onMsgScroll">
      <div v-if="state.msgLoading" style="text-align:center;color:#707579;font-size:13px;padding:8px">加载中…</div>
      <template v-for="(m, i) in state.messages" :key="msgKey(m, i)">
        <div class="msg-row" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }">
          <div v-if="m.sender_id !== state.me.id && state.chat.type !== 'private'" class="msg-avatar avatar" :style="{ width: '28px', height: '28px', fontSize: '12px', background: avatarColor(senderName(m)) }"><img v-if="senderAvatar(m)" :src="senderAvatar(m)" alt=""><template v-else>{{ senderName(m)[0] }}</template></div>
          <div class="bubble" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }" @click="onMsgTap(m)" @contextmenu.prevent="onMsgTap(m)">
            <div v-if="state.chat.type !== 'private' && m.sender_id !== state.me.id" class="sender-name">{{ senderName(m) }}</div>
            <template v-if="m.is_recalled"><span class="msg-recalled">此消息已撤回</span></template>
            <template v-else-if="m.type === 'image' && m.file_url">
              <img class="msg-image" :src="fileURL(m.file_url)" @load="scrollBottom">
              <div v-if="m.content" style="margin-top:4px">{{ m.content }}</div>
            </template>
            <template v-else-if="m.type === 'file' || m.type === 'voice' || m.type === 'video'">
              <div class="msg-file" @click.stop="openFile(m)">
                <div class="msg-file-icon">
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6"/></svg>
                </div>
                <div style="min-width:0"><div class="msg-file-name">{{ m.file_name || '附件' }}</div><div class="msg-file-size">{{ fmtSize(m.file_size) }}</div></div>
              </div>
              <div v-if="m.content" style="margin-top:4px">{{ m.content }}</div>
            </template>
            <template v-else>{{ m.content }}</template>
            <span class="msg-meta">
              <span v-if="m.is_edited">已编辑 · </span>{{ fmtClock(m.created_at) }}
              <span v-if="m.sender_id === state.me.id && !m.is_recalled && state.chat.type === 'private'" class="read-tag" :class="{ unread: !isPeerRead(m) }">{{ isPeerRead(m) ? '已读' : '未读' }}</span>
            </span>
            <div v-if="m.destroy_at && !m.is_recalled" class="burn-chip">🔥 {{ burnCountdown(m) }}</div>
          </div>
        </div>
      </template>
      <div v-if="!state.messages.length && !state.msgLoading" class="empty-state" style="padding-top:60px"><div>暂无消息<br><small>发出第一条消息，开始加密通讯</small></div></div>
    </div>

    <!-- 新消息浮钮：上滑看历史期间收到新消息时显示，点击直达最新 -->
    <div v-if="newMsgPill" class="new-msg-pill" @click="jumpToLatest">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
      新消息
    </div>

    <!-- 编辑消息提示条 -->
    <div v-if="editing" class="edit-bar">
      <div style="flex:1;min-width:0">
        <div class="edit-bar-title">编辑消息</div>
        <div class="edit-bar-text">{{ editing.content }}</div>
      </div>
      <div class="edit-bar-close" @click="cancelEdit">✕</div>
    </div>

    <div class="input-bar">
      <button class="attach-btn" @click="$refs.fileInput.click()" title="发送图片/文件">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input type="file" ref="fileInput" style="display:none" @change="onFilePicked">
      <textarea class="msg-textarea" ref="msgInput" v-model="draft" rows="1" placeholder="消息" @input="autoGrow" @keydown.enter.exact.prevent="send"></textarea>
      <button class="burn-btn" :class="{ active: state.burnSeconds }" @click="showBurnSheet = true" title="阅后即焚定时器">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" :stroke="state.burnSeconds ? '#E07000' : '#707579'" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>
      </button>
      <button class="send-btn" @click="send">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </div>

    <!-- ═══════ 阅后即焚定时器选择 ═══════ -->
    <div v-if="showBurnSheet" class="overlay" @click.self="showBurnSheet = false">
      <div class="sheet">
        <div class="sheet-title">阅后即焚 · 消息销毁时间</div>
        <div v-for="o in burnOptions" :key="o.v" class="sheet-item" :style="state.burnSeconds === o.v ? 'font-weight:600;background:var(--tg-gray-bg)' : ''" @click="pickBurn(o.v)">
          {{ o.label }}<span v-if="state.burnSeconds === o.v"> ✓</span>
        </div>
        <div class="sheet-item sheet-cancel" @click="showBurnSheet = false">取消</div>
      </div>
    </div>

    <!-- ═══════ 消息操作菜单 ═══════ -->
    <div v-if="msgAction" class="overlay" @click.self="msgAction = null">
      <div class="sheet">
        <div class="sheet-title" style="max-height:60px;overflow:hidden">{{ msgAction.is_recalled ? '消息已撤回' : (msgAction.content || msgAction.file_name || '').slice(0, 60) }}</div>
        <div class="sheet-item" v-if="!msgAction.is_recalled" @click="copyMsg">复制</div>
        <div class="sheet-item" v-if="canEditAction" @click="startEdit">编辑</div>
        <div class="sheet-item" v-if="msgAction.sender_id === state.me.id && !msgAction.is_recalled" @click="showReceipt">已读回执</div>
        <div class="sheet-item danger" v-if="msgAction.sender_id === state.me.id && !msgAction.is_recalled" @click="recallMsg">撤回</div>
        <div class="sheet-item sheet-cancel" @click="msgAction = null">取消</div>
      </div>
    </div>

    <!-- ═══════ 已读回执 ═══════ -->
    <div v-if="receiptMsg" class="overlay" @click.self="receiptMsg = null">
      <div class="sheet">
        <div class="sheet-title">已读回执 · {{ (receiptMsg.content || receiptMsg.file_name || '').slice(0, 30) }}</div>
        <div style="overflow-y:auto">
          <div v-if="receiptLoading" class="sheet-item" style="color:var(--tg-text-secondary)">加载中…</div>
          <template v-else>
            <div v-if="!receiptList.length" class="sheet-item" style="color:var(--tg-text-secondary)">暂无回执数据</div>
            <div v-for="(r, i) in receiptList" :key="r.id || r.user_id || i" class="receipt-row">
              <span>{{ r.user_display_name || '成员' }}</span>
              <span class="receipt-status" :class="{ read: r.is_read }">{{ r.is_read ? '✓✓ 已读' : r.is_delivered ? '✓ 已送达' : '未送达' }}</span>
            </div>
          </template>
        </div>
        <div class="sheet-item sheet-cancel" @click="receiptMsg = null">关闭</div>
      </div>
    </div>
  </div>
</template>

<script>
import { nextTick } from 'vue'
import { state, closeChat, setBurn, sendText, sendFile, recallMessage, showToast, editMessage, openChatInfo, asArray } from '../store'
import { api } from '../api'
import { DEMO } from '../mock/demo'
import { BURN_OPTIONS, avatarColor, avatarSrc, convAvatar, convName, convInitial, fileURL, fmtClock, fmtSize, memberUser, memberUid } from '../utils/format'

export default {
  name: 'ChatRoom',
  data() {
    return {
      state,
      burnOptions: BURN_OPTIONS,
      draft: '',
      showBurnSheet: false,
      msgAction: null,
      editing: null,       // 正在编辑的消息
      receiptMsg: null,    // 查看回执的消息
      receiptList: [],
      receiptLoading: false,
      stickBottom: true,   // 是否吸附在底部（用户未上滑查看历史时自动跟随新消息）
      newMsgPill: false    // 上滑看历史期间收到新消息 → 显示「↓ 新消息」浮钮
    }
  },
  computed: {
    canEditAction() {
      const m = this.msgAction
      return !!(m && m.sender_id === state.me.id && !m.is_recalled && m.type === 'text')
    },
    chatStatus() {
      const c = state.chat
      if (!c) return ''
      if (c.type === 'group') return c.member_count + ' 位成员'
      if (c.type === 'channel') return c.member_count + ' 位订阅者'
      return '在线'
    },
    burnLabel() {
      const o = BURN_OPTIONS.find(x => x.v === state.burnSeconds)
      return o ? o.label : ''
    }
  },
  watch: {
    // 打开会话/非静默刷新完成 → 重新吸附并强制滚到底部
    'state.msgSeq'() {
      this.stickBottom = true
      this.newMsgPill = false
      this.scrollBottom()
    },
    // 自己发送/条数变化 → 仅当用户停留在底部（未上滑查看历史）时跟随滚动
    'state.messages.length'() {
      if (this.stickBottom) this.scrollBottom()
    },
    // 轮询发现新消息（按最新时间戳判定，条数顶到上限不变时也能触发）→ 吸附中滚底，上滑中弹「新消息」浮钮
    'state.newMsgSeq'() {
      if (this.stickBottom) this.scrollBottom()
      else this.newMsgPill = true
    }
  },
  methods: {
    closeChat,
    avatarColor,
    convName,
    convInitial,
    convAvatar,
    fileURL,
    fmtClock,
    fmtSize,
    /** 发送者用户对象：通讯录 → 会话对方 → 群成员（兼容嵌套/平铺）→ 演示数据 */
    senderInfo(m) {
      if (m.sender_id === state.me.id) return state.me
      const c = state.contacts.find(x => x.id === m.sender_id)
      if (c) return c
      const ou = state.chat && state.chat.other_user
      if (ou && ou.id === m.sender_id) return ou
      const gm = (Array.isArray(state.groupMembers) ? state.groupMembers : []).find(x => memberUid(x) === m.sender_id)
      if (gm) return memberUser(gm)
      if (state.demoMode) {
        const u = DEMO.users.find(x => x.id === m.sender_id)
        if (u) return u
      }
      return null
    },
    senderName(m) {
      if (m.sender_id === state.me.id) return state.me.display_name || '我'
      const u = this.senderInfo(m)
      return u ? (u.display_name || u.name || u.username || '成员') : '成员'
    },
    senderAvatar(m) {
      return avatarSrc(this.senderInfo(m))
    },
    burnCountdown(m) {
      const left = Math.max(0, new Date(m.destroy_at) - state.nowTick)
      if (left <= 0) {
        nextTick(() => { state.messages = state.messages.filter(x => x.id !== m.id) })
        return '已焚毁'
      }
      const s = Math.ceil(left / 1000)
      if (s < 60) return s + 's 后焚毁'
      if (s < 3600) return Math.ceil(s / 60) + 'min 后焚毁'
      if (s < 86400) return Math.ceil(s / 3600) + 'h 后焚毁'
      return Math.ceil(s / 86400) + 'd 后焚毁'
    },
    autoGrow(e) {
      const el = e.target
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 120) + 'px'
    },
    onMsgScroll() {
      const b = this.$refs.msgBox
      if (!b) return
      // 距底部 < 60px 视为「在底部」：恢复自动跟随并收起新消息浮钮；否则用户正在上滑查看历史，停止跟随
      const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 60
      this.stickBottom = atBottom
      if (atBottom) this.newMsgPill = false
    },
    scrollBottom() {
      nextTick(() => {
        const b = this.$refs.msgBox
        if (b) b.scrollTop = b.scrollHeight
        // 再补一帧校准：仅在吸附状态下二次滚底，避免打扰上滑看历史的用户
        requestAnimationFrame(() => {
          const b2 = this.$refs.msgBox
          if (b2 && this.stickBottom) b2.scrollTop = b2.scrollHeight
        })
      })
    },
    /** 点击「↓ 新消息」浮钮：强制吸附并滚到最新 */
    jumpToLatest() {
      this.newMsgPill = false
      this.stickBottom = true
      this.scrollBottom()
    },
    /** 消息渲染 key 兜底：id → message_id → 索引，避免后端 id 字段名不一致导致 key 冲突、新行不渲染 */
    msgKey(m, i) {
      return (m && (m.id ?? m.message_id ?? m.messageId)) ?? i
    },
    /** 本人私聊消息是否被对方已读：消息时间 ≤ 已读水位线（真实回执数据，store 维护） */
    isPeerRead(m) {
      if (this.state.demoMode) return true // 演示模式统一显示已读
      const t = Date.parse((m && m.created_at) || '') || 0
      return t > 0 && t <= this.state.readWatermark
    },
    pickBurn(v) {
      setBurn(v)
      this.showBurnSheet = false
    },
    openInfo() {
      openChatInfo()
    },
    startEdit() {
      const m = this.msgAction
      this.msgAction = null
      this.editing = m
      this.draft = m.content || ''
      nextTick(() => { if (this.$refs.msgInput) this.$refs.msgInput.focus() })
    },
    cancelEdit() {
      this.editing = null
      this.draft = ''
    },
    async showReceipt() {
      const m = this.msgAction
      this.msgAction = null
      this.receiptMsg = m
      this.receiptList = []
      this.receiptLoading = true
      if (state.demoMode) {
        const others = state.chat && state.chat.type === 'private'
          ? [state.chat.other_user].filter(Boolean)
          : DEMO.users.slice(0, 3)
        this.receiptList = others.map((u, i) => ({
          user_id: u.id, user_display_name: u.display_name,
          is_delivered: true, is_read: i < 2, read_at: i < 2 ? new Date().toISOString() : null
        }))
        this.receiptLoading = false
        return
      }
      try {
        this.receiptList = asArray(await api.getReceipt(m.id))
      } catch (e) {
        showToast(e.message)
        this.receiptMsg = null
      } finally {
        this.receiptLoading = false
      }
    },
    async send() {
      const text = this.draft.trim()
      if (!text) return
      // 编辑模式：提交修改
      if (this.editing) {
        const m = this.editing
        if (text === (m.content || '').trim()) { this.cancelEdit(); return }
        this.editing = null
        this.draft = ''
        if (this.$refs.msgInput) this.$refs.msgInput.style.height = 'auto'
        const ok = await editMessage(m, text)
        if (!ok) { this.editing = m; this.draft = text }
        return
      }
      if (!state.chat) return
      this.draft = ''
      if (this.$refs.msgInput) this.$refs.msgInput.style.height = 'auto'
      const ok = await sendText(text)
      if (!ok) this.draft = text
    },
    onFilePicked(e) {
      const file = e.target.files[0]
      e.target.value = ''
      if (file) sendFile(file)
    },
    openFile(m) {
      if (m.file_url) window.open(fileURL(m.file_url), '_blank')
    },
    onMsgTap(m) {
      this.msgAction = m
    },
    copyMsg() {
      const t = this.msgAction.content || ''
      if (navigator.clipboard) navigator.clipboard.writeText(t).then(() => showToast('已复制'))
      this.msgAction = null
    },
    recallMsg() {
      const m = this.msgAction
      this.msgAction = null
      recallMessage(m)
    }
  }
}
</script>
<style scoped>
.edit-bar { display: flex; align-items: center; gap: 10px; padding: 7px 14px; background: var(--tg-bg); border-top: 1px solid var(--tg-border); border-left: 3px solid var(--tg-blue); }
.edit-bar-title { font-size: 13px; color: var(--tg-blue); font-weight: 600; }
.edit-bar-text { font-size: 13px; color: var(--tg-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.edit-bar-close { cursor: pointer; color: var(--tg-text-secondary); padding: 2px 8px; font-size: 15px; flex-shrink: 0; }
.receipt-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; font-size: 15px; }
.receipt-status { color: var(--tg-text-secondary); font-size: 13.5px; }
.receipt-status.read { color: var(--tg-blue); font-weight: 500; }
.read-tag { font-size: 11px; margin-left: 3px; opacity: .85; }
.bubble.out .read-tag { color: #8fd3a8; }          /* 已读：柔和绿 */
.bubble.out .read-tag.unread { color: rgba(255,255,255,.55); } /* 未读：灰白 */
.new-msg-pill { position: absolute; right: 14px; bottom: 78px; z-index: 30; display: flex; align-items: center; gap: 4px; background: var(--tg-blue); color: #fff; font-size: 13.5px; font-weight: 500; padding: 8px 14px; border-radius: 18px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.28); animation: bubbleIn .18s ease; }
.new-msg-pill:active { opacity: .85; }
</style>
