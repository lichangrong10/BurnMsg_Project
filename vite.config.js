import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 焚信 BurnMsg 前端工程
// 开发环境跨域：把 App 内「后端地址」设置为 /api/v1，即走下方 vite 代理转发到真实后端
export default defineConfig({
  plugins: [vue()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://192.168.9.116:9091',
        changeOrigin: true,
        ws: true // 代理 WebSocket（socket.io 实时推送）
      }
    }
  },
  build: {
    outDir: 'dist'
  }
})
