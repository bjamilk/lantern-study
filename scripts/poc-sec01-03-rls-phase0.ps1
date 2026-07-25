# SEC-01 / SEC-02 / SEC-03 regression PoC (Phase 0 RLS hardening)
# Expects fixes applied: self cannot activate pending membership, pending cannot
# read group notes, participants cannot expand dm_threads.participant_ids.
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
    if ($_.Exception.Response) {
      $status = [int]$_.Exception.Response.StatusCode
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
      } catch {}
    }
    return @{ ok = $false; status = $status; body = $body }
  }
}

function Get-UserJwt([string]$Email, [string]$Password) {
  $login = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-sec01-03-poc/1.0' } `
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
  if ($Id) {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/auth/v1/admin/users/$Id" -Headers $script:AdminHeaders | Out-Null
  }
}

function UserHeaders([string]$Jwt) {
  return @{
    Authorization = "Bearer $Jwt"
    apikey        = $AnonKey
    'User-Agent'  = 'lantern-sec01-03-poc/1.0'
    Prefer        = 'return=representation'
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
  'User-Agent'  = 'lantern-sec01-03-poc/1.0'
  Prefer        = 'return=representation'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$ownerId = $null
$attackerId = $null
$outsiderId = $null
$groupId = $null
$noteId = $null
$threadId = $null
$failures = @()

Write-Host "SEC-01/02/03 PoC against $SupabaseUrl" -ForegroundColor Cyan

try {
  $owner = New-AuthUser -Email "sec0103.owner.$ts@example.com" -Password $password -Name 'SEC Owner'
  $attacker = New-AuthUser -Email "sec0103.attacker.$ts@example.com" -Password $password -Name 'SEC Attacker'
  $outsider = New-AuthUser -Email "sec0103.outsider.$ts@example.com" -Password $password -Name 'SEC Outsider'
  $ownerId = $owner.id
  $attackerId = $attacker.id
  $outsiderId = $outsider.id

  foreach ($u in @($owner, $attacker, $outsider)) {
    $upsertHeaders = $script:AdminHeaders.Clone()
    $upsertHeaders['Prefer'] = 'resolution=merge-duplicates,return=minimal'
    Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/profiles" -Headers $upsertHeaders -ContentType 'application/json' `
      -Body (@{ id = $u.id; username = ("s" + $u.id.Substring(0, 8)); name = $u.user_metadata.name } | ConvertTo-Json) | Out-Null
  }

  # Owner creates a private group + membership + group note (service role)
  $group = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/groups" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{
      name = "SEC Private $ts"
      description = 'phase0 rls'
      admin_ids = @($ownerId)
    } | ConvertTo-Json)
  $groupId = $group.id
  if (-not $groupId -and $group -is [array]) { $groupId = $group[0].id }

  Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/group_members" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{ group_id = $groupId; user_id = $ownerId; pending = $false } | ConvertTo-Json) | Out-Null

  $note = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/notes" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{
      user_id = $ownerId
      group_id = $groupId
      title = "Secret note $ts"
      body = 'classified study material for active members only'
      source_type = 'typed'
    } | ConvertTo-Json)
  $noteId = $note.id
  if (-not $noteId -and $note -is [array]) { $noteId = $note[0].id }

  $attackerJwt = Get-UserJwt -Email $attacker.email -Password $password
  $attackerHeaders = UserHeaders $attackerJwt

  # --- SEC-01: self-insert pending, then attempt self-activate ---
  $insertPending = Invoke-Supabase -Method POST -Path '/rest/v1/group_members' -Headers $attackerHeaders `
    -Body @{ group_id = $groupId; user_id = $attackerId; pending = $true }
  if (-not $insertPending.ok) {
    $failures += "SEC-01 setup: expected pending self-insert to succeed, got $($insertPending.status) $($insertPending.body)"
  }

  $activate = Invoke-Supabase -Method PATCH -Path "/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$attackerId" `
    -Headers $attackerHeaders -Body @{ pending = $false }
  if ($activate.ok) {
    $failures += "SEC-01 FAIL: attacker activated pending membership (status $($activate.status))"
  } else {
    Write-Host "SEC-01 PASS: pending self-activation blocked ($($activate.status))" -ForegroundColor Green
  }

  # Confirm still pending via service role
  $memberCheck = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$attackerId&select=pending" `
    -Headers $script:AdminHeaders
  $pendingStill = $true
  if ($memberCheck -is [array] -and $memberCheck.Count -gt 0) {
    $pendingStill = [bool]$memberCheck[0].pending
  } elseif ($memberCheck.pending -ne $null) {
    $pendingStill = [bool]$memberCheck.pending
  }
  if (-not $pendingStill) {
    $failures += 'SEC-01 FAIL: membership pending flag is false after blocked update'
  }

  # --- SEC-02: pending member must not read group note ---
  $noteRead = Invoke-Supabase -Method GET -Path "/rest/v1/notes?id=eq.$noteId&select=id,title" -Headers $attackerHeaders
  $noteBody = if ($noteRead.body) { $noteRead.body.Trim() } else { '' }
  $sawNote = $noteRead.ok -and $noteBody -ne '' -and $noteBody -ne '[]' -and $noteBody -notmatch '"id"\s*:\s*null'
  if ($sawNote -and $noteBody -match [regex]::Escape($noteId)) {
    $failures += "SEC-02 FAIL: pending member read group note ($noteBody)"
  } else {
    Write-Host "SEC-02 PASS: pending member cannot read group note" -ForegroundColor Green
  }

  # --- SEC-03: participant cannot expand participant_ids ---
  $sortedPair = @($ownerId, $attackerId) | Sort-Object
  $threadId = [guid]::NewGuid().ToString()
  Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/dm_threads" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{
      id = $threadId
      participant_ids = $sortedPair
      participants = @{}
      status = 'open'
    } | ConvertTo-Json)

  Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/rest/v1/dm_messages" -Headers $script:AdminHeaders -ContentType 'application/json' `
    -Body (@{
      thread_id = $threadId
      sender_id = $ownerId
      text = "private history $ts"
      timestamp = (Get-Date).ToUniversalTime().ToString('o')
    } | ConvertTo-Json) | Out-Null

  $expanded = @($ownerId, $attackerId, $outsiderId) | Sort-Object
  $expand = Invoke-Supabase -Method PATCH -Path "/rest/v1/dm_threads?id=eq.$threadId" `
    -Headers $attackerHeaders -Body @{ participant_ids = @($expanded) }
  if ($expand.ok) {
    $failures += "SEC-03 FAIL: participant expanded participant_ids (status $($expand.status))"
  } else {
    Write-Host "SEC-03 PASS: participant_ids expansion blocked ($($expand.status))" -ForegroundColor Green
  }

  $threadAfter = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/dm_threads?id=eq.$threadId&select=participant_ids" `
    -Headers $script:AdminHeaders
  $pids = @()
  if ($threadAfter -is [array] -and $threadAfter.Count -gt 0) {
    $pids = @($threadAfter[0].participant_ids)
  } elseif ($threadAfter.participant_ids) {
    $pids = @($threadAfter.participant_ids)
  }
  if ($pids -contains $outsiderId) {
    $failures += 'SEC-03 FAIL: outsider appears in participant_ids after blocked update'
  }

  $outsiderJwt = Get-UserJwt -Email $outsider.email -Password $password
  $outsiderHeaders = UserHeaders $outsiderJwt
  $history = Invoke-Supabase -Method GET -Path "/rest/v1/dm_messages?thread_id=eq.$threadId&select=id,text" -Headers $outsiderHeaders
  $historyBody = if ($history.body) { $history.body.Trim() } else { '' }
  if ($history.ok -and $historyBody -match 'private history') {
    $failures += "SEC-03 FAIL: outsider read DM history ($historyBody)"
  } else {
    Write-Host "SEC-03 PASS: outsider cannot read DM history" -ForegroundColor Green
  }

  if ($failures.Count -gt 0) {
    Write-Host "`nFAIL ($($failures.Count)):" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
    exit 1
  }

  Write-Host "`nAll SEC-01/02/03 checks passed." -ForegroundColor Green
  exit 0
}
finally {
  if ($noteId) {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/rest/v1/notes?id=eq.$noteId" -Headers $script:AdminHeaders -ErrorAction SilentlyContinue | Out-Null
  }
  if ($threadId) {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/rest/v1/dm_messages?thread_id=eq.$threadId" -Headers $script:AdminHeaders -ErrorAction SilentlyContinue | Out-Null
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/rest/v1/dm_threads?id=eq.$threadId" -Headers $script:AdminHeaders -ErrorAction SilentlyContinue | Out-Null
  }
  if ($groupId) {
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/rest/v1/group_members?group_id=eq.$groupId" -Headers $script:AdminHeaders -ErrorAction SilentlyContinue | Out-Null
    Invoke-RestMethod -Method DELETE -Uri "$SupabaseUrl/rest/v1/groups?id=eq.$groupId" -Headers $script:AdminHeaders -ErrorAction SilentlyContinue | Out-Null
  }
  Remove-AuthUser $ownerId
  Remove-AuthUser $attackerId
  Remove-AuthUser $outsiderId
}
