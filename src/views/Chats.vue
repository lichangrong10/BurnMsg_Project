<template>
  <div @touchstart="pullStart" @touchmove="pullMove" @touchend="pullEnd" @touchcancel="pullEnd">
    <!-- 下拉刷新指示器 -->
    <div class="pull-indicator" :style="{ height: pullDist + 'px', opacity: pullOpacity }">
      <svg v-if="pullState !== 'refreshing'" class="pull-arrow" :class="{ up: pullState === 'ready' }" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      <span v-else class="pull-spinner"></span>
      <span>{{ pullText }}</span>
    </div>
    <div class="chat-tabs" style="margin-top: 10px;">
      <div class="chat-tab" :class="{ active: chatTab === 'private' }" @click="chatTab = 'private'"><span class="tab-label">私聊<span v-if="tabUnread.private" class="tab-dot"></span></span></div>
      <div class="chat-tab" :class="{ active: chatTab === 'group' }" @click="chatTab = 'group'"><span class="tab-label">群组<span v-if="tabUnread.group" class="tab-dot"></span></span></div>
      <div class="chat-tab" :class="{ active: chatTab === 'channel' }" @click="chatTab = 'channel'"><span class="tab-label">频道<span v-if="tabUnread.channel" class="tab-dot"></span></span></div>
    </div>
    <div v-if="!filteredConvs.length" class="empty-state">
      <div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div>暂无会话<br><small>从通讯录选择同事，直接发起聊天</small></div>
    </div>
    <div v-for="c in filteredConvs" :key="c.id" class="conv-item" :class="{ 'is-pinned': c.pinned, 'has-unread': c.unread }"
      @click="onClickConv(c)"
      @contextmenu.prevent="openMenu(c, $event)"
      @touchstart="touchStart($event, c)"
      @touchmove="touchMove"
      @touchend="touchEnd"
      @touchcancel="cancelLongPress">
      <span v-if="c.unread" class="conv-badge-bottom">{{ c.unread > 99 ? '99+' : c.unread }}</span>
      <div class="avatar-wrap">
        <div class="avatar" :style="{ width: '52px', height: '52px', fontSize: '19px', background: avatarColor(c.type === 'private' ? String((c.other_user && c.other_user.id) || convName(c)) : convName(c)) }"><img v-if="convAvatar(c)" :src="convAvatar(c)" alt=""><template v-else>{{ convInitial(c) }}</template></div>
        <!-- 私聊在线圆点：绿=在线，灰=离线；未取到在线态时不显示 -->
        <span v-if="peerOnline(c) !== null" class="online-dot" :class="{ on: peerOnline(c) }" :title="peerOnline(c) ? '在线' : '离线'"></span>
          <!-- 右上角：焚毁时间（加密聊天剩余有效期 / 会话焚毁时长） -->
          <span v-if="burnBadge(c)" class="conv-burn-badge" :title="'焚毁时间 ' + burnBadge(c)">{{ burnBadge(c) }}</span>
      </div>
      <div class="conv-main">
        <div class="conv-row">
          <div class="conv-name"><svg v-if="c.pinned" class="pin-mark" width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>{{ displayName(c) }}<span v-if="c.e2e_mode === 1" class="conv-enc">{{ c.e2e_state === 1 ? '加密请求' : '加密' }}</span></div>
        </div>
        <div class="conv-row" style="align-items:center">
          <div class="conv-preview"><svg v-if="c.burning" class="burn-tag" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.7c-1.1 3.2 1.4 4.9 2.9 6.6 1.5 1.7 2.8 3.6 2.8 5.9a7.2 7.2 0 1 1-14.4 0c0-2.9 1.6-5 3.2-6.8.5 1.8 1.6 2.8 2.8 3.4.1-2.8-.5-5.8 2.7-9.1z"/></svg><span v-if="c.mentionFlag" class="conv-mention">有人@了你</span><template v-else>{{ c.lastMsg || '开始聊天吧' }}</template></div>
          <div class="conv-right">
              <span class="conv-time-bottom">{{ fmtTime(c.last_message_at) }}</span>
              <span v-if="c.dissolved_at" class="type-tag" style="color:#E53935;background:rgba(229,57,53,.1)">已解散</span>
              <span v-if="c.e2e_mode === 1" class="type-tag" style="color:var(--tg-blue);background:rgba(51,144,236,.1)">加密</span>
              <span v-else-if="c.is_channel || c.type === 'channel'" class="type-tag">频道</span>
              <span v-else-if="c.type === 'group'" class="type-tag">群组</span>
              <span v-else class="type-tag">私聊</span>
              
          </div>
        </div>
      </div>
    </div>

    <!-- 长按 / 右键操作菜单 -->
    <div v-if="menu" class="conv-menu-overlay" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="conv-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
        <div class="conv-menu-item" @click="onTogglePin">{{ menu.conv.pinned ? '取消置顶' : '置顶会话' }}</div>
        <div class="conv-menu-item danger" @click="onDeleteConv">删除会话</div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, openChat, togglePin, deleteConversation, loadConvs, isUserOnline } from '../store'
