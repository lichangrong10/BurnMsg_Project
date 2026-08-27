<template>
  <div class="auth-page">
    <div class="auth-logo">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    </div>
    <div class="auth-title">设置新密码</div>
    <div class="auth-sub">首次登录需修改初始密码<br>新密码至少 8 位</div>
    <div class="auth-form">
      <input class="input" v-model="state.pwdForm.old" type="password" placeholder="初始密码">
      <input class="input" v-model="state.pwdForm.n1" type="password" placeholder="新密码（≥8 位）">
      <input class="input" v-model="state.pwdForm.n2" type="password" placeholder="确认新密码" @keyup.enter="changePassword">
      <div class="auth-error">{{ state.pwdErr }}</div>
      <button class="btn" :disabled="state.pwdLoading" @click="changePassword">
        <span v-if="state.pwdLoading" class="spinner"></span><span v-else>确认修改</span>
      </button>
    </div>
  </div>
</template>

<script>
import { state, changePassword } from '../store'

export default {
  name: 'ChangePwdView',
  data() {
    return { state }
  },
  methods: {
    changePassword
  }
}
</script>
