$ErrorActionPreference = 'Continue'
$base = 'http://192.168.9.253:9091'
$candidates = @('/api-docs-json','/api-docs.json','/api-docs/swagger.json','/api-docs','/swagger.json','/v3/api-docs','/openapi.json')
$doc = $null
foreach ($u in $candidates) {
  try {
    $r = Invoke-WebRequest -Uri ($base + $u) -TimeoutSec 8 -UseBasicParsing
    if ($r.Content -match '"paths"') {
      $doc = $r.Content | ConvertFrom-Json
      Write-Output ("FOUND SWAGGER JSON: " + $u)
      break
    }
  } catch { }
}
if (-not $doc) {
  Write-Output 'NO SWAGGER JSON FOUND'
  try {
    $h = (Invoke-WebRequest -Uri ($base + '/api-docs') -TimeoutSec 8 -UseBasicParsing).Content
    $m = [regex]::Matches($h, '(url|jsonUrl)[^,}<]+')
    foreach ($x in $m) { Write-Output ('HTML hint: ' + $x.Value) }
  } catch { }
  exit 1
}
foreach ($p in $doc.paths.PSObject.Properties) {
  if ($p.Name -match 'messages') {
    foreach ($m in $p.Value.PSObject.Properties) {
      Write-Output ('=== ' + $m.Name.ToUpper() + ' ' + $p.Name + ' ===')
      if ($m.Value.parameters) {
        foreach ($prm in $m.Value.parameters) {
          $def = ''
          if ($prm.schema -and $null -ne $prm.schema.default) { $def = [string]$prm.schema.default }
          Write-Output ('  param ' + $prm.name + ' in=' + $prm.in + ' required=' + $prm.required + ' default=' + $def)
        }
      } else {
        Write-Output '  (no parameters listed)'
      }
    }
  }
}