<template>
  <div>
    <div v-if="!filteredConvs.length" class="empty-state">
      <div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
      <div>暂无会话<br><small>从通讯录选择同事，直接发起聊天</small></div>
    </div>
    <div v-for="c in filteredConvs" :key="c.id" class="conv-item" :class="{ 'is-pinned': c.pinned }"
      @click="onClickConv(c)"
      @contextmenu.prevent="openMenu(c, $event)"
      @touchstart="touchStart($event, c)"
      @touchmove="touchMove"
      @touchend="touchEnd"
      @touchcancel="cancelLongPress">
      <div class="avatar" :style="{ width: '52px', height: '52px', fontSize: '19px', background: avatarColor(convName(c)) }"><img v-if="convAvatar(c)" :src="convAvatar(c)" alt=""><template v-else>{{ convInitial(c) }}</template></div>
      <div class="conv-main">
        <div class="conv-row">
          <div class="conv-name"><span v-if="c.pinned" class="pin-mark">📌</span>{{ convName(c) }}</div>
          <div class="conv-time">{{ fmtTime(c.last_message_at) }}</div>
        </div>
        <div class="conv-row" style="align-items:center">
          <div class="conv-preview"><span v-if="c.burning" class="burn-tag">🔥 </span>{{ c.lastMsg || '开始聊天吧' }}</div>
          <div class="conv-right">
            <span v-if="c.dissolved_at" class="type-tag" style="color:#E53935;background:rgba(229,57,53,.1)">已解散</span>
            <span v-else-if="c.unread" class="badge">{{ c.unread > 99 ? '99+' : c.unread }}</span>
            <span v-else-if="c.type === 'channel'" class="type-tag">频道</span>
            <span v-else-if="c.type === 'group'" class="type-tag">群组</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 长按 / 右键操作菜单 -->
    <div v-if="menu" class="conv-menu-overlay" @click="closeMenu" @contextmenu.prevent="closeMenu">
      <div class="conv-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
        <div class="conv-menu-item" @click="onTogglePin">{{ menu.conv.pinned ? '取消置顶' : '置顶会话' }}</div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, openChat, togglePin } from '../store'
import { avatarColor, convAvatar, convName, convInitial, fmtTime } from '../utils/format'

export default {
  name: 'ChatsView',
  data() {
    return {
      state,
      menu: null        // 长按/右键浮层：{ conv, x, y }
    }
  },
  computed: {
    filteredConvs() {
      const k = state.keyword.toLowerCase()
      const list = Array.isArray(state.convs) ? state.convs : []
      return list
        .filter(c => !k || convName(c).toLowerCase().includes(k))
        .sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1
          return (new Date(b.last_message_at || 0).getTime()) - (new Date(a.last_message_at || 0).getTime())
        })
    }
  },
  methods: {
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
    }
  }
}
</script>
