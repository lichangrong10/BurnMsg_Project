<template>
  <div class="chat-page gs-page">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="closeSelf">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">{{ pageTitle }}</div>
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

    <!-- 分类标签（任务15：会话内模式） -->
    <div v-if="convScoped" class="gs-cats">
      <div v-for="c in visibleCategories" :key="c.key" class="gs-cat" :class="{ on: category === c.key }" @click="setCategory(c.key)">{{ c.label }}</div>
    </div>

    <!-- 二级选择条：日期（下拉选择 全部时间/今天/本周/本月/自定义 + 自定义起止日期） -->
    <div v-if="convScoped && category === 'date'" class="gs-subbar">
      <select class="gs-custom-select" :value="currentDateSelect" @change="onDateSelect($event)">
        <option v-for="r in dateRanges" :key="r.key" :value="r.key">{{ r.label }}</option>
        <option value="custom">自定义</option>
      </select>
      <div v-if="useCustomDate" class="gs-date-custom">
        <input type="date" class="gs-dc-input" v-model="startDate" @change="onCustomDateChange" :title="startDate ? '' : '选择开始日期'">
        <span class="gs-dc-sep">至</span>
        <input type="date" class="gs-dc-input" v-model="endDate" @change="onCustomDateChange" :title="endDate ? '' : '选择结束日期'">
      </div>
    </div>

    <!-- 二级选择条：群成员 -->
    <div v-if="convScoped && isGroupConv && category === 'member'" class="gs-subbar">
      <div class="gs-member" :class="{ on: selectedMemberId === '' }" @click="selectMember('')">
        <div class="gs-member-avatar" style="background:#8a8f98">全</div>
        <div class="gs-member-name">全部</div>
      </div>
      <div v-for="m in memberOptions" :key="m.uid" class="gs-member" :class="{ on: selectedMemberId === m.uid }" @click="selectMember(m.uid)">
        <div class="gs-member-avatar" :style="{ background: avatarColor(m.name) }">{{ (m.name || '?').charAt(0) }}</div>
        <div class="gs-member-name">{{ m.name }}</div>
      </div>
    </div>

    <!-- 消息列表 / 媒体网格 -->
    <div class="gs-body" @scroll="onScroll">
      <!-- 初始空状态 -->
      <div v-if="!hasSearched && !loading" class="gs-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#b0b5bc" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <div>{{ convScoped ? '输入关键词搜索聊天记录，或点上方分类直接浏览' : '输入关键词搜索全局消息' }}</div>
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

      <!-- 结果区 -->
      <template v-else>
        <!-- 媒体分类：微信式缩略图网格（按时间分组） -->
        <template v-if="category === 'media'">
          <template v-for="g in mediaGroups" :key="'g' + g.label">
            <div class="gs-media-title">{{ g.label }}</div>
            <div class="gs-media-grid">
              <div v-for="it in g.items" :key="'c' + it.id" class="gs-media-cell" @click="openResult(it)">
                <img v-if="it.type === 'image'" class="gs-media-thumb" :src="fileURL(it.file_url)" loading="lazy">
                <div v-else class="gs-media-video">
                  <video class="gs-media-thumb" :src="fileURL(it.file_url)" preload="metadata" muted playsinline webkit-playsinline></video>
                  <span class="gs-media-play"><svg width="22" height="22" viewBox="0 0 24 24" fill="#fff"><path d="M8 5.5v13l11-6.5z"/></svg></span>
                </div>
                <span class="gs-media-zoom" title="查看大图" @click.stop="openPreview(it)">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M11 8v6M8 11h6"/></svg>
                </span>
              </div>
            </div>
          </template>
        </template>

        <!-- 其他分类：文字行 -->
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
              <div v-if="!convScoped" class="gs-result-conv">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span>{{ getConvName(item.conversation_id) }}</span>
                <span v-if="item.is_encrypted" class="gs-enc-tag">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  加密
                </span>
              </div>
            </div>
          </div>
        </template>

        <!-- 加载更多（两种模式共用） -->
        <div v-if="loadingMore" class="gs-loading-more">
          <div class="gs-spinner gs-spinner-sm"></div>
          <span>加载中…</span>
        </div>
        <div v-else-if="noMore && results.length" class="gs-no-more">
          — 已加载全部结果 —
        </div>
      </template>
    </div>

    <!-- 媒体预览层（图片放大 / 视频播放） -->
    <div v-if="preview.show" class="gs-preview" @click.self="closePreview">
      <div class="gs-preview-top">
        <div class="gs-preview-meta">
          <span>{{ preview.sender || '未知用户' }}</span>
          <span>·</span>
          <span>{{ fmtTime(preview.time) }}</span>
          <span v-if="preview.name" class="gs-preview-name">{{ preview.name }}</span>
        </div>
        <div class="gs-preview-close" @click="closePreview">✕</div>
      </div>
      <img v-if="preview.type === 'image'" class="gs-preview-media" :src="preview.url">
      <video v-else class="gs-preview-media" :src="preview.url" controls autoplay playsinline></video>
    </div>
  </div>
