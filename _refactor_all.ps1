$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)

function Rep {
  param([string]$Text, [string]$Old, [string]$New)
  if (-not $Text.Contains($Old)) { throw "NOT_FOUND: $Old" }
  return $Text.Replace($Old, $New)
}

# ============ 1. ChatRoom.vue : template refactor (move msg-meta out, insert reply-quote) ============
$vuePath = 'E:\burnmsg-vue\src\views\ChatRoom.vue'
$vue = [IO.File]::ReadAllText($vuePath, $enc)

$rx = [regex]'<span class="msg-meta">[\s\S]*?</span>[ \t]*\r?\n[ \t]*(?=<div v-if="burnVisible\(m\)")'
$m = $rx.Match($vue)
if (-not $m.Success) { throw 'META_NOT_FOUND' }
$meta = $m.Value -replace '\s+$', ''
$vue = $vue.Remove($m.Index, $m.Length)

$rq = '<div v-if="replyQuote(m)" class="reply-quote" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }" @click.stop="jumpToReply(m)"><span class="rq-name">{{ replyQuote(m).name }}</span><span class="rq-text">{{ replyQuote(m).text }}</span></div>'

$ai = $vue.IndexOf('{{ burnCountdown(m) }}')
if ($ai -lt 0) { throw 'BURN_NOT_FOUND' }
$p1 = $vue.IndexOf('</div>', $ai)
$p2 = $vue.IndexOf('</div>', $p1 + 6)
$ins = $p2 + 6

$metaLines = $meta -split '\r?\n' | ForEach-Object { $_.Trim() } | ForEach-Object { '            ' + $_ }
$metaInd = $metaLines -join "`r`n"
$chunk = "`r`n            " + $rq + "`r`n" + $metaInd
$vue = $vue.Insert($ins, $chunk)
$bodyIdx = $vue.IndexOf('</div>', $ins + $chunk.Length)
$vue = $vue.Insert($bodyIdx + 6, "`r`n        </div>")

# ============ 2. ChatRoom.vue : scoped css (reply-quote + read-tag) ============
$vue = Rep $vue '.reply-quote { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; margin-bottom: 0; padding: 5px 8px 6px; border-radius: 6px; cursor: pointer; max-width: 100%; }' '.reply-quote { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; margin-bottom: 0; padding: 5px 8px 6px; border-radius: 6px; cursor: pointer; max-width: 100%; background: rgba(51,144,236,.07); border-left: 2px solid var(--tg-blue); }'
$vue = Rep $vue '.reply-quote.out .rq-name { color: #fff; }' ''
$vue = Rep $vue '.reply-quote.out .rq-text { color: rgba(255,255,255,.78); }' ''
$vue = Rep $vue '.reply-quote.out { text-align: left; margin-left: 0; background: rgba(255,255,255,.16); border-right: 2px solid rgba(255,255,255,.7); }' '.reply-quote.out { text-align: left; margin-left: 0; }'
$vue = Rep $vue '.reply-quote.in { text-align: left; margin-right: 0; background: rgba(51,144,236,.07); border-left: 2px solid var(--tg-blue); }' '.reply-quote.in { text-align: left; margin-right: 0; }'
$vue = Rep $vue '.bubble.out .read-tag { color: var(--tg-green-check); }' '.msg-body.out .read-tag { color: var(--tg-green-check); }'
$vue = Rep $vue '.bubble.out .read-tag.unread { color: var(--tg-text-secondary); }' '.msg-body.out .read-tag.unread { color: var(--tg-text-secondary); }'

# ============ 3. main.css : msg-body wrapper + msg-meta selectors ============
$cssPath = 'E:\burnmsg-vue\src\assets\main.css'
$css = [IO.File]::ReadAllText($cssPath, $enc)

$css = Rep $css '.msg-row.in:has(.sender-name) { margin-top: 21px; }' ('.msg-row.in:has(.sender-name) { margin-top: 21px; }' + "`r`n.msg-body { display: flex; flex-direction: column; align-items: flex-start; max-width: 76%; min-width: 0; }" + "`r`n.msg-row.out .msg-body { align-items: flex-end; }")
$css = Rep $css '  max-width: 76%; padding: 7px 10px 6px; border-radius: var(--radius-lg); position: relative;' '  max-width: 100%; padding: 7px 10px 6px; border-radius: var(--radius-lg); position: relative;'
$css = Rep $css '.bubble .msg-meta { position: absolute; top: 100%; right: 6px; float: none; display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--tg-text-secondary); margin: 3px 0 0 0; user-select: none; white-space: nowrap; }' '.msg-body .msg-meta { align-self: flex-end; display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--tg-text-secondary); margin: 3px 0 0 0; user-select: none; white-space: nowrap; }'
$css = Rep $css '.bubble.out .msg-meta { color: var(--tg-text-secondary); }' '.msg-body.out .msg-meta { color: var(--tg-text-secondary); }'
$css = Rep $css '.bubble.img .msg-meta { position: absolute; top: 100%; right: 6px; float: none; margin: 3px 0 0 0; padding: 0; background: transparent; color: var(--tg-text-secondary); border-radius: 0; font-size: 11px; white-space: nowrap; }' '.msg-body.img .msg-meta { align-self: flex-end; margin: 3px 0 0 0; padding: 0; background: transparent; color: var(--tg-text-secondary); border-radius: 0; font-size: 11px; white-space: nowrap; }'
$css = Rep $css '.bubble.img .msg-meta .read-tag { color: var(--tg-green-check); }' '.msg-body.img .msg-meta .read-tag { color: var(--tg-green-check); }'
$css = Rep $css '.bubble.img .msg-meta .read-tag.unread { color: var(--tg-text-secondary); }' '.msg-body.img .msg-meta .read-tag.unread { color: var(--tg-text-secondary); }'
$css = Rep $css '.bubble.video .msg-meta { position: static; float: right; margin: 5px 0 0 6px; padding: 2px 7px; background: var(--tg-blue-tint); color: var(--tg-blue); border-radius: 10px; font-size: 11px; }' '.msg-body.video .msg-meta { align-self: flex-end; margin: 5px 0 0 6px; padding: 2px 7px; background: var(--tg-blue-tint); color: var(--tg-blue); border-radius: 10px; font-size: 11px; }'
$css = Rep $css '.bubble.video .msg-meta .read-tag { color: var(--tg-green-check); }' '.msg-body.video .msg-meta .read-tag { color: var(--tg-green-check); }'
$css = Rep $css '.bubble.video .msg-meta .read-tag.unread { color: var(--tg-text-secondary); }' '.msg-body.video .msg-meta .read-tag.unread { color: var(--tg-text-secondary); }'

# ============ 4. write back ============
[IO.File]::WriteAllText($vuePath, $vue, $enc)
[IO.File]::WriteAllText($cssPath, $css, $enc)
Write-Output 'ALL_OK'