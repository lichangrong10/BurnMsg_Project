<template>
  <!-- 通知设置指引（PUSH_JPUSH.md §9）
       国产 ROM 即使厂商通道配好，用户侧不放开电池优化/自启动，App 过一会儿就收不到推送。
       首次原生启动自动弹一次，之后从「我的」手动进入。 -->
  <div class="chat-page ng-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="close">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">通知设置指引</div>
        <div class="chat-status">收不到消息提醒时按这几步检查</div>
      </div>
    </div>

    <div class="chat-body ng-body">
      <div class="ng-intro">
        安卓系统会限制后台应用的联网，可能导致消息提醒延迟或收不到。
        完成以下 4 步后，焚信才能在后台正常接收消息。
      </div>

      <div v-for="(s, i) in steps" :key="i" class="ng-card">
        <div class="ng-no">{{ i + 1 }}</div>
        <div class="ng-main">
          <div class="ng-title">{{ s.title }}</div>
          <div v-if="s.path" class="ng-path">{{ s.path }}</div>
          <div v-if="s.desc" class="ng-desc">{{ s.desc }}</div>
        </div>
      </div>

      <div class="ng-tip">
        不同品牌路径略有差异，可以在「设置」里直接搜索 <b>焚信</b> 或 <b>通知</b> 快速定位。
        如果设备由公司统一管理（MDM），可由 IT 统一下发以上策略。
      </div>

      <!-- 两个一键入口：能弹授权框就直接弹；系统不再弹框（拒绝过两次）就直达设置页 -->
      <button class="ng-primary" :disabled="busy" @click="askPermission">
        {{ busy ? '处理中…' : '一键开启通知权限' }}
      </button>
      <button class="ng-secondary" :disabled="busy" @click="gotoSettings">
        打开系统通知设置页
      </button>
      <button class="ng-done" @click="close">我知道了，不再提示</button>
    </div>
  </div>
</template>

<script>
import { state, showToast } from '../store'
import { ensureNotificationPermission, openNotificationSettings } from '../utils/push'

export default {
  name: 'NotifyGuide',
  data() {
    return {
      state,
      busy: false,
      // 来自 PUSH_JPUSH.md §9 的四条标准指引
      steps: [
        {
          title: '允许通知',
          path: '设置 → 应用管理 → 焚信 → 通知管理',
          desc: '把「允许通知」打开；横幅、锁屏、声音、振动建议全部开启。'
        },
        {
          title: '关闭电池优化',
          path: '设置 → 电池 → 焚信 → 允许后台活动',
          desc: '关闭省电优化 / 后台限制，否则锁屏一段时间后会被系统冻结。'
        },
        {
          title: '允许自启动',
          path: '设置 → 应用启动管理 → 焚信 → 允许自启动',
          desc: '小米、华为等机型特有；不开的话 App 被清理后收不到推送。'
        },
        {
          title: '锁定后台',
          path: '最近任务卡片下拉 → 锁定焚信',
          desc: '小米、OPPO 等机型支持；锁定后清理全部应用时不会被一起清掉。'
        }
      ]
    }
  },
  methods: {
    /** 一键申请：Android 13+ 会直接弹系统授权框；已开启则提示无需操作 */
    async askPermission() {
      if (this.busy) return
      this.busy = true
      try {
        const granted = await ensureNotificationPermission()
        showToast(granted ? '通知权限已开启' : '未获得授权，可点下面的按钮去系统设置里手动打开')
      } finally {
        this.busy = false
      }
    },
    /** 直达系统「焚信 → 通知」页（系统不再弹授权框时的唯一出路） */
    async gotoSettings() {
      if (this.busy) return
      this.busy = true
      try {
        const ok = await openNotificationSettings()
        if (!ok) showToast('无法跳转，请手动进入：设置 → 应用 → 焚信 → 通知')
      } finally {
        this.busy = false
      }
    },
    close() {
      state.showNotifyGuide = false
    }
  }
}
</script>

<style scoped>
.ng-body { padding: 14px 14px 28px; overflow-y: auto; }
.ng-intro {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--tg-text-secondary);
  margin-bottom: 14px;
}
.ng-card {
  display: flex;
  gap: 12px;
  background: var(--tg-bubble-in);
  border-radius: 12px;
  padding: 13px 14px;
  margin-bottom: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, .06);
}
.ng-no {
  flex: 0 0 22px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--tg-blue);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
  text-align: center;
}
.ng-main { flex: 1 1 auto; min-width: 0; }
.ng-title { font-size: 14.5px; font-weight: 600; color: var(--tg-text); }
.ng-path {
  font-size: 12.5px;
  color: var(--tg-blue);
  margin-top: 4px;
  word-break: break-all;
}
.ng-desc {
  font-size: 12.5px;
  color: var(--tg-text-secondary);
  line-height: 1.5;
  margin-top: 5px;
}
.ng-tip {
  font-size: 12.5px;
  color: var(--tg-text-secondary);
  line-height: 1.6;
  background: var(--tg-gray-bg);
  border-radius: 10px;
  padding: 11px 13px;
  margin: 14px 0 18px;
}
.ng-tip b { color: var(--tg-text); font-weight: 600; }
.ng-done {
  width: 100%;
  height: 44px;
  border: none;
  border-radius: 10px;
  background: var(--tg-blue);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
}
.ng-done:active { background: var(--tg-blue-dark); }
.ng-primary {
  width: 100%;
  height: 44px;
  border: none;
  border-radius: 10px;
  background: var(--tg-blue);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 10px;
}
.ng-primary:active { background: var(--tg-blue-dark); }
.ng-secondary {
  width: 100%;
  height: 44px;
  border: 1px solid var(--tg-border);
  border-radius: 10px;
  background: var(--tg-bubble-in);
  color: var(--tg-blue);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-bottom: 14px;
}
.ng-secondary:active { background: var(--tg-gray-bg); }
.ng-primary[disabled], .ng-secondary[disabled] { opacity: .6; cursor: default; }
</style>
