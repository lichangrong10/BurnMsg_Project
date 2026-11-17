<template>
  <div class="call-page" :class="['kind-' + callState.kind, { 'pip-mode': callState.inPip }]">
    <!-- 远端画面：默认主画面；和本地画面互换后变成小窗。
         语音通话时压到 1px 只让音轨继续播（不渲染占画面）。
         小窗（PiP）里强制主画面为远端，且铺满整个小窗。 -->
    <video
      ref="remoteVideo"
      class="call-surface call-remote"
      :class="{ 'as-main': callState.inPip || focus === 'remote', 'as-pip': !callState.inPip && focus === 'local', 'audio-only': callState.kind !== 'video', 'has-video': hasRemote }"
      :style="remoteStyle"
      autoplay
      playsinline
      @click="onSurfaceClick('remote')"
      @dblclick.prevent="onDblTap('remote')"
      @loadedmetadata="onRemoteMeta"
    ></video>

    <div v-if="!callState.inPip" class="call-head">
      <div class="call-peer">{{ callState.peer.name || '对方' }}</div>
      <div class="call-sub">{{ subTitle }}</div>
      <div v-if="!callState.relay && callState.phase !== 'incoming'" class="call-relay-tip">
        无通话中继 · 仅同一网络可通
      </div>
      <div v-if="isVideoCall && hasLocalVideo" class="call-hint">点小窗可互换画面 · 双击放大</div>
      <div v-if="callState.mediaWarning && callState.phase !== 'incoming'" class="call-hint warn">{{ callState.mediaWarning }}</div>
    </div>

    <!-- 小窗 + 语音：头像与计时排成一个居中竖列（不用 absolute，避免越界被裁） -->
    <div v-if="callState.inPip && callState.kind !== 'video'" class="pip-col">
      <div class="call-avatar pip" :style="{ background: avatarBg }">{{ initial }}</div>
      <div class="pip-timer">{{ subTitle }}</div>
    </div>

    <!-- 全屏：语音通话，或视频通话远端还没出画时用大圆头像 -->
    <div
      v-else-if="!callState.inPip && (callState.kind !== 'video' || (!hasRemote && focus === 'remote'))"
      class="call-avatar"
      :style="{ background: avatarBg }"
    >
      {{ initial }}
    </div>

    <!-- 本地画面：默认右上角小窗，点一下和远端互换主画面。
         ⚠️ 外层 div 承担尺寸/圆角/裁切，<video> 上**不加** transform / border-radius / box-shadow / transition：
         这些会让 WebView 把相机流送进合成层，实测在部分机型上会卡死渲染进程（整页假死）。 -->
    <div
      v-if="isVideoCall && hasLocalVideo"
      class="call-surface call-local-wrap"
      :class="{ 'as-main': focus === 'local', 'as-pip': focus === 'remote', off: callState.camOff }"
      :style="localWrapStyle"
      @click="onSurfaceClick('local')"
      @dblclick.prevent="onDblTap('local')"
    >
      <video
        :ref="bindLocalEl"
        class="local-video"
        autoplay
        playsinline
        muted
        @loadedmetadata="onLocalMeta"
      ></video>
    </div>

    <!-- 小窗（PiP）里不显示任何按钮：点小窗由系统展开回全屏 -->
    <div v-if="!callState.inPip" class="call-actions">
      <!-- 来电：拒接 / 接听 -->
      <template v-if="callState.phase === 'incoming'">
        <button class="ca-btn danger" @click="onReject">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5C3 7 9 4 12 4s9 3 9 6.5c0 1.2-.6 2-1.6 2.2l-2.7.6c-.9.2-1.7-.3-2-1.2l-.4-1.2c-1.5.5-3 .5-4.6 0l-.4 1.2c-.3.9-1.1 1.4-2 1.2l-2.7-.6C3.6 12.5 3 11.7 3 10.5Z"/><path d="m4 4 16 16"/></svg>
          <span>拒接</span>
        </button>
        <button class="ca-btn ok" @click="onAccept">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5C3 7 9 4 12 4s9 3 9 6.5c0 1.2-.6 2-1.6 2.2l-2.7.6c-.9.2-1.7-.3-2-1.2l-.4-1.2c-1.5.5-3 .5-4.6 0l-.4 1.2c-.3.9-1.1 1.4-2 1.2l-2.7-.6C3.6 12.5 3 11.7 3 10.5Z"/></svg>
          <span>接听</span>
        </button>
      </template>

      <!-- 通话中 / 连接中：静音、摄像头、切换、挂断 -->
      <template v-else-if="callState.phase === 'active' || callState.phase === 'connecting'">
        <button class="ca-btn ghost" :class="{ on: callState.muted }" @click="onMute">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v4"/><template v-if="callState.muted"><path d="m3 3 18 18"/></template></svg>
          <span>{{ callState.muted ? '取消静音' : '静音' }}</span>
        </button>
        <button v-if="callState.kind === 'video' && hasLocalVideo" class="ca-btn ghost" :class="{ on: callState.camOff }" @click="onCamera">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="m16 11 6-3.5v9L16 13"/></svg>
          <span>{{ callState.camOff ? '开摄像头' : '关摄像头' }}</span>
        </button>
        <button v-if="callState.kind === 'video' && hasLocalVideo" class="ca-btn ghost" @click="onSwitch">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 8a8 8 0 0 0-14-2"/><path d="M4 16a8 8 0 0 0 14 2"/><path d="M4 4v4h4"/><path d="M20 20v-4h-4"/></svg>
          <span>翻转</span>
        </button>
        <button class="ca-btn danger" @click="onHangup">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5C3 7 9 4 12 4s9 3 9 6.5c0 1.2-.6 2-1.6 2.2l-2.7.6c-.9.2-1.7-.3-2-1.2l-.4-1.2c-1.5.5-3 .5-4.6 0l-.4 1.2c-.3.9-1.1 1.4-2 1.2l-2.7-.6C3.6 12.5 3 11.7 3 10.5Z"/><path d="m4 4 16 16"/></svg>
          <span>挂断</span>
        </button>
      </template>

      <!-- 拨号中 -->
      <template v-else-if="callState.phase === 'dialing'">
        <button class="ca-btn danger" @click="onHangup">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5C3 7 9 4 12 4s9 3 9 6.5c0 1.2-.6 2-1.6 2.2l-2.7.6c-.9.2-1.7-.3-2-1.2l-.4-1.2c-1.5.5-3 .5-4.6 0l-.4 1.2c-.3.9-1.1 1.4-2 1.2l-2.7-.6C3.6 12.5 3 11.7 3 10.5Z"/><path d="m4 4 16 16"/></svg>
          <span>取消</span>
        </button>
      </template>

      <!-- 已结束 / 失败：只留关闭 -->
      <template v-else>
        <button class="ca-btn ghost" @click="onHangup"><span>关闭</span></button>
      </template>
    </div>
  </div>
