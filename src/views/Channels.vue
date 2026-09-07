<template>
  <div>
    <!-- 下拉刷新指示器 -->
    <div class="pull-indicator" :style="{ height: pullDist + 'px', opacity: pullOpacity }">
      <svg v-if="pullState !== 'refreshing'" class="pull-arrow" :class="{ up: pullState === 'ready' }" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
      <span v-else class="pull-spinner"></span>
      <span>{{ pullText }}</span>
    </div>

    <!-- ── 我的频道 ── -->
    <div class="section-header" style="margin-top:4px">我的频道</div>
    <div v-if="loading" class="mc-loading">
      <span class="pull-spinner"></span>
      <span>加载中…</span>
    </div>
    <template v-else-if="myChannel">
      <div class="mc-card" @click="openChat(myChannel)">
        <div class="mc-avatar" :style="{ background: avatarColor(myChannel.name || '频道') }">
          <img v-if="myChannel.avatar_url" :src="fileURL(myChannel.avatar_url)" alt="">
          <template v-else>{{ (myChannel.name || '频')[0] }}</template>
        </div>
        <div class="mc-info">
          <div class="mc-name-row">
            <span class="mc-name">{{ myChannel.name }}</span>
            <span class="mc-vis" :class="myChannel.visibility">{{ myChannel.visibility === 'public' ? '公开' : '私密' }}</span>
          </div>
          <div class="mc-desc">{{ myChannel.description || '暂无描述' }}</div>
          <div class="mc-stats">
            <span>{{ myChannel.member_count || 0 }} 位订阅者</span>
            <span v-if="myChannel.last_message_at">· 最后发布 {{ fmtTime(myChannel.last_message_at) }}</span>
          </div>
        </div>
        <div class="mc-arrow">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#bbb" stroke-width="2" stroke-linecap="round"><path d="m9 18 6-6-6-6"/></svg>
        </div>
      </div>
    </template>
    <div v-else class="mc-empty-card">
      <div class="mc-empty-icon">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#707579" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
      </div>
      <div class="mc-empty-text">你还没有创建频道</div>
      <div class="mc-empty-sub">创建后可在频道广场展示，让同事订阅你的内容</div>
      <button class="mc-create-btn" @click="showCreateForm = true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
        创建我的频道
      </button>
    </div>

    <!-- ── 创建频道表单 ── -->
    <div v-if="showCreateForm" class="mc-form-overlay" @click.self="showCreateForm = false">
      <div class="mc-form">
        <div class="mc-form-title">创建我的频道</div>
        <div class="mc-form-field">
          <label>频道名称 <span class="req">*</span></label>
          <input v-model.trim="createForm.name" placeholder="例如：萝卜的实验室" maxlength="200">
        </div>
        <div class="mc-form-field">
          <label>个人描述</label>
          <textarea v-model.trim="createForm.description" placeholder="介绍一下你自己或你的频道内容…" maxlength="1000" rows="3"></textarea>
        </div>
        <div class="mc-form-actions">
          <button class="mc-btn-cancel" @click="showCreateForm = false">取消</button>
          <button class="mc-btn-ok" :disabled="!createForm.name || creating" @click="doCreate">
            {{ creating ? '创建中…' : '创建' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── 频道广场 ── -->
    <div class="section-header" style="margin-top:16px">频道广场 <span class="mc-total">{{ discoverTotal }} 个公开频道</span></div>
    <div v-if="discoverLoading && !discoverList.length" class="mc-loading">
      <span class="pull-spinner"></span>
      <span>加载中…</span>
    </div>
    <div v-else-if="!discoverList.length" class="mc-discover-empty">暂无公开频道</div>
    <template v-else>
      <div v-for="ch in discoverList" :key="ch.id" class="disc-item">
        <div class="disc-avatar" :style="{ background: avatarColor(ch.name || '频道') }">
          <img v-if="ch.avatar_url" :src="fileURL(ch.avatar_url)" alt="">
          <template v-else>{{ (ch.name || '频')[0] }}</template>
        </div>
        <div class="disc-info">
          <div class="disc-name">{{ ch.name }}<span v-if="ch.is_owner" class="mc-owner-tag">我的</span></div>
          <div class="disc-desc">{{ ch.description || '暂无描述' }}</div>
          <div class="disc-meta">
            <span>{{ ch.member_count || 0 }} 订阅</span>
            <span v-if="ch.owner"> · {{ ch.owner.display_name }}</span>
          </div>
        </div>
        <button v-if="ch.is_owner" class="disc-btn owned" disabled>我的</button>
        <button v-else-if="ch.is_subscribed" class="disc-btn subscribed" @click="doUnsubscribe(ch)">已订阅</button>
        <button v-else class="disc-btn subscribe" @click="doSubscribe(ch)">订阅</button>
      </div>
      <div v-if="discoverHasMore" class="mc-load-more" @click="loadDiscover(true)">
        {{ discoverLoading ? '加载中…' : '加载更多' }}
      </div>
    </template>
  </div>
</template>

<script>
import { state, openChat, loadConvs } from '../store'
import { api } from '../api'
import { avatarColor, fmtTime, fileURL } from '../utils/format'

export default {
  name: 'ChannelsView',
  data() {
    return {
      state,
      myChannel: null,
      loading: false,
      showCreateForm: false,
      creating: false,
      createForm: { name: '', description: '' },
      discoverList: [],
      discoverTotal: 0,
      discoverPage: 1,
      discoverHasMore: false,
      discoverLoading: false,
      pullDist: 0,
      pullState: 'idle'
    }
  },
  computed: {
    pullText() {
      if (this.pullState === 'refreshing') return '刷新中…'
      return this.pullState === 'ready' ? '释放刷新' : '下拉刷新'
    },
    pullOpacity() {
      return this.pullDist > 0 ? 1 : 0
    }
  },
  mounted() {
    this.loadData()
    this._bindPull()
  },
  methods: {
    avatarColor,
    fmtTime,
    fileURL,
    openChat,
    async loadData() {
      this.loading = true
      try {
        const res = await api.getMyChannel()
        this.myChannel = res || null
      } catch (e) {
        if (e && (e.code === 404 || e.status === 404 || /404/.test(e.message || ''))) {
          this.myChannel = null
        }
      } finally {
        this.loading = false
      }
      this.loadDiscover()
    },
    async loadDiscover(append = false) {
      if (this.discoverLoading) return
      this.discoverLoading = true
      const page = append ? this.discoverPage + 1 : 1
      try {
        const res = await api.discoverChannels({ page, pageSize: 20 })
        const items = Array.isArray(res) ? res : (res && res.items) || []
        const total = (res && res.total) || 0
        if (append) {
          this.discoverList = [...this.discoverList, ...items]
        } else {
          this.discoverList = items
        }
        this.discoverTotal = total
        this.discoverPage = page
        this.discoverHasMore = this.discoverList.length < total
      } catch (e) {
        console.error('discoverChannels error:', e)
      } finally {
        this.discoverLoading = false
      }
    },
    async doCreate() {
      if (!this.createForm.name || this.creating) return
      this.creating = true
      try {
        const res = await api.createMyChannel(this.createForm)
        this.myChannel = res
        this.showCreateForm = false
        this.createForm = { name: '', description: '' }
        await loadConvs(true)
        this.loadDiscover()
      } catch (e) {
        alert((e && e.message) || '创建失败')
      } finally {
        this.creating = false
      }
    },
    async doSubscribe(ch) {
      try {
        await api.subscribeChannel(ch.id)
        ch.is_subscribed = true
        ch.member_count = (ch.member_count || 0) + 1
        await loadConvs(true)
      } catch (e) {
        alert((e && e.message) || '订阅失败')
      }
    },
    async doUnsubscribe(ch) {
      try {
        await api.unsubscribeChannel(ch.id)
        ch.is_subscribed = false
        ch.member_count = Math.max(0, (ch.member_count || 0) - 1)
        await loadConvs(true)
      } catch (e) {
        alert((e && e.message) || '退订失败')
      }
    },
    // ── 下拉刷新 ──
    _bindPull() {
      const el = this.$el
      el.addEventListener('touchstart', this._pullStart, { passive: true })
      el.addEventListener('touchmove', this._pullMove, { passive: false })
      el.addEventListener('touchend', this._pullEnd)
      el.addEventListener('touchcancel', this._pullEnd)
    },
    _pullStart(e) {
      if (this.pullState === 'refreshing') return
      const sc = this.$el.closest('.content-scroll')
      if (!sc || sc.scrollTop > 0) return
      const t = e.touches && e.touches[0]
      if (!t) return
      this._pull = { startY: t.clientY }
    },
    _pullMove(e) {
      if (!this._pull || this.pullState === 'refreshing') return
      const t = e.touches && e.touches[0]
      if (!t) return
      const dy = t.clientY - this._pull.startY
      if (dy <= 0) { this.pullDist = 0; this.pullState = 'idle'; return }
      if (e.cancelable) e.preventDefault()
      const damp = Math.min(dy * 0.5, 90)
      this.pullDist = damp
      this.pullState = damp >= 55 ? 'ready' : 'pulling'
    },
    _pullEnd() {
      if (!this._pull) return
      const ready = this.pullState === 'ready'
      this._pull = null
      if (ready) this._doRefresh()
      else { this.pullDist = 0; this.pullState = 'idle' }
    },
    async _doRefresh() {
      if (this.pullState === 'refreshing') return
      this.pullState = 'refreshing'
      this.pullDist = 50
      const t0 = Date.now()
      try {
        await this.loadData()
        await loadConvs(true)
      } finally {
        const wait = Math.max(0, 400 - (Date.now() - t0))
        setTimeout(() => {
          this.pullDist = 0
          this.pullState = 'idle'
        }, wait)
      }
    }
  }
}
</script>

<style scoped>
.pull-indicator {
  height: 0;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #909399;
  font-size: 12.5px;
  transition: height .18s ease, opacity .18s ease;
}
.pull-arrow.up { transform: rotate(180deg); }
.pull-spinner {
  width: 14px; height: 14px;
  border: 2px solid rgba(0,0,0,.15);
  border-top-color: var(--tg-blue);
  border-radius: 50%;
  animation: ch-spin .8s linear infinite;
}
@keyframes ch-spin { to { transform: rotate(360deg); } }

/* ── 我的频道卡片 ── */
.mc-card {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 8px 12px;
  padding: 14px;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
  cursor: pointer;
  transition: background .15s;
}
.mc-card:active { background: var(--tg-gray-bg); }
.mc-avatar {
  width: 52px; height: 52px;
  border-radius: 16px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 20px; font-weight: 600;
  overflow: hidden;
}
.mc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.mc-info { flex: 1; min-width: 0; }
.mc-name-row { display: flex; align-items: center; gap: 6px; }
.mc-name { font-size: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mc-vis {
  font-size: 10px; padding: 1px 6px; border-radius: 6px; flex-shrink: 0;
}
.mc-vis.public { color: #43A047; background: rgba(67,160,71,.1); }
.mc-vis.private { color: #FB8C00; background: rgba(251,140,0,.1); }
.mc-desc {
  font-size: 13px; color: var(--tg-text-secondary);
  margin-top: 3px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mc-stats {
  font-size: 12px; color: #9BA1A8; margin-top: 4px;
}
.mc-arrow { flex-shrink: 0; }

/* ── 空状态（未创建频道） ── */
.mc-empty-card {
  margin: 12px;
  padding: 28px 20px;
  text-align: center;
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,.06);
}
.mc-empty-icon { margin-bottom: 10px; }
.mc-empty-text { font-size: 15px; font-weight: 600; color: var(--tg-text); }
.mc-empty-sub { font-size: 12.5px; color: var(--tg-text-secondary); margin: 6px 0 16px; }
.mc-create-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 22px;
  background: var(--tg-blue);
  color: #fff; border: none; border-radius: 10px;
  font-size: 14px; font-weight: 600;
  cursor: pointer;
  transition: opacity .15s;
}
.mc-create-btn:active { opacity: .8; }

/* ── 创建表单弹窗 ── */
.mc-form-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 900;
}
.mc-form {
  width: 85%; max-width: 360px;
  background: #fff; border-radius: 16px;
  padding: 20px;
  box-shadow: 0 8px 32px rgba(0,0,0,.18);
}
.mc-form-title { font-size: 17px; font-weight: 600; margin-bottom: 16px; }
.mc-form-field { margin-bottom: 14px; }
.mc-form-field label { display: block; font-size: 13px; color: var(--tg-text-secondary); margin-bottom: 5px; }
.mc-form-field .req { color: #E53935; }
.mc-form-field input,
.mc-form-field textarea {
  width: 100%; padding: 10px 12px;
  border: 1px solid var(--tg-border); border-radius: 10px;
  font-size: 14px; outline: none;
  box-sizing: border-box;
  transition: border-color .2s;
  font-family: inherit;
}
.mc-form-field input:focus,
.mc-form-field textarea:focus { border-color: var(--tg-blue); }
.mc-form-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px; }
.mc-btn-cancel {
  padding: 9px 18px; border: 1px solid var(--tg-border); border-radius: 10px;
  background: #fff; font-size: 14px; cursor: pointer;
}
.mc-btn-ok {
  padding: 9px 18px; border: none; border-radius: 10px;
  background: var(--tg-blue); color: #fff; font-size: 14px; font-weight: 600;
  cursor: pointer;
}
.mc-btn-ok:disabled { opacity: .5; cursor: not-allowed; }

/* ── 频道广场 ── */
.mc-total { font-size: 12px; font-weight: 400; color: var(--tg-text-secondary); }
.disc-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: #fff;
  transition: background .15s;
}
.disc-item:active { background: var(--tg-gray-bg); }
.disc-avatar {
  width: 44px; height: 44px;
  border-radius: 14px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 18px; font-weight: 600;
  overflow: hidden;
}
.disc-avatar img { width: 100%; height: 100%; object-fit: cover; }
.disc-info { flex: 1; min-width: 0; }
.disc-name { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.mc-owner-tag { font-size: 10px; color: var(--tg-blue); background: rgba(51,144,236,.1); padding: 1px 5px; border-radius: 4px; }
.disc-desc {
  font-size: 12.5px; color: var(--tg-text-secondary);
  margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.disc-meta { font-size: 11.5px; color: #9BA1A8; margin-top: 3px; }
.disc-btn {
  flex-shrink: 0;
  padding: 6px 14px; border-radius: 8px; border: none;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  transition: opacity .15s;
}
.disc-btn:active { opacity: .7; }
.disc-btn.subscribe { background: var(--tg-blue); color: #fff; }
.disc-btn.subscribed { background: rgba(0,0,0,.06); color: var(--tg-text-secondary); }
.disc-btn.owned { background: rgba(51,144,236,.1); color: var(--tg-blue); }
.mc-discover-empty { padding: 20px; text-align: center; color: var(--tg-text-secondary); font-size: 13px; }
.mc-loading { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 20px; color: #909399; font-size: 13px; }
.mc-load-more { text-align: center; padding: 12px; color: var(--tg-blue); font-size: 13px; cursor: pointer; }
</style>
