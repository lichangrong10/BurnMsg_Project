<template>
  <div class="chat-page gs-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showGlobalSearch = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">搜索消息</div>
        <div class="chat-status" v-if="total >= 0">{{ total }} 条结果</div>
      </div>
    </div>

    <!-- 搜索输入框 -->
    <div class="gs-search-bar">
      <svg class="gs-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
      <input
        class="gs-search-input"
        ref="searchInput"
        v-model.trim="keyword"
        placeholder="搜索消息内容（至少 2 个字符）"
        @input="onInput"
        @keydown.enter="doSearch(1)"
      >
      <div v-if="keyword" class="gs-clear-btn" @click="clearSearch">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </div>
    </div>

    <!-- 消息列表 -->
    <div class="gs-body" @scroll="onScroll">
      <!-- 初始空状态 -->
      <div v-if="!hasSearched && !loading" class="gs-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#b0b5bc" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <div>输入关键词搜索全局消息</div>
      </div>

      <!-- 加载中（首次） -->
      <div v-else-if="loading && !results.length" class="gs-empty">
        <div class="gs-spinner"></div>
        <div>搜索中…</div>
      </div>

      <!-- 无结果 -->
      <div v-else-if="hasSearched && !results.length && !loading" class="gs-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#b0b5bc" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/></svg>
        <div>没有找到相关消息</div>
        <div class="gs-empty-hint">换个关键词试试</div>
      </div>

      <!-- 结果列表 -->
      <template v-else>
        <div v-for="item in results" :key="item.id" class="gs-result-item" @click="openResult(item)">
          <div class="gs-result-avatar" :style="{ background: avatarColor(item.sender_name || '?') }">
            {{ (item.sender_name || '?').charAt(0) }}
          </div>
          <div class="gs-result-body">
            <div class="gs-result-row1">
              <span class="gs-result-sender">{{ item.sender_name || '未知用户' }}</span>
              <span class="gs-result-time">{{ fmtTime(item.created_at) }}</span>
            </div>
            <div class="gs-result-snippet" v-html="highlightSnippet(item.content_snippet)"></div>
            <div class="gs-result-conv">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              <span>{{ getConvName(item.conversation_id) }}</span>
              <span v-if="item.is_encrypted" class="gs-enc-tag">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                加密
              </span>
            </div>
          </div>
        </div>

        <!-- 加载更多 -->
        <div v-if="loadingMore" class="gs-loading-more">
          <div class="gs-spinner gs-spinner-sm"></div>
          <span>加载中…</span>
        </div>
        <div v-else-if="noMore && results.length" class="gs-no-more">
          — 已加载全部结果 —
        </div>
      </template>
    </div>
  </div>
</template>

<script>
import { state, openChat } from '../store'
import { api } from '../api'
import { avatarColor, fmtTime } from '../utils/format'

export default {
  name: 'GlobalSearchView',
  data() {
    return {
      state,
      keyword: '',
      results: [],
      total: -1,
      page: 1,
      pageSize: 20,
      loading: false,
      loadingMore: false,
      hasSearched: false,
      debounceTimer: null
    }
  },
  computed: {
    noMore() {
      return this.total >= 0 && this.results.length >= this.total
    }
  },
  mounted() {
    this.$nextTick(() => {
      if (this.$refs.searchInput) this.$refs.searchInput.focus()
    })
  },
  methods: {
    avatarColor,
    fmtTime,

    onInput() {
      clearTimeout(this.debounceTimer)
      if (this.keyword.length < 2) {
        this.results = []
        this.total = -1
        this.hasSearched = false
        return
      }
      this.debounceTimer = setTimeout(() => {
        this.doSearch(1)
      }, 400)
    },

    async doSearch(page = 1) {
      if (this.keyword.length < 2) return
      if (page === 1) {
        this.loading = true
        this.results = []
        this.total = -1
      } else {
        this.loadingMore = true
      }
      this.hasSearched = true
      try {
        const res = await api.searchMessages({
          keyword: this.keyword,
          page,
          pageSize: this.pageSize
        })
        const data = Array.isArray(res) ? { list: res } : (res || {})
        const list = data.list || data.items || (Array.isArray(data) ? data : [])
        if (page === 1) {
          this.results = list
        } else {
          this.results = [...this.results, ...list]
        }
        this.total = data.total || 0
        this.page = page
      } catch (e) {
        console.error('[GlobalSearch] 搜索失败:', e)
        if (state.toast !== undefined) state.toast = '搜索失败，请重试'
        setTimeout(() => { if (state.toast === '搜索失败，请重试') state.toast = '' }, 2000)
      } finally {
        this.loading = false
        this.loadingMore = false
      }
    },

    onScroll(e) {
      if (this.loadingMore || this.noMore || this.loading) return
      const el = e.target
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
        this.doSearch(this.page + 1)
      }
    },

    getConvName(conversationId) {
      const c = state.convs.find(cv => cv.id === conversationId || String(cv.id) === String(conversationId))
      if (!c) return '会话 ' + String(conversationId).slice(0, 8)
      if (c.type === 'group' || c.is_channel) return c.name || c.title || '群组'
      if (c.other_user) return c.other_user.name || c.other_user.phone || '单聊'
      return '单聊'
    },

    highlightSnippet(snippet) {
      if (!snippet) return ''
      if (!this.keyword) return escHtml(snippet)
      const esc = escHtml(snippet)
      const kw = escHtml(this.keyword)
      const re = new RegExp('(' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi')
      return esc.replace(re, '<mark class="gs-hl">$1</mark>')
    },

    openResult(item) {
      const conv = state.convs.find(cv => cv.id === item.conversation_id || String(cv.id) === String(item.conversation_id))
      if (conv) {
        state.targetMessageId = item.id
        state.showGlobalSearch = false
        openChat(conv)
      } else {
        state.toast = '会话不存在'
        setTimeout(() => { state.toast = '' }, 2000)
      }
    },

    clearSearch() {
      this.keyword = ''
      this.results = []
      this.total = -1
      this.hasSearched = false
      this.page = 1
      if (this.$refs.searchInput) this.$refs.searchInput.focus()
    }
  }
}

