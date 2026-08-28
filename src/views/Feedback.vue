<template>
  <div class="chat-page fb-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showFeedback = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">意见反馈</div>
        <div class="chat-status">告诉我们你的想法与建议</div>
      </div>
    </div>

    <div class="chat-body fb-body">
      <!-- 提交新反馈 -->
      <div class="fb-form">
        <div class="fb-form-title">提交新反馈</div>
        <textarea class="fb-textarea" v-model="content" maxlength="2000" rows="4" placeholder="请描述你遇到的问题或建议（必填，2000 字以内）"></textarea>
        <div class="fb-count">{{ (content || '').length }}/2000</div>
        <input class="fb-contact" v-model.trim="contact" maxlength="100" placeholder="联系方式（选填，便于我们回访）">
        <button class="fb-submit" :disabled="submitting || !(content || '').trim()" @click="doSubmit">{{ submitting ? '提交中…' : '提交反馈' }}</button>
      </div>

      <!-- 我的反馈记录 -->
      <div class="fb-section-title">我的反馈 · {{ state.feedbackList.length }}</div>
      <div v-if="state.feedbackLoading && !state.feedbackList.length" class="fb-empty">加载中…</div>
      <div v-else-if="!state.feedbackList.length" class="fb-empty">还没有反馈记录</div>
      <div v-for="f in state.feedbackList" :key="f.id" class="fb-item">
        <div class="fb-item-head">
          <span class="fb-status" :class="{ processed: f.status === 'processed' }">{{ f.status === 'processed' ? '已回复' : '待处理' }}</span>
          <span class="fb-time">{{ fmtDateTime(f.created_at) }}</span>
        </div>
        <div class="fb-content">{{ f.content }}</div>
        <div v-if="f.status === 'processed' && f.admin_reply" class="fb-reply">
          <div class="fb-reply-head">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
            <span>管理员回复</span>
            <span v-if="f.replied_at" class="fb-time">{{ fmtDateTime(f.replied_at) }}</span>
          </div>
          <div class="fb-reply-text">{{ f.admin_reply }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, submitFeedback } from '../store'
import { fmtDateTime } from '../utils/format'

export default {
  name: 'FeedbackView',
  data() {
    return {
      state,
      content: '',
      contact: '',
      submitting: false
    }
  },
  methods: {
    fmtDateTime,
    async doSubmit() {
      if (this.submitting) return
      this.submitting = true
      try {
        const ok = await submitFeedback(this.content, this.contact)
        if (ok) { this.content = ''; this.contact = '' }
      } finally {
        this.submitting = false
      }
    }
  }
}
</script>

<style scoped>
.fb-page { background: var(--tg-gray-bg); }
.fb-body { padding: 12px 12px 24px; }

/* ── 提交卡片 ── */
.fb-form { background: #fff; border-radius: 14px; padding: 14px 13px; box-shadow: 0 1px 3px rgba(16, 24, 40, .06); }
.fb-form-title { font-size: 15px; font-weight: 600; color: #111; margin-bottom: 10px; }
.fb-textarea {
  width: 100%;
  border: 1px solid var(--tg-border);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 14.5px;
  line-height: 1.5;
  font-family: inherit;
  resize: none;
  outline: none;
  box-sizing: border-box;
  background: #FAFBFC;
}
.fb-textarea:focus { border-color: var(--tg-blue); background: #fff; }
.fb-count { text-align: right; font-size: 11.5px; color: #999DA3; margin-top: 4px; }
.fb-contact {
  width: 100%;
  margin-top: 8px;
  border: 1px solid var(--tg-border);
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  background: #FAFBFC;
}
.fb-contact:focus { border-color: var(--tg-blue); background: #fff; }
.fb-submit {
  width: 100%;
  margin-top: 12px;
  border: none;
  border-radius: 12px;
  padding: 11px 0;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background: var(--tg-blue);
  cursor: pointer;
}
.fb-submit:disabled { opacity: .55; }
.fb-submit:not(:disabled):active { filter: brightness(.93); }

/* ── 反馈记录 ── */
.fb-section-title { margin: 18px 2px 10px; font-size: 13px; font-weight: 600; color: #707579; }
.fb-empty { text-align: center; color: #999DA3; font-size: 13.5px; padding: 26px 0; }
.fb-item { background: #fff; border-radius: 14px; padding: 12px 13px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(16, 24, 40, .06); }
.fb-item-head { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; }
.fb-status { font-size: 11px; font-weight: 600; border-radius: 6px; padding: 2px 8px; color: #B26A00; background: rgba(224, 112, 0, .12); }
.fb-status.processed { color: #1A9E54; background: rgba(26, 158, 84, .12); }
.fb-time { font-size: 12px; color: #999DA3; }
.fb-content { font-size: 14.5px; color: #222; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
.fb-reply { margin-top: 10px; background: rgba(51, 144, 236, .07); border-left: 3px solid var(--tg-blue); border-radius: 8px; padding: 9px 11px; }
.fb-reply-head { display: flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 600; color: var(--tg-blue); margin-bottom: 5px; }
.fb-reply-head .fb-time { font-weight: 400; margin-left: auto; }
.fb-reply-text { font-size: 13.5px; color: #2a2a2a; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
</style>
