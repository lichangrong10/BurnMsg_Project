import { createApp } from 'vue'
import App from './App.vue'
import './assets/main.css'
import './assets/tab-transition.css'
import { initLayout } from './store'

// 响应式布局：按屏幕可视宽度自动适配（App 端 / 原生 APK 强制 mobile，样式不变）
initLayout()

createApp(App).mount('#app')
