<template>
  <div class="chat-page ann-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showAnnouncements = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">公告中心</div>
        <div class="chat-status">{{ state.annUnread ? state.annUnread + ' 条未读' : '全部已读' }}</div>
      </div>
    </div>

    <div class="chat-body ann-body">
      <div v-if="!state.announcements.length" class="empty-state" style="margin-top:90px">
        <div class="empty-icon"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></div>
        <div>暂无公告</div>
      </div>

      <div v-for="a in state.announcements" :key="a.id"
        class="ann-item" :class="{ 'is-urgent': a.priority === 'urgent', 'is-read': a.is_read }"
        @click="openDetail(a)">
        <div class="ann-item-icon" :class="{ urgent: a.priority === 'urgent' }">
          <svg v-if="a.priority === 'urgent'" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 2v1"/><path d="m4.2 4.2.7.7"/><path d="m19.8 4.2-.7.7"/><path d="M2 13h1"/><path d="M21 13h1"/></svg>
          <svg v-else width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
        </div>
        <div class="ann-item-main">
          <div class="ann-head">
            <span class="ann-title">{{ a.title }}</span>
            <span v-if="!a.is_read" class="ann-dot"></span>
          </div>
          <div class="ann-preview">{{ a.content }}</div>
          <div class="ann-meta">
            <span v-if="a.priority === 'urgent'" class="ann-urgent">紧急</span>
            <span class="ann-time">{{ fmtDateTime(a.created_at) }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 公告详情：屏幕中央圆角卡片 -->
    <div v-if="detail" class="ann-modal-overlay" @click.self="closeDetail">
      <div class="ann-modal" :class="{ urgent: detail.priority === 'urgent' }">
        <div class="ann-modal-banner">
          <div class="ann-modal-banner-left">
            <svg v-if="detail.priority === 'urgent'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 2v1"/><path d="m4.2 4.2.7.7"/><path d="m19.8 4.2-.7.7"/><path d="M2 13h1"/><path d="M21 13h1"/></svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
            <span>{{ detail.priority === 'urgent' ? '紧急公告' : '系统公告' }}</span>
          </div>
          <svg class="ann-modal-close" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" @click="closeDetail"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </div>
        <div class="ann-modal-body">
          <div class="ann-modal-title">{{ detail.title }}</div>
          <div class="ann-modal-time">{{ fmtDateTime(detail.created_at) }}</div>
          <div class="ann-modal-content">{{ detail.content }}</div>
        </div>
        <div class="ann-modal-foot">
          <button class="ann-modal-btn" :class="{ urgent: detail.priority === 'urgent' }" @click="closeDetail">我知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, readAnnouncement } from '../store'
import { fmtDateTime } from '../utils/format'

export default {
  name: 'AnnouncementsView',
  data() {
    return {
      state,
      detail: null // 当前打开的公告详情卡片（null = 仅列表）
    }
  },
  watch: {
    // 从首页紧急横幅跳入：列表异步加载完成后自动展开该公告
    'state.announcements'(list) { this.tryFocus(list) }
  },
  mounted() {
    window.addEventListener('bm-back', this.onNativeBack)
    this.tryFocus(state.announcements)
  },
  beforeUnmount() {
    window.removeEventListener('bm-back', this.onNativeBack)
  },
  methods: {
    fmtDateTime,
    tryFocus(list) {
      if (!state.annFocusId) return
      const t = (list || []).find(a => a.id === state.annFocusId)
      if (t) {
        state.annFocusId = null
        this.openDetail(t)
      }
    },
    /** 原生返回键：详情卡片开着先关卡片，消费掉事件；否则不消费（由全局关闭本页） */
    onNativeBack(e) {
      if (this.detail) { this.closeDetail(); e.preventDefault() }
    },
    /** 点开详情卡片即标记已读（本地即时置灰 + 上报后端） */
    openDetail(a) {
      this.detail = a
      readAnnouncement(a)
    },
    closeDetail() { this.detail = null }
  }
}
</script>

<style scoped>
.ann-page { background: var(--tg-gray-bg); }
.ann-body { padding: 12px 12px 24px; }

/* ── 列表卡片 ── */
.ann-item {
  display: flex;
  gap: 11px;
  align-items: flex-start;
  background: #fff;
  border-radius: 14px;
  padding: 13px 13px 11px;
  margin-bottom: 10px;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(16, 24, 40, .06);
  border-left: 4px solid transparent;
  transition: transform .12s, box-shadow .12s;
}
.ann-item:active { transform: scale(.985); box-shadow: 0 1px 2px rgba(16, 24, 40, .04); }
.ann-item.is-urgent {
  border-left-color: var(--tg-urgent);
  background: linear-gradient(90deg, rgba(var(--tg-urgent-rgb), .05), #fff 30%);
}
.ann-item-icon {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tg-blue-tint);
  color: var(--tg-blue);
}
.ann-item-icon.urgent { background: rgba(var(--tg-urgent-rgb), .12); color: var(--tg-urgent); }
.ann-item-main { flex: 1; min-width: 0; }
.ann-head { display: flex; align-items: center; gap: 7px; }
.ann-title {
  flex: 1;
  font-size: 15.5px;
  font-weight: 600;
  color: #111;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ann-item.is-read .ann-title { color: #555; font-weight: 500; }
.ann-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: var(--tg-blue);
  flex-shrink: 0;
  box-shadow: 0 0 0 3px rgba(var(--tg-blue-rgb), .15);
}
.ann-preview {
  margin-top: 4px;
  font-size: 13.5px;
  color: #707579;
  line-height: 1.45;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.ann-meta { margin-top: 7px; display: flex; align-items: center; gap: 8px; }
.ann-urgent {
  font-size: 11px;
  font-weight: 600;
  color: var(--tg-urgent);
  background: rgba(var(--tg-urgent-rgb), .1);
  border-radius: 6px;
  padding: 1.5px 7px;
}
.ann-time { font-size: 12px; color: #999DA3; }

/* ── 详情模态卡片（屏幕中央） ── */
.ann-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  background: rgba(15, 20, 28, .48);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  animation: ann-fade .18s ease;
}
@keyframes ann-fade { from { opacity: 0; } to { opacity: 1; } }
.ann-modal {
  width: 100%;
  max-width: 340px;
  max-height: 72vh;
  background: #fff;
  border-radius: 18px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 18px 50px rgba(0, 0, 0, .28);
  animation: ann-pop .22s cubic-bezier(.2, 1.4, .4, 1);
}
@keyframes ann-pop {
  from { transform: scale(.86) translateY(14px); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.ann-modal-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  background: linear-gradient(120deg, var(--tg-blue) 0%, var(--tg-blue-light) 100%);
  color: #fff;
  flex-shrink: 0;
}
.ann-modal.urgent .ann-modal-banner { background: linear-gradient(120deg, var(--tg-urgent) 0%, var(--tg-urgent-light) 100%); }
.ann-modal-banner-left {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .5px;
}
.ann-modal-close { cursor: pointer; border-radius: 50%; padding: 3px; opacity: .92; box-sizing: content-box; }
.ann-modal-close:active { background: rgba(255, 255, 255, .22); }
.ann-modal-body { padding: 16px 18px 8px; overflow-y: auto; }
.ann-modal-title { font-size: 17.5px; font-weight: 700; color: #111; line-height: 1.4; }
.ann-modal-time { margin-top: 5px; font-size: 12.5px; color: #999DA3; }
.ann-modal-content {
  margin-top: 13px;
  font-size: 15px;
  color: #2a2a2a;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  padding-bottom: 8px;
}
.ann-modal-foot { padding: 10px 16px 16px; flex-shrink: 0; }
.ann-modal-btn {
  width: 100%;
  border: none;
  border-radius: 12px;
  padding: 11px 0;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  background: var(--tg-blue);
}
.ann-modal-btn:active { filter: brightness(.93); }
.ann-modal-btn.urgent { background: linear-gradient(90deg, var(--tg-urgent), var(--tg-urgent-light)); }
</style>
