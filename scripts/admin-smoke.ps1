param(
  [string]$ApiBaseUrl,
  [string]$SupabaseUrl,
  [string]$SupabaseAnonKey,
  [string]$SupabaseServiceRoleKey,
  [string]$TestUserPassword,
  [string]$EnvFilePath,
  [bool]$CleanupUsers = $true
)

$ErrorActionPreference = 'Stop'

function Get-StatusCodeFromException($ex) {
  if ($ex.Exception.Response -and $ex.Exception.Response.StatusCode) { return [int]$ex.Exception.Response.StatusCode }
  return 0
}

function Invoke-JsonApi {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    $BodyObj
  )
  try {
    if ($null -ne $BodyObj) {
      $json = $BodyObj | ConvertTo-Json -Depth 10
      $resp = Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -ContentType 'application/json' -Body $json
    } else {
      $resp = Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers
    }
    return @{ status = 200; body = $resp }
  } catch {
    $status = Get-StatusCodeFromException $_
    $body = $null
    try {
      if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $text = $reader.ReadToEnd()
        if ($text) { $body = $text }
      }
    } catch {}
    return @{ status = $status; body = $body }
  }
}

function Parse-EnvFile {
  param([string]$Path)
  $map = @{}
  if (-not $Path -or -not (Test-Path $Path)) { return $map }
  $lines = Get-Content $Path
  foreach ($line in $lines) {
    $trim = $line.Trim()
    if (-not $trim -or $trim.StartsWith('#')) { continue }
    $idx = $trim.IndexOf('=')
    if ($idx -lt 1) { continue }
    $key = $trim.Substring(0, $idx).Trim()
    $value = $trim.Substring($idx + 1).Trim().Trim('"').Trim("'")
    $map[$key] = $value
  }
  return $map
}

