# -*- coding: utf-8 -*-
"""群默认头像：微信风格 2x2 宫格（取前 4 个成员的昵称首字/头像）"""
import io, re

STORE = r"E:\burnmsg-vue\src\store\index.js"
CHATS = r"E:\burnmsg-vue\src\views\Chats.vue"
log = []

# ── ① store：群成员缩略缓存 ──
t = io.open(STORE, encoding="utf-8").read()
if "groupThumbs: {}" not in t:
    t = t.replace("  groupMembers: [],", "  groupThumbs: {},          // 群头像宫格缓存：groupId -> [{name, avatar}]\n  groupMembers: [],", 1)
    log.append("[OK] state.groupThumbs")

if "export async function ensureGroupThumbs" not in t:
    fn = '''/** 懒加载群成员缩略（用于群默认头像的 2x2 宫格），带缓存 */
export async function ensureGroupThumbs(ids) {
  const list = (ids || []).filter(id => id && !state.groupThumbs[id])
  if (!list.length) return
  for (const id of list.slice(0, 12)) {
    try {
      const arr = await api.getGroupMembers(id)
      const members = Array.isArray(arr) ? arr : (arr && (arr.list || arr.items)) || []
      state.groupThumbs[id] = members.slice(0, 4).map(m => {
        const u = m.user || m
        return { name: u.display_name || u.name || '', avatar: u.avatar_url || m.avatar_url || null }
      })
    } catch (e) { state.groupThumbs[id] = [] }
  }
}

'''
    anchor = "export async function loadConvs(quiet) {"
    if anchor in t:
        t = t.replace(anchor, fn + anchor, 1)
        log.append("[OK] ensureGroupThumbs")
io.open(STORE, "w", encoding="utf-8").write(t)

# ── ② Chats.vue：模板 + 逻辑 + 样式 ──
c = io.open(CHATS, encoding="utf-8").read()

old_avatar = '''<div class="avatar" :style="{ width: '52px', height: '52px', fontSize: '19px', background: avatarColor(c.type === 'private' ? String((c.other_user && c.other_user.id) || convName(c)) : convName(c)) }"'''
new_avatar = '''<div v-if="c.type === 'group' && !convAvatar(c) && quadMembers(c).length" class="avatar avatar-quad" :style="{ width: '52px', height: '52px' }">
          <span v-for="(m, i) in quadMembers(c)" :key="i" class="quad-cell" :style="{ background: avatarColor(m.name || '?') }">
            <img v-if="m.avatar" :src="m.avatar" alt=""><template v-else>{{ (m.name || '?')[0] }}</template>
          </span>
          <span v-for="n in (4 - quadMembers(c).length)" :key="'e' + n" class="quad-cell quad-empty"></span>
        </div>
        <div v-else class="avatar" :style="{ width: '52px', height: '52px', fontSize: '19px', background: avatarColor(c.type === 'private' ? String((c.other_user && c.other_user.id) || convName(c)) : convName(c)) }"'''
if old_avatar in c:
    c = c.replace(old_avatar, new_avatar, 1)
    log.append("[OK] quad avatar markup")

# 方法 + watch
if "quadMembers(c)" in c and "quadMembers(c) {" not in c:
    c = c.replace("  methods: {", """  methods: {
    /** 群默认头像宫格成员（无自定义头像时用） */
    quadMembers(c) {
      if (!c || c.type !== 'group' || convAvatar(c)) return []
      return (state.groupThumbs && state.groupThumbs[c.id]) || []
    },""", 1)
    c = c.replace("  mounted() {", """  mounted() {
    this.syncGroupThumbs()
  },
  watch: {
    filteredConvs() { this.syncGroupThumbs() }
  },
  created() {},
  methods2() {""", 1)
    log.append("[OK] quadMembers (partial)")
io.open(CHATS, "w", encoding="utf-8").write(c)
print("\n".join(log))
