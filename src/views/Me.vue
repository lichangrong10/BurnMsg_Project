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
        <span class="cell-label">编辑资料</span><span class="cell-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
      <div class="cell" @click="openDevices">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/></svg>
        <span class="cell-label">已登录设备</span><span class="cell-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
      <div class="cell" @click="showPwd = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
        <span class="cell-label">修改密码</span><span class="cell-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
      <div class="cell" @click="state.showServerDialog = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>
        <span class="cell-label">后端地址</span><span class="cell-value" style="max-width:55%;overflow:hidden;text-overflow:ellipsis">{{ state.baseURL.replace('http://', '') }}</span>
      </div>
      <div class="cell" @click="openFeedback">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span class="cell-label">意见反馈</span><span class="cell-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
      <div class="cell" @click="manualCheckUpdate">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <span class="cell-label">检查更新</span>
        <span class="cell-value">
          <span v-if="updateStatus === 'checking'" style="color:var(--tg-text-secondary)">检查中…</span>
          <span v-else-if="updateStatus === 'latest'" style="color:var(--tg-green-check)">已是最新 v{{ appVersionName }}</span>
          <span v-else-if="updateStatus === 'available'" style="color:var(--tg-blue);font-weight:600" @click.stop="showUpdateDialog = true">v{{ updateInfo.version_name }} 可更新</span>
          <span v-else>v{{ appVersionName }}</span>
        </span>
      </div>
      <div class="cell" @click="showTheme = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.7l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
        <span class="cell-label">主题颜色</span>
        <span class="cell-value"><span class="theme-dot" :style="{ background: themeColor }"></span>{{ themeColor }}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
      <div class="cell" v-if="state.me.role === 'admin'" @click="state.showAdmin = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m17 8 2 2 4-4"/></svg>
        <span class="cell-label">账号管理</span><span class="cell-value"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg></span>
      </div>
    </div>
    <div class="group-gap"></div>
    <div class="cell-group">
      <div class="cell danger" @click="showLogout = true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="#E53935" stroke-width="2" stroke-linecap="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/></svg>
        <span class="cell-label">退出登录</span>
      </div>
    </div>
    <div style="text-align:center;color:#707579;font-size:12px;padding:18px 0">焚信 BurnMsg · v{{ appVersionName }}{{ state.demoMode ? ' · 演示模式' : '' }}</div>

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

    <!-- ═══════ 主题颜色 ═══════ -->
    <div v-if="showTheme" class="overlay" @click.self="showTheme = false">
      <div class="sheet">
        <div class="sheet-title">主题颜色 · 顶栏 / 按钮 / 气泡全局联动</div>
        <div class="theme-picker-body">
          <div class="theme-circle" :style="{ background: themeColor }" @click="pickThemeColor"></div>
          <div class="theme-hex">{{ themeColor }}</div>
          <div class="theme-hint">点击圆形挑选颜色，全 App 实时生效</div>
        </div>
        <input ref="colorInput" type="color" :value="themeColor.toLowerCase()" style="display:none" @input="onThemeInput">
        <div class="sheet-item sheet-cancel" @click="showTheme = false">完成</div>
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

    <!-- ═══════ 发现新版本弹窗 ═══════ -->
    <div v-if="showUpdateDialog" class="dialog-overlay" @click.self="showUpdateDialog = false">
      <div class="dialog">
        <div class="dialog-title">发现新版本 v{{ updateInfo.version_name }}</div>
        <div class="dialog-body" style="display:flex;flex-direction:column;gap:8px">
          <div v-if="updateInfo.notes" style="color:var(--tg-text-secondary);font-size:13.5px;line-height:1.6;white-space:pre-line">{{ updateInfo.notes }}</div>
          <div style="color:var(--tg-text-secondary);font-size:12px">
            <span v-if="updateInfo.file_size">安装包 {{ (updateInfo.file_size / 1048576).toFixed(1) }} MB</span>
            <span v-if="updateInfo.force" style="color:#E53935;font-weight:600;margin-left:8px">此版本为强制更新</span>
          </div>
          <div v-if="downloading" style="margin-top:4px">
            <div style="background:var(--tg-border);border-radius:4px;height:6px;overflow:hidden">
              <div :style="{ width: downloadProgress + '%', background: 'var(--tg-blue)', height: '100%', transition: 'width .3s' }"></div>
            </div>
            <div style="font-size:12px;color:var(--tg-text-secondary);margin-top:4px;text-align:center">{{ downloadProgress }}%</div>
          </div>
        </div>
        <div class="dialog-actions" v-if="!downloading">
          <button class="btn-text" @click="showUpdateDialog = false" :disabled="downloading && updateInfo.force" v-if="!updateInfo.force">稍后再说</button>
          <button class="btn-text" style="font-weight:600" @click="downloadUpdate" :disabled="downloading">立即更新</button>
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
import { state, logout, changePassword, updateProfile, changeMyAvatar, showToast, asArray, openFeedback, getThemeColor, setTheme } from '../store'
import { api } from '../api'
import { avatarColor, avatarSrc } from '../utils/format'
import { getCurrentVersionCode, checkAppUpdate, downloadAndInstallApk } from '../utils/update'

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
      showLogout: false,
      showTheme: false,
      themeColor: getThemeColor(),
      // 检查更新相关
      appVersionName: '1.0',
      updateStatus: '',          // '' | 'checking' | 'latest' | 'available'
      updateInfo: null,
      showUpdateDialog: false,
      downloading: false,
      downloadProgress: 0
    }
  },
  async mounted() {
    // 获取当前 App 版本号
    try {
      const cap = window.Capacitor
      if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
        const { App } = await import('@capacitor/app')
        const info = await App.getInfo()
        this.appVersionName = info.version || '1.0'
      }
    } catch (e) { /* 浏览器环境忽略 */ }
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
    pickThemeColor() {
      this.$refs.colorInput && this.$refs.colorInput.click()
    },
    onThemeInput(e) {
      const c = (e.target.value || '').toUpperCase()
      if (!c) return
      this.themeColor = c
      setTheme(c)
    },
    doLogout() {
      this.showLogout = false
      logout()
    },
    async manualCheckUpdate() {
      // 非原生环境提示
      const cap = window.Capacitor
      if (!cap || !cap.isNativePlatform || !cap.isNativePlatform()) {
        showToast('仅 App 端支持检查更新')
        return
      }
      this.updateStatus = 'checking'
      this.downloading = false
      this.downloadProgress = 0
      try {
        const result = await checkAppUpdate()
        if (result) {
          this.updateStatus = 'available'
          this.updateInfo = result
          this.showUpdateDialog = true
        } else {
          this.updateStatus = 'latest'
          showToast('已是最新版本')
        }
      } catch (e) {
        this.updateStatus = ''
        showToast('检查更新失败：' + (e.message || '未知错误'))
      }
    },
    async downloadUpdate() {
      if (!this.updateInfo || this.downloading) return
      this.downloading = true
      this.downloadProgress = 0
      this.showUpdateDialog = true
      try {
        await downloadAndInstallApk(this.updateInfo.apk_url, (pct) => {
          this.downloadProgress = pct
        })
      } catch (e) {
        showToast('下载失败：' + (e.message || '未知错误'))
      } finally {
        this.downloading = false
      }
    }
  }
}
</script>
<style scoped>
.avatar-editable { position: relative; cursor: pointer; display: inline-block; }
.avatar-camera { position: absolute; right: -2px; bottom: -2px; width: 22px; height: 22px; border-radius: 50%; background: var(--tg-blue); border: 2px solid #fff; display: flex; align-items: center; justify-content: center; }
.theme-dot { display: inline-block; width: 15px; height: 15px; border-radius: 50%; margin-right: 6px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.1); }
.theme-picker-body { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0 12px; }
.theme-circle { width: 92px; height: 92px; border-radius: 50%; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.2), inset 0 0 0 1px rgba(0,0,0,.1); }
.theme-circle:active { transform: scale(.93); }
.theme-hex { font-size: 16px; font-weight: 600; letter-spacing: 1px; }
.theme-hint { font-size: 12.5px; color: var(--tg-text-secondary); }
</style>