function First-NonEmpty {
  param([string[]]$Values)
  foreach ($v in $Values) {
    if ($null -ne $v -and "$v".Trim().Length -gt 0) { return $v }
  }
  return $null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$candidateEnvFiles = @(
  $EnvFilePath,
  (Join-Path $projectRoot '.env.staging'),
  (Join-Path $projectRoot '.env'),
  (Join-Path $projectRoot 'apps/api-server/.env')
)

$envCombined = @{}
foreach ($f in $candidateEnvFiles) {
  $parsed = Parse-EnvFile -Path $f
  foreach ($k in $parsed.Keys) { if (-not $envCombined.ContainsKey($k)) { $envCombined[$k] = $parsed[$k] } }
}

$ApiBaseUrl = First-NonEmpty @(
  $ApiBaseUrl,
  $env:API_BASE_URL,
  $env:STAGING_API_BASE_URL,
  $envCombined['API_BASE_URL'],
  $envCombined['STAGING_API_BASE_URL'],
  'http://127.0.0.1:3001'
)

$SupabaseUrl = First-NonEmpty @(
  $SupabaseUrl,
  $env:SUPABASE_URL,
  $env:STAGING_SUPABASE_URL,
  $envCombined['SUPABASE_URL'],
  $envCombined['STAGING_SUPABASE_URL'],
  $envCombined['VITE_SUPABASE_URL']
)

$SupabaseAnonKey = First-NonEmpty @(
  $SupabaseAnonKey,
  $env:SUPABASE_ANON_KEY,
  $env:STAGING_SUPABASE_ANON_KEY,
  $envCombined['SUPABASE_ANON_KEY'],
  $envCombined['STAGING_SUPABASE_ANON_KEY'],
  $envCombined['VITE_SUPABASE_ANON_KEY']
)

$SupabaseServiceRoleKey = First-NonEmpty @(
  $SupabaseServiceRoleKey,
  $env:SUPABASE_SERVICE_ROLE_KEY,
  $env:STAGING_SUPABASE_SERVICE_ROLE_KEY,
  $envCombined['SUPABASE_SERVICE_ROLE_KEY'],
  $envCombined['STAGING_SUPABASE_SERVICE_ROLE_KEY']
)

$TestUserPassword = First-NonEmpty @(
  $TestUserPassword,
  $env:SMOKE_TEST_USER_PASSWORD,
  $env:STAGING_SMOKE_TEST_USER_PASSWORD,
  $envCombined['SMOKE_TEST_USER_PASSWORD'],
  $envCombined['STAGING_SMOKE_TEST_USER_PASSWORD'],
  'Password123!'
)

if (-not $SupabaseUrl -or -not $SupabaseAnonKey -or -not $SupabaseServiceRoleKey) {
  throw 'Missing required Supabase configuration. Provide SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (or STAGING_ variants).'
}

$health = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/health" -Headers @{} -BodyObj $null
if ($health.status -ne 200) {
  throw "API server not healthy at $ApiBaseUrl (status $($health.status))"
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$adminEmail = "admin.smoke.$ts@example.com"
$userEmail = "user.smoke.$ts@example.com"

$authAdminHeaders = @{ 'Authorization' = "Bearer $SupabaseServiceRoleKey"; 'apikey' = $SupabaseServiceRoleKey }
$createdUserIds = @()

try {
  $createAdmin = Invoke-JsonApi -Method 'POST' -Url "$SupabaseUrl/auth/v1/admin/users" -Headers $authAdminHeaders -BodyObj @{ email = $adminEmail; password = $TestUserPassword; email_confirm = $true; user_metadata = @{ name = 'Smoke Admin' } }
  $createUser = Invoke-JsonApi -Method 'POST' -Url "$SupabaseUrl/auth/v1/admin/users" -Headers $authAdminHeaders -BodyObj @{ email = $userEmail; password = $TestUserPassword; email_confirm = $true; user_metadata = @{ name = 'Smoke User' } }

  if ($createAdmin.status -ne 200 -or $createUser.status -ne 200) {
    throw "Failed creating users: admin=$($createAdmin.status) user=$($createUser.status)"
  }

  $adminUserId = $createAdmin.body.id
  $normalUserId = $createUser.body.id
  $createdUserIds += $adminUserId
  $createdUserIds += $normalUserId

  $setAdmin = Invoke-JsonApi -Method 'PUT' -Url "$SupabaseUrl/auth/v1/admin/users/$adminUserId" -Headers $authAdminHeaders -BodyObj @{ app_metadata = @{ is_platform_admin = $true } }
  if ($setAdmin.status -ne 200) { throw "Failed to set admin metadata ($($setAdmin.status))" }

  $authHeaders = @{ 'apikey' = $SupabaseAnonKey }
  $adminLogin = Invoke-JsonApi -Method 'POST' -Url "$SupabaseUrl/auth/v1/token?grant_type=password" -Headers $authHeaders -BodyObj @{ email = $adminEmail; password = $TestUserPassword }
  $userLogin = Invoke-JsonApi -Method 'POST' -Url "$SupabaseUrl/auth/v1/token?grant_type=password" -Headers $authHeaders -BodyObj @{ email = $userEmail; password = $TestUserPassword }
  if ($adminLogin.status -ne 200 -or $userLogin.status -ne 200) {
    throw "Failed login: admin=$($adminLogin.status) user=$($userLogin.status)"
  }

  $adminToken = $adminLogin.body.access_token
  $userToken = $userLogin.body.access_token
  if (-not $adminToken -or -not $userToken) { throw 'Missing access tokens' }

  $unauthAdminStats = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/admin/stats" -Headers @{} -BodyObj $null
  $nonAdminHeaders = @{ 'Authorization' = "Bearer $userToken" }
  $adminHeaders = @{ 'Authorization' = "Bearer $adminToken" }
  $nonAdminStats = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/admin/stats" -Headers $nonAdminHeaders -BodyObj $null
  $adminStats = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/admin/stats" -Headers $adminHeaders -BodyObj $null
  $adminUsers = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/admin/users?limit=5" -Headers $adminHeaders -BodyObj $null
  $adminReports = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/admin/reports?status=open&limit=5" -Headers $adminHeaders -BodyObj $null

  $unauthCompanionHistory = Invoke-JsonApi -Method 'GET' -Url "$ApiBaseUrl/api/v1/ai/companion/history?userId=$adminUserId" -Headers @{} -BodyObj $null

  $eventTag = "spoof_test_$ts"
  $spoofAttempt = Invoke-JsonApi -Method 'POST' -Url "$ApiBaseUrl/api/v1/ai/companion/analytics" -Headers $nonAdminHeaders -BodyObj @{ userId = $adminUserId; event = $eventTag; metadata = @{ source = 'smoke'; spoofed = $true; target = 'admin' } }

  $eventEncoded = [uri]::EscapeDataString($eventTag)
  $analyticsUrl = "$SupabaseUrl/rest/v1/ai_analytics?select=user_id,event,created_at&event=eq.$eventEncoded&order=created_at.desc&limit=1"
  $analyticsHeaders = @{ 'Authorization' = "Bearer $SupabaseServiceRoleKey"; 'apikey' = $SupabaseServiceRoleKey }
  $analyticsResp = Invoke-JsonApi -Method 'GET' -Url $analyticsUrl -Headers $analyticsHeaders -BodyObj $null

  $matchedUser = $null
  if ($analyticsResp.status -eq 200 -and $analyticsResp.body -and $analyticsResp.body.Count -gt 0) {
    $matchedUser = $analyticsResp.body[0].user_id
  }

  $checks = [ordered]@{
    admin_unauth_status = $unauthAdminStats.status
    admin_non_admin_status = $nonAdminStats.status
    admin_admin_stats_status = $adminStats.status
    admin_admin_users_status = $adminUsers.status
    admin_admin_reports_status = $adminReports.status
    companion_unauth_history_status = $unauthCompanionHistory.status
    companion_spoof_post_status = $spoofAttempt.status
    companion_spoof_stored_user_id = $matchedUser
    companion_spoof_expected_user_id = $normalUserId
    companion_spoof_ignored_client_user_id = ($matchedUser -eq $normalUserId)
  }

  $allPassed = (
    $checks.admin_unauth_status -eq 401 -and
    $checks.admin_non_admin_status -eq 403 -and
    $checks.admin_admin_stats_status -eq 200 -and
    $checks.admin_admin_users_status -eq 200 -and
    $checks.admin_admin_reports_status -eq 200 -and
    $checks.companion_unauth_history_status -eq 401 -and
    $checks.companion_spoof_post_status -eq 200 -and
    $checks.companion_spoof_ignored_client_user_id -eq $true
  )

  $result = [ordered]@{
    api_base_url = $ApiBaseUrl
    supabase_url = $SupabaseUrl
    seeded_admin_user_id = $adminUserId
    seeded_non_admin_user_id = $normalUserId
    cleanup_users_enabled = $CleanupUsers
    checks = $checks
    all_passed = $allPassed
  }

  $result | ConvertTo-Json -Depth 8
}
finally {
  if ($CleanupUsers -and $createdUserIds.Count -gt 0) {
    foreach ($uid in $createdUserIds) {
      if (-not $uid) { continue }
      [void](Invoke-JsonApi -Method 'DELETE' -Url "$SupabaseUrl/auth/v1/admin/users/$uid" -Headers $authAdminHeaders -BodyObj $null)
    }
  }
}