</template>

<script>
import { state, openChat } from '../store'
import { api } from '../api'
import { avatarColor, fmtTime, fileURL } from '../utils/format'

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
      debounceTimer: null,
      category: 'all',
      categories: [
        { key: 'all', label: '全部' },
        { key: 'media', label: '图片与视频', type: 'image,video' },
        { key: 'file', label: '文件', type: 'file' },
        { key: 'voice', label: '语音', type: 'voice' },
        { key: 'date', label: '日期' },
        { key: 'member', label: '群成员' }
      ],
      // 日期筛选：全部时间 / 今天 / 本周 / 本月（after 毫秒时间戳后端已支持）+ 自定义起止日期
      dateRange: 'all',
      startDate: '',
      endDate: '',
      useCustomDate: false,
      dateRanges: [
        { key: 'all', label: '全部时间' },
        { key: 'today', label: '今天' },
        { key: 'week', label: '本周' },
        { key: 'month', label: '本月' }
      ],
      selectedMemberId: '',
      preview: { show: false, url: '', type: '', name: '', sender: '', time: '' }
    }
  },
  computed: {
    noMore() {
      return this.total >= 0 && this.results.length >= this.total
    },
    /** 当前锁定会话（聊天信息页进入时的会话） */
    currentConv() {
      if (!state.globalSearchConvId) return null
      return state.convs.find(cv => cv.id === state.globalSearchConvId || String(cv.id) === String(state.globalSearchConvId)) || null
    },
    /** 当前会话是否为群聊（单聊不显示「群成员」分类） */
    isGroupConv() {
      const c = this.currentConv
      return !!(c && (c.type === 'group' || c.is_channel))
    },
    /** 可见分类：群成员仅群聊显示 */
    visibleCategories() {
      return this.isGroupConv ? this.categories : this.categories.filter(c => c.key !== 'member')
    },
    /** 会话内模式（任务15）：从聊天信息页「查找聊天内容」进入时锁定当前会话 */
    convScoped() {
      return !!state.globalSearchConvId
    },
    pageTitle() {
      return this.convScoped ? '查找聊天内容' : '搜索消息'
    },
    /** 日期下拉当前显示值（启用自定义时显示「自定义」） */
    currentDateSelect() {
      return this.useCustomDate ? 'custom' : this.dateRange
    },
    /** 媒体分类按时间分组（微信式：今天/本周/更早） */
    mediaGroups() {
      const now = new Date()
      const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
      const day = now.getDay() || 7
      const startWeek = startToday - (day - 1) * 86400000
      const groups = [
        { label: '今天', items: [] },
        { label: '本周', items: [] },
        { label: '更早', items: [] }
      ]
      for (const it of this.results) {
        const t = Date.parse(it.created_at) || 0
        if (!t) { groups[2].items.push(it); continue }
        if (t >= startToday) groups[0].items.push(it)
        else if (t >= startWeek) groups[1].items.push(it)
        else groups[2].items.push(it)
      }
      return groups.filter(g => g.items.length)
    },
    /** 当前会话群成员（群成员筛选选项） */
    memberOptions() {
      const members = Array.isArray(state.groupMembers) ? state.groupMembers : []
      const seen = {}
      const out = []
      for (const m of members) {
        const uid = m.user_id ?? m.userId ?? m.id
        if (uid == null || seen[uid]) continue
        seen[uid] = true
        out.push({ uid: String(uid), name: m.display_name || m.name || m.username || m.nickname || m.phone || '成员' })
      }
      return out
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
    fileURL,

    onInput() {
      clearTimeout(this.debounceTimer)
      // 单聊没有「群成员」分类：若残留 member 分类则强制回到「全部」，避免空跑群成员筛选
      if (this.category === 'member' && !this.isGroupConv) this.category = 'all'
      // 分类浏览（非「全部」）允许空关键词直接浏览；「全部」仍需 ≥2 字符
      if (this.category === 'all' && this.keyword.length < 2) {
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
      const cat = this.categories.find(c => c.key === this.category)
      const type = cat && cat.type ? cat.type : ''
      if (!type && this.keyword.length < 2 && this.category !== 'date' && this.category !== 'member') return
      if (page === 1) {
        this.loading = true
        this.results = []
        this.total = -1
      } else {
        this.loadingMore = true
      }
      this.hasSearched = true
      try {
        const params = { page, pageSize: this.pageSize }
        if (this.keyword) params.keyword = this.keyword
        if (type) params.type = type
        if (state.globalSearchConvId) params.conversation_id = state.globalSearchConvId
        if (this.category === 'date') {
          // 自定义起止日期优先；未启用自定义走快捷区间
          if (this.useCustomDate) {
            if (this.startDate) params.after = String(new Date(this.startDate + 'T00:00:00').getTime())
            if (this.endDate) params.before = String(new Date(this.endDate + 'T23:59:59.999').getTime())
          } else if (this.dateRange !== 'all') {
            params.after = String(this.calcAfter(this.dateRange))
          }
        }
        if (this.category === 'member' && this.selectedMemberId) params.sender_id = this.selectedMemberId
        const res = await api.searchMessages(params)
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
        state.globalSearchConvId = null
        state.showGlobalSearch = false
        state.showChatInfo = false // 从「聊天信息」页进入搜索时，返回会话必须先压掉信息层，否则点结果永远停在聊天信息页
        openChat(conv)
      } else {
        state.toast = '会话不存在'
        setTimeout(() => { state.toast = '' }, 2000)
      }
    },

    /** 媒体缩略图点击：打开大图/视频预览 */
    openPreview(item) {
      this.preview = {
        show: true,
        url: this.fileURL(item.file_url),
        type: item.type,
        name: item.file_name || '',
        sender: item.sender_name || '未知用户',
        time: item.created_at
      }
    },
    closePreview() {
      this.preview.show = false
    },

    clearSearch() {
      this.keyword = ''
      this.results = []
      this.total = -1
      this.hasSearched = false
      this.page = 1
      if (this.$refs.searchInput) this.$refs.searchInput.focus()
    },

    /** 切换分类（任务15）：分类浏览立即加载；切回「全部」时无关键词则清空 */
    setCategory(key) {
      if (this.category === key) return
      this.category = key
      if (key !== 'all' || this.keyword.length >= 2) {
        this.doSearch(1)
      } else {
        this.results = []
        this.total = -1
        this.hasSearched = false
      }
    },

    /** 日期下拉选择：custom 展开自定义输入；其余切换快捷区间 */
    onDateSelect(e) {
      if (e.target.value === 'custom') {
        this.useCustomDate = true
        return // 展开输入框，等填了两个日期再搜
      }
      this.setDateRange(e.target.value)
    },

    /** 日期快捷区间切换；点快捷项时清掉自定义起止日期 */
    setDateRange(key) {
      this.dateRange = key
      this.useCustomDate = false
      this.startDate = ''
      this.endDate = ''
      this.doSearch(1)
    },

    /** 自定义起止日期变化：只填一端也允许（半开区间）；两端都空则退回快捷/全部 */
    onCustomDateChange() {
      if (!this.startDate && !this.endDate) {
        this.useCustomDate = false
        this.doSearch(1)
        return
      }
      this.useCustomDate = true
      this.doSearch(1)
    },

    /** 群成员切换：空串 = 全部成员 */
    selectMember(uid) {
      if (this.selectedMemberId === uid) return
      this.selectedMemberId = uid
      this.doSearch(1)
    },

    /** 时间区间起点（毫秒时间戳，后端 parseDateParam 支持） */
    calcAfter(key) {
      const d = new Date()
      if (key === 'today') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      if (key === 'week') {
        const day = d.getDay() || 7
        return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - (day - 1) * 86400000
      }
      if (key === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
      return 0
    },

    /** 关闭搜索页：清空会话锁定，避免下次全局搜索残留会话模式 */
    closeSelf() {
      state.globalSearchConvId = null
      state.showGlobalSearch = false
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

/* ── 分类标签（任务15） ── */
.gs-cats {
  display: flex; gap: 8px; padding: 0 12px 10px;
  background: var(--tg-gray-bg);
  overflow-x: auto;
}
.gs-cat {
  flex-shrink: 0; padding: 5px 14px;
  background: #fff; border-radius: 15px;
  font-size: 13px; color: var(--tg-text);
  cursor: pointer; box-shadow: 0 1px 3px rgba(16,24,40,.06);
  transition: background .15s, color .15s;
}
.gs-cat.on { background: var(--tg-blue); color: #fff; }

/* ── 二级选择条（日期/群成员） ── */
.gs-subbar {
  display: flex; align-items: center; gap: 8px;
  padding: 0 12px 10px;
  background: var(--tg-gray-bg);
  overflow-x: auto;
}
.gs-custom-select {
  flex-shrink: 0; padding: 5px 10px;
  border: 1px solid #d5d9df; border-radius: 8px;
  font-size: 12.5px; color: var(--tg-text); background: #fff;
  cursor: pointer; outline: none;
}
.gs-chip {
  flex-shrink: 0; padding: 4px 13px;
  background: #fff; border-radius: 14px;
  font-size: 12.5px; color: var(--tg-text);
  cursor: pointer; box-shadow: 0 1px 3px rgba(16,24,40,.06);
}
.gs-chip.on { background: var(--tg-blue); color: #fff; }
.gs-date-custom {
  flex-shrink: 0; display: flex; align-items: center; gap: 5px;
  margin-left: 6px; padding-left: 12px; border-left: 1px dashed #c9cdd3;
}
.gs-dc-input {
  width: 118px; padding: 4px 6px;
  border: 1px solid #d5d9df; border-radius: 6px;
  font-size: 12px; color: var(--tg-text); background: #fff;
}
.gs-dc-sep { font-size: 12px; color: #999DA3; }
.gs-member {
  flex-shrink: 0; width: 58px;
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  cursor: pointer;
}
.gs-member-avatar {
  width: 38px; height: 38px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px;
  border: 2px solid transparent;
}
.gs-member.on .gs-member-avatar { border-color: var(--tg-blue); }
.gs-member-name {
  font-size: 11px; color: var(--tg-text-secondary);
  max-width: 58px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}

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

/* ── 媒体缩略图网格（微信式） ── */
.gs-media-title {
  font-size: 12.5px; color: #999DA3;
  padding: 10px 14px 6px;
}
.gs-media-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 3px; padding: 0 3px;
}
.gs-media-cell {
  position: relative; aspect-ratio: 1;
  overflow: hidden; background: #e8eaee; border-radius: 2px;
  cursor: pointer;
}
.gs-media-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.gs-media-video { position: relative; width: 100%; height: 100%; }
.gs-media-video .gs-media-thumb { position: absolute; inset: 0; }
.gs-media-play {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
  width: 30px; height: 30px; border-radius: 50%;
  background: rgba(0,0,0,.45);
  display: flex; align-items: center; justify-content: center;
}

/* ── 媒体预览层 ── */
.gs-preview {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0,0,0,.92);
  display: flex; flex-direction: column;
}
.gs-preview-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; color: #fff;
}
.gs-preview-meta {
  font-size: 14px; opacity: .92;
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.gs-preview-name { font-size: 12px; opacity: .7; }
.gs-preview-close { cursor: pointer; font-size: 20px; padding: 4px; opacity: .85; }
.gs-preview-media { flex: 1; min-height: 0; max-width: 100%; margin: 0 auto; }
img.gs-preview-media { object-fit: contain; max-width: 100%; }
video.gs-preview-media { width: 100%; }

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
.gs-media-zoom {
  position: absolute; top: 4px; right: 4px;
  width: 20px; height: 20px; border-radius: 50%;
  background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 2;
}
.gs-media-zoom:hover { background: rgba(0,0,0,.72); }
</style>