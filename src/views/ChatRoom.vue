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
      <div class="topbar-icon" @click="showBurnSheet = true" :title="state.burnSeconds && state.e2eOn ? '阅后即焚 + 明文加密（端到端密文）' : '阅后即焚'">
        <svg v-if="state.burnSeconds && state.e2eOn" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" stroke="#FFB020" stroke-width="2"/>
          <rect x="9.6" y="11.6" width="4.8" height="3.9" rx="1" fill="#fff" stroke="#fff" stroke-width="1.2"/>
          <path d="M10.6 11.6V9.3a1.4 1.4 0 0 1 2.8 0v2.3" stroke="#fff" stroke-width="1.5" fill="none"/>
        </svg>
        <svg v-else width="21" height="21" viewBox="0 0 24 24" fill="none" :stroke="state.burnSeconds ? '#FFB020' : '#fff'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      </div>
    </div>

    <div v-if="state.burnSeconds" class="burn-banner">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#B25E00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
      阅后即焚已开启：消息将在 {{ burnLabel }} 后销毁<span v-if="state.e2eOn"> · 明文加密（端到端密文）</span>
    </div>

    <div class="msg-scroll" ref="msgBox" @scroll="onMsgScroll">
      <div v-if="state.msgLoading" style="text-align:center;color:#707579;font-size:13px;padding:8px">加载中…</div>
      <template v-for="(m, i) in state.messages" :key="msgKey(m, i)">
        <div class="msg-row" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }">
          <div v-if="m.sender_id !== state.me.id && state.chat.type !== 'private'" class="msg-avatar avatar" :style="{ width: '28px', height: '28px', fontSize: '12px', background: avatarColor(senderName(m)) }"><img v-if="senderAvatar(m)" :src="senderAvatar(m)" alt=""><template v-else>{{ senderName(m)[0] }}</template></div>
          <div class="bubble" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }" @click="onBubbleClick(m)" @contextmenu.prevent="onMsgTap(m)">
            <div v-if="state.chat.type !== 'private' && m.sender_id !== state.me.id" class="sender-name">{{ senderName(m) }}</div>
            <template v-if="m.is_recalled"><span class="msg-recalled">此消息已撤回</span></template>
            <template v-else-if="isBurned(m)"><span class="msg-recalled">此消息已焚毁</span></template>
            <template v-else-if="isBlurredBurn(m)"><span class="burn-blur" :class="{ enc: isEnc(m) }"><svg v-if="isEnc(m)" class="blur-ico" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" stroke="currentColor" stroke-width="2"/><rect x="9.6" y="11.6" width="4.8" height="3.9" rx="1" fill="currentColor" stroke="currentColor" stroke-width="1.2"/><path d="M10.6 11.6V9.3a1.4 1.4 0 0 1 2.8 0v2.3" stroke="currentColor" stroke-width="1.5" fill="none"/></svg><span v-else class="blur-ico">🔥</span>{{ isEnc(m) ? '焚毁加密消息 · 点击查看' : '焚毁消息 · 点击查看' }}</span></template>
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
            <template v-else>
              <template v-if="isEnc(m) && !isBurnMsg(m) && reveal[e2eKey(m)]"><span class="e2e-lock" title="端到端加密消息">🔒 </span>{{ m.content }}<span class="e2e-count">{{ revealLeft[e2eKey(m)] }}s</span></template>
              <template v-else-if="isEnc(m) && !isBurnMsg(m)"><span class="e2e-reveal">🔒 加密消息 · 点击查看</span></template>
              <template v-else>{{ m.content }}</template>
            </template>
            <span class="msg-meta">
              <span v-if="m.is_edited">已编辑 · </span>{{ fmtClock(m.created_at) }}
              <span v-if="m.sender_id === state.me.id && !m.is_recalled && state.chat.type === 'private'" class="read-tag" :class="{ unread: !isPeerRead(m) }">{{ isPeerRead(m) ? '已读' : '未读' }}</span>
            </span>
            <div v-if="burnVisible(m)" class="burn-chip" :class="{ enc: isEnc(m) }">
              <svg v-if="isEnc(m)" class="chip-ico" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" stroke="currentColor" stroke-width="2.2"/><rect x="9.8" y="11.7" width="4.4" height="3.6" rx="1" fill="currentColor"/><path d="M10.8 11.7V9.5a1.2 1.2 0 0 1 2.4 0v2.2" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
              <span v-else>🔥</span>{{ burnCountdown(m) }}
            </div>
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

    <div v-if="!isDissolved" class="input-bar">
      <button class="attach-btn" @click="$refs.fileInput.click()" title="发送图片/文件">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
      </button>
      <input type="file" ref="fileInput" style="display:none" @change="onFilePicked">
      <textarea class="msg-textarea" ref="msgInput" v-model="draft" rows="1" :placeholder="state.e2eOn ? (state.burnSeconds ? '加密消息 · 阅后即焚' : '加密消息 · 端到端') : (state.burnSeconds ? '消息 · 阅后即焚' : '消息')" @input="autoGrow" @keydown.enter.exact.prevent="send"></textarea>
      <button class="burn-btn" :class="{ active: state.e2eOn }" @click="toggleE2E" title="明文加密（端到端，仅单聊）">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" :stroke="state.e2eOn ? '#3390EC' : '#707579'" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </button>
      <button class="send-btn" @click="send">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
      </button>
    </div>
    <div v-else class="dissolved-bar">群组已解散，无法发送消息</div>

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

    <!-- 文件在线预览层（Word / Excel） -->
    <div v-if="preview.show" class="preview-mask">
      <div class="preview-head">
        <div class="preview-close" @click="closePreview">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </div>
        <div class="preview-title">{{ preview.name }}</div>
        <div class="preview-dl" @click="downloadPreview">下载</div>
      </div>
      <div class="preview-body">
        <div v-if="preview.loading" class="preview-tip">加载中…</div>
        <div v-else-if="preview.error" class="preview-tip">{{ preview.error }}<div><span class="preview-tip-btn" @click="downloadPreview">下载到本地查看</span></div></div>
        <div v-else-if="preview.kind === 'word'" ref="previewBox" class="preview-doc"></div>
        <template v-else>
          <div v-if="preview.sheets.length > 1" class="preview-sheet-bar">
            <div v-for="(s, i) in preview.sheets" :key="i" class="preview-sheet-tab" :class="{ on: i === preview.activeSheet }" @click="preview.activeSheet = i">{{ s.name }}</div>
          </div>
          <div class="preview-doc preview-xlsx" v-html="preview.sheets[preview.activeSheet] ? preview.sheets[preview.activeSheet].html : ''"></div>
        </template>
      </div>
    </div>
  </div>
