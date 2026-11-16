import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'
import './assets/tab-transition.css'
import { initLayout } from './store'

/**
 * 构建戳：排查时在控制台执行 __appBuild 就能确认手机上跑的是哪一次打包，
 * 免得再拿旧包当新包查（每次发测试包前手动改这个字符串）。
 */
const APP_BUILD = '2026-11-16 callui-3 (no-alert)'
try {
  window.__appBuild = APP_BUILD
  console.log('[焚信] build:', APP_BUILD)
} catch (e) { /* 忽略 */ }

// 响应式布局：按屏幕可视宽度自动适配（App 端 / 原生 APK 强制 mobile，样式不变）
initLayout()

createApp(App).mount('#app')
