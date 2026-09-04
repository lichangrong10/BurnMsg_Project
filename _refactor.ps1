$ErrorActionPreference = 'Stop'
$path = 'E:\burnmsg-vue\src\views\ChatRoom.vue'
$enc = New-Object System.Text.UTF8Encoding($false)
$c = [System.IO.File]::ReadAllText($path, $enc)

$rx = [regex]'<span class="msg-meta">[\s\S]*?</span>[ \t]*\r?\n[ \t]*(?=<div v-if="burnVisible\(m\)")'
$m = $rx.Match($c)
if (-not $m.Success) { throw 'META_NOT_FOUND' }
$meta = $m.Value -replace '\s+$', ''
$c = $c.Remove($m.Index, $m.Length)

$rq = '<div v-if="replyQuote(m)" class="reply-quote" :class="{ out: m.sender_id === state.me.id, in: m.sender_id !== state.me.id }" @click.stop="jumpToReply(m)"><span class="rq-name">{{ replyQuote(m).name }}</span><span class="rq-text">{{ replyQuote(m).text }}</span></div>'

$ai = $c.IndexOf('{{ burnCountdown(m) }}')
if ($ai -lt 0) { throw 'BURN_NOT_FOUND' }
$p1 = $c.IndexOf('</div>', $ai)
$p2 = $c.IndexOf('</div>', $p1 + 6)
$ins = $p2 + 6

$metaLines = $meta -split '\r?\n' | ForEach-Object { $_.Trim() } | ForEach-Object { '            ' + $_ }
$metaInd = $metaLines -join "`r`n"

$chunk = "`r`n            " + $rq + "`r`n" + $metaInd
$c = $c.Insert($ins, $chunk)

$bodyIdx = $c.IndexOf('</div>', $ins + $chunk.Length)
$c = $c.Insert($bodyIdx + 6, "`r`n        </div>")

[System.IO.File]::WriteAllText($path, $c, $enc)
Write-Output 'REFACTOR_OK'