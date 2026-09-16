# F-02 PoC: authenticated users must not sign private profile avatars they cannot view.
param(
  [string]$SupabaseUrl = '',
  [string]$AnonKey = '',
  [string]$ServiceRoleKey = '',
  [string]$ApiBaseUrl = ''
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

function Get-UserJwt([string]$Email, [string]$Password) {
  $login = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-f02-poc/1.0' } `
    -ContentType 'application/json' `
    -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
  return $login.access_token
}

function New-AuthUser([string]$Email, [string]$Password, [string]$Name) {
  $user = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/admin/users" `
    -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{ email = $Email; password = $Password; email_confirm = $true; user_metadata = @{ name = $Name } } | ConvertTo-Json)
  # A wrong $SupabaseUrl (the Supabase *dashboard* URL instead of the project
  # API URL) answers this POST with a 200 HTML page. Invoke-RestMethod happily
  # returns that, .id is $null, and the first $user.id.Substring(0,8) blows up
  # 50 lines later with "You cannot call a method on a null-valued expression"
  # -- which says nothing about the real problem. Fail here, naming it.
  if (-not $user -or -not $user.id) {
    throw "Admin create-user did not return a user id. `$SupabaseUrl is probably not a Supabase project API URL (it must be https://<project-ref>.supabase.co -- Settings > API > Project URL -- not the dashboard URL). Response starts: $(([string]($user | ConvertTo-Json -Compress -Depth 3)) -replace '\s+', ' ' | ForEach-Object { if ($_.Length -gt 200) { $_.Substring(0,200) + '...' } else { $_ } })"
  }
  return $user
}

function Remove-AuthUser([string]$Id) {
  if ($Id) {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/auth/v1/admin/users/$Id" -Headers $script:AdminHeaders | Out-Null
  }
}

$rootEnv = Read-DotEnv (Join-Path $RepoRoot '.env')
$apiEnv = Read-DotEnv (Join-Path $RepoRoot 'apps/api-server/.env')
if (-not $SupabaseUrl) { $SupabaseUrl = $rootEnv['VITE_SUPABASE_URL'] }
if (-not $AnonKey) { $AnonKey = $rootEnv['VITE_SUPABASE_ANON_KEY'] }
if (-not $ServiceRoleKey) { $ServiceRoleKey = $apiEnv['SUPABASE_SERVICE_ROLE_KEY'] }
if (-not $ApiBaseUrl) { $ApiBaseUrl = $rootEnv['VITE_API_BASE_URL'] }

if (-not $SupabaseUrl -or -not $AnonKey -or -not $ServiceRoleKey) {
  throw 'Missing Supabase URL, anon key, or service role key (.env / apps/api-server/.env).'
}

# No production fallback. This PoC signs in against $SupabaseUrl and then calls
# $ApiBaseUrl with that JWT. If the two point at different projects — which is
# exactly what a silent fallback to the production API URL produces when the
# base URL is unset — every call 401s, the attacker probe reads as "blocked"
# for the wrong reason, and the step proves nothing. Fail loudly instead.
if (-not $ApiBaseUrl) {
  throw 'Missing VITE_API_BASE_URL (.env). In CI it comes from the VITE_SUPABASE_API_BASE_URL repository secret; point it at the API server that serves the SAME Supabase project as VITE_SUPABASE_URL.'
}

