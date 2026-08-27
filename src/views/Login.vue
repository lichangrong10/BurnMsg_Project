<template>
  <div class="auth-page">
    <div class="auth-logo">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
    </div>
    <div class="auth-title">焚信 BurnMsg</div>
    <div class="auth-sub">企业加密通讯 · 阅后即焚<br>请使用管理员开通的手机号登录</div>
    <div class="auth-form">
      <input class="input" v-model.trim="form.phone" placeholder="手机号" inputmode="numeric" maxlength="11" @keyup.enter="doLogin">
      <input class="input" v-model="form.password" type="password" placeholder="密码" @keyup.enter="doLogin">
      <div class="auth-error">{{ err }}</div>
      <button class="btn" :disabled="loading" @click="doLogin">
        <span v-if="loading" class="spinner"></span><span v-else>登 录</span>
      </button>
      <div class="auth-link"><button class="btn-text" @click="enterDemo">后端未就绪？进入演示模式 →</button></div>
    </div>
    <div class="server-addr" @click="state.showServerDialog = true">后端地址：{{ state.baseURL }} ✎</div>
  </div>
</template>

<script>
import { state, login, enterDemo } from '../store'

export default {
  name: 'LoginView',
  data() {
    return {
      state,
      form: { phone: '', password: '' },
      err: '',
      loading: false
    }
  },
  methods: {
    enterDemo,
    async doLogin() {
      this.err = ''
      if (!/^1\d{10}$/.test(this.form.phone)) { this.err = '请输入 11 位手机号'; return }
      if (!this.form.password) { this.err = '请输入密码'; return }
      this.loading = true
      try {
        await login(this.form.phone, this.form.password)
      } catch (e) {
        this.err = e.message
      } finally {
        this.loading = false
      }
    }
  }
}
</script>