import { avatarColor, convAvatar, convName, convInitial, fmtTime } from '../utils/format'

export default {
  name: 'ChatsView',
  data() {
    return {
      state,
      chatTab: 'private', // private | group | channel
      menu: null,        // 长按/右键浮层：{ conv, x, y }
      pullDist: 0,       // 下拉距离 px
      pullState: 'idle'  // idle | pulling | ready | refreshing
    }
  },
  computed: {
    /** 三个分类标签是否有未读（用来在标签右上角显示小红点） */
    tabUnread() {
      const list = Array.isArray(state.convs) ? state.convs : []
      const has = (pred) => list.some(c => pred(c) && (c.unread || 0) > 0)
      return {
        private: has(c => c.type === 'private' && !c.is_channel),
        group: has(c => c.type === 'group' && !c.is_channel),
        channel: has(c => c.is_channel || c.type === 'channel')
      }
    },
    /** 当前列表里重名的私聊（同名不同人）→ 给名字加唯一后缀 */
    dupNameIds() {
      const list = Array.isArray(state.convs) ? state.convs : []
      const cnt = {}
      list.filter(c => c.type === 'private' && c.e2e_mode !== 1).forEach(c => {
        const n = convName(c)
        cnt[n] = (cnt[n] || 0) + 1
      })
      const set = new Set()
      list.filter(c => c.type === 'private' && c.e2e_mode !== 1 && cnt[convName(c)] > 1).forEach(c => set.add(String(c.id)))
      return set
    },
    filteredConvs() {
      const k = '' // 会话页不再本地过滤（搜索统一走全局搜索）
      const list = Array.isArray(state.convs) ? state.convs : []
      const tab = this.chatTab
      return list
        .filter(c => {
          const isCh = c.is_channel || c.type === 'channel'
          const kwOk = !k || convName(c).toLowerCase().includes(k)
          if (tab === 'channel') return isCh && kwOk
          if (isCh) return false
          if (tab === 'private') return c.type === 'private' && kwOk
          if (tab === 'group') return c.type === 'group' && kwOk
          return kwOk
        })
        .sort((a, b) => {
          // 加密聊天请求置顶（pending 的 last_message_at 为 null，否则会沉到最底）
          const ap = (a.e2e_mode === 1 && (a.e2e_state === 1 || a.e2e_state === 2)) ? 1 : 0
          const bp = (b.e2e_mode === 1 && (b.e2e_state === 1 || b.e2e_state === 2)) ? 1 : 0
          if (ap !== bp) return bp - ap
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
          return (new Date(b.last_message_at || 0).getTime()) - (new Date(a.last_message_at || 0).getTime())
        })
    },
    pullText() {
      if (this.pullState === 'refreshing') return '刷新中…'
      return this.pullState === 'ready' ? '释放刷新' : '下拉刷新'
    },
    pullOpacity() {
      return this.pullDist > 0 ? 1 : 0
    }
  },
  mounted() {
    window.addEventListener('bm-back', this.onNativeBack)
  },
  beforeUnmount() {
    window.removeEventListener('bm-back', this.onNativeBack)
  },
  methods: {
    /** 展示名：重名时追加部门/工号，没有则追加 ID 后 4 位，保证可区分 */
    displayName(c) {
      const base = convName(c)
      if (!c || c.type !== 'private' || c.e2e_mode === 1 || !this.dupNameIds.has(String(c.id))) return base
      const u = c.other_user || {}
      const extra = u.department || u.employee_no || String(u.id || '').slice(-4)
      return extra ? base + ' · ' + extra : base
    },
    /** 头像右上角焚毁时间：加密聊天取剩余有效期，普通会话取会话焚毁时长 */
    burnBadge(c) {
      if (!c) return ''
      if (c.e2e_mode === 1) {
        const at = c.e2e_expires_at
        if (!at) return ''
        const ms = Date.parse(at) - Date.now()
        if (!(ms > 0)) return ''
        const d = Math.ceil(ms / 86400000)
        if (d >= 1) return d + 'd'
        const h = Math.ceil(ms / 3600000)
        if (h >= 1) return h + 'h'
        return Math.max(1, Math.ceil(ms / 60000)) + 'm'
      }
      const ttl = Number(c.burn_ttl_seconds || 0)
      if (!(ttl > 0)) return ''
      if (ttl >= 86400) return Math.round(ttl / 86400) + 'd'
      if (ttl >= 3600) return Math.round(ttl / 3600) + 'h'
      if (ttl >= 60) return Math.round(ttl / 60) + 'm'
      return ttl + 's'
    },
    /** 私聊对方是否在线：返回 true/false；群/频道或数据未到返回 null（不显示圆点） */
    peerOnline(c) {
      if (!c || c.type !== 'private' || !c.other_user || c.other_user.id == null) return null
      const v = isUserOnline(c.other_user.id)
      return v === null ? null : v === true
    },
    /** 原生返回键：会话长按/右键菜单打开时先关菜单，消费掉事件 */
    onNativeBack(e) {
      if (this.menu) { this.closeMenu(); e.preventDefault() }
    },
    openChat,
    avatarColor,
    convAvatar,
    convName,
    convInitial,
    fmtTime,
    onClickConv(c) {
      if (this.suppressClick) { this.suppressClick = false; return }
      openChat(c)
    },
    // ── 长按（触屏）/ 右键（桌面）唤起置顶菜单 ──
    openMenu(c, e) {
      const px = (e && e.clientX) || 60
      const py = (e && e.clientY) || 120
      this.menu = {
        conv: c,
        x: Math.max(12, Math.min(px, window.innerWidth - 150)),
        y: Math.max(12, Math.min(py, window.innerHeight - 60))
      }
    },
    closeMenu() { this.menu = null },
    onTogglePin() {
      const c = this.menu && this.menu.conv
      if (c) togglePin(c)
      this.closeMenu()
    },
    onDeleteConv() {
      const c = this.menu && this.menu.conv
      if (c) deleteConversation(c)
      this.closeMenu()
    },
    touchStart(e, c) {
      const t = e.touches && e.touches[0]
      if (!t) return
      this._lp = { x: t.clientX, y: t.clientY, conv: c, fired: false }
      clearTimeout(this._lpTimer)
      this._lpTimer = setTimeout(() => {
        if (this._lp) {
          this._lp.fired = true
          this.openMenu(this._lp.conv, { clientX: this._lp.x, clientY: this._lp.y })
          if (navigator.vibrate) { try { navigator.vibrate(20) } catch (e) {} }
        }
      }, 500)
    },
    touchMove() { this.cancelLongPress() },
    touchEnd() {
      const fired = this._lp && this._lp.fired
      clearTimeout(this._lpTimer)
      this._lp = null
      if (fired) this.suppressClick = true
    },
    cancelLongPress() {
      clearTimeout(this._lpTimer)
      this._lp = null
    },
    // ── 下拉刷新（触屏）──
    pullStart(e) {
      if (this.pullState === 'refreshing') return
      const sc = this.$el.closest('.content-scroll')
      if (!sc || sc.scrollTop > 0) return
      const t = e.touches && e.touches[0]
      if (!t) return
      this._pull = { startY: t.clientY }
    },
    pullMove(e) {
      if (!this._pull || this.pullState === 'refreshing') return
      const t = e.touches && e.touches[0]
      if (!t) return
      const dy = t.clientY - this._pull.startY
      if (dy <= 0) { this.pullDist = 0; this.pullState = 'idle'; return }
      if (e.cancelable) e.preventDefault()
      const damp = Math.min(dy * 0.5, 90)
      this.pullDist = damp
      this.pullState = damp >= 55 ? 'ready' : 'pulling'
    },
    pullEnd() {
      if (!this._pull) return
      const ready = this.pullState === 'ready'
      this._pull = null
      if (ready) this.refreshConvs()
      else { this.pullDist = 0; this.pullState = 'idle' }
    },
    async refreshConvs() {
      if (this.pullState === 'refreshing') return
      this.pullState = 'refreshing'
      this.pullDist = 50
      const t0 = Date.now()
      try {
        await loadConvs(true)
      } finally {
        const wait = Math.max(0, 400 - (Date.now() - t0))
        setTimeout(() => {
          this.pullDist = 0
          this.pullState = 'idle'
        }, wait)
      }
    }
  }
}
</script>
<style scoped>
.pull-indicator {
  height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #909399;
  font-size: 13px;
  transition: height .18s ease, opacity .18s ease;
  user-select: none;
}
.pull-arrow { transition: transform .18s ease; }
.pull-arrow.up { transform: rotate(180deg); }
.pull-spinner {
  width: 15px;
  height: 15px;
  border: 2px solid #c8ccd4;
  border-top-color: var(--tg-blue);
  border-radius: 50%;
  animation: pullSpin .7s linear infinite;
}
@keyframes pullSpin {
  to { transform: rotate(360deg); }
}

