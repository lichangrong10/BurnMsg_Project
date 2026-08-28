<template>
  <div>
    <div class="profile-card">
      <div class="avatar-editable" @click="pickAvatar" title="更换头像">
        <div class="avatar" :style="{ width: '64px', height: '64px', fontSize: '24px', background: avatarColor(state.me.display_name) }"><img v-if="avatarSrc(state.me)" :src="avatarSrc(state.me)" alt=""><template v-else>{{ (state.me.display_name || '?')[0] }}</template></div>
        <div class="avatar-camera"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div>
      </div>
      <input ref="avatarFile" type="file" accept="image/*" style="display:none" @change="onAvatarPick">
      <div>
        <div class="profile-name">{{ state.me.display_name }}</div>
        <div class="profile-sub">{{ state.me.phone }}<template v-if="state.me.department"> · {{ state.me.department }}</template></div>
        <div class="profile-sub" v-if="state.me.signature">{{ state.me.signature }}</div>
      </div>
    </div>
    <div class="group-gap"></div>
    <div class="cell-group">
      <div class="cell" @click="openEditProfile">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span class="cell-label">编辑资料</span><span class="cell-value">›</span>
      </div>
      <div class="cell" @click="openDevices">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        <span class="cell-label">已登录设备</span><span class="cell-value">›</span>
      </div>
      <div class="cell" @click="showPwd = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span class="cell-label">修改密码</span><span class="cell-value">›</span>
      </div>
      <div class="cell" @click="state.showServerDialog = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
        <span class="cell-label">后端地址</span><span class="cell-value" style="max-width:55%;overflow:hidden;text-overflow:ellipsis">{{ state.baseURL.replace('http://', '') }}</span>
      </div>
      <div class="cell" @click="openFeedback">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span class="cell-label">意见反馈</span><span class="cell-value">›</span>
      </div>
      <div class="cell" v-if="state.me.role === 'admin'" @click="state.showAdmin = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 2 2 4-4"/></svg>
        <span class="cell-label">账号管理</span><span class="cell-value">›</span>
      </div>
    </div>
    <div class="group-gap"></div>
    <div class="cell-group">
      <div class="cell danger" @click="showLogout = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#E53935" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>
        <span class="cell-label">退出登录</span>
      </div>
    </div>
    <div style="text-align:center;color:#707579;font-size:12px;padding:18px 0">焚信 BurnMsg · v1.0{{ state.demoMode ? ' · 演示模式' : '' }}</div>

    <!-- ═══════ 设备管理 ═══════ -->
    <div v-if="showDevices" class="overlay" @click.self="showDevices = false">
      <div class="sheet">
        <div class="sheet-title">已登录设备 · 点击可将设备强制下线</div>
        <div style="overflow-y:auto">
          <div v-for="d in devices" :key="d.id" class="cell" style="border-bottom:1px solid var(--tg-border)" @click="confirmOffline(d)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
            <span class="cell-label">{{ d.device_name }}<br><small style="color:#707579">{{ d.device_type }} · {{ d.is_online ? '在线' : '离线' }}</small></span>
            <span class="cell-value" style="color:#E53935">下线</span>
          </div>
          <div v-if="!devices.length" class="sheet-item" style="color:#707579">暂无设备记录</div>
        </div>
        <div class="sheet-item sheet-cancel" @click="showDevices = false">关闭</div>
      </div>
    </div>

    <!-- ═══════ 编辑资料 ═══════ -->
    <div v-if="showEditProfile" class="dialog-overlay" @click.self="showEditProfile = false">
      <div class="dialog">
        <div class="dialog-title">编辑资料</div>
        <div class="dialog-body" style="display:flex;flex-direction:column;gap:10px">
          <input class="input" v-model.trim="profileForm.display_name" placeholder="昵称" maxlength="100">
          <input class="input" v-model.trim="profileForm.signature" placeholder="签名" maxlength="200">
        </div>
        <div class="dialog-actions">
          <button class="btn-text" @click="showEditProfile = false">取消</button>
          <button class="btn-text" style="font-weight:600" @click="saveProfile">保存</button>
        </div>
      </div>
    </div>

    <!-- ═══════ 修改密码 ═══════ -->
    <div v-if="showPwd" class="dialog-overlay" @click.self="showPwd = false">
      <div class="dialog">
        <div class="dialog-title">修改密码</div>
        <div class="dialog-body" style="display:flex;flex-direction:column;gap:10px">
          <input class="input" v-model="state.pwdForm.old" type="password" placeholder="当前密码">
          <input class="input" v-model="state.pwdForm.n1" type="password" placeholder="新密码（≥8 位）">
          <input class="input" v-model="state.pwdForm.n2" type="password" placeholder="确认新密码">
          <div class="auth-error" style="text-align:left">{{ state.pwdErr }}</div>
        </div>
        <div class="dialog-actions">
          <button class="btn-text" @click="showPwd = false">取消</button>
          <button class="btn-text" style="font-weight:600" @click="submitPwd">确认</button>
        </div>
      </div>
    </div>

    <!-- ═══════ 退出确认 ═══════ -->
    <div v-if="showLogout" class="dialog-overlay" @click.self="showLogout = false">
      <div class="dialog">
        <div class="dialog-title">退出登录</div>
        <div class="dialog-body">确定要退出当前账号吗？</div>
        <div class="dialog-actions">
          <button class="btn-text" @click="showLogout = false">取消</button>
          <button class="btn-text" style="font-weight:600;color:#E53935" @click="doLogout">退出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, logout, changePassword, updateProfile, changeMyAvatar, showToast, asArray, openFeedback } from '../store'