</template>

<script>
import { nextTick } from 'vue'
import { state, closeChat, setBurn, sendText, sendFile, recallMessage, revealBurn, showToast, editMessage, openChatInfo, asArray, toggleE2E } from '../store'
import { api } from '../api'
import { http } from '../utils/request'
import { DEMO } from '../mock/demo'
import { BURN_OPTIONS, avatarColor, avatarSrc, convAvatar, convName, convInitial, fileURL, fmtClock, fmtSize, memberUser, memberUid } from '../utils/format'
import { renderSheetHtml } from '../utils/xlsxRender'
import { copyText } from '../utils/clipboard'

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
      preview: { show: false, kind: '', name: '', url: '', loading: false, error: '', sheets: [], activeSheet: 0 }, // 文件在线预览
      stickBottom: true,   // 是否吸附在底部（用户未上滑查看历史时自动跟随新消息）
      newMsgPill: false,   // 上滑看历史期间收到新消息 → 显示「↓ 新消息」浮钮
      reveal: {},          // 端到端加密消息点按显示状态 { msgId: true }
      revealTickers: {},   // 点按显示倒计时定时器 { msgId: intervalId }
      revealLeft: {}       // 点按显示剩余秒数 { msgId: n }
    }
  },
  computed: {
    canEditAction() {
      const m = this.msgAction
      return !!(m && m.sender_id === state.me.id && !m.is_recalled && m.type === 'text' && !m.is_encrypted)
    },
    isDissolved() {
      return !!(state.chat && state.chat.dissolved_at)
    },
    chatStatus() {
      const c = state.chat
      if (!c) return ''
      if (c.dissolved_at) return '已解散'
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
  mounted() {
    window.addEventListener('bm-back', this.onNativeBack)
  },
  beforeUnmount() {
    window.removeEventListener('bm-back', this.onNativeBack)
    Object.values(this.revealTickers).forEach(clearInterval)
  },
  methods: {
    /** 原生返回键：先关本页内部弹层（回执详情→消息菜单→阅后即焚面板→退出编辑态），消费掉事件 */
    onNativeBack(e) {
      if (this.preview.show)      { this.preview.show = false; e.preventDefault(); return }
      if (this.receiptMsg)        { this.receiptMsg = null; e.preventDefault(); return }
      if (this.msgAction)         { this.msgAction = null; e.preventDefault(); return }
      if (this.showBurnSheet)     { this.showBurnSheet = false; e.preventDefault(); return }
      if (this.editing)           { this.editing = null; e.preventDefault(); return }
    },
    closeChat,
    toggleE2E,
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
      // 本地倒计时优先：reveal / 历史加载时由后端 remain_seconds 种入 store.burnLeft，摆脱客户端-服务端时钟偏差（10 秒变 20 秒根因）
      const local = (m.id != null) ? state.burnLeft[m.id] : undefined
      if (local != null) return local <= 0 ? '已焚毁' : this.fmtBurnLeft(local)
      // 兜底：demo / 旧数据 / 未点开但已有截止时间，用 burn_at（个人截止）或 destroy_at 绝对时间
      const endStr = m.burn_at || m.destroy_at
      if (!endStr) return ''
      const left = Math.max(0, new Date(endStr) - state.nowTick)
      if (left <= 0) {
        return '已焚毁'
      }
      return this.fmtBurnLeft(Math.ceil(left / 1000))
    },
    fmtBurnLeft(s) {
      if (s < 60) return s + 's 后焚毁'
      if (s < 3600) return Math.ceil(s / 60) + 'min 后焚毁'
      if (s < 86400) return Math.ceil(s / 3600) + 'h 后焚毁'
      return Math.ceil(s / 86400) + 'd 后焚毁'
    },
    /** 是否焚毁消息（burn_ttl_seconds 或 destroy_at 任一即视为焚毁消息） */
    isBurnMsg(m) {
      return !!(m && (m.burn_ttl_seconds != null || m.destroy_at != null))
    },
    /** 是否已焚毁：倒计时归零后保留「已焚毁」占位（类似撤回），不再显示正文/倒计时 */
    isBurned(m) {
      if (!m) return false
      if (m.is_burned === true) return true
      const local = (m.id != null) ? state.burnLeft[m.id] : undefined
      if (local != null) return local <= 0
      const endStr = m.burn_at || m.destroy_at
      if (!endStr) return false
      return new Date(endStr).getTime() <= state.nowTick
    },
    /** 焚毁消息的「马赛克占位」态：点开前，点击触发 reveal 拉取内容 */
    isBlurredBurn(m) {
      return !!(m && m.is_blurred === true)
    },
    /** 是否显示焚毁倒计时角标：非撤回、已点开（非占位）、且有截止时间 */
    burnVisible(m) {
      return !!(m && !m.is_recalled && !this.isBurned(m) && !m.is_blurred && (m.burn_at || m.destroy_at))
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
    /** 点击文件消息：Word/Excel 在线预览，其他类型维持原下载/打开逻辑 */
    openFile(m) {
      if (!m.file_url) return
      const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
      if (ext === 'docx') this.startPreview(m, 'word')
      else if (ext === 'xlsx' || ext === 'xls') this.startPreview(m, 'excel')
      else window.open(fileURL(m.file_url), '_blank')
    },
    /** 在线预览：拉取文件 blob → docx-preview 渲染 Word / SheetJS 渲染 Excel（库均按需动态加载，不进主包） */
    async startPreview(m, kind) {
      this.preview = { show: true, kind, name: m.file_name || '附件', url: fileURL(m.file_url), loading: true, error: '', sheets: [], activeSheet: 0 }
      if (state.demoMode) { this.preview.loading = false; this.preview.error = '演示模式暂不支持在线预览'; return }
      let blob
      try {
        blob = await http.get(this.preview.url, { responseType: 'blob', timeout: 30000 })
      } catch (e) {
        this.preview.loading = false
        this.preview.error = '文件获取失败'
        return
      }
      try {
        if (kind === 'word') {
          const { renderAsync } = await import('docx-preview')
          this.preview.loading = false
          await nextTick()
          await renderAsync(blob, this.$refs.previewBox, null, { inWrapper: true })
          // 纸张比屏幕宽时整页缩放适配（Chrome/WebView 支持 zoom，布局随缩放重排），观感同微信
          const box = this.$refs.previewBox
          const pw = box ? box.clientWidth : 0
          if (pw > 0) box.querySelectorAll('section.docx').forEach(sec => {
            if (sec.offsetWidth > pw) sec.style.zoom = (pw / sec.offsetWidth).toFixed(3)
          })
        } else {
          const buf = await blob.arrayBuffer()
          const ext = ((m.file_name || '').split('.').pop() || '').toLowerCase()
          if (ext === 'xlsx') {
            // xlsx：exceljs 读取样式，自渲染还原原生 Excel 观感（颜色/边框/合并/列宽行高/数字格式）
            const ExcelJS = await import('exceljs')
            const wb = new ExcelJS.Workbook()
            await wb.xlsx.load(buf)
            this.preview.sheets = wb.worksheets.map(ws => ({ name: ws.name, html: renderSheetHtml(ws) }))
          } else {
            // xls 老格式：SheetJS 兜底（无样式，数据+网格线）
            const XLSX = await import('xlsx')
            const wb = XLSX.read(buf, { type: 'array' })
            this.preview.sheets = wb.SheetNames.map(n => ({ name: n, html: XLSX.utils.sheet_to_html(wb.Sheets[n]) }))
          }
          if (!this.preview.sheets.length) throw new Error('empty workbook')
          this.preview.loading = false
        }
      } catch (e) {
        console.warn('[preview] render fail', e)
        this.preview.loading = false
        this.preview.error = '该文件无法预览'
      }
    },
    closePreview() { this.preview.show = false },
    downloadPreview() {
      if (this.preview.url) window.open(this.preview.url, '_blank')
    },
    onMsgTap(m) {
      this.msgAction = m
    },
    /** 端到端加密消息：点击气泡显示明文 10 秒后自动隐藏；长按/右键仍打开操作菜单 */
    e2eKey(m) {
      return String(m && (m.id ?? m.message_id ?? m.messageId))
    },
    /** 是否端到端加密消息：解密成功(e2e) / 解密失败(e2eFail) / 后端加密标记(is_encrypted)，三者任一即视为加密 */
    isEnc(m) {
      return !!(m && (m.e2e === true || m.e2eFail === true || m.is_encrypted === true))
    },
    onBubbleClick(m) {
      if (this.isBlurredBurn(m)) { revealBurn(m); return } // 焚毁占位卡：点开才焚，reveal 拉完整内容
      if (this.isEnc(m) && !this.isBurnMsg(m)) { this.revealE2E(m); return }
      this.onMsgTap(m)
    },
    revealE2E(m) {
      const key = this.e2eKey(m)
      if (!key) return
      this.reveal[key] = true
      this.revealLeft[key] = 10
      clearInterval(this.revealTickers[key])
      this.revealTickers[key] = setInterval(() => {
        if (this.revealLeft[key] > 1) {
          this.revealLeft[key] -= 1
        } else {
          clearInterval(this.revealTickers[key])
          this.reveal[key] = false
          delete this.revealLeft[key]
        }
      }, 1000)
    },
    copyMsg() {
      const t = (this.msgAction.content || this.msgAction.file_name || '').trim()
      this.msgAction = null
      if (!t) { showToast('无可复制内容'); return }
      copyText(t).then(ok => showToast(ok ? '已复制' : '复制失败'))
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
.dissolved-bar { padding: 14px 16px calc(14px + var(--safe-bottom)); background: var(--tg-bg); border-top: 1px solid var(--tg-border); text-align: center; font-size: 14px; color: var(--tg-text-secondary); }
/* ── 文件在线预览层 ── */
.preview-mask { position: absolute; inset: 0; z-index: 45; background: #f6f7f9; display: flex; flex-direction: column; }
.preview-head { display: flex; align-items: center; gap: 8px; padding: calc(8px + var(--safe-top)) 12px 8px; background: var(--tg-bg); border-bottom: 1px solid var(--tg-border); flex-shrink: 0; }
.preview-close { color: var(--tg-text); cursor: pointer; display: flex; padding: 5px; border-radius: 8px; }
.preview-close:active { background: var(--tg-gray-bg); }
.preview-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--tg-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.preview-dl { color: var(--tg-blue); font-size: 14px; font-weight: 500; cursor: pointer; flex-shrink: 0; padding: 6px 8px; }
.preview-body { flex: 1; overflow: auto; -webkit-overflow-scrolling: touch; }
.preview-tip { text-align: center; color: var(--tg-text-secondary); padding: 70px 20px 0; font-size: 14px; }
.preview-tip-btn { display: inline-block; margin-top: 16px; color: #fff; background: var(--tg-blue); border-radius: 8px; padding: 9px 20px; font-size: 14px; cursor: pointer; }
.preview-doc { background: #fff; min-height: 100%; }
/* docx-preview：灰底白纸效果 */
.preview-doc :deep(.docx-wrapper) { background: #f6f7f9 !important; padding: 12px 0 !important; }
.preview-doc :deep(.docx-wrapper > section.docx) { box-shadow: 0 1px 4px rgba(0,0,0,.08) !important; margin-bottom: 12px !important; }
/* SheetJS 表格（xls 兜底） */
.preview-xlsx { padding: 10px; }
.preview-xlsx :deep(table) { border-collapse: collapse; background: #fff; font-size: 13px; width: max-content; min-width: calc(100% - 20px); }
.preview-xlsx :deep(td), .preview-xlsx :deep(th) { border: 1px solid #dde1e6; padding: 5px 10px; white-space: pre-wrap; word-break: break-word; min-width: 64px; color: #222; }
/* exceljs 自渲染表格（xlsx 带样式还原）：fixed 布局严格按 Excel 列宽，超出截断同 Excel */
.preview-xlsx :deep(.xr-table) { table-layout: fixed; width: max-content; }
.preview-xlsx :deep(.xr-table td) { border: 1px solid #e3e6ea; padding: 3px 8px; overflow: hidden; min-width: 0; background: #fff; }
.preview-xlsx :deep(.xr-empty) { color: #999; padding: 40px; text-align: center; }
.preview-sheet-bar { display: flex; gap: 6px; padding: 8px 10px; overflow-x: auto; background: var(--tg-bg); border-bottom: 1px solid var(--tg-border); position: sticky; top: 0; z-index: 2; }
.preview-sheet-tab { flex-shrink: 0; font-size: 13px; padding: 5px 13px; border-radius: 14px; background: var(--tg-gray-bg); color: var(--tg-text-secondary); cursor: pointer; }
.preview-sheet-tab.on { background: var(--tg-blue); color: #fff; }
/* 端到端加密消息：点按查看 */
.e2e-reveal { color: var(--tg-blue); cursor: pointer; }
.bubble.out .e2e-reveal { color: rgba(255,255,255,.92); }
.e2e-reveal:active { opacity: .7; }
.e2e-count { font-size: 10px; line-height: 1; margin-left: 6px; padding: 3px 7px; border-radius: 9px; background: rgba(0,0,0,.10); color: #565c63; font-weight: 600; }
.bubble.out .e2e-count { background: rgba(0,0,0,.20); color: rgba(255,255,255,.92); }
</style>