function escHtml(s) {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
</script>

<style scoped>
.gs-page { background: var(--tg-gray-bg); }

/* ── 搜索栏 ── */
.gs-search-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px 10px;
  background: var(--tg-gray-bg);
}
.gs-search-icon { flex-shrink: 0; color: #999DA3; }
.gs-search-input {
  flex: 1; min-width: 0;
  border: none; outline: none;
  background: #fff;
  border-radius: 10px;
  padding: 9px 12px;
  font-size: 14.5px;
  color: var(--tg-text);
  box-shadow: 0 1px 3px rgba(16, 24, 40, .06);
}
.gs-search-input::placeholder { color: #999DA3; }
.gs-clear-btn {
  flex-shrink: 0; width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; cursor: pointer;
  color: #999DA3;
}
.gs-clear-btn:hover { background: rgba(0,0,0,.06); }

/* ── 列表容器 ── */
.gs-body {
  flex: 1; overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 0 0 24px;
}

/* ── 空状态 ── */
.gs-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 60px 20px;
  color: #999DA3; font-size: 14px; text-align: center;
}
.gs-empty-hint { font-size: 12.5px; color: #b0b5bc; }

/* ── Spinner ── */
.gs-spinner {
  width: 28px; height: 28px;
  border: 2.5px solid var(--tg-border, #e0e3e6);
  border-top-color: var(--tg-blue);
  border-radius: 50%;
  animation: gs-spin .7s linear infinite;
}
.gs-spinner-sm { width: 18px; height: 18px; border-width: 2px; }
@keyframes gs-spin { to { transform: rotate(360deg); } }

/* ── 搜索结果项 ── */
.gs-result-item {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background .12s;
}
.gs-result-item:active { background: rgba(0,0,0,.04); }

.gs-result-avatar {
  flex-shrink: 0;
  width: 44px; height: 44px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 600; color: #fff;
}

.gs-result-body { flex: 1; min-width: 0; }

.gs-result-row1 {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 3px;
}
.gs-result-sender {
  font-size: 14.5px; font-weight: 600; color: var(--tg-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  max-width: 60%;
}
.gs-result-time { font-size: 12px; color: #999DA3; flex-shrink: 0; }

.gs-result-snippet {
  font-size: 13.5px; color: var(--tg-text-secondary);
  line-height: 1.45;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-word;
}
.gs-result-snippet :deep(.gs-hl) {
  background: rgba(51, 144, 236, .15);
  color: var(--tg-blue);
  border-radius: 2px;
  padding: 0 1px;
}

.gs-result-conv {
  display: flex; align-items: center; gap: 4px;
  margin-top: 5px;
  font-size: 11.5px; color: #999DA3;
}
.gs-enc-tag {
  display: inline-flex; align-items: center; gap: 2px;
  margin-left: 4px;
  color: #1A9E54;
  background: rgba(26, 158, 84, .1);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10px; font-weight: 600;
}

/* ── 加载更多 / 无更多 ── */
.gs-loading-more {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 16px 0;
  font-size: 13px; color: #999DA3;
}
.gs-no-more {
  text-align: center; padding: 16px 0;
  font-size: 12.5px; color: #b0b5bc;
}
</style>
