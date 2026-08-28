<template>
  <div class="chat-page" style="background: var(--tg-gray-bg)">
    <div class="chat-topbar">
      <div class="topbar-icon" @click="state.showAdmin = false">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      </div>
      <div class="chat-title-wrap">
        <div class="chat-title">{{ tab === 'groups' ? '群组管理' : '账号管理' }}</div>
        <div class="chat-status">{{ tab === 'groups' ? ('共 ' + gtotal + ' 个群组') : ('共 ' + total + ' 个账号') }}</div>
      </div>
      <button v-if="tab === 'accounts'" class="btn-text" style="color:#fff;font-weight:600;font-size:14.5px" @click="openCreate">＋ 开通</button>
    </div>

    <!-- 页签：账号 / 群组 -->
    <div style="padding:10px 14px 6px;background:var(--tg-bg)">
      <div class="seg-wrap" style="margin-bottom:8px">
        <div class="seg-item" :class="{ on: tab === 'accounts' }" @click="switchTab('accounts')">账号</div>
        <div class="seg-item" :class="{ on: tab === 'groups' }" @click="switchTab('groups')">群组</div>
      </div>
      <template v-if="tab === 'accounts'">
        <!-- 搜索 + 状态筛选 -->
        <input class="input" v-model.trim="keyword" placeholder="搜索手机号 / 姓名" @input="onSearchInput">
        <div class="seg-wrap" style="margin-top:8px">
          <div class="seg-item" :class="{ on: status === '' }" @click="setStatus('')">全部</div>
          <div class="seg-item" :class="{ on: status === 'active' }" @click="setStatus('active')">启用中</div>
          <div class="seg-item" :class="{ on: status === 'disabled' }" @click="setStatus('disabled')">已停用</div>
        </div>
      </template>
      <template v-else>
        <!-- 群搜索 + 解散状态筛选 -->
        <input class="input" v-model.trim="gkeyword" placeholder="搜索群名称" @input="onGSearchInput">
        <div class="seg-wrap" style="margin-top:8px">
          <div class="seg-item" :class="{ on: !gIncludeDissolved }" @click="setGInclude(false)">进行中</div>
          <div class="seg-item" :class="{ on: gIncludeDissolved }" @click="setGInclude(true)">含已解散</div>
        </div>
      </template>
    </div>

    <!-- 账号列表 -->
    <div v-if="tab === 'accounts'" style="flex:1;overflow-y:auto">
      <div v-if="loading" class="empty-state"><div>加载中…</div></div>
      <div v-else-if="!list.length" class="empty-state"><div>没有匹配的账号</div></div>
      <div v-for="u in list" :key="u.id" class="contact-item" @click="actionTarget = u">
        <div class="avatar" :style="{ width: '42px', height: '42px', fontSize: '15px', background: avatarColor(u.display_name) }"><img v-if="avatarSrc(u)" :src="avatarSrc(u)" alt=""><template v-else>{{ (u.display_name || '?')[0] }}</template></div>
        <div class="contact-main">
          <div class="contact-name">
            {{ u.display_name }}
            <span v-if="u.role === 'admin'" class="mini-tag admin">管理员</span>
            <span v-if="u.status === 'disabled'" class="mini-tag off">已停用</span>
          </div>
          <div class="contact-sub">{{ u.phone }}<template v-if="u.department"> · {{ u.department }}</template></div>
        </div>
        <span style="color:var(--tg-text-secondary);margin-right:8px">›</span>
      </div>
    </div>

    <!-- 群组列表 -->
    <div v-else style="flex:1;overflow-y:auto">
      <div v-if="gloading" class="empty-state"><div>加载中…</div></div>
      <div v-else-if="!glist.length" class="empty-state"><div>没有匹配的群组</div></div>
      <div v-for="g in glist" :key="g.id" class="contact-item" @click="groupAction = g">
        <div class="avatar" :style="{ width: '42px', height: '42px', fontSize: '15px', background: avatarColor(g.name) }"><img v-if="avatarSrc(g)" :src="avatarSrc(g)" alt=""><template v-else>{{ (g.name || '?')[0] }}</template></div>
        <div class="contact-main">
          <div class="contact-name">
            {{ g.name }}
            <span v-if="g.is_channel" class="mini-tag admin">频道</span>
            <span v-if="g.dissolved_at" class="mini-tag off">已解散</span>
          </div>
          <div class="contact-sub">群主 {{ g.owner_name || '—' }} · {{ g.member_count ?? 0 }} 名成员</div>
        </div>
        <span style="color:var(--tg-text-secondary);margin-right:8px">›</span>
      </div>
    </div>

    <!-- 分页 -->
    <div class="pager" v-if="tab === 'accounts' && total > pageSize">
      <button class="btn-text" :style="{ opacity: page > 1 ? 1 : .35 }" @click="goPage(page - 1)">‹ 上一页</button>
      <span style="font-size:13px;color:var(--tg-text-secondary)">{{ page }} / {{ Math.max(1, Math.ceil(total / pageSize)) }}</span>
      <button class="btn-text" :style="{ opacity: page < Math.ceil(total / pageSize) ? 1 : .35 }" @click="goPage(page + 1)">下一页 ›</button>
    </div>
    <div class="pager" v-if="tab === 'groups' && gtotal > gpageSize">
      <button class="btn-text" :style="{ opacity: gpage > 1 ? 1 : .35 }" @click="goGPage(gpage - 1)">‹ 上一页</button>
      <span style="font-size:13px;color:var(--tg-text-secondary)">{{ gpage }} / {{ Math.max(1, Math.ceil(gtotal / gpageSize)) }}</span>
      <button class="btn-text" :style="{ opacity: gpage < Math.ceil(gtotal / gpageSize) ? 1 : .35 }" @click="goGPage(gpage + 1)">下一页 ›</button>
    </div>

    <!-- ═══ 开通账号（单个 / JSON 批量 / Excel 导入） ═══ -->
    <div v-if="showCreate" class="overlay" @click.self="showCreate = false">
      <div class="sheet">
        <div class="sheet-title">开通账号</div>
        <div class="seg-wrap" style="margin:0 16px 8px">
          <div class="seg-item" :class="{ on: createTab === 'single' }" @click="createTab = 'single'">单个开通</div>
          <div class="seg-item" :class="{ on: createTab === 'batch' }" @click="createTab = 'batch'">JSON 批量</div>
          <div class="seg-item" :class="{ on: createTab === 'excel' }" @click="createTab = 'excel'">Excel 导入</div>
        </div>
        <div style="overflow-y:auto;padding:0 16px">
          <template v-if="createTab === 'single'">
            <input class="input" v-model.trim="single.phone" placeholder="手机号（必填）" inputmode="numeric" maxlength="11" style="margin-bottom:8px">
            <input class="input" v-model.trim="single.display_name" placeholder="姓名（必填）" maxlength="100" style="margin-bottom:8px">
            <input class="input" v-model.trim="single.department" placeholder="部门（可选）" maxlength="100" style="margin-bottom:8px">
            <input class="input" v-model="single.password" placeholder="初始密码（留空自动生成）" style="margin-bottom:4px">
          </template>
          <template v-else-if="createTab === 'batch'">
            <textarea class="input" v-model="batchText" rows="7" placeholder='[{"phone":"13800138001","display_name":"张三","department":"技术部"}, ...]' style="font-family:monospace;font-size:12.5px"></textarea>
            <div style="font-size:12px;color:var(--tg-text-secondary);margin-top:4px">JSON 数组，1~500 条；phone / display_name 必填，department 可选</div>
          </template>
          <template v-else>
            <div class="import-tip">
            Excel 文件（.xlsx，≤5MB），列名支持 phone/手机号、display_name/姓名、department/部门
            </div>
            <input type="file" ref="excelInput" accept=".xlsx" style="display:none" @change="doImport">
            <div class="sheet-item" style="border:1px dashed var(--tg-border);border-radius:10px;margin:6px 0" @click="$refs.excelInput.click()">选择 xlsx 文件</div>
          </template>
        </div>
        <div v-if="createTab !== 'excel'" class="sheet-item" style="font-weight:600" @click="createTab === 'single' ? doCreateSingle() : doBatch()">提交</div>
        <div class="sheet-item sheet-cancel" @click="showCreate = false">取消</div>
      </div>
    </div>

    <!-- ═══ 账号操作菜单 ═══ -->
    <div v-if="actionTarget" class="overlay" @click.self="actionTarget = null">
      <div class="sheet">
        <div class="sheet-title">{{ actionTarget.display_name }} · {{ actionTarget.phone }}</div>
        <div class="sheet-item" @click="resetTarget = actionTarget; actionTarget = null">重置密码</div>
        <div class="sheet-item" :class="{ danger: actionTarget.status === 'active' }" @click="doToggle">
          {{ actionTarget.status === 'active' ? '停用账号（全端强制下线）' : '启用账号' }}
        </div>
        <div class="sheet-item sheet-cancel" @click="actionTarget = null">取消</div>
      </div>
    </div>

    <!-- ═══ 重置密码确认 ═══ -->
    <div v-if="resetTarget" class="dialog-overlay" @click.self="resetTarget = null">
      <div class="dialog">
        <div class="dialog-title">重置密码</div>
        <div class="dialog-body" style="display:flex;flex-direction:column;gap:8px">
          <div>为「{{ resetTarget.display_name }}」设置新密码：</div>
          <input class="input" v-model="resetPwdInput" placeholder="留空则自动生成随机密码">
        </div>
        <div class="dialog-actions">
          <button class="btn-text" @click="resetTarget = null">取消</button>
          <button class="btn-text" style="font-weight:600" @click="doResetPwd">确认重置</button>
        </div>
      </div>
    </div>

    <!-- ═══ 结果展示（新密码 / 批量结果） ═══ -->
    <div v-if="resultDialog" class="dialog-overlay" @click.self="resultDialog = null">
      <div class="dialog">
        <div class="dialog-title">{{ resultDialog.title }}</div>
        <div class="dialog-body" style="word-break:break-all;user-select:text">{{ resultDialog.text }}</div>
        <div class="dialog-actions">
          <button class="btn-text" style="font-weight:600" @click="resultDialog = null">知道了</button>
        </div>
      </div>
    </div>

    <!-- ═══ 群组操作菜单 ═══ -->
    <div v-if="groupAction" class="overlay" @click.self="groupAction = null">
      <div class="sheet">
        <div class="sheet-title">{{ groupAction.name }}</div>
        <div v-if="!groupAction.dissolved_at" class="sheet-item danger" @click="confirmForce = groupAction; groupAction = null">强制解散（留痕，消息保留供审计）</div>
        <div v-else class="sheet-item" style="color:var(--tg-text-secondary);pointer-events:none">该群已解散</div>
        <div class="sheet-item sheet-cancel" @click="groupAction = null">取消</div>
      </div>
    </div>

    <!-- ═══ 强制解散确认 ═══ -->
    <div v-if="confirmForce" class="dialog-overlay" @click.self="confirmForce = null">
      <div class="dialog">
        <div class="dialog-title">强制解散群组</div>
        <div class="dialog-body">确定要强制解散「{{ confirmForce.name }}」吗？解散后成员不可再发消息；消息与回执将保留供审计追溯（留痕，不做物理焚毁）。</div>
        <div class="dialog-actions">
          <button class="btn-text" @click="confirmForce = null">取消</button>
          <button class="btn-text" style="font-weight:600;color:#E53935" @click="doForceDissolve">强制解散</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { state, asArray, showToast } from '../store'
