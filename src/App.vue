<template>
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

  <!-- ═══════ 后端地址设置（登录页 / 我的 共用） ═══════ -->
  <div v-if="state.showServerDialog" class="dialog-overlay" @click.self="state.showServerDialog = false">
    <div class="dialog">
      <div class="dialog-title">后端地址</div>
      <div class="dialog-body">
        <input class="input" v-model.trim="serverInput" placeholder="http://192.168.9.253:9091/api/v1">
        <div style="font-size:12px;margin-top:8px;line-height:1.5">
          打包 APK 后 WebView 直连无跨域限制；浏览器调试可填 <b>/api/v1</b> 走 vite 开发代理，或确保后端已开启 CORS。
        </div>
      </div>
      <div class="dialog-actions">
        <button class="btn-text" :disabled="testing" @click="testConn">{{ testing ? '测试中…' : '测试连接' }}</button>
        <button class="btn-text" @click="state.showServerDialog = false">取消</button>
        <button class="btn-text" style="font-weight:600" @click="save">保存</button>
      </div>
    </div>
  </div>

  <!-- 全局 Toast -->
  <div v-if="state.toast" class="toast">{{ state.toast }}</div>

  <!-- ═══════ App 版本更新弹窗 ═══════ -->
  <div v-if="updateInfo" class="dialog-overlay" :style="{zIndex:200}" @click.self="!updateInfo.force && dismissUpdate()">
    <div class="dialog" style="max-width:340px">
      <div class="dialog-title" style="display:flex;align-items:center;gap:8px">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tg-blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
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
      <div class="dialog-actions">
        <button v-if="!updateInfo.force" class="btn-text" :disabled="updateDownloading" @click="dismissUpdate">{{ updateDownloading ? '下载中…' : '暂不更新' }}</button>
        <button class="btn-text" style="font-weight:600" :disabled="updateDownloading" @click="doUpdate">{{ updateDownloading ? '下载中…' : '立即更新' }}</button>
      </div>
    </div>
  </div>

  <!-- TOFU 公钥变更告警横幅（全局，覆盖在任意页面上方） -->
  <div v-if="state.tofuAlerts.length" class="tofu-banners">
    <div v-for="a in state.tofuAlerts" :key="a.user_id" class="tofu-banner">
      <span class="tofu-banner-text"><svg class="tofu-warn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>「{{ a.name }}」的安全密钥已变更（可能是对方换了手机/重装，也可能是密钥被替换）</span>
      <button class="tofu-btn" @click="confirmTofuKey(a.user_id)">确认信任新密钥</button>
      <button class="tofu-btn ghost" @click="dismissTofuAlert(a.user_id)">稍后处理</button>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import { state, saveServer, forceLogout, bootstrap, startTimers, stopTimers, showToast, confirmTofuKey, dismissTofuAlert } from './store'
import { storage } from './utils/storage'
import { onWs, WS_EVENTS } from './utils/ws'
import { setupBackHandler } from './utils/back'
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

const DEVICE_TYPE_TEXT = { web: '网页版', mobile: '手机版', desktop: '桌面版' }

export default {
  name: 'App',
  components: { LoginView, ChangePwdView, HomeView, ChatRoom, CreateGroup, ChatInfo, AdminView, AnnouncementsView, FeedbackView },
  data() {
    return {
      state,
      serverInput: state.baseURL,
      testing: false,
      updateInfo: null,
      updateDownloading: false,
      updateProgress: 0
    }
  },
  mounted() {
    window.addEventListener('bm-logout', forceLogout)
    startTimers()
    setupBackHandler()
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
    confirmTofuKey,
    dismissTofuAlert,
    save() {
      if (saveServer(this.serverInput)) state.showServerDialog = false
    },
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
    },
    /** 用弹窗中输入的地址裸调 /health（不经过 axios 实例，未保存也能测） */
    async testConn() {
      const url = (this.serverInput || '').replace(/\/+$/, '')
      if (!/^https?:\/\/.+/.test(url) && !/^\//.test(url)) {
        showToast('请先输入合法地址（http(s)://… 或 /api/v1）')
        return
      }
      this.testing = true
      try {
        await axios.get(url + '/health', { timeout: 8000 })
        showToast('连接成功 ✓')
      } catch (e) {
        const msg = e.response ? 'HTTP ' + e.response.status + '（路径可能不对）' : (e.code === 'ECONNABORTED' ? '超时' : '无法到达服务器')
        showToast('连接失败：' + msg)
      } finally {
        this.testing = false
      }
    }
  }
}
</script>
