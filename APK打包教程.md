# 焚信 BurnMsg 打包 APK 教程

把本 Vue3 工程打包成 Android 安装包（APK），使用官方推荐的 **Capacitor** 方案——不需要重写代码，Web 工程直接套壳成原生 App。

---

## 一、环境准备（只需装一次）

| 软件 | 版本要求 | 下载地址 | 说明 |
|------|---------|---------|------|
| Node.js | ≥ 18 | https://nodejs.org | 你已有，跳过 |
| JDK | **17**（不要装 21，Gradle 兼容性差） | https://adoptium.net | 安装时勾选"设置 JAVA_HOME" |
| Android Studio | 最新稳定版 | https://developer.android.com/studio | 安装时保持默认勾选 Android SDK |

安装完 Android Studio 后，打开 **SDK Manager**（欢迎界面 → More Actions → SDK Manager），确认已安装：
- Android SDK Platform（API 33 或更高任意一个）
- Android SDK Build-Tools
- Android SDK Command-line Tools

然后配置环境变量（Windows：设置 → 系统 → 关于 → 高级系统设置 → 环境变量）：

```
ANDROID_HOME = C:\Users\你的用户名\AppData\Local\Android\Sdk
Path 追加：%ANDROID_HOME%\platform-tools
```

验证：新开一个终端执行 `java -version` 和 `adb --version`，都有版本号输出即 OK。

---

## 二、工程接入 Capacitor（只做一次）

在本工程根目录（`burnmsg-vue/`）打开终端：

```bash
# 1. 安装 Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. 初始化（交互式提问，按下面回答）
npx cap init
#   Name of your app?        → 焚信
#   App ID (包名)?           → com.burnmsg.app      ← 全小写，格式 com.xxx.xxx
#   Web asset directory?     → dist                 ← 必须填 dist！
```

执行完会生成 `capacitor.config.ts`，确认里面 `webDir: 'dist'`。

```bash
# 3. 构建 Web 产物
npm run build

# 4. 添加 Android 平台（会生成 android/ 原生工程目录）
npx cap add android
```

---

## 三、关键配置：让 App 能连上后端

APK 里**没有 Vite 开发代理**，必须注意这两点：

### 1. 后端地址要用完整地址
登录页的"后端地址"输入框必须填完整地址，例如：
```
http://192.168.9.123:9091/api/v1
```
不能填 `/api/v1`（那是开发时走 vite proxy 的写法）。

### 2. 允许 HTTP 明文请求（重要！）
Android 9 以上默认拦截 http（非 https）请求，后端是 http 的话 App 会全部请求失败。

打开 `android/app/src/main/AndroidManifest.xml`，在 `<application>` 标签上加一个属性：

```xml
<application
    android:usesCleartextTraffic="true"
    ... >
```

---

## 四、构建 APK

### 方式 A：Android Studio 图形界面（推荐新手）

```bash
# 每次改了前端代码后，都要执行这两步同步到原生工程
npm run build
npx cap sync

# 用 Android Studio 打开原生工程
npx cap open android
```

Android Studio 打开后：
1. 等右下角 Gradle 同步完成（第一次要下载依赖，可能 10~30 分钟，耐心等）
2. 菜单栏 **Build → Build Bundle(s) / APK(s) → Build APK(s)**
3. 完成后右下角弹窗点 **locate**，APK 在：
   `android/app/build/outputs/apk/debug/app-debug.apk`
4. 把这个 apk 发到手机就能安装（手机需允许"安装未知来源应用"）

### 方式 B：命令行（快）

```bash
cd android
gradlew assembleDebug
```

产物同样在 `android/app/build/outputs/apk/debug/app-debug.apk`。

---

## 五、正式发布版（可选）

debug 包可以直接用，但要上架应用市场需要 release 签名包：

```bash
# 1. 生成签名密钥（只需一次，文件和密码务必保管好，丢了永远无法更新 App）
keytool -genkey -v -keystore burnmsg.keystore -alias burnmsg -keyalg RSA -keysize 2048 -validity 36500

# 2. 把 burnmsg.keystore 放到 android/app/ 目录下
```

编辑 `android/app/build.gradle`，在 `android { }` 块内加：

```gradle
signingConfigs {
    release {
        storeFile file('burnmsg.keystore')
        storePassword '你的密钥库密码'
        keyAlias 'burnmsg'
        keyPassword '你的密钥密码'
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
    }
}
```

然后 Android Studio → **Build → Generate Signed Bundle / APK → APK → 选 burnmsg.keystore → release**，得到正式签名包。

---

## 六、改代码后的日常流程

以后每次修改前端代码，只需三步：

```bash
npm run build      # 构建 Web
npx cap sync       # 同步到 android 工程
```

然后在 Android Studio 里重新 Build APK（或命令行 `cd android && gradlew assembleDebug`）。

---

## 七、常见问题

| 问题 | 原因与解决 |
|------|-----------|
| App 打开白屏 | `capacitor.config.ts` 的 `webDir` 不是 `dist`，或没执行 `npm run build` 就 sync |
| 登录提示网络错误/请求失败 | ① 后端地址没填完整 http 地址 ② 没配 `usesCleartextTraffic="true"` ③ 手机和后端不在同一局域网 |
| Gradle 同步卡死/失败 | 国内网络问题，给 `android/gradle/wrapper/gradle-wrapper.properties` 的 distributionUrl 换成腾讯镜像：`https://mirrors.cloud.tencent.com/gradle/gradle-8.2.1-all.zip`（版本号保持与原来一致） |
| 提示找不到 JAVA_HOME | JDK 环境变量没配好，重开终端；或在 Android Studio 内 Settings → Gradle → Gradle JDK 选 17 |
| 手机连不上电脑调试 | 数据线 + 手机开开发者模式 + USB 调试；无线调试可用 `adb connect 手机IP:5555` |
| 按返回键直接退出 App | 正常现象（单页应用）。如需"返回上一页"行为，可后续加 `@capacitor/app` 插件监听返回键 |

---

## 附：iOS 说明

`npx cap add ios` 可以生成 iOS 工程，但**必须有 macOS 电脑 + Xcode + 苹果开发者账号（个人签名有效期 7 天，正式上架 $99/年）**。Windows 上无法构建 iOS 包，建议先只做 Android。
