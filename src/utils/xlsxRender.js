/**
 * Excel(.xlsx) 带样式渲染为 HTML 表格
 * 用 exceljs 读取单元格样式（字体/颜色/填充/边框/对齐/数字格式/列宽行高/合并），
 * 尽量还原在 Excel 软件里打开的原生观感。
 * 注：.xls 老格式 exceljs 不支持，调用方需用 SheetJS 兜底。
 */

/** argb('FF3390EC'/'003390EC') → '#3390EC' */
function argb2hex(a) {
  return (a && typeof a === 'string' && a.length >= 6) ? '#' + a.slice(-6) : null
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 'A1' → { r:1, c:1 } */
function addrToRC(a) {
  const m = /^([A-Z]+)(\d+)$/.exec(a)
  if (!m) return null
  let c = 0
  for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
  return { r: +m[2], c }
}

/** 数字按 numFmt 粗略格式化（千分位/百分比/小数位） */
function fmtNum(v, fmt) {
  if (!fmt || fmt === 'General') return String(v)
  if (/%/.test(fmt)) {
    const d = (fmt.split('.')[1] || '').replace(/[^0#]/g, '').length
    return (v * 100).toFixed(d) + '%'
  }
  if (/#,##0/.test(fmt)) {
    const d = (fmt.split('.')[1] || '').replace(/[^0#]/g, '').length
    return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  }
  const dm = /^0\.(0+)$/.exec(fmt)
  if (dm) return v.toFixed(dm[1].length)
  return String(v)
}

/** 单元格显示文本（处理富文本/公式/日期/超链接/错误值） */
function cellText(cell) {
  let v = cell.value
  if (v == null) return ''
  if (v instanceof Date) return v.toLocaleDateString('zh-CN')
  if (typeof v === 'object') {
    if (v.richText) return esc(v.richText.map(t => t.text).join(''))
    if ('result' in v) v = v.result
    else if (v.error) return esc(v.error)
    else if (v.text != null) return esc(v.text)
    if (v == null) return ''
    if (v instanceof Date) return v.toLocaleDateString('zh-CN')
    if (typeof v === 'object') return ''
  }
  if (typeof v === 'number') return esc(fmtNum(v, cell.numFmt))
  return esc(String(v))
}

/** 单元格内联样式（还原 Excel 观感） */
function cellCss(cell) {
  const s = []
  const f = cell.font || {}
  if (f.bold) s.push('font-weight:600')
  if (f.italic) s.push('font-style:italic')
  const deco = []
  if (f.underline) deco.push('underline')
  if (f.strike) deco.push('line-through')
  if (deco.length) s.push('text-decoration:' + deco.join(' '))
  if (f.size) s.push('font-size:' + Math.max(9, Math.round(f.size * 4 / 3)) + 'px')
  if (f.name) s.push('font-family:' + f.name)
  const fc = f.color && argb2hex(f.color.argb)
  if (fc) s.push('color:' + fc)
  const fill = cell.fill
  if (fill && fill.type === 'pattern' && fill.pattern === 'solid') {
    const bg = fill.fgColor && argb2hex(fill.fgColor.argb)
    if (bg) s.push('background:' + bg)
  }
  const al = cell.alignment || {}
  if (al.horizontal) {
    const h = { centerContinuous: 'center', distributed: 'justify', fill: 'left', general: '' }[al.horizontal] ?? al.horizontal
    if (['left', 'center', 'right', 'justify'].includes(h)) s.push('text-align:' + h)
  }
  if (al.vertical === 'middle' || al.vertical === 'center') s.push('vertical-align:middle')
  else if (al.vertical === 'top') s.push('vertical-align:top')
  else if (al.vertical === 'bottom') s.push('vertical-align:bottom')
  s.push(al.wrapText ? 'white-space:pre-wrap' : 'white-space:nowrap')
  if (al.indent) s.push('padding-left:' + (8 + al.indent * 10) + 'px')
  const b = cell.border || {}
  const sides = { top: 'border-top', bottom: 'border-bottom', left: 'border-left', right: 'border-right' }
  for (const [k, prop] of Object.entries(sides)) {
    const side = b[k]
    if (!side || !side.style) continue
    const bw = { hair: '1px', thin: '1px', medium: '2px', thick: '3px', double: '3px' }[side.style] || '1px'
    const bs = { dashed: 'dashed', dotted: 'dotted', double: 'double' }[side.style] || 'solid'
    s.push(`${prop}:${bw} ${bs} ${argb2hex(side.color && side.color.argb) || '#000'}`)
  }
  return s.join(';')
}

/** 合并区域列表（兼容字符串区间与对象两种格式） */
function buildMerges(ws) {
  const list = []
  for (const it of (ws.model.merges || [])) {
    if (typeof it === 'string') {
      const [a, b] = it.split(':')
      const t = addrToRC(a), e = addrToRC(b || a)
      if (t && e) list.push({ r1: t.r, c1: t.c, r2: e.r, c2: e.c })
    } else if (it && it.top != null) {
      list.push({ r1: it.top, c1: it.left, r2: it.bottom, c2: it.right })
    }
  }
  return list
}

/**
 * 渲染单个 worksheet 为 HTML 表格字符串
 * @param ws ExcelJS Worksheet
 */
export function renderSheetHtml(ws) {
  const maxCol = Math.max(ws.columnCount || 1, 1)
  const maxRow = ws.rowCount || 0
  if (!maxRow) return '<div class="xr-empty">（空工作表）</div>'
  const merges = buildMerges(ws)
  const covered = new Set()
  const startMap = new Map()
  for (const mg of merges) {
    for (let r = mg.r1; r <= mg.r2; r++) {
      for (let c = mg.c1; c <= mg.c2; c++) {
        if (r === mg.r1 && c === mg.c1) startMap.set(r + ':' + c, mg)
        else covered.add(r + ':' + c)
      }
    }
  }
  let colgroup = ''
  for (let c = 1; c <= maxCol; c++) {
    const w = ws.getColumn(c).width
    colgroup += `<col style="width:${w ? Math.max(24, Math.round(w * 7 + 5)) : 80}px">`
  }
  let rows = ''
  for (let r = 1; r <= maxRow; r++) {
    const row = ws.getRow(r)
    const ht = row.height ? ` style="height:${Math.round(row.height * 4 / 3)}px"` : ''
    let tds = ''
    for (let c = 1; c <= maxCol; c++) {
      if (covered.has(r + ':' + c)) continue
      const mg = startMap.get(r + ':' + c)
      const span = mg ? ` colspan="${mg.c2 - mg.c1 + 1}" rowspan="${mg.r2 - mg.r1 + 1}"` : ''
      const cell = row.getCell(c)
      const css = cellCss(cell)
      tds += `<td${span}${css ? ` style="${css}"` : ''}>${cellText(cell)}</td>`
    }
    rows += `<tr${ht}>${tds}</tr>`
  }
  return `<table class="xr-table"><colgroup>${colgroup}</colgroup>${rows}</table>`
}