import { api } from '../api'
import { avatarColor, avatarSrc } from '../utils/format'

export default {
  name: 'MeView',
  data() {
    return {
      state,
      devices: [],
      showDevices: false,
      showEditProfile: false,
      profileForm: { display_name: '', signature: '' },
      showPwd: false,
      showLogout: false
    }
  },
  methods: {
    avatarColor,
    avatarSrc,
    openFeedback,
    async openDevices() {
      this.showDevices = true
      this.devices = []
      if (state.demoMode) {
        this.devices = [{ id: '1', device_name: 'Android App（本机）', device_type: 'mobile', is_online: true }]
        return
      }
      try {
        this.devices = asArray(await api.getDevices())
      } catch (e) {
        showToast(e.message)
      }
    },
    async confirmOffline(d) {
      if (state.demoMode) {
        this.devices = this.devices.filter(x => x.id !== d.id)
        showToast('已下线（模拟）')
        return
      }
      try {
        await api.offlineDevice(d.id)
        this.devices = this.devices.filter(x => x.id !== d.id)
        showToast('该设备已强制下线')
      } catch (e) {
        showToast(e.message)
      }
    },
    pickAvatar() {
      this.$refs.avatarFile && this.$refs.avatarFile.click()
    },
    async onAvatarPick(e) {
      const file = e.target.files && e.target.files[0]
      e.target.value = ''
      if (!file) return
      await changeMyAvatar(file)
    },
    openEditProfile() {
      this.profileForm = { display_name: state.me.display_name || '', signature: state.me.signature || '' }
      this.showEditProfile = true
    },
    async saveProfile() {
      if (!this.profileForm.display_name) { showToast('昵称不能为空'); return }
      const ok = await updateProfile(this.profileForm)
      if (ok) this.showEditProfile = false
    },
    async submitPwd() {
      const ok = await changePassword()
      if (ok) this.showPwd = false
    },
    doLogout() {
      this.showLogout = false
      logout()
    }
  }
}
</script>
<style scoped>
.avatar-editable { position: relative; cursor: pointer; display: inline-block; }
.avatar-camera { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; background: var(--tg-blue); border: 2px solid #fff; display: flex; align-items: center; justify-content: center; }
</style>