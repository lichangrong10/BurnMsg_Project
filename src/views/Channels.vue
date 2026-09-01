<template>
  <div @touchstart="pullStart" @touchmove="pullMove" @touchend="pullEnd" @touchcancel="pullEnd">
    <!-- 下拉刷新指示器 -->
    <div class="pull-indicator" :style="{ height: pullDist + 'px', opacity: pullOpacity }">
      <svg v-if="pullState !== 'refreshing'" class="pull-arrow" :class="{ up: pullState === 'ready' }" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      <span v-else class="pull-spinner"></span>
      <span>{{ pullText }}</span>
    </div>
    <!-- 空状态 -->
    <div v-if="!filteredChannels.length" class="empty-state ch-empty">
      <div class="empty-icon"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg></div>
      <div>暂无频道<br><small>频道适合公告、通知等单向广播场景<br>点击上方「创建频道」开始</small></div>
    </div>

    <!-- 频道列表 -->
    <template v-else>
      <div class="section-header">我的频道 · {{ filteredChannels.length }}</div>
      <div v-for="c in filteredChannels" :key="c.id" class="ch-item" @click="openChat(c)">
        <div class="ch-avatar" :style="{ background: avatarColor(convName(c)) }">
          <img v-if="convAvatar(c)" :src="convAvatar(c)" alt="">
          <template v-else>{{ convInitial(c) }}</template>
        </div>
        <div class="ch-main">
          <div class="ch-row">
            <div class="ch-name">{{ convName(c) }}</div>
            <div class="ch-time">{{ fmtTime(c.last_message_at) }}</div>
          </div>
          <div class="ch-row" style="align-items:center">
            <div class="ch-preview"><svg v-if="c.burning" class="burn-tag" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M13.5.7c-1.1 3.2 1.4 4.9 2.9 6.6 1.5 1.7 2.8 3.6 2.8 5.9a7.2 7.2 0 1 1-14.4 0c0-2.9 1.6-5 3.2-6.8.5 1.8 1.6 2.8 2.8 3.4.1-2.8-.5-5.8 2.7-9.1z"/></svg>{{ c.lastMsg || c.description || '暂无消息' }}</div>
            <span v-if="c.unread" class="badge">{{ c.unread > 99 ? '99+' : c.unread }}</span>
          </div>
          <div class="ch-meta">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span>{{ c.member_count || 0 }} 位成员</span>
            <span v-if="c.dissolved_at" class="ch-dissolved">已解散</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { state, openChat, loadConvs } from '../store'
import { avatarColor, convAvatar, convName, convInitial, fmtTime } from '../utils/format'

export default {
  name: 'ChannelsView',
  data() {
    return {
      state,
      pullDist: 0,       // 下拉距离 px
      pullState: 'idle'  // idle | pulling | ready | refreshing
    }
  },
  computed: {
    filteredChannels() {
      const k = state.keyword.toLowerCase()
      const list = Array.isArray(state.convs) ? state.convs : []
      return list
        // 真实接口会话 type 恒为 group，频道以 is_channel 区分；demo 数据 type 为 channel，两者兼容
        .filter(c => c.is_channel || c.type === 'channel')
        .filter(c => !k || convName(c).toLowerCase().includes(k))
        .sort((a, b) => (new Date(b.last_message_at || 0).getTime()) - (new Date(a.last_message_at || 0).getTime()))
    },
    pullText() {
      if (this.pullState === 'refreshing') return '刷新中…'
      return this.pullState === 'ready' ? '释放刷新' : '下拉刷新'
    },
    pullOpacity() {
      return this.pullDist > 0 ? 1 : 0
    }
  },
  methods: {
    openChat,
    avatarColor,
    convAvatar,
    convName,
    convInitial,
    fmtTime,
    // ── 下拉刷新（与会话列表同一套手势）──
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
  font-size: 12.5px;
  transition: height .18s ease, opacity .18s ease;
}
.pull-arrow.up { transform: rotate(180deg); }
.pull-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(0,0,0,.15);
  border-top-color: var(--tg-blue);
  border-radius: 50%;
  animation: ch-spin .8s linear infinite;
}
@keyframes ch-spin { to { transform: rotate(360deg); } }

/* 空状态上方有创建卡片，去掉全局 empty-state 的 100% 高度避免溢出 */
.ch-empty { height: auto; padding: 52px 40px; }

/* ── 创建频道入口卡片 ── */
.ch-create {
  margin: 10px 12px 4px;
  padding: 13px 14px;
  background: var(--tg-bg);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: transform .12s ease, box-shadow .15s ease;
}
.ch-create:active { transform: scale(.985); box-shadow: none; }
.ch-create-icon {
  width: 44px; height: 44px; border-radius: 14px; flex-shrink: 0;
  background: linear-gradient(145deg, #4EA6F5, var(--tg-blue-dark));
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4px 12px rgba(51,144,236,.32);
}
.ch-create-text { flex: 1; min-width: 0; }
.ch-create-title { font-size: 15.5px; font-weight: 600; }
.ch-create-sub { font-size: 12.5px; color: var(--tg-text-secondary); margin-top: 2px; }

/* ── 频道列表项 ── */
.ch-item {
  display: flex; align-items: center; gap: 12px;
  padding: 11px 12px;
  background: #fff;
  cursor: pointer;
  transition: background .15s;
}
.ch-item:active { background: var(--tg-gray-bg); }
.ch-avatar {
  width: 54px; height: 54px;
  border-radius: 17px; /* 圆角方形头像：与会话列表的圆形头像区分「频道」 */
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 21px; font-weight: 600;
  overflow: hidden; user-select: none;
  box-shadow: 0 2px 6px rgba(0,0,0,.1);
}
.ch-avatar img { width: 100%; height: 100%; object-fit: cover; }
.ch-main { flex: 1; min-width: 0; border-bottom: 1px solid var(--tg-border); padding: 8px 0 9px 2px; }
.ch-item:last-child .ch-main { border-bottom: none; }
.ch-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.ch-name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ch-time { font-size: 12.5px; color: var(--tg-text-secondary); flex-shrink: 0; }
.ch-preview { font-size: 14px; color: var(--tg-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; }
.ch-preview .burn-tag { color: #E07000; flex-shrink: 0; vertical-align: -1px; margin-right: 2px; }
.ch-meta {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: #9BA1A8; margin-top: 4px;
}
.ch-dissolved {
  margin-left: 6px; font-size: 11px; font-weight: 500;
  color: #E53935; background: rgba(229,57,53,.1);
  padding: 1px 7px; border-radius: 8px;
}
</style>
