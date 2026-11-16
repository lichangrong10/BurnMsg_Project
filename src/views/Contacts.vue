<template>
  <div>
    <div v-if="!filteredContacts.length" class="empty-state"><div>未找到联系人</div></div>
    <template v-for="g in groupedContacts" :key="g.letter">
      <div class="section-header" :id="'sec-' + g.letter">{{ g.letter }}</div>
      <div v-for="u in g.list" :key="u.id" class="contact-item" @click="startChatWith(u)">
        <div class="avatar-wrap">
          <div class="avatar" :style="{ width: '46px', height: '46px', fontSize: '17px', background: avatarColor(u.display_name) }"><img v-if="avatarSrc(u)" :src="avatarSrc(u)" alt=""><template v-else>{{ (u.display_name || '?')[0] }}</template></div>
          <!-- 在线圆点：绿=在线，灰=离线；未取到在线态时不显示 -->
          <span v-if="userOnline(u) !== null" class="online-dot" :class="{ on: userOnline(u) }" :title="userOnline(u) ? '在线' : '离线'"></span>
        </div>
        <div class="contact-main">
          <div class="contact-name">{{ u.display_name }}<span v-if="userOnline(u)" class="online-tag">在线</span></div>
          <div class="contact-sub">{{ u.phone }}<template v-if="u.signature"> · {{ u.signature }}</template></div>
        </div>
      </div>
    </template>
    <!-- 右侧字母索引：点击跳到对应分组 -->
    <div class="alpha-index" v-if="groupedContacts.length">
      <span v-for="g in groupedContacts" :key="g.letter" class="alpha-item" @click.stop="jumpTo(g.letter)">{{ g.letter }}</span>
    </div>
  </div>
</template>

<script>
import { state, startChatWith, openCreateGroup, isUserOnline } from '../store'
import { avatarColor, avatarSrc } from '../utils/format'
import { groupByLetter } from '../utils/pinyin'

export default {
  name: 'ContactsView',
  data() {
    return { state }
  },
  computed: {
    filteredContacts() {
      const k = state.keyword.toLowerCase()
      const list = Array.isArray(state.contacts) ? state.contacts : []
      return list.filter(u => !k || (u.display_name || '').toLowerCase().includes(k) || (u.phone || '').includes(k))
    },
    groupedContacts() {
      return groupByLetter(this.filteredContacts, u => (u.display_name || u.phone || ''))
    },
  },
  methods: {
    /** 点击右侧字母 → 滚动到对应分组 */
    jumpTo(letter) {
      const el = document.getElementById('sec-' + letter)
      if (!el) return
      const scroller = el.closest('.content-scroll')
      if (scroller) scroller.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' })
      else el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    openCreateGroup,
    startChatWith,
    avatarColor,
    avatarSrc,
    /** 是否在线：true/false；数据未到返回 null（不显示圆点） */
    userOnline(u) {
      if (!u || u.id == null) return null
      const v = isUserOnline(u.id)
      return v === null ? null : v === true
    }
  }
}
</script>

<style scoped>
.avatar-wrap { position: relative; flex-shrink: 0; display: inline-flex; align-self: center; }
.online-dot {
  position: absolute; right: -1px; bottom: -1px;
  width: 12px; height: 12px; border-radius: 50%;
  background: #C4C9CE; border: 2px solid var(--tg-bg, #fff);
  box-sizing: border-box;
}
.online-dot.on { background: #31C48D; }
.online-tag {
  margin-left: 6px; font-size: 11px; line-height: 15px;
  color: #31C48D; border: 1px solid #31C48D;
  border-radius: 4px; padding: 0 4px; vertical-align: 1px;
}

  /* 分组头吸顶，滚动时始终显示当前字母 */
  .section-header {
    position: sticky; top: 0; z-index: 3;
    background: #F0F2F5; padding: 5px 14px; font-size: 12.5px;
    color: #6B7280; font-weight: 600; letter-spacing: .3px;
  }

  /* 右侧字母索引条 */
  .alpha-index {
    position: fixed; right: 1px; top: 50%; transform: translateY(-50%);
    display: flex; flex-direction: column; align-items: center;
    gap: 0; z-index: 30; padding: 4px 2px;
    border-radius: 12px; background: rgba(255,255,255,.55);
    backdrop-filter: blur(4px);
  }
  .alpha-item {
    font-size: 10px; line-height: 1.35; color: var(--tg-blue, #2A9D8F);
    font-weight: 600; padding: 0 4px; cursor: pointer; user-select: none;
  }
  .alpha-item:active { transform: scale(1.3); color: #fff; background: var(--tg-blue); border-radius: 6px; }
</style>
