# Post-deploy security verification for API hardening.
param(
  [string]$ApiBaseUrl = 'https://lantern-study-api.onrender.com'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent

function Read-DotEnv([string]$Path) {
  $vars = @{}
  if (-not (Test-Path $Path)) { return $vars }
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^(?<k>[A-Za-z_][A-Za-z0-9_]*)=(?<v>.*)$') {
      $vars[$Matches.k] = $Matches.v.Trim().Trim('"').Trim("'")
    }
  }
  return $vars
}

function Invoke-Status {
  param([string]$Method, [string]$Url, [hashtable]$Headers = @{}, $Body = $null)
  try {
    $params = @{ Method = $Method; Uri = $Url; Headers = $Headers; UseBasicParsing = $true }
    if ($null -ne $Body) { $params.ContentType = 'application/json'; $params.Body = ($Body | ConvertTo-Json -Compress) }
    $resp = Invoke-WebRequest @params
    return @{ status = [int]$resp.StatusCode; body = $resp.Content }
  } catch {
    $status = 0
    $body = $null
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      } catch {}
    }
    return @{ status = $status; body = $body }
  }
}

$rootEnv = Read-DotEnv (Join-Path $RepoRoot '.env')
$apiEnv = Read-DotEnv (Join-Path $RepoRoot 'apps/api-server/.env')
$supabaseUrl = $rootEnv['VITE_SUPABASE_URL']
$anonKey = $rootEnv['VITE_SUPABASE_ANON_KEY']
$serviceKey = $apiEnv['SUPABASE_SERVICE_ROLE_KEY']
$password = 'Password123!'
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "security.verify.$ts@example.com"
$userId = $null
$apiSecret = $null

Write-Host "API: $ApiBaseUrl" -ForegroundColor Cyan

# 1) user-stats without JWT -> 401
$unauthStats = Invoke-Status -Method POST -Url "$ApiBaseUrl/api/v1/user-stats" -Body @{
  userId = '550e8400-e29b-41d4-a716-446655440000'
  questionId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
}
Write-Host "user-stats unauth: $($unauthStats.status) (expect 401)"

# 2) public marketplace read rate limit -> 429
$hit429 = $false
for ($i = 1; $i -le 80; $i++) {
  $r = Invoke-Status -Method GET -Url "$ApiBaseUrl/api/v1/marketplace/listings"
  if ($r.status -eq 429) { $hit429 = $true; Write-Host "rate limit hit on request $i"; break }
  if ($r.status -ne 200) { Write-Host "unexpected status on request $i : $($r.status)"; break }
}
Write-Host "marketplace rate limit 429: $hit429 (expect True)"

# 3) API key create + auth
$adminHeaders = @{
  Authorization = "Bearer $serviceKey"
  apikey        = $serviceKey
  'User-Agent'  = 'lantern-security-verify/1.0'
}
$createUser = Invoke-RestMethod -Method POST -Uri "$supabaseUrl/auth/v1/admin/users" -Headers $adminHeaders -ContentType 'application/json' -Body (@{
  email = $email; password = $password; email_confirm = $true; user_metadata = @{ name = 'Security Verify' }
} | ConvertTo-Json)
$userId = $createUser.id

$login = Invoke-RestMethod -Method POST -Uri "$supabaseUrl/auth/v1/token?grant_type=password" -Headers @{ apikey = $anonKey; 'User-Agent' = 'lantern-security-verify/1.0' } -ContentType 'application/json' -Body (@{ email = $email; password = $password } | ConvertTo-Json)
$jwt = $login.access_token

$createKey = Invoke-Status -Method POST -Url "$ApiBaseUrl/api/v1/api-keys" -Headers @{ Authorization = "Bearer $jwt" } -Body @{ name = "verify-$ts"; permissions = @('read') }
Write-Host "api-keys create: $($createKey.status) (expect 201)"
if ($createKey.body) {
  $parsed = $createKey.body | ConvertFrom-Json
  $apiSecret = $parsed.data.secret
}

$keyAuth = @{ status = 0 }
if ($apiSecret) {
  $keyAuth = Invoke-Status -Method GET -Url "$ApiBaseUrl/api/v1/decks" -Headers @{ 'X-API-Key' = $apiSecret }
  Write-Host "protected route with lsk key: $($keyAuth.status) (expect 200)"
}

# cleanup
if ($userId) {
  Invoke-RestMethod -Method DELETE -Uri "$supabaseUrl/auth/v1/admin/users/$userId" -Headers $adminHeaders | Out-Null
}

$passed = ($unauthStats.status -eq 401) -and $hit429 -and ($createKey.status -eq 201) -and ($keyAuth.status -eq 200)
$result = [ordered]@{
  user_stats_unauth = $unauthStats.status
  marketplace_rate_limited = $hit429
  api_key_create = $createKey.status
  api_key_auth = $keyAuth.status
  all_passed = $passed
}
$result | ConvertTo-Json
if (-not $passed) { exit 1 }
