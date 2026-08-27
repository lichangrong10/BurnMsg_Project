<template>
  <div class="chat-page" style="background: var(--tg-gray-bg)">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showChatInfo = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">聊天信息</div>
      </div>
    </div>

    <div style="flex:1;overflow-y:auto" v-if="state.chat">
      <!-- ═══ 资料卡 ═══ -->
      <div class="info-card">
        <div class="avatar-editable" :class="{ dim: !(isGroup && canManage) }" @click="pickGroupAvatar" :title="isGroup && canManage ? '更换群头像' : ''">
          <div class="avatar" :style="{ width: '72px', height: '72px', fontSize: '28px', background: avatarColor(title) }"><img v-if="cardAvatar" :src="cardAvatar" alt=""><template v-else>{{ (title || '?')[0] }}</template></div>
          <div v-if="isGroup && canManage" class="avatar-camera"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
        </div>
        <input ref="groupAvatarFile" type="file" accept="image/*" style="display:none" @change="onGroupAvatarPick">
        <div class="info-name">{{ title }}</div>
        <div class="info-sub" v-if="isGroup">{{ memberList.length || state.chat.member_count }} 位成员</div>
        <div class="info-sub" v-else>{{ state.chat.other_user && state.chat.other_user.phone }}</div>
        <div class="info-sub" v-if="!isGroup && state.chat.other_user && state.chat.other_user.signature">{{ state.chat.other_user.signature }}</div>
        <div class="info-sub" v-if="isGroup && state.chat.description" style="margin-top:4px">{{ state.chat.description }}</div>
        <button v-if="isGroup && canManage" class="btn-text" style="margin-top:8px" @click="openEdit">编辑资料</button>
      </div>

      <!-- ═══ 群成员 ═══ -->
      <template v-if="isGroup">
        <div class="section-header">成员列表</div>
        <div class="member-list">
          <div v-if="canManage" class="contact-item" @click="showAdd = true">
            <div class="avatar add-avatar">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
            </div>
            <div class="contact-main"><div class="contact-name" style="color:var(--tg-blue)">添加成员</div></div>
          </div>
          <div v-for="m in memberList" :key="uidOf(m)" class="contact-item" @click="onMemberTap(m)">
            <div class="avatar" :style="{ width: '42px', height: '42px', fontSize: '15px', background: avatarColor(nameOf(m)) }"><img v-if="memberAvatar(m)" :src="memberAvatar(m)" alt=""><template v-else>{{ (nameOf(m) || '?')[0] }}</template></div>
            <div class="contact-main">
              <div class="contact-name">
                {{ nameOf(m) }}<span v-if="uidOf(m) === state.me.id" style="color:var(--tg-text-secondary);font-weight:400">（我）</span>
              </div>
            </div>
            <span v-if="m.role === 'owner'" class="role-tag owner">群主</span>
            <span v-else-if="m.role === 'admin'" class="role-tag">管理员</span>
          </div>
          <div v-if="!memberList.length" class="empty-state"><div>成员加载中…</div></div>
        </div>

        <div style="height:14px"></div>
        <div class="cell-group">
          <div class="cell danger" @click="confirmLeave = true">
            <span class="cell-label">{{ state.chat.is_channel ? '退出频道' : '退出群组' }}</span>
          </div>
        </div>
        <div style="height:24px"></div>
      </template>
    </div>

    <!-- ═══ 编辑群资料 ═══ -->
    <div v-if="showEdit" class="dialog-overlay" @click.self="showEdit = false">
      <div class="dialog">
        <div class="dialog-title">编辑群资料</div>
        <div class="dialog-body" style="display:flex;flex-direction:column;gap:10px">
          <input class="input" v-model.trim="editName" placeholder="名称" maxlength="200">
          <input class="input" v-model.trim="editDesc" placeholder="简介（可选）" maxlength="500">
        </div>
        <div class="dialog-actions">
          <button class="btn-text" @click="showEdit = false">取消</button>
          <button class="btn-text" style="font-weight:600" @click="saveEdit">保存</button>
        </div>
      </div>
    </div>

    <!-- ═══ 添加成员 ═══ -->
    <div v-if="showAdd" class="overlay" @click.self="showAdd = false">
      <div class="sheet">
        <div class="sheet-title">添加成员（已选 {{ addIds.length }} 人）</div>
        <div style="overflow-y:auto">
          <div v-if="!addableContacts.length" class="sheet-item" style="color:var(--tg-text-secondary)">通讯录中没有更多可添加的人</div>
          <div v-for="u in addableContacts" :key="u.id" class="contact-item" @click="toggleAdd(u.id)">
            <div class="avatar" :style="{ width: '38px', height: '38px', fontSize: '14px', background: avatarColor(u.display_name) }">{{ (u.display_name || '?')[0] }}</div>
            <div class="contact-main"><div class="contact-name" style="font-size:15px">{{ u.display_name }}</div></div>
            <div class="check-circle" :class="{ on: addIds.includes(u.id) }">
              <svg v-if="addIds.includes(u.id)" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
          </div>
        </div>
        <div class="sheet-item" style="font-weight:600" :style="{ opacity: addIds.length ? 1 : .4 }" @click="doAdd">添加</div>
        <div class="sheet-item sheet-cancel" @click="showAdd = false">取消</div>
      </div>
    </div>

    <!-- ═══ 成员操作菜单 ═══ -->
    <div v-if="memberAction" class="overlay" @click.self="memberAction = null">
      <div class="sheet">
        <div class="sheet-title">{{ nameOf(memberAction) }}</div>
        <div v-if="canSetRole && memberAction.role !== 'admin'" class="sheet-item" @click="doSetRole('admin')">设为管理员</div>
        <div v-if="canSetRole && memberAction.role === 'admin'" class="sheet-item" @click="doSetRole('member')">取消管理员</div>
        <div v-if="canRemoveTarget" class="sheet-item danger" @click="doRemove">移出{{ state.chat.is_channel ? '频道' : '群组' }}</div>
        <div class="sheet-item sheet-cancel" @click="memberAction = null">取消</div>
      </div>
    </div>

    <!-- ═══ 退群确认 ═══ -->
    <div v-if="confirmLeave" class="dialog-overlay" @click.self="confirmLeave = false">
      <div class="dialog">
        <div class="dialog-title">{{ state.chat && state.chat.is_channel ? '退出频道' : '退出群组' }}</div>
        <div class="dialog-body">确定要退出「{{ title }}」吗？</div>
        <div class="dialog-actions">
          <button class="btn-text" @click="confirmLeave = false">取消</button>
          <button class="btn-text" style="font-weight:600;color:#E53935" @click="doLeave">退出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, myChatRole, renameGroup, addMembers, removeMember, setMemberRole, changeGroupAvatar } from '../store'
import { avatarColor, avatarSrc, convAvatar, memberName, memberUid, memberAvatar } from '../utils/format'

export default {
  name: 'ChatInfo',
  data() {
    return {
      state,
      showEdit: false,
      editName: '',
      editDesc: '',
      showAdd: false,
      addIds: [],
      memberAction: null,
      confirmLeave: false
    }
  },
  computed: {
    isGroup() {
      return state.chat && state.chat.type !== 'private'
    },
    title() {
      const c = state.chat
      if (!c) return ''
      return c.type === 'private' ? (c.other_user ? c.other_user.display_name : '私聊') : (c.name || '群聊')
    },
    cardAvatar() {
      return convAvatar(state.chat)
    },
    memberList() {
      return Array.isArray(state.groupMembers) ? state.groupMembers : []
    },
    myRole() {
      return myChatRole()
    },
    canManage() {
      return this.myRole === 'owner' || this.myRole === 'admin'
    },
    canSetRole() {
      return this.myRole === 'owner' && this.memberAction && this.uidOf(this.memberAction) !== state.me.id
    },
    canRemoveTarget() {
      if (!this.memberAction) return false
      if (this.uidOf(this.memberAction) === state.me.id) return false
      if (this.memberAction.role === 'owner') return false
      if (this.myRole === 'owner') return true
      return this.myRole === 'admin' && this.memberAction.role === 'member'
    },
    addableContacts() {
      const inGroup = this.memberList.map(m => this.uidOf(m))
      const list = Array.isArray(state.contacts) ? state.contacts : []
      return list.filter(u => !inGroup.includes(u.id))
    }
  },
  methods: {
    avatarColor,
    avatarSrc,
    memberAvatar,
    uidOf: memberUid,
    nameOf: memberName,
    pickGroupAvatar() {
      if (!(this.isGroup && this.canManage)) return
      this.$refs.groupAvatarFile && this.$refs.groupAvatarFile.click()
    },
    async onGroupAvatarPick(e) {
      const file = e.target.files && e.target.files[0]
      e.target.value = ''
      if (!file) return
      await changeGroupAvatar(file)
    },
    openEdit() {
      this.editName = state.chat.name || ''
      this.editDesc = state.chat.description || ''
      this.showEdit = true
    },
    async saveEdit() {
      if (!this.editName) return
      const ok = await renameGroup(this.editName, this.editDesc)
      if (ok) this.showEdit = false
    },
    toggleAdd(id) {
      const i = this.addIds.indexOf(id)
      if (i >= 0) this.addIds.splice(i, 1)
      else this.addIds.push(id)
    },
    async doAdd() {
      if (!this.addIds.length) return
      const ok = await addMembers(this.addIds.slice())
      if (ok) { this.showAdd = false; this.addIds = [] }
    },
    onMemberTap(m) {
      if (this.uidOf(m) === state.me.id) return // 自己用底部退群按钮
      if (this.canSetRole || (this.myRole === 'admin' && m.role === 'member') || (this.myRole === 'owner' && m.role !== 'owner')) {
        this.memberAction = m
      }
    },
    async doSetRole(role) {
      const m = this.memberAction
      this.memberAction = null
      await setMemberRole(this.uidOf(m), role)
    },
    async doRemove() {
      const m = this.memberAction
      this.memberAction = null
      await removeMember(this.uidOf(m))
    },
    async doLeave() {
      this.confirmLeave = false
      await removeMember(state.me.id)
    }
  }
}
</script>

<style scoped>
.info-card { background: var(--tg-bg); padding: 24px 16px 18px; display: flex; flex-direction: column; align-items: center; }
.info-name { font-size: 19px; font-weight: 600; margin-top: 12px; }
.info-sub { font-size: 14px; color: var(--tg-text-secondary); margin-top: 3px; }
.member-list { background: var(--tg-bg); }
.add-avatar { width: 42px; height: 42px; background: rgba(0,0,0,.06); display: flex; align-items: center; justify-content: center; }
.role-tag { font-size: 11.5px; color: var(--tg-blue); background: rgba(0,0,0,.07); padding: 2px 8px; border-radius: 9px; margin-right: 8px; flex-shrink: 0; }
.role-tag.owner { color: #fff; background: var(--tg-blue); }
.check-circle { width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--tg-border); margin-right: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.check-circle.on { background: var(--tg-blue); border-color: var(--tg-blue); }
</style>
<style scoped>
.avatar-editable { position: relative; cursor: pointer; display: inline-block; }
.avatar-editable.dim { cursor: default; }
.avatar-camera { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; background: var(--tg-blue); border: 2px solid var(--tg-bg); display: flex; align-items: center; justify-content: center; }
</style>