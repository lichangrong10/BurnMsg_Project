<template>
  <div class="chat-page" style="background: var(--tg-bg)">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showCreateGroup = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">新建群组</div>
        <div class="chat-status">已选 {{ selected.length }} 位成员</div>
      </div>
      <button class="btn-text" style="color:#fff;font-weight:600;font-size:15px" :style="{ opacity: canCreate ? 1 : .5 }" @click="create">创建</button>
    </div>

    <div style="padding:14px 16px 6px">
      <input class="input" v-model.trim="name" placeholder="群组名称" maxlength="200" style="margin-top:12px">
      <input class="input" v-model.trim="description" placeholder="简介（可选）" maxlength="500" style="margin-top:10px">
      <div style="font-size:12.5px;color:var(--tg-text-secondary);margin-top:8px;line-height:1.5">群组中所有成员均可发言，创建后可在聊天信息页管理成员。</div>
    </div>

    <div class="section-header">选择成员</div>
    <div style="flex:1;overflow-y:auto">
      <div v-if="!contactList.length" class="empty-state"><div>暂无联系人<br><small>真实模式下请先确认通讯录已加载</small></div></div>
      <div v-for="u in contactList" :key="u.id" class="contact-item" @click="toggle(u.id)">
        <div class="avatar" :style="{ width: '44px', height: '44px', fontSize: '16px', background: avatarColor(u.display_name) }"><img v-if="avatarSrc(u)" :src="avatarSrc(u)" alt=""><template v-else>{{ (u.display_name || '?')[0] }}</template></div>
        <div class="contact-main">
          <div class="contact-name">{{ u.display_name }}</div>
          <div class="contact-sub">{{ u.phone }}<template v-if="u.department"> · {{ u.department }}</template></div>
        </div>
        <div class="check-circle" :class="{ on: selected.includes(u.id) }">
          <svg v-if="selected.includes(u.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, createGroupAction } from '../store'
import { avatarColor, avatarSrc } from '../utils/format'

export default {
  name: 'CreateGroup',
  data() {
    return {
      state,
      name: '',
      description: '',
      selected: []
    }
  },
  mounted() {

  },
  computed: {
    contactList() {
      return Array.isArray(state.contacts) ? state.contacts : []
    },
    canCreate() {
      return this.name.length > 0 && this.selected.length > 0
    }
  },
  methods: {
    avatarColor,
    avatarSrc,
    toggle(id) {
      const i = this.selected.indexOf(id)
      if (i >= 0) this.selected.splice(i, 1)
      else this.selected.push(id)
    },
    create() {
      if (!this.canCreate) return
      createGroupAction(this.name, this.selected.slice(), false, this.description)
    }
  }
}
</script>

<style scoped>
.seg-wrap { display: flex; background: var(--tg-gray-bg); border-radius: 10px; padding: 3px; }
.seg-item { flex: 1; text-align: center; padding: 7px 0; font-size: 14.5px; border-radius: 8px; cursor: pointer; color: var(--tg-text-secondary); }
.seg-item.on { background: var(--tg-bg); color: var(--tg-blue); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.check-circle { width: 22px; height: 22px; border-radius: 50%; border: 2px solid var(--tg-border); margin-right: 6px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.check-circle.on { background: var(--tg-blue); border-color: var(--tg-blue); }
</style>
