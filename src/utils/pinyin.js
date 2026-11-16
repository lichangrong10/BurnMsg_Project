/**
 * 联系人按首字母分组（微信式）
 * - 中文：用 Intl.Collator('zh') 的拼音排序 + 基准字确定首字母（不依赖词典/第三方库）
 * - 英文：直接取大写首字母
 * - 其他（数字、符号）：归入 #
 */

const collator = new Intl.Collator('zh-Hans-CN', { sensitivity: 'base', numeric: true })

/** 各字母的"基准汉字"：汉字按拼音排序后，用二分法确定它属于哪个字母段 */
const ANCHORS = [
  ['A', '阿'], ['B', '八'], ['C', '擦'], ['D', '搭'], ['E', '蛾'], ['F', '发'],
  ['G', '噶'], ['H', '哈'], ['J', '击'], ['K', '喀'], ['L', '拉'], ['M', '妈'],
  ['N', '拿'], ['O', '哦'], ['P', '啪'], ['Q', '期'], ['R', '然'], ['S', '撒'],
  ['T', '塌'], ['W', '挖'], ['X', '昔'], ['Y', '压'], ['Z', '匝']
]

/** 取首字母：A-Z 或 # */
export function firstLetter(name) {
  const s = String(name || '').trim()
  if (!s) return '#'
  const ch = s[0]
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase()
  if (/[0-9]/.test(ch)) return '#'
  if (!/[\u4e00-\u9fa5]/.test(ch)) return '#'
  // 汉字：从后往前找最后一个"不大于"该字的基准字
  let result = '#'
  for (const [letter, anchor] of ANCHORS) {
    if (collator.compare(ch, anchor) >= 0) result = letter
    else break
  }
  return result
}

/** 按拼音排序（中文按拼音，英文按字母，数字自然序） */
export function compareByPinyin(a, b) {
  return collator.compare(String(a || ''), String(b || ''))
}

/** 分组：返回 [{ letter, list }]，字母升序，# 排最后 */
export function groupByLetter(items, nameOf) {
  const map = {}
  for (const it of items) {
    const letter = firstLetter(nameOf(it))
    ;(map[letter] = map[letter] || []).push(it)
  }
  for (const k of Object.keys(map)) map[k].sort((a, b) => compareByPinyin(nameOf(a), nameOf(b)))
  const letters = Object.keys(map).filter(k => k !== '#').sort()
  if (map['#']) letters.push('#')
  return letters.map(letter => ({ letter, list: map[letter] }))
}
