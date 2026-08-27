<template>
  <div class="main-page">
    <div class="topbar">
      <div class="topbar-title">{{ state.tab === 'chats' ? '焚信' : state.tab === 'contacts' ? '通讯录' : '我的' }}</div>
      <div class="topbar-icon" v-if="state.tab === 'chats'" @click="state.tab = 'contacts'" title="发起聊天">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
      </div>
    </div>
    <div class="search-wrap" v-if="state.tab !== 'me'">
      <input class="search-input" v-model.trim="state.keyword" :placeholder="state.tab === 'chats' ? '搜索' : '搜索姓名 / 手机号'">
    </div>

    <div class="content-scroll">
      <Chats v-if="state.tab === 'chats'" />
      <Contacts v-else-if="state.tab === 'contacts'" />
      <Me v-else />
    </div>

    <!-- 底部 Tab -->
    <div class="tabbar">
      <div class="tab-item" :class="{ active: state.tab === 'chats' }" @click="state.tab = 'chats'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        会话<span v-if="totalUnread" class="badge tab-badge">{{ totalUnread > 99 ? '99+' : totalUnread }}</span>
      </div>
      <div class="tab-item" :class="{ active: state.tab === 'contacts' }" @click="state.tab = 'contacts'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        通讯录
      </div>
      <div class="tab-item" :class="{ active: state.tab === 'me' }" @click="state.tab = 'me'">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        我的
      </div>
    </div>
  </div>
</template>

<script>
import { state } from '../store'
import Chats from './Chats.vue'
import Contacts from './Contacts.vue'
import Me from './Me.vue'

export default {
  name: 'HomeView',
  components: { Chats, Contacts, Me },
  data() {
    return { state }
  },
  computed: {
    totalUnread() {
      return state.convs.reduce((s, c) => s + (c.unread || 0), 0)
    }
  }
}
</script>