/* ── 会话 Tab 栏 ── */
.chat-tabs {
  display: flex;
  align-items: center;
  margin: 0 12px 8px;
  background: #E8EBEE;
  border-radius: 10px;
  padding: 3px;
}
.chat-tab {
  flex: 1;
  text-align: center;
  padding: 7px 0;
  font-size: 14px;
  color: #707579;
  border-radius: 8px;
  cursor: pointer;
  transition: background .2s ease, color .2s ease, font-weight .2s ease;
  user-select: none;
}
.chat-tab.active {
  background: var(--tg-bg);
  color: var(--tg-text);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,.08);
}
/* ── 头像 + 在线圆点 ── */
.avatar-wrap { position: relative; flex-shrink: 0; display: inline-flex; align-self: center; }
.online-dot {
  position: absolute; right: -1px; bottom: -1px;
  width: 12px; height: 12px; border-radius: 50%;
  background: #C4C9CE; border: 2px solid var(--tg-bg, #fff);
  box-sizing: border-box;
}
.online-dot.on { background: #31C48D; }
  .conv-enc { font-size: 10px; color: var(--tg-blue); border: 1px solid rgba(51,144,236,.45); border-radius: 4px; padding: 0 3px; line-height: 1.5; margin-left: 4px; font-weight: 500; }
  .conv-item { position: relative; }
.conv-badge-bottom { position: absolute; bottom: 17px; right: 14px; min-width: 19px; height: 19px; padding: 0 6px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; background: #F04438; color: #fff; font-size: 11px; font-weight: 600; border-radius: 10px; line-height: 1; z-index: 2; }
  .conv-item.has-unread .conv-right { display: none; }
.conv-time-bottom { font-size: 11.5px; color: #9AA0A6; margin-right: 6px; flex-shrink: 0; }
.conv-burn-badge { position: absolute; right: -7px; top: -7px; display: inline-flex; align-items: center; height: 15px; padding: 0 5px; border-radius: 8px; background: #E07000; color: #fff; font-size: 9.5px; font-weight: 600; line-height: 1; box-shadow: 0 0 0 1.5px var(--tg-bg, #fff); }
  /* 分类标签的未读小红点：跟着文字右上角 */
  .chat-tab .tab-label { position: relative; display: inline-block; }
  .tab-dot { position: absolute; top: -2px; right: -8px; width: 6px; height: 6px; border-radius: 50%; background: #F04438; box-shadow: 0 0 0 1.5px var(--tg-bg, #fff); }
</style>
