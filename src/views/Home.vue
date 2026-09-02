<template>
  <div class="main-page">
    <div class="topbar">
      <div class="topbar-title" :class="{ 'with-notice': state.tab === 'chats' && state.urgentBanner }">{{ state.tab === 'chats' ? '焚信' : state.tab === 'contacts' ? '通讯录' : '我的' }}</div>
      <div v-if="state.tab === 'chats' && state.urgentBanner" class="notice-bar" :class="{ 'is-normal': state.urgentBanner.priority !== 'urgent' }" @click="openUrgentBanner">
        <svg class="nb-icon" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5 6 9H2v6h4l5 4V5Z"/></svg>
        <svg class="nb-wave" width="16" height="14" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 4.5c3.2 2.3 3.2 4.7 0 7"/><path d="M4 1.5c5.8 4.2 5.8 8.8 0 13"/></svg>
        <span class="nb-comma">,</span>
        <span class="nb-text">{{ state.urgentBanner.title }}</span>
        <svg class="nb-arrow" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
      </div>
      <div style="display:flex;align-items:center;gap:2px" v-if="state.tab === 'chats'">
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
    <div class="search-wrap" v-if="state.tab !== 'me'">
      <input class="search-input" v-model.trim="state.keyword" :placeholder="state.tab === 'chats' ? '搜索' : state.tab === 'channels' ? '搜索频道' : '搜索姓名 / 手机号'">
    </div>

    <div class="content-scroll tab-anim">
      <transition :name="tabTransition">
      <Chats v-if="state.tab === 'chats'" class="pad-search" />
      <Channels v-else-if="state.tab === 'channels'" class="pad-search" />
      <Contacts v-else-if="state.tab === 'contacts'" class="pad-search" />
      <Me v-else />
      </transition>
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
  </div>
</template>

<script>
import { state, openAnnouncements, openUrgentBanner } from '../store'
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
    openUrgentBanner
  }
}
</script>
<style scoped>
/* ── 首页公告横幅：极简复古（黑边 + 暗豆沙紫底 + 亮红前景）── */
.topbar-title.with-notice { flex: 0 0 auto; white-space: nowrap; }
.notice-bar {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 9px;
  background: #6E5A63;
  border: 1px solid #000;
  border-radius: 2px;
  color: #FF3B30;
  cursor: pointer;
  overflow: hidden;
}
.notice-bar.is-normal { background: #DCF0E3; color: #2E9E50; }
.nb-icon { flex-shrink: 0; }
.nb-wave { flex-shrink: 0; }
.nb-comma { flex-shrink: 0; font-size: 15px; font-weight: 700; line-height: 1; transform: translateY(-1px); }
.nb-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nb-arrow { flex-shrink: 0; }
</style>
