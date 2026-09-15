# Phase 3: assert client JWTs cannot EXECUTE API-only / anon-locked RPCs.
# Expects migration 20260725031426_phase3_definer_execute_hardening applied.
param(
  [string]$SupabaseUrl = '',
  [string]$AnonKey = '',
  [string]$ServiceRoleKey = ''
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

function Invoke-Supabase {
  param(
    [string]$Method,
    [string]$Path,
    [hashtable]$Headers,
    $Body = $null
  )
  $uri = "$SupabaseUrl$Path"
  $params = @{ Method = $Method; Uri = $uri; Headers = $Headers; UseBasicParsing = $true }
  if ($null -ne $Body) {
    $params.ContentType = 'application/json'
    $params.Body = ($Body | ConvertTo-Json -Compress -Depth 10)
  }
  try {
    $resp = Invoke-WebRequest @params
    return @{ ok = $true; status = [int]$resp.StatusCode; body = $resp.Content }
  } catch {
    $status = 0
    $body = $null
    $resp = $_.Exception.Response
    if ($resp) {
      try { $status = [int]$resp.StatusCode } catch { $status = 0 }
    }
    # Body capture, in the order that actually works on each host.
    #
    # PowerShell 7 (the ubuntu-latest CI runner) hands back a
    # System.Net.Http.HttpResponseMessage, which has NO GetResponseStream() —
    # the old code called it inside a swallowing `catch {}`, so every PoC
    # failure printed a bare status with an empty body and told you nothing.
    # PS7 puts the payload on $_.ErrorDetails.Message; Windows PowerShell 5.1
    # still needs the stream read. Try both, never swallow silently.
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $body = $_.ErrorDetails.Message
    } elseif ($resp -and $resp.PSObject.Properties['Content'] -and $resp.Content) {
      try { $body = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult() } catch {}
    } elseif ($resp -and $resp.PSObject.Methods['GetResponseStream']) {
      try {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
      } catch {}
    }
    if (-not $body) { $body = "(no response body; exception: $($_.Exception.Message))" }
    return @{ ok = $false; status = $status; body = $body }
  }
}

function Get-UserJwt([string]$Email, [string]$Password) {
  $login = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-phase3-definer-poc/1.0' } `
    -ContentType 'application/json' `
    -Body (@{ email = $Email; password = $Password } | ConvertTo-Json)
  return $login.access_token
}

function New-AuthUser([string]$Email, [string]$Password, [string]$Name) {
  return Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/admin/users" `
    -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{ email = $Email; password = $Password; email_confirm = $true; user_metadata = @{ name = $Name } } | ConvertTo-Json)
}

function Remove-AuthUser([string]$Id) {
  if (-not $Id) { return }
  try {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/auth/v1/admin/users/$Id" -Headers $script:AdminHeaders | Out-Null
  } catch {
    Write-Host "WARN cleanup user $Id failed: $($_.Exception.Message)" -ForegroundColor Yellow
  }
}

function Assert-Denied {
  param(
    [string]$Label,
    [hashtable]$Result
  )
  # PostgREST typically returns 401/403/404 for missing EXECUTE; also accept 400 with permission text.
  $denied = -not $Result.ok -and (
    $Result.status -in 401, 403, 404 -or
    ($Result.body -match 'permission denied|42501|PGRST202|Could not find the function')
  )
  if (-not $denied) {
    $script:failures += "$Label expected denial, got status=$($Result.status) body=$($Result.body)"
    Write-Host "FAIL $Label status=$($Result.status)" -ForegroundColor Red
  } else {
    Write-Host "PASS $Label (status=$($Result.status))" -ForegroundColor Green
  }
}

$rootEnv = Read-DotEnv (Join-Path $RepoRoot '.env')
$apiEnv = Read-DotEnv (Join-Path $RepoRoot 'apps/api-server/.env')
if (-not $SupabaseUrl) { $SupabaseUrl = $rootEnv['VITE_SUPABASE_URL'] }
if (-not $AnonKey) { $AnonKey = $rootEnv['VITE_SUPABASE_ANON_KEY'] }
if (-not $ServiceRoleKey) { $ServiceRoleKey = $apiEnv['SUPABASE_SERVICE_ROLE_KEY'] }

