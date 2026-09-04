$ErrorActionPreference = 'SilentlyContinue'
$base = 'http://192.168.9.253:9091'
$candidates = @('/api-docs-json','/api-docs.json','/api-docs/swagger.json','/api-docs','/swagger.json','/v3/api-docs','/openapi.json')
$json = $null
$hit = $null
foreach ($c in $candidates) {
  $url = $base + $c
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10
  if ($r.Content -match '"paths"') {
    $json = $r.Content | ConvertFrom-Json
    $hit = $c
    break
  }
}
if (-not $json) { Write-Output 'NO SWAGGER JSON'; exit 0 }
Write-Output ("HIT: " + $hit)
$found = $false
foreach ($p in $json.paths.PSObject.Properties) {
  if ($p.Name -match 'messages/\{conversationId\}') {
    $op = $p.Value.get
    if ($op) {
      Write-Output ("PATH KEY: " + $p.Name)
      Write-Output '=== GET /messages/{conversationId} parameters full schema ==='
      ($op.parameters | ConvertTo-Json -Depth 30)
      $found = $true
    }
  }
}
if (-not $found) { Write-Output 'TARGET PATH NOT FOUND' }