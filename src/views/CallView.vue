<template>
  <div class="call-page" :class="'kind-' + callState.kind">
    <!-- 远端画面：视频通话铺满；语音通话只取音轨（元素压到 1px 保持播放） -->
    <video
      ref="remoteVideo"
      class="call-remote"
      :class="{ 'audio-only': callState.kind !== 'video', 'has-video': hasRemote }"
      autoplay
      playsinline
    ></video>

    <div class="call-head">
      <div class="call-peer">{{ callState.peer.name || '对方' }}</div>
      <div class="call-sub">{{ subTitle }}</div>
    </div>

    <div v-if="callState.kind !== 'video' || !hasRemote" class="call-avatar" :style="{ background: avatarBg }">
      {{ initial }}
    </div>

    <!-- 本地预览：视频通话右上角小窗 -->
    <video
      v-if="callState.kind === 'video' && hasLocal"
      ref="localVideo"
      class="call-local"
      :class="{ mirrored: !callState.camOff, off: callState.camOff }"
      autoplay
      playsinline
      muted
    ></video>

    <div class="call-actions">
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
        <button v-if="callState.kind === 'video'" class="ca-btn ghost" :class="{ on: callState.camOff }" @click="onCamera">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="3"/><path d="m16 11 6-3.5v9L16 13"/></svg>
          <span>{{ callState.camOff ? '开摄像头' : '关摄像头' }}</span>
        </button>
        <button v-if="callState.kind === 'video'" class="ca-btn ghost" @click="onSwitch">
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
import { callState, acceptCall, endCall, rejectCurrent, toggleMute, toggleCamera, switchCamera } from '../utils/call'
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
    return { callState }
  },
  computed: {
    hasRemote() { return !!this.callState.remoteStream },
    hasLocal() { return !!this.callState.localStream },
    initial() {
      const n = this.callState.peer.name || '对方'
      return n[0]
    },
    avatarBg() { return avatarColor(this.callState.peer.name || '?') },
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
    'callState.remoteStream'(v) { this.attachRemote(v) },
    'callState.localStream'(v) { this.attachLocal(v) },
    'callState.kind'() {
      this.$nextTick(() => {
        this.attachRemote(this.callState.remoteStream)
        this.attachLocal(this.callState.localStream)
      })
    }
  },
  mounted() {
    this.attachRemote(this.callState.remoteStream)
    this.attachLocal(this.callState.localStream)
  },
  beforeUnmount() {
    // 只解除元素绑定，真正的轨道释放在 call.js 的收尾里（这里停轨道会让通话断掉）
    const r = this.$refs.remoteVideo
    if (r) r.srcObject = null
    const l = this.$refs.localVideo
    if (l) l.srcObject = null
  },
  methods: {
    attachRemote(stream) {
      const el = this.$refs.remoteVideo
      if (!el) return
      if (el.srcObject !== stream) el.srcObject = stream || null
      if (stream) el.play().catch(() => { /* 等用户手势后自动恢复 */ })
    },
    attachLocal(stream) {
      const el = this.$refs.localVideo
      if (!el) return
      if (el.srcObject !== stream) el.srcObject = stream || null
      if (stream) el.play().catch(() => {})
    },
    onAccept() { acceptCall() },
    onReject() { rejectCurrent('decline') },
    onHangup() { endCall() },
    onMute() { toggleMute() },
    onCamera() { toggleCamera() },
    onSwitch() { switchCamera() }
  }
}
</script>
