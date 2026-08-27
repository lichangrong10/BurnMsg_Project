# 焚信 BurnMsg 前端工程（Vue3 + Vite）

企业加密通讯 App 移动端前端，仿 Telegram 风格，对接 NestJS 后端（JWT Bearer）。

## 技术栈

- Vue 3（Options API）+ Vite 5
- axios（token 注入 / 401 自动刷新 / 统一响应解包）
- 无 UI 框架依赖，纯手写 Telegram 风格样式（`src/assets/main.css` 设计令牌）
- 轻量全局状态 `src/store/index.js`（无 Pinia，业务动作集中管理）

## 目录结构

```
src/
├── main.js               入口
├── App.vue               根组件（视图路由 + 后端地址弹层 + Toast + 定时器挂载）
├── api/index.js          全部接口定义（按 swagger.json）
├── utils/
│   ├── request.js        ★ axios 封装：token 注入、401 单例刷新 + 请求重放
│   ├── storage.js        localStorage 持久化（token/baseURL/user/demo）
│   └── format.js         头像配色、时间格式化、阅后即焚档位等
├── store/index.js        全局状态 + 业务动作（登录/会话/消息/阅后即焚/资料）
├── mock/demo.js          演示模式 Mock 数据（对齐 SafeUser/Conversation/Message）
├── assets/main.css       Telegram 风格设计令牌与全部样式
└── views/
    ├── Login.vue         登录（含演示模式入口）
    ├── ChangePwd.vue     首次登录强制改密
    ├── Home.vue          主框架（topbar/搜索/底部 tab）
    ├── Chats.vue         会话列表
    ├── Contacts.vue      通讯录（按部门分组）
    ├── Me.vue            我的（资料/设备/改密/地址/退出）
    └── ChatRoom.vue      聊天页（气泡/阅后即焚/撤回/文件图片）
```

## 本地开发

```bash
npm install
npm run dev        # http://localhost:5173
```

- 无后端时：登录页点「进入演示模式」，Mock 数据可体验完整 UI
- 连真实后端：登录页/「我的 → 后端地址」改为 `http://192.168.9.123:9091/api/v1`
- 浏览器跨域：后端地址填 `/api/v1`，走 `vite.config.js` 里已配好的 dev 代理；或后端 `app.enableCors()`

## 打包 APK（Capacitor）

```bash
npm run build                                # 产出 dist/（依赖全部本地化，无 CDN 外联）
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init 焚信 com.company.burnmsg --web-dir=dist
npx cap add android
npx cap sync                                 # 每次 build 后同步到安卓工程
npx cap open android                         # Android Studio → Build APK
```

要求 JDK 17+ 与 Android Studio。APK WebView 直连内网后端，无跨域问题。

## 说明

- `dist/` 为已构建产物，可直接用于 Capacitor 套壳；修改源码后重新 `npm run build && npx cap sync`
- 根目录另有单文件版 `burnmsg.html`（同功能 CDN 版），仅用于免构建快速预览
- 服务端文档：接口见 swagger.json（`/api/docs`），统一响应 `{code,message,data}`，access_token 2h / refresh_token 30 天