import { api } from '../api'
import { DEMO } from '../mock/demo'
import { avatarColor, avatarSrc } from '../utils/format'

export default {
  name: 'AdminView',
  data() {
    return {
      state,
      list: [],
      total: 0,
      page: 1,
      pageSize: 20,
      keyword: '',
      status: '',
      loading: false,
      searchTimer: null,
      showCreate: false,
      createTab: 'single',
      single: { phone: '', display_name: '', department: '', password: '' },
      batchText: '',
      actionTarget: null,
      resetTarget: null,
      resetPwdInput: '',
      resultDialog: null,
      // ── 群组管理 ──
      tab: 'accounts',
      glist: [],
      gtotal: 0,
      gpage: 1,
      gpageSize: 20,
      gkeyword: '',
      gIncludeDissolved: false,
      gloading: false,
      gsearchTimer: null,
      groupAction: null,
      confirmForce: null
    }
  },
  mounted() {
    this.load()
  },
  methods: {
    avatarColor,
    avatarSrc,
    switchTab(t) {
      if (this.tab === t) return
      this.tab = t
      if (t === 'groups' && !this.glist.length) this.loadGroups()
    },
    /* ─── 群组管理 ─── */
    async loadGroups() {
      this.gloading = true
      try {
        if (state.demoMode) {
          const k = this.gkeyword.toLowerCase()
          this.glist = DEMO.convs
            .filter(c => c.type === 'group')
            .filter(c => !k || (c.name || '').toLowerCase().includes(k))
            .filter(c => this.gIncludeDissolved || !c.dissolved_at)
            .map(c => ({ ...c, owner_name: c.owner_name || DEMO.me.display_name }))
          this.gtotal = this.glist.length
          return
        }
        const d = await api.getAdminGroups({
          page: this.gpage,
          pageSize: this.gpageSize,
          keyword: this.gkeyword || undefined,
          include_dissolved: this.gIncludeDissolved ? 'true' : undefined
        })
        this.glist = asArray(d)
        this.gtotal = (d && typeof d === 'object' && !Array.isArray(d) && typeof d.total === 'number') ? d.total : this.glist.length
      } catch (e) {
        showToast(e.message)
      } finally {
        this.gloading = false
      }
    },
    onGSearchInput() {
      clearTimeout(this.gsearchTimer)
      this.gsearchTimer = setTimeout(() => { this.gpage = 1; this.loadGroups() }, 400)
    },
    setGInclude(v) {
      this.gIncludeDissolved = v
      this.gpage = 1
      this.loadGroups()
    },
    goGPage(p) {
      const max = Math.max(1, Math.ceil(this.gtotal / this.gpageSize))
      if (p < 1 || p > max) return
      this.gpage = p
      this.loadGroups()
    },
    async doForceDissolve() {
      const g = this.confirmForce
      this.confirmForce = null
      if (state.demoMode) {
        g.dissolved_at = new Date().toISOString()
        showToast('已强制解散（模拟）')
        return
      }
      try {
        await api.adminDissolveGroup(g.id)
        showToast('已强制解散（留痕）')
        this.loadGroups()
      } catch (e) {
        showToast(e.message)
      }
    },
    async load() {
      this.loading = true
      try {
        if (state.demoMode) {
          const all = [DEMO.me, ...DEMO.users]
          const k = this.keyword.toLowerCase()
          this.list = all.filter(u =>
            (!k || (u.display_name || '').toLowerCase().includes(k) || (u.phone || '').includes(k)) &&
            (!this.status || u.status === this.status)
          )
          this.total = this.list.length
          return
        }
        const d = await api.getAccounts({ page: this.page, pageSize: this.pageSize, keyword: this.keyword || undefined, status: this.status || undefined })
        this.list = asArray(d)
        this.total = (d && typeof d === 'object' && !Array.isArray(d) && typeof d.total === 'number') ? d.total : this.list.length
      } catch (e) {
        showToast(e.message)
      } finally {
        this.loading = false
      }
    },
    onSearchInput() {
      clearTimeout(this.searchTimer)
      this.searchTimer = setTimeout(() => { this.page = 1; this.load() }, 400)
    },
    setStatus(s) {
      this.status = s
      this.page = 1
      this.load()
    },
    goPage(p) {
      const max = Math.max(1, Math.ceil(this.total / this.pageSize))
      if (p < 1 || p > max) return
      this.page = p
      this.load()
    },
    openCreate() {
      this.createTab = 'single'
      this.single = { phone: '', display_name: '', department: '', password: '' }
      this.batchText = ''
      this.showCreate = true
    },
    async doCreateSingle() {
      if (!/^1\d{10}$/.test(this.single.phone)) { showToast('请输入 11 位手机号'); return }
      if (!this.single.display_name) { showToast('请输入姓名'); return }
      if (state.demoMode) {
        this.showCreate = false
        showToast('已开通（模拟）')
        return
      }
      try {
        const payload = { phone: this.single.phone, display_name: this.single.display_name }
        if (this.single.department) payload.department = this.single.department
        if (this.single.password) payload.password = this.single.password
        const u = await api.createAccount(payload)
        this.showCreate = false
        if (u && u.initial_password) {
          this.resultDialog = { title: '账号已开通，初始密码仅显示一次', text: `${u.display_name}（${u.phone}）\n初始密码：${u.initial_password}` }
        } else {
          showToast('账号已开通')
        }
        this.load()
      } catch (e) {
        showToast(e.message)
      }
    },
    async doBatch() {
      let arr
      try {
        arr = JSON.parse(this.batchText)
        if (arr && !Array.isArray(arr) && Array.isArray(arr.accounts)) arr = arr.accounts
        if (!Array.isArray(arr) || !arr.length) throw new Error('empty')
      } catch (e) {
        showToast('JSON 格式不正确，应为账号数组')
        return
      }
      if (state.demoMode) {
        this.showCreate = false
        showToast(`已批量开通 ${arr.length} 个账号（模拟）`)
        return
      }
      try {
        const r = await api.batchCreateAccounts(arr)
        this.showCreate = false
        const okCount = (r && (r.success_count ?? r.succeeded ?? r.success)) ?? null
        const failCount = (r && (r.fail_count ?? r.failed)) ?? null
        this.resultDialog = {
          title: '批量开通完成',
          text: okCount !== null ? `成功 ${okCount} 个，失败 ${failCount ?? 0} 个` : '操作完成，明细已打印到控制台'
        }
        if (okCount === null) console.log('[焚信] 批量开通结果：', r)
        this.load()
      } catch (e) {
        showToast(e.message)
      }
    },
    async doImport(e) {
      const file = e.target.files[0]
      e.target.value = ''
      if (!file) return
      if (file.size > 5 * 1024 * 1024) { showToast('文件不能超过 5MB'); return }
      if (state.demoMode) {
        this.showCreate = false
        showToast('已导入（模拟）')
        return
      }
      showToast('导入中…')
      try {
        const r = await api.importAccounts(file)
        this.showCreate = false
        const okCount = (r && (r.success_count ?? r.succeeded ?? r.success)) ?? null
        this.resultDialog = {
          title: 'Excel 导入完成',
          text: okCount !== null ? `成功 ${okCount} 条` : '操作完成，明细已打印到控制台'
        }
        if (okCount === null) console.log('[焚信] 导入结果：', r)
        this.load()
      } catch (e) {
        showToast(e.message)
      }
    },
    async doResetPwd() {
      const u = this.resetTarget
      const pwd = this.resetPwdInput
      this.resetTarget = null
      this.resetPwdInput = ''
      if (state.demoMode) {
        showToast('密码已重置（模拟）')
        return
      }
      try {
        const r = await api.resetAccountPassword(u.id, pwd || undefined)
        const newPwd = r && (r.new_password || r.initial_password || (r.data && r.data.new_password))
        if (newPwd) {
          this.resultDialog = { title: '密码已重置，新密码仅显示一次', text: `${u.display_name}（${u.phone}）\n新密码：${newPwd}` }
        } else {
          showToast('密码已重置')
        }
      } catch (e) {
        showToast(e.message)
      }
    },
    async doToggle() {
      const u = this.actionTarget
      this.actionTarget = null
      const next = u.status === 'active' ? 'disabled' : 'active'
      if (state.demoMode) {
        u.status = next
        showToast(next === 'disabled' ? '已停用（模拟）' : '已启用（模拟）')
        return
      }
      try {
        await api.toggleAccountStatus(u.id, next)
        showToast(next === 'disabled' ? '已停用，该账号全端强制下线' : '已启用')
        this.load()
      } catch (e) {
        showToast(e.message)
      }
    }
  }
}
</script>

<style scoped>
.seg-wrap { display: flex; background: var(--tg-gray-bg); border-radius: 10px; padding: 3px; }
.seg-item { flex: 1; text-align: center; padding: 6px 0; font-size: 13.5px; border-radius: 8px; cursor: pointer; color: var(--tg-text-secondary); }
.seg-item.on { background: var(--tg-bg); color: var(--tg-blue); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.mini-tag { font-size: 10.5px; padding: 1px 6px; border-radius: 7px; margin-left: 5px; font-weight: 500; }
.mini-tag.admin { color: var(--tg-blue); background: rgba(0,0,0,.07); }
.mini-tag.off { color: #E53935; background: rgba(229,57,53,.1); }
.pager { display: flex; align-items: center; justify-content: space-between; padding: 8px 16px calc(10px + var(--safe-bottom)); background: var(--tg-bg); border-top: 1px solid var(--tg-border); }
.import-tip { font-size: 12.5px; color: var(--tg-text-secondary); line-height: 1.6; padding: 4px 0; }
</style>