</template>

<script>
/**
 * 全屏通话界面（来电 / 拨号 / 通话中 / 结果态）。
 * 只做渲染与用户手势，所有信令与密钥都在 utils/call.js。
 */
import { callState, acceptCall, endCall, rejectCurrent, dismissCall, toggleMute, toggleCamera, switchCamera, setPipAspect } from '../utils/call'
import { avatarColor } from '../utils/format'

/** 秒 → m:ss / h:mm:ss */
function fmtDuration(sec) {
  const s = Math.max(0, sec | 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(r).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

export default {
  name: 'CallView',
  data() {
    return {
      callState,
      /** 主画面是谁：remote=对方铺满（默认）| local=自己铺满（点小窗互换后的状态） */
      focus: 'remote',
      /** 主画面数字放大倍数：双击在 1x / 2x 之间切（视觉裁切，只影响本端） */
      zoom: 1,
      /** 本地摄像头真实宽高比（小窗里按它设框，避免左右黑边或裁切） */
      localRatio: 3 / 4,
    }
  },
  created() {
    // ⚠️ 这两个必须**非响应式**：函数式 ref 在每次 patch 都会回调，
    // 若写进 data() 就会「渲染 → 改响应式 → 再渲染」无限循环（Vue 报 Maximum recursive updates）。
    this.localEl = null
  },
  computed: {
    hasRemote() { return !!this.callState.remoteStream },
    hasLocal() { return !!this.callState.localStream },
    /** 本地流里真的有视频轨（摄像头降级为语音时为 false，此时不显示预览小窗与摄像头按钮） */
    hasLocalVideo() {
      const s = this.callState.localStream
      return !!(s && s.getVideoTracks && s.getVideoTracks().length)
    },
    isVideoCall() { return this.callState.kind === 'video' },
    initial() {
      const n = this.callState.peer.name || '对方'
      return n[0]
    },
    avatarBg() { return avatarColor(this.callState.peer.name || '?') },
    /** 小窗里：本地画框的宽高比跟随摄像头真实比例（既不留黑边，也不裁切） */
    localWrapStyle() {
      if (!this.callState.inPip) return null
      return { aspectRatio: String(this.localRatio) }
    },
    /** 远端画面：双击放大时才加 transform；小窗里的缩放方式由 pip-mode 的 CSS 决定 */
    remoteStyle() {
      const z = this.focus === 'remote' ? this.zoom : 1
      return z > 1 ? { transform: `scale(${z})` } : null
    },
    /**
     * 本地预览**不做镜像**：`transform: scaleX(-1)` 会让 WebView 把相机流送进合成层，
     * 实测这台机器上直接卡死渲染进程（音频通话不受影响，因为没有 video 元素）。
     * 宁可少一个镜像效果，也不冒整页假死的风险。
     */
    /** 顶部副标题：把 phase/status 翻成一句人话（结果态优先显示结果） */
    subTitle() {
      const s = this.callState
      if (s.phase === 'failed') return s.error || '通话失败'
      if (s.phase === 'ended') {
        return s.error || ({ decline: '对方已拒接', busy: '对方忙线中', timeout: '无人接听', cancel: '已取消', hangup: '通话已结束' }[s.endedReason] || '通话已结束')
      }
      if (s.phase === 'incoming') return s.kind === 'video' ? '视频来电…' : '语音来电…'
      if (s.phase === 'dialing') return s.status === 'media' ? '正在打开麦克风…' : '正在呼叫…'
      if (s.phase === 'connecting') return '正在连接…'
      if (s.phase === 'active') return fmtDuration(s.duration)
      return ''
    }
  },
  watch: {
    // 进入小窗：强制显示对方画面（小窗里不该是自己的预览）；退出小窗：恢复远端播放
    'callState.inPip'(v) {
      if (v) {
        this.focus = 'remote'
        this.zoom = 1
      } else {
        this.$nextTick(() => this.playSafely(this.$refs.remoteVideo))
      }
    },
    // 本地预览元素带 v-if（要有流才渲染），watcher 触发时 DOM 还没更新，
    // 必须等 nextTick 才拿得到 ref；否则 srcObject 永远绑不上 → 自己看到黑框、对方却正常。
    'callState.remoteStream'(v) { this.$nextTick(() => this.attachRemote(v)) },
    'callState.localStream'(v) { this.$nextTick(() => this.attachLocal(v)) },
    'callState.kind'() {
      this.$nextTick(() => {
        this.attachRemote(this.callState.remoteStream)
        this.attachLocal(this.callState.localStream)
      })
    }
  },
  mounted() {
    this.$nextTick(() => {
      this.attachRemote(this.callState.remoteStream)
      this.attachLocal(this.callState.localStream)
    })
  },
  beforeUnmount() {
    // 只解除元素绑定，真正的轨道释放在 call.js 的收尾里（这里停轨道会让通话断掉）
    const r = this.$refs.remoteVideo
    if (r) r.srcObject = null
    if (this.localEl) this.localEl.srcObject = null
  },
  methods: {
    /**
     * 本地 video 的 ref 回调。注意：Vue 3 每次 patch 都会调用函数式 ref，
     * 所以这里只做「绑流」这种幂等操作，绝不写响应式数据（否则渲染死循环）。
     */
    bindLocalEl(el) {
      this.localEl = el || null
      if (!el) return
      if (el.srcObject === this.callState.localStream) return // 已经绑好了，别重复 play
      this.attachLocal(this.callState.localStream)
    },
    attachRemote(stream) {
      const el = this.$refs.remoteVideo
      if (!el) return
      if (el.srcObject !== stream) el.srcObject = stream || null
      if (stream) this.playSafely(el)
    },
    attachLocal(stream) {
      const el = this.localEl
      if (!el) return
      // 本地预览静音，否则会听到自己的回声；muted 属性在部分 WebView 上不生效，属性+property 都设
      el.muted = true
      el.setAttribute('muted', '')
      if (el.srcObject !== stream) el.srcObject = stream || null
      if (stream) this.playSafely(el)
    },
    /** autoplay 被策略拦时补一次：多数 WebView 静音视频可直接播，失败就等下一次挂载/点击重试 */
    playSafely(el) {
      const p = el.play()
      if (p && p.catch) {
        p.catch(() => {
          setTimeout(() => { try { el.play().catch(() => {}) } catch (e) { /* 忽略 */ } }, 300)
        })
      }
    },
    onAccept() { acceptCall() },
    onReject() { rejectCurrent('decline') },
    // 结果态点「关闭」只收界面，不再发挂断（避免重复信令）
    onHangup() {
      const p = this.callState.phase
      if (p === 'ended' || p === 'failed') { dismissCall(); return }
      endCall()
    },
    onMute() { toggleMute() },
    onCamera() { toggleCamera() },
    onSwitch() { switchCamera() },
    /**
     * 点画面：只有点「当前的小窗」才互换主/次（点大画面不打断观看）。
     * 视频通话里把小窗放大是最高频诉求，这一步不需要碰 WebRTC。
     */
    /** 远端画面尺寸确定后：把它同步给原生小窗（窗口比例尽量贴近画面） */
    onRemoteMeta() {
      try {
        const v = this.$refs.remoteVideo
        if (!v || !v.videoWidth || !v.videoHeight) return
        setPipAspect(v.videoWidth / v.videoHeight)
      } catch (e) { /* 忽略 */ }
    },
    /** 本地摄像头真实比例：小窗里按它设小窗宽高比，既不留黑边也不裁切 */
    onLocalMeta() {
      try {
        const el = this.localEl
        if (!el || !el.videoWidth || !el.videoHeight) return
        this.localRatio = el.videoWidth / el.videoHeight
      } catch (e) { /* 忽略 */ }
    },
    onSurfaceClick(which) {
      if (!this.isVideoCall || !this.hasLocal) return
      const pip = this.focus === 'local' ? 'remote' : 'local'
      if (which !== pip) return
      this.focus = this.focus === 'local' ? 'remote' : 'local'
      this.zoom = 1
      this.$nextTick(() => {
        this.attachRemote(this.callState.remoteStream)
        this.attachLocal(this.callState.localStream)
      })
    },
    /** 双击主画面：1x ↔ 2x 数字放大（CSS 裁切，不改变发给对方的画面） */
    onDblTap(which) {
      if (!this.isVideoCall) return
      if (which && which !== this.focus) return // 只对当前主画面生效，避免点小窗时同时触发互换
      this.zoom = this.zoom > 1 ? 1 : 2
    }
  }
}
</script>

<style scoped>
/* 通话页：铺满全屏、压在所有弹窗之上（App 的弹窗层级最高 210） */
.call-page {
  position: fixed; inset: 0; z-index: 400;
  display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  background: radial-gradient(circle at 50% 0%, #1d2733 0%, #0d1116 72%);
  color: #fff; overflow: hidden;
  padding: calc(env(safe-area-inset-top, 0px) + 20px) 16px calc(env(safe-area-inset-bottom, 0px) + 28px);
}

/* ── 画中画小窗（微信式：铺满优先）────────────────
   系统给的窗口尺寸是固定的（实测 110×161）；对方画面就按这个尺寸铺满，
   允许裁边但绝不留黑；自己画面做成右上角小角标，保持比例不裁。
*/
.call-page.pip-mode {
  padding: 0;
  display: block;      /* 两个画面都用绝对定位，不再参与 flex 排布 */
  background: #000;
}
/* 对方画面：与窗口完全同尺寸 + cover → 铺满，无黑边（超出的边被裁掉） */
.call-page.pip-mode .call-surface.call-remote {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  background: #000; border-radius: 0;
}
/* 自己画面：右上角角标，宽度按窗口比例、高度按摄像头比例，完整显示 */
.call-page.pip-mode .call-local-wrap {
  position: absolute; right: 6px; top: 6px;
  width: 32%; height: auto;
  border-radius: 6px; overflow: hidden;
  background: #000; z-index: 3;
}
.call-page.pip-mode .local-video { object-fit: contain; }
/* 语音：头像 + 计时居中铺满（此时没有画面，整个窗口都给它） */
.call-page.pip-mode .pip-col {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px;
}
/* 语音：头像 + 计时作为一个居中竖列，尺寸按短边比例，窗口再小也不会溢出 */
.pip-col {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 6px;
}
.call-avatar.pip {
  position: static;
  width: min(42vmin, 96px); height: min(42vmin, 96px);
  font-size: min(18vmin, 40px);
  margin: 0; box-shadow: none; animation: none;
}
.pip-timer {
  position: static;
  margin-top: 0;
  font-size: max(11px, 3.2vmin); line-height: 1.2;
  text-align: center; font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.78);
}

/* 画面层：同一个 .call-surface 在主画面/小窗之间切换（互换只需换 class，不重建元素） */
.call-surface {
  position: absolute; object-fit: cover; background: #000; z-index: 1;
  touch-action: manipulation; /* 让双击放大不被浏览器当成页面缩放 */
}
.call-surface.as-main { inset: 0; width: 100%; height: 100%; border-radius: 0; }
.call-surface.as-pip {
  right: 14px; top: calc(env(safe-area-inset-top, 0px) + 86px);
  width: 104px; height: 148px; border-radius: 14px; z-index: 3;
}
/* 本地预览：裁切/圆角放在外层 div 上，video 只负责铺满（不碰合成层属性） */
.call-local-wrap { overflow: hidden; background: #111; }
.local-video { display: block; width: 100%; height: 100%; object-fit: cover; background: #111; }

/* 语音通话：远端元素压到 1px，只让音轨继续播 */
.call-surface.audio-only { width: 1px; height: 1px; opacity: 0; pointer-events: none; }
/* 只对**远端**元素做「还没出画就隐藏」；本地元素没有 has-video，不能一起被 rule 命中 */
.call-surface.call-remote:not(.has-video) { opacity: 0; }
.call-surface.off { opacity: .35; }

.call-head { position: relative; z-index: 2; text-align: center; max-width: 78%; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
.call-peer { font-size: 21px; font-weight: 600; letter-spacing: .2px; }
.call-sub { margin-top: 7px; font-size: 14px; color: rgba(255,255,255,.74); font-variant-numeric: tabular-nums; }
/* 没有 TURN 中继时给一条克制提示：直连（host 候选）能通的场景完全正常，跨网才会失败 */
.call-relay-tip {
  display: inline-block; margin-top: 9px; padding: 3px 10px; border-radius: 999px;
  background: rgba(255,159,10,.16); color: #FFB84D; font-size: 12px; line-height: 1.5;
}

/* 头像：语音通话（或视频还没出画）时的视觉主体 */
.call-avatar {
  position: relative; z-index: 2; margin: auto;
  width: 108px; height: 108px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 40px; font-weight: 600; color: #fff;
  box-shadow: 0 0 0 10px rgba(255,255,255,.06);
  animation: callPulse 2.4s ease-in-out infinite;
}
@keyframes callPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.045); } }

/* 操作提示：只在视频通话且已有本地画面时出现 */
.call-hint { margin-top: 6px; font-size: 12px; color: rgba(255,255,255,.55); }
.call-hint.warn { color: #FF9095; }

.call-actions { position: relative; z-index: 4; width: 100%; display: flex; align-items: flex-end; justify-content: center; gap: 16px; }
.ca-btn {
  display: inline-flex; flex-direction: column; align-items: center; gap: 7px;
  width: 74px; padding: 0; border: 0; background: transparent;
  color: rgba(255,255,255,.88); font-size: 12px; line-height: 1; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.ca-btn svg { box-sizing: content-box; padding: 15px; border-radius: 50%; background: rgba(255,255,255,.14); transition: transform .12s ease, background .15s ease; }
.ca-btn.danger svg { background: #E5484D; }
.ca-btn.ok svg { background: #30A46C; }
.ca-btn.ghost.on svg { background: rgba(255,255,255,.92); color: #0d1116; }
.ca-btn:active svg { transform: scale(.93); }
.ca-btn span { opacity: .82; white-space: nowrap; }
</style>



