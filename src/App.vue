<template>
  <div class="app-root" :class="rootClass">
    <LoginView v-if="state.view === 'login'" />
  <ChangePwdView v-else-if="state.view === 'changePwd'" />
  <HomeView v-else />

  <!-- 聊天页覆盖层 -->
  <ChatRoom v-if="state.chat" />

  <!-- 功能覆盖层（顺序即层级，后渲染的在上） -->
  <CreateGroup v-if="state.showCreateGroup" />
  <ChatInfo v-if="state.showChatInfo && state.chat" />
  <AdminView v-if="state.showAdmin" />
  <AnnouncementsView v-if="state.showAnnouncements" />
  <FeedbackView v-if="state.showFeedback" />
  <GlobalSearch v-if="state.showGlobalSearch" />

  <!-- 全局 Toast -->
  <div v-if="state.toast" class="toast">{{ state.toast }}</div>

  <!-- ═══════ App 版本更新弹窗 ═══════ -->
  <div v-if="updateInfo" class="dialog-overlay" :style="{zIndex:200}" @click.self="!updateInfo.force && dismissUpdate()">
    <div class="dialog" style="max-width:340px">
      <div class="dialog-title" style="display:flex;align-items:center;gap:8px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 1 1-2 2H5a2 2 0 1 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        发现新版本
      </div>
      <div class="dialog-body" style="margin-bottom:4px">
        <div style="display:flex;gap:16px;margin-bottom:10px;font-size:13.5px;color:var(--tg-text-secondary)">
          <span>v{{ updateInfo.version_name }}（build {{ updateInfo.version_code }}）</span>
          <span v-if="updateInfo.force" style="color:#E53935;font-weight:600">强制更新</span>
          <span v-if="updateInfo.file_size">{{ formatSize(updateInfo.file_size) }}</span>
        </div>
        <div v-if="updateInfo.notes" style="background:var(--tg-gray-bg);border-radius:10px;padding:10px 12px;font-size:14px;color:var(--tg-text);line-height:1.6;white-space:pre-wrap;max-height:160px;overflow-y:auto">{{ updateInfo.notes }}</div>
        <div v-else style="color:var(--tg-text-secondary);font-size:13.5px">暂无更新说明</div>
      </div>
      <div v-if="updateProgress > 0 && updateProgress < 100" style="margin:8px 0 4px">
        <div style="background:var(--tg-gray-bg);border-radius:6px;height:6px;overflow:hidden">
          <div :style="{width: updateProgress + '%', height:'100%', background:'var(--tg-blue)', borderRadius:'6px', transition:'width .3s'}"></div>
        </div>
        <div style="text-align:center;font-size:12px;color:var(--tg-text-secondary);margin-top:4px">下载中 {{ updateProgress }}%</div>
      </div>
      <div class="dialog-actions" v-if="!updateDownloading">
        <button v-if="!updateInfo.force" class="btn-text" :disabled="updateDownloading" @click="dismissUpdate">{{ updateDownloading ? '' : '暂不更新' }}</button>
        <button class="btn-text" style="font-weight:600" :disabled="updateDownloading" @click="doUpdate">{{ updateDownloading ? '' : '立即更新' }}</button>
      </div>
    </div>
  </div>
  </div>

</template>

<script>
import { state, forceLogout, bootstrap, startTimers, stopTimers, showToast } from './store'
import { storage } from './utils/storage'
import { onWs, WS_EVENTS } from './utils/ws'
import { setupBackHandler } from './utils/back'
import { setupStatusBar } from './utils/statusbar'
import { checkAppUpdate, downloadAndInstallApk } from './utils/update'
import LoginView from './views/Login.vue'
import ChangePwdView from './views/ChangePwd.vue'
import HomeView from './views/Home.vue'
import ChatRoom from './views/ChatRoom.vue'
import CreateGroup from './views/CreateGroup.vue'
import ChatInfo from './views/ChatInfo.vue'
import AdminView from './views/Admin.vue'
import AnnouncementsView from './views/Announcements.vue'
import FeedbackView from './views/Feedback.vue'
import GlobalSearch from './views/GlobalSearch.vue'

const DEVICE_TYPE_TEXT = { web: '网页版', mobile: '手机版', desktop: '桌面版' }

export default {
  name: 'App',
  components: { LoginView, ChangePwdView, HomeView, ChatRoom, CreateGroup, ChatInfo, AdminView, AnnouncementsView, FeedbackView, GlobalSearch },
  data() {
    return {
      state,
      updateInfo: null,
      updateDownloading: false,
      updateProgress: 0
    }
  },
  computed: {
    // 根元素 class：标识当前视图与布局模式，供 main.css 响应式规则精确匹配
    rootClass() {
      return {
        'view-login': this.state.view === 'login',
        'view-changePwd': this.state.view === 'changePwd',
        'view-main': this.state.view === 'main',
        'layout-tablet': this.state.layout === 'tablet',
        'layout-desktop': this.state.layout === 'desktop'
      }
    }
  },
  mounted() {
    window.addEventListener('bm-logout', forceLogout)
    startTimers()
    setupBackHandler()
    setupStatusBar()
    if (state.view === 'main') bootstrap()
    this.doCheckUpdate()
    onWs(WS_EVENTS.APP_UPDATE, () => this.doCheckUpdate())

    // ═══════ 设备相关推送（后端 events.types.ts：仅真正新建设备/下线设备时推送） ═══════
    // device:added —— 同账号新设备登录。本设备自己登录不弹（后端 payload.device_id 为设备表主键，
    // 与登录时存下的 storage.deviceRowId 比对即可识别）
    onWs(WS_EVENTS.DEVICE_ADDED, p => {
      if (p && p.device_id && p.device_id === storage.deviceRowId) return
      const t = DEVICE_TYPE_TEXT[p && p.device_type] || (p && p.device_type) || '未知类型'
      showToast(`新设备登录：${(p && p.device_name) || '未知设备'}（${t}）`)
    })
    // device:removed —— 某设备被下线。本设备被下线 → 直接回登录页；其他设备被下线 → 仅提示
    onWs(WS_EVENTS.DEVICE_REMOVED, p => {
      if (p && p.device_id && p.device_id === storage.deviceRowId) { forceLogout(); return }
      showToast('你的一台设备已被下线')
    })
  },
  beforeUnmount() {
    window.removeEventListener('bm-logout', forceLogout)
    stopTimers()
  },
  methods: {
    formatSize(bytes) {
      if (!bytes) return ''
      if (bytes < 1024) return bytes + ' B'
      if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
      return (bytes / 1048576).toFixed(1) + ' MB'
    },
    async doCheckUpdate() {
      try {
        const info = await checkAppUpdate()
        if (info) this.updateInfo = info
      } catch (e) { /* silent */ }
    },
    dismissUpdate() {
      this.updateInfo = null
      this.updateProgress = 0
    },
    async doUpdate() {
      if (!this.updateInfo || this.updateDownloading) return
      this.updateDownloading = true
      this.updateProgress = 0
      try {
        const r = await downloadAndInstallApk(this.updateInfo.apk_url, p => { this.updateProgress = p })
        showToast((r && r.message) || '下载完成，正在安装…')
      } catch (e) {
        showToast('下载失败：' + (e.message || '未知错误'))
      } finally {
        this.updateDownloading = false
        this.updateProgress = 0
      }
    }
  }
}
</script>
