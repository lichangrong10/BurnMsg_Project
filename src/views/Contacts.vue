<template>
  <div>
    <div class="contact-item" @click="openCreateGroup(false)">
      <div class="avatar" style="width:46px;height:46px;background:rgba(0,0,0,.06);display:flex;align-items:center;justify-content:center">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      </div>
      <div class="contact-main"><div class="contact-name" style="color:var(--tg-blue)">发起群聊 / 频道</div></div>
    </div>
    <div v-if="!filteredContacts.length" class="empty-state"><div>未找到联系人</div></div>
    <template v-for="g in groupedContacts" :key="g.dept">
      <div class="section-header">{{ g.dept }}</div>
      <div v-for="u in g.list" :key="u.id" class="contact-item" @click="startChatWith(u)">
        <div class="avatar" :style="{ width: '46px', height: '46px', fontSize: '17px', background: avatarColor(u.display_name) }"><img v-if="avatarSrc(u)" :src="avatarSrc(u)" alt=""><template v-else>{{ (u.display_name || '?')[0] }}</template></div>
        <div class="contact-main">
          <div class="contact-name">{{ u.display_name }}</div>
          <div class="contact-sub">{{ u.phone }}<template v-if="u.signature"> · {{ u.signature }}</template></div>
        </div>
      </div>
    </template>
  </div>
</template>

<script>
import { state, startChatWith, openCreateGroup } from '../store'
import { avatarColor, avatarSrc } from '../utils/format'

export default {
  name: 'ContactsView',
  data() {
    return { state }
  },
  computed: {
    filteredContacts() {
      const k = state.keyword.toLowerCase()
      const list = Array.isArray(state.contacts) ? state.contacts : []
      return list.filter(u => !k || (u.display_name || '').toLowerCase().includes(k) || (u.phone || '').includes(k))
    },
    groupedContacts() {
      const map = {}
      this.filteredContacts.forEach(u => {
        const d = u.department || '其他'
        ;(map[d] = map[d] || []).push(u)
      })
      return Object.keys(map).sort().map(dept => ({ dept, list: map[dept] }))
    }
  },
  methods: {
    openCreateGroup,
    startChatWith,
    avatarColor,
    avatarSrc
  }
}
</script>
