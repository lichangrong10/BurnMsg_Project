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

  <!-- ═══════ 后端地址设置（登录页 / 我的 共用） ═══════ -->
  <div v-if="state.showServerDialog" class="dialog-overlay" @click.self="state.showServerDialog = false">
    <div class="dialog">
      <div class="dialog-title">后端地址</div>
      <div class="dialog-body">
        <input class="input" v-model.trim="serverInput" placeholder="http://192.168.9.110:9091/api/v1">
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
</template>

<script>
import axios from 'axios'
import { state, saveServer, forceLogout, bootstrap, startTimers, stopTimers, showToast } from './store'
import LoginView from './views/Login.vue'
import ChangePwdView from './views/ChangePwd.vue'
import HomeView from './views/Home.vue'
import ChatRoom from './views/ChatRoom.vue'
import CreateGroup from './views/CreateGroup.vue'
import ChatInfo from './views/ChatInfo.vue'
import AdminView from './views/Admin.vue'

export default {
  name: 'App',
  components: { LoginView, ChangePwdView, HomeView, ChatRoom, CreateGroup, ChatInfo, AdminView },
  data() {
    return {
      state,
      serverInput: state.baseURL,
      testing: false
    }
  },
  mounted() {
    window.addEventListener('bm-logout', forceLogout)
    startTimers()
    if (state.view === 'main') bootstrap()
  },
  beforeUnmount() {
    window.removeEventListener('bm-logout', forceLogout)
    stopTimers()
  },
  methods: {
    save() {
      if (saveServer(this.serverInput)) state.showServerDialog = false
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
