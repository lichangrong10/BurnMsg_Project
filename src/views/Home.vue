<template>
  <div class="main-page">
    <div class="topbar">
      <div class="topbar-title">{{ state.tab === 'chats' ? '焚信' : state.tab === 'channels' ? '频道' : state.tab === 'contacts' ? '通讯录' : '我的' }}</div>
      <!-- 紧急公告小条：相对手机屏幕居中，点击查看详情卡片，× 掉不再显示 -->
      <div v-if="state.tab === 'chats' && state.urgentBanner" class="urgent-chip" @click="openUrgentBanner">
        <svg class="uc-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 21h14"/><path d="M12 2v1"/><path d="m4.2 4.2.7.7"/><path d="m19.8 4.2-.7.7"/><path d="M2 13h1"/><path d="M21 13h1"/></svg>
        <span class="uc-text">【紧急】{{ state.urgentBanner.title }}</span>
        <svg class="uc-close" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" @click.stop="dismissUrgentBanner"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </div>
      <div style="display:flex;align-items:center;gap:2px" v-if="state.tab === 'chats'">
        <div class="topbar-icon" style="position:relative" @click="openAnnouncements" title="公告">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          <span v-if="state.annUnread" class="badge" style="position:absolute;top:2px;right:0">{{ state.annUnread > 99 ? '99+' : state.annUnread }}</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:2px" v-if="state.tab === 'channels'">
        <div class="topbar-icon" @click="openCreateGroup(true)" title="创建频道">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        </div>
      </div>
    </div>
    <div class="search-wrap" v-if="state.tab !== 'me'">
      <input class="search-input" v-model.trim="state.keyword" :placeholder="state.tab === 'chats' ? '搜索' : state.tab === 'channels' ? '搜索频道' : '搜索姓名 / 手机号'">
    </div>

    <div class="content-scroll">
      <Chats v-if="state.tab === 'chats'" />
      <Channels v-else-if="state.tab === 'channels'" />
      <Contacts v-else-if="state.tab === 'contacts'" />
      <Me v-else />
    </div>

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
import { state, openAnnouncements, openUrgentBanner, dismissUrgentBanner, openCreateGroup } from '../store'
import Chats from './Chats.vue'
import Channels from './Channels.vue'
import Contacts from './Contacts.vue'
import Me from './Me.vue'

export default {
  name: 'HomeView',
  components: { Chats, Channels, Contacts, Me },
  data() {
    return { state }
  },
  computed: {
    totalUnread() {
      return state.convs.reduce((s, c) => s + (c.unread || 0), 0)
    }
  },
  methods: {
    openAnnouncements,
    openUrgentBanner,
    dismissUrgentBanner,
    openCreateGroup
  }
}
</script>
<style scoped>
/* ── 紧急公告小条：相对手机屏幕居中 ── */
.topbar { position: relative; }
.urgent-chip {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 46%;
  max-width: 220px;
  display: flex;
  align-items: center;
  gap: 5px;
  background: linear-gradient(90deg, #E53935 0%, #FF7043 100%);
  border-radius: 999px;
  padding: 6px 9px;
  color: #fff;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(229, 57, 53, .5);
  z-index: 2;
}
.uc-icon { flex-shrink: 0; }
.uc-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
}
.uc-close { flex-shrink: 0; opacity: .92; border-radius: 50%; padding: 1px; box-sizing: content-box; }
.uc-close:active { background: rgba(255, 255, 255, .28); }
</style>