if (-not $SupabaseUrl -or -not $AnonKey -or -not $ServiceRoleKey) {
  throw 'Missing Supabase URL, anon key, or service role key (.env / apps/api-server/.env).'
}

$script:AdminHeaders = @{
  Authorization = "Bearer $ServiceRoleKey"
  apikey        = $ServiceRoleKey
  'User-Agent'  = 'lantern-phase3-definer-poc/1.0'
  Prefer        = 'return=representation'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$userId = $null
$failures = @()
$dummyUuid = '00000000-0000-4000-8000-000000000001'

Write-Host "Phase 3 DEFINER EXECUTE PoC against $SupabaseUrl" -ForegroundColor Cyan

try {
  $user = New-AuthUser -Email "phase3.definer.$ts@example.com" -Password $password -Name 'Phase3 Definer'
  $userId = $user.id
  $jwt = Get-UserJwt -Email "phase3.definer.$ts@example.com" -Password $password

  $authHeaders = @{
    Authorization = "Bearer $jwt"
    apikey        = $AnonKey
    'User-Agent'  = 'lantern-phase3-definer-poc/1.0'
  }
  $anonHeaders = @{
    apikey       = $AnonKey
    'User-Agent' = 'lantern-phase3-definer-poc/1.0'
  }

  # API-only: authenticated must not call
  Assert-Denied 'authenticated rpc/is_username_available' (Invoke-Supabase POST '/rest/v1/rpc/is_username_available' $authHeaders @{ check_username = 'phase3probe' })
  Assert-Denied 'authenticated rpc/profile_visible_to_viewer' (Invoke-Supabase POST '/rest/v1/rpc/profile_visible_to_viewer' $authHeaders @{ viewer_id = $userId; target_id = $dummyUuid })
  Assert-Denied 'authenticated rpc/marketplace_search_listings' (Invoke-Supabase POST '/rest/v1/rpc/marketplace_search_listings' $authHeaders @{ p_search = ''; p_page = 1; p_limit = 1 })

  # Anon must not call note helpers / username / search
  Assert-Denied 'anon rpc/can_read_note' (Invoke-Supabase POST '/rest/v1/rpc/can_read_note' $anonHeaders @{ p_note_id = $dummyUuid })
  Assert-Denied 'anon rpc/is_note_collaborator' (Invoke-Supabase POST '/rest/v1/rpc/is_note_collaborator' $anonHeaders @{ p_note_id = $dummyUuid })
  Assert-Denied 'anon rpc/is_username_available' (Invoke-Supabase POST '/rest/v1/rpc/is_username_available' $anonHeaders @{ check_username = 'phase3probe' })
  Assert-Denied 'anon rpc/marketplace_search_listings' (Invoke-Supabase POST '/rest/v1/rpc/marketplace_search_listings' $anonHeaders @{ p_search = ''; p_page = 1; p_limit = 1 })

  # service_role still works for API-only username check
  $svc = Invoke-Supabase POST '/rest/v1/rpc/is_username_available' $script:AdminHeaders @{ check_username = "phase3_unique_$ts" }
  if (-not $svc.ok) {
    $failures += "service_role is_username_available should succeed, got status=$($svc.status) body=$($svc.body)"
    Write-Host "FAIL service_role username check" -ForegroundColor Red
  } else {
    Write-Host "PASS service_role rpc/is_username_available" -ForegroundColor Green
  }
}
finally {
  Remove-AuthUser $userId
}

if ($failures.Count -gt 0) {
  Write-Host "`nPhase 3 DEFINER PoC FAILED:" -ForegroundColor Red
  $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "`nPhase 3 DEFINER PoC PASSED" -ForegroundColor Green
exit 0