$script:AdminHeaders = @{
  Authorization = "Bearer $ServiceRoleKey"
  apikey        = $ServiceRoleKey
  'User-Agent'  = 'lantern-f02-poc/1.0'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$attackerId = $null
$victimId = $null
$avatarPath = $null

Write-Host "F-02 PoC against $ApiBaseUrl (storage signed-url)" -ForegroundColor Cyan

try {
  $attacker = New-AuthUser -Email "f02.attacker.$ts@example.com" -Password $password -Name 'F02 Attacker'
  $victim = New-AuthUser -Email "f02.victim.$ts@example.com" -Password $password -Name 'F02 Victim'
  $attackerId = $attacker.id
  $victimId = $victim.id
  $avatarPath = "$victimId/avatar-$ts.png"

  foreach ($u in @($attacker, $victim)) {
    $upsertHeaders = $script:AdminHeaders.Clone()
    $upsertHeaders['Prefer'] = 'resolution=merge-duplicates'
    Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/profiles" -Headers $upsertHeaders -ContentType 'application/json' `
      -Body (@{ id = $u.id; username = "f02$($u.id.Substring(0,8))"; name = $u.user_metadata.name } | ConvertTo-Json) | Out-Null
  }

  # Victim profile is private
  Invoke-RestMethod -Method PATCH -Uri "$SupabaseUrl/rest/v1/profiles?id=eq.$victimId" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{ settings = @{ privacy = @{ profileVisibility = 'private' } } } | ConvertTo-Json -Depth 6) | Out-Null

  # Seed avatar object so signed-url minting can succeed when access is allowed
  $pngBytes = [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==')
  $storagePath = "$SupabaseUrl/storage/v1/object/profile-avatars/$avatarPath"
  Invoke-RestMethod -Method POST -Uri $storagePath -Headers ($script:AdminHeaders.Clone()) `
    -ContentType 'image/png' -Body $pngBytes | Out-Null

  $attackerJwt = Get-UserJwt -Email $attacker.email -Password $password
  $apiHeaders = @{
    Authorization = "Bearer $attackerJwt"
    'Content-Type' = 'application/json'
    'X-Requested-With' = 'LanternStudy'
    'User-Agent' = 'lantern-f02-poc/1.0'
  }

  $signBlocked = $false
  $signStatus = 0
  $signBody = $null
  try {
    Invoke-RestMethod -Method POST -Uri "$ApiBaseUrl/api/v1/storage/signed-url" -Headers $apiHeaders `
      -Body (@{ bucket = 'profile-avatars'; path = $avatarPath } | ConvertTo-Json) | Out-Null
  } catch {
    if ($_.Exception.Response) {
      $signStatus = [int]$_.Exception.Response.StatusCode
      $signBlocked = $signStatus -in 401, 403
    }
    # PowerShell 7 carries the response body here; print it so a failing step
    # says WHY it failed instead of just showing a status.
    $signBody = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  }

  $victimJwt = Get-UserJwt -Email $victim.email -Password $password
  $victimHeaders = @{
    Authorization = "Bearer $victimJwt"
    'Content-Type' = 'application/json'
    'X-Requested-With' = 'LanternStudy'
    'User-Agent' = 'lantern-f02-poc/1.0'
  }
  $ownerAllowed = $false
  $ownerStatus = 0
  $ownerBody = $null
  try {
    $ownerResp = Invoke-WebRequest -Method POST -Uri "$ApiBaseUrl/api/v1/storage/signed-url" -Headers $victimHeaders `
      -Body (@{ bucket = 'profile-avatars'; path = $avatarPath } | ConvertTo-Json) -UseBasicParsing
    $ownerStatus = [int]$ownerResp.StatusCode
    $ownerAllowed = $ownerStatus -eq 200
  } catch {
    $ownerAllowed = $false
    if ($_.Exception.Response) {
      try { $ownerStatus = [int]$_.Exception.Response.StatusCode } catch {}
    }
    $ownerBody = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
  }

  Write-Host "attacker sign private avatar blocked: $signBlocked (expect True) status=$signStatus"
  if ($signBody) { Write-Host "  attacker response body: $signBody" }
  Write-Host "owner sign own avatar allowed: $ownerAllowed (expect True) status=$ownerStatus"
  if ($ownerBody) { Write-Host "  owner response body: $ownerBody" }

  $passed = $signBlocked -and $ownerAllowed
  $result = [ordered]@{
    finding = 'F-02 profile avatar signed-URL IDOR'
    attacker_sign_blocked = $signBlocked
    owner_sign_allowed = $ownerAllowed
    all_passed = $passed
  }
  $result | ConvertTo-Json
  if (-not $passed) { exit 1 }
}
finally {
  if ($avatarPath) {
    try {
      Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/storage/v1/object/profile-avatars/$avatarPath" -Headers $script:AdminHeaders | Out-Null
    } catch {}
  }
  Remove-AuthUser -Id $attackerId
  Remove-AuthUser -Id $victimId
}
