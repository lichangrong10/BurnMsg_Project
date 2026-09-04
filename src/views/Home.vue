<template>
  <div class="main-page">
    <div class="topbar">
      <div class="topbar-title">{{ state.tab === 'chats' ? '焚信' : state.tab === 'channels' ? '频道' : state.tab === 'contacts' ? '通讯录' : '我的' }}</div>
      <div style="display:flex;align-items:center;gap:2px" v-if="state.tab === 'chats'">
        <div class="topbar-icon" @click="state.showGlobalSearch = true" title="搜索消息">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        </div>
        <div class="topbar-icon" style="position:relative" @click="openAnnouncements" title="公告">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          <span v-if="state.annUnread" style="    position: absolute;
    top: 5px;
    right: 6px;
    display: inline-block !important;
    height: 7px;
    background-color: red;
    border-radius: 50%;
    width: 7px;"></span>
        </div>
      </div>
    </div>
    <div class="content-scroll tab-anim">
      <transition :name="tabTransition">
      <Chats v-if="state.tab === 'chats'" class="pad-search" />
      <Channels v-else-if="state.tab === 'channels'" class="pad-search" />
      <Contacts v-else-if="state.tab === 'contacts'" class="pad-search" />
      <Me v-else />
      </transition>
    </div>

    <!-- 搜索框悬浮：DOM 顺序放在滑动容器之后，同级层叠时后绘制，保证始终浮在切换动画之上 -->
    <div class="search-wrap" :class="{ 'search-off': state.tab === 'me' }">
      <input class="search-input" v-model.trim="state.keyword" :placeholder="state.tab === 'chats' ? '搜索联系人' : state.tab === 'channels' ? '搜索频道' : '搜索姓名 / 手机号'">
    </div>
    <!-- <div style="height: 10%;background: #E8EBEE;">

    </div> -->
    <!-- 底部 Tab -->
    <div class="tabbar">
      <div class="tab-item" :class="{ active: state.tab === 'chats' }" @click="state.tab = 'chats'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        会话<span v-if="totalUnread" class="badge tab-badge">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
      </div>
      <div class="tab-item" :class="{ active: state.tab === 'channels' }" @click="state.tab = 'channels'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
        频道
      </div>
      <div class="tab-item" :class="{ active: state.tab === 'contacts' }" @click="state.tab = 'contacts'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        通讯录
      </div>
      <div class="tab-item" :class="{ active: state.tab === 'me' }" @click="state.tab = 'me'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        我的
      </div>
    </div>
    <!-- 公告弹窗：最新未读公告自动弹出 -->
    <div v-if="state.showAnnPopup && state.annPopup" class="ann-popup-mask" @click.self="laterAnnPopup">
      <div class="ann-popup" :class="{ urgent: state.annPopup.priority === 'urgent' }">
        <div class="ann-popup-head">
          <span class="ann-popup-tag">{{ state.annPopup.priority === 'urgent' ? '紧急公告' : '公告' }}</span>
          <span class="ann-popup-time">{{ fmtDateTime(state.annPopup.created_at) }}</span>
        </div>
        <div class="ann-popup-title">{{ state.annPopup.title }}</div>
        <div class="ann-popup-body">{{ state.annPopup.content }}</div>
        <div class="ann-popup-foot">
          <button class="ann-popup-btn later" @click="laterAnnPopup">待会处理</button>
          <button class="ann-popup-btn ack" @click="ackAnnPopup">知道了</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, openAnnouncements, ackAnnPopup, laterAnnPopup } from '../store'
import { fmtDateTime } from '../utils/format'
import Chats from './Chats.vue'
import Channels from './Channels.vue'
import Contacts from './Contacts.vue'
import Me from './Me.vue'

export default {
  name: 'HomeView',
  components: { Chats, Channels, Contacts, Me },
  data() {
    return { state, tabTransition: 'tab-slide-left' }
  },
  computed: {
    totalUnread() {
      return state.convs.reduce((s, c) => s + (c.unread || 0), 0)
    }
  },
  watch: {
    // 按 tab 顺序判断滑动方向：切到更靠右的 tab 左滑入，反之右滑入
    'state.tab'(to, from) {
      const order = ['chats', 'channels', 'contacts', 'me']
      this.tabTransition = order.indexOf(to) >= order.indexOf(from) ? 'tab-slide-left' : 'tab-slide-right'
    }
  },
  methods: {
    openAnnouncements,
    ackAnnPopup,
    laterAnnPopup,
    fmtDateTime
  }
}
</script>
<style scoped>
/* ── 公告弹窗：最新未读公告自动弹出 ── */
.ann-popup-mask {
  position: fixed; inset: 0; z-index: 999;
  background: rgba(17, 24, 39, .55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  animation: ap-fade .18s ease;
}
.ann-popup {
  width: 100%; max-width: 320px; max-height: 78%;
  background: #fff; border-radius: 14px;
  display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 12px 32px rgba(0, 0, 0, .18);
  animation: ap-pop .22s cubic-bezier(.2, 1.4, .4, 1);
}
.ann-popup-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 0;
}
.ann-popup-tag {
  font-size: 12px; font-weight: 600; color: #6B7280;
  background: #F3F4F6; padding: 3px 9px; border-radius: 999px;
}
.ann-popup.urgent .ann-popup-tag { color: #E07000; background: rgba(224, 112, 0, .1); }
.ann-popup-time { font-size: 12px; color: #999DA3; }
.ann-popup-title {
  padding: 10px 16px 0;
  font-size: 16.5px; font-weight: 700; color: #111; line-height: 1.4;
}
.ann-popup-body {
  padding: 10px 16px 16px;
  font-size: 14px; color: #333; line-height: 1.6;
  overflow-y: auto; white-space: pre-wrap; word-break: break-word;
}
.ann-popup-foot {
  display: flex; gap: 10px; padding: 0 16px 16px;
}
.ann-popup-btn {
  flex: 1; height: 42px; border: none; border-radius: 10px;
  font-size: 15px; font-weight: 600; cursor: pointer;
}
.ann-popup-btn.later { background: #F1F3F5; color: #555; }
.ann-popup-btn.later:active { background: #E5E7EB; }
.ann-popup-btn.ack { background: var(--tg-blue, #3390EC); color: #fff; }
.ann-popup-btn.ack:active { background: #2E8BD6; }
@keyframes ap-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes ap-pop { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }
</style>
