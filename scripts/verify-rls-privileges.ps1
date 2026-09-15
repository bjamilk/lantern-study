# Verify RLS privilege boundaries (profiles escalation, platform tables, group admin).
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
    $Body = $null,
    [switch]$PreferMinimal
  )
  $uri = "$SupabaseUrl$Path"
  # Copy the caller's headers. Writing Prefer straight into $Headers mutated the
  # shared $script:AdminHeaders hashtable, so one -PreferMinimal call left
  # 'return=minimal' stuck on every later admin request — including the GETs
  # whose bodies these assertions read.
  $requestHeaders = @{}
  foreach ($key in $Headers.Keys) { $requestHeaders[$key] = $Headers[$key] }
  $params = @{ Method = $Method; Uri = $uri; Headers = $requestHeaders; UseBasicParsing = $true }
  if ($PreferMinimal) { $requestHeaders['Prefer'] = 'return=minimal' }
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

# marketplace_listings.campus_id became NOT NULL in
# 20260723221532_nationwide_marketplace_access.sql. A seed listing without one
# is rejected by Postgres with 23502 before this script can prove anything, so
# every listing seed resolves a real active campus first.
function Get-SeedCampusId {
  $resp = Invoke-Supabase -Method GET `
    -Path '/rest/v1/marketplace_campuses?select=id&active=eq.true&order=slug.asc&limit=1' `
    -Headers $script:AdminHeaders
  if ($resp.status -ge 400 -or -not $resp.body) {
    throw "campus lookup failed: $($resp.status) $($resp.body)"
  }
  $rows = @($resp.body | ConvertFrom-Json)
  if ($rows.Count -lt 1) {
    throw 'No active row in marketplace_campuses. The PoC target project is missing the marketplace seed data (supabase/migrations/20260705120000_marketplace_location.sql) — apply the migrations to the staging project, do not relax this check.'
  }
  return $rows[0].id
}

function Get-UserJwt([string]$Email, [string]$Password) {
  $login = Invoke-RestMethod -Method POST -Uri "$SupabaseUrl/auth/v1/token?grant_type=password" `
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-rls-verify/1.0' } `
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

if (-not $SupabaseUrl -or -not $AnonKey -or -not $ServiceRoleKey) {
  throw 'Missing Supabase URL, anon key, or service role key (.env / apps/api-server/.env).'
}

$script:AdminHeaders = @{
  Authorization = "Bearer $ServiceRoleKey"
  apikey        = $ServiceRoleKey
  'User-Agent'  = 'lantern-rls-verify/1.0'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$userIds = @()
$groupId = $null
$inquiryListingId = $null
$inquiryThreadId = $null

Write-Host "Supabase: $SupabaseUrl" -ForegroundColor Cyan

try {
  $userA = New-AuthUser -Email "rls.verify.a.$ts@example.com" -Password $password -Name 'RLS User A'
  $userB = New-AuthUser -Email "rls.verify.b.$ts@example.com" -Password $password -Name 'RLS User B'
  $userC = New-AuthUser -Email "rls.verify.c.$ts@example.com" -Password $password -Name 'RLS User C'
  $userIds = @($userA.id, $userB.id, $userC.id)

  $jwtA = Get-UserJwt -Email $userA.email -Password $password
  $jwtB = Get-UserJwt -Email $userB.email -Password $password
  $jwtC = Get-UserJwt -Email $userC.email -Password $password

  $headersA = @{ Authorization = "Bearer $jwtA"; apikey = $AnonKey; 'User-Agent' = 'lantern-rls-verify/1.0' }
  $headersB = @{ Authorization = "Bearer $jwtB"; apikey = $AnonKey; 'User-Agent' = 'lantern-rls-verify/1.0' }
  $headersC = @{ Authorization = "Bearer $jwtC"; apikey = $AnonKey; 'User-Agent' = 'lantern-rls-verify/1.0' }

  # Ensure profiles rows exist (upsert via service role)
  foreach ($u in @($userA, $userB, $userC)) {
    $upsertHeaders = $script:AdminHeaders.Clone()
    $upsertHeaders['Prefer'] = 'resolution=merge-duplicates'
    $profileUpsert = Invoke-Supabase -Method POST -Path '/rest/v1/profiles' -Headers $upsertHeaders `
      -Body @{ id = $u.id; username = "rls$($u.id.Substring(0,8))"; name = $u.user_metadata.name }
    if ($profileUpsert.status -ge 400) {
      throw "profile seed failed for $($u.id): $($profileUpsert.status) $($profileUpsert.body)"
    }
  }

  # 1) profiles.settings escalation stripped
  $escalate = Invoke-Supabase -Method PATCH -Path "/rest/v1/profiles?id=eq.$($userA.id)" -Headers $headersA `
    -Body @{ settings = @{ is_platform_admin = $true; theme = 'dark' } }
  $profileRead = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/profiles?id=eq.$($userA.id)&select=settings" -Headers $headersA
  $settings = $profileRead[0].settings
  $escalationBlocked = ($escalate.status -in 200, 204) -and ($settings.is_platform_admin -ne $true)
  Write-Host "profiles escalation blocked: $escalationBlocked (expect True) escalateStatus=$($escalate.status)"

  # 2) admin_audit_log blocked for authenticated
  $audit = Invoke-Supabase -Method GET -Path '/rest/v1/admin_audit_log?select=id&limit=1' -Headers $headersA
  $auditBlocked = ($audit.status -in 401, 403) -or ($audit.status -eq 200 -and ($audit.body -eq '[]' -or [string]::IsNullOrWhiteSpace($audit.body)))
  Write-Host "admin_audit_log blocked: $auditBlocked (expect True) status=$($audit.status)"

  # 3) platform_admins blocked
  $platform = Invoke-Supabase -Method GET -Path '/rest/v1/platform_admins?select=user_id&limit=1' -Headers $headersA
  $platformBlocked = ($platform.status -in 401, 403) -or ($platform.status -eq 200 -and ($platform.body -eq '[]' -or [string]::IsNullOrWhiteSpace($platform.body)))
  Write-Host "platform_admins blocked: $platformBlocked (expect True) status=$($platform.status)"

  # 4) marketplace_favorite_milestones write blocked
  $milestone = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_favorite_milestones' -Headers $headersA `
    -Body @{ listing_id = '00000000-0000-0000-0000-000000000001'; milestone = 1 }
  $milestoneBlocked = $milestone.status -in 401, 403, 404, 409
  Write-Host "favorite_milestones write blocked: $milestoneBlocked (expect True) status=$($milestone.status)"

  # 5) Group admin boundary via group_members (groups UPDATE can recurse via group_members RLS)
  $groupId = [guid]::NewGuid().ToString()
  $adminIdsJson = @([string]$userB.id)
  $createGroup = Invoke-Supabase -Method POST -Path '/rest/v1/groups' -Headers $script:AdminHeaders -Body @{
    id = $groupId
    name = "RLS Verify $ts"
    admin_ids = $adminIdsJson
  } -PreferMinimal
  if ($createGroup.status -ge 400) {
    throw "group create failed: $($createGroup.status) $($createGroup.body)"
  }

  $createMembers = Invoke-Supabase -Method POST -Path '/rest/v1/group_members' -Headers $script:AdminHeaders -Body @(
    @{ group_id = $groupId; user_id = $userB.id; pending = $false },
    @{ group_id = $groupId; user_id = $userC.id; pending = $false }
  ) -PreferMinimal
  if ($createMembers.status -ge 400) {
    throw "group_members create failed: $($createMembers.status) $($createMembers.body)"
  }

  # Non-admin (C) cannot remove admin (B)
  $memberDeleteAttempt = Invoke-Supabase -Method DELETE -Path "/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$($userB.id)" -Headers $headersC -PreferMinimal
  $stillMember = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$($userB.id)&select=user_id" -Headers $script:AdminHeaders
  $memberBlocked = ($stillMember.Count -eq 1)

  # Group admin (B) can remove member (C)
  $adminDelete = Invoke-Supabase -Method DELETE -Path "/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$($userC.id)" -Headers $headersB -PreferMinimal
  $cRemoved = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/group_members?group_id=eq.$groupId&user_id=eq.$($userC.id)&select=user_id" -Headers $script:AdminHeaders
  $adminAllowed = ($adminDelete.status -in 200, 204) -and ($cRemoved.Count -eq 0)

  Write-Host "group member delete blocked (non-admin): $memberBlocked (expect True) status=$($memberDeleteAttempt.status)"
  Write-Host "group admin delete allowed: $adminAllowed (expect True) status=$($adminDelete.status)"

  # 6) Wallet balance cannot be self-minted via user_preferences
  $walletPatch = Invoke-Supabase -Method PATCH -Path "/rest/v1/user_preferences?user_id=eq.$($userA.id)" -Headers $headersA `
    -Body @{ preferences = @{ budgetExtras = @{ walletBalance = 999999; savingsGoals = @() } } }
  $walletRead = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/user_preferences?user_id=eq.$($userA.id)&select=preferences" -Headers $script:AdminHeaders
  $walletBalance = $walletRead[0].preferences.budgetExtras.walletBalance
  $walletBlocked = ($walletPatch.status -in 200, 204) -and ($walletBalance -ne 999999)
  Write-Host "wallet balance escalation blocked: $walletBlocked (expect True) balance=$walletBalance"

  # 7) Gamification points cannot be self-awarded
  $pointsPatch = Invoke-Supabase -Method PATCH -Path "/rest/v1/profiles?id=eq.$($userA.id)" -Headers $headersA `
    -Body @{ points = 999999 }
  $pointsRead = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/profiles?id=eq.$($userA.id)&select=points" -Headers $script:AdminHeaders
  $pointsBlocked = ($pointsPatch.status -in 200, 204) -and ($pointsRead[0].points -ne 999999)
  Write-Host "profiles points escalation blocked: $pointsBlocked (expect True) points=$($pointsRead[0].points)"

  # 8) Non-pending group self-join blocked
  $selfJoin = Invoke-Supabase -Method POST -Path '/rest/v1/group_members' -Headers $headersA `
    -Body @{ group_id = $groupId; user_id = $userA.id; pending = $false }
  $selfJoinBlocked = $selfJoin.status -in 401, 403, 409
  Write-Host "group self-join without pending blocked: $selfJoinBlocked (expect True) status=$($selfJoin.status)"

  # 9) study_activity direct insert blocked
  $activityInsert = Invoke-Supabase -Method POST -Path '/rest/v1/study_activity' -Headers $headersA `
    -Body @{ user_id = $userA.id; activity_date = (Get-Date).ToString('yyyy-MM-dd'); count = 999 }
  $activityBlocked = $activityInsert.status -in 401, 403
  Write-Host "study_activity direct write blocked: $activityBlocked (expect True) status=$($activityInsert.status)"

  # 10) marketplace_inquiries client writes blocked (Auth-02)
  $inquiryListingId = [guid]::NewGuid().ToString()
  $inquiryId = [guid]::NewGuid().ToString()
  $inquiryThreadId = (@($userA.id, $userB.id) | Sort-Object) -join '-'
  $inquiryThreadId = (@($userA.id, $userB.id) | Sort-Object) -join '-'
  $inquiryCampusId = Get-SeedCampusId
  # Seeds are asserted, not fire-and-forget: a silently failed seed turns the
  # exploit assertions below into "blocked" for the wrong reason.
  $inquiryListingCreate = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_listings' -Headers $script:AdminHeaders -Body @{
    id = $inquiryListingId
    user_id = $userB.id
    title = "RLS verify inquiry $ts"
    description = 'ephemeral'
    price = 500
    category = 'textbook_exchange'
    status = 'active'
    campus_id = $inquiryCampusId
    country_code = 'NG'
    currency = 'NGN'
    images = @()
  } -PreferMinimal
  if ($inquiryListingCreate.status -ge 400) {
    throw "inquiry listing seed failed: $($inquiryListingCreate.status) $($inquiryListingCreate.body)"
  }
  $inquiryThreadCreate = Invoke-Supabase -Method POST -Path '/rest/v1/dm_threads' -Headers $script:AdminHeaders -Body @{
    id = $inquiryThreadId
    participant_ids = @($userA.id, $userB.id)
    participants = @(
      @{ id = $userA.id; name = $userA.user_metadata.name },
      @{ id = $userB.id; name = $userB.user_metadata.name }
    )
  } -PreferMinimal
  if ($inquiryThreadCreate.status -ge 400) {
    throw "inquiry dm thread seed failed: $($inquiryThreadCreate.status) $($inquiryThreadCreate.body)"
  }
  $inquirySeed = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_inquiries' -Headers $script:AdminHeaders -Body @{
    id = $inquiryId
    listing_id = $inquiryListingId
    buyer_id = $userA.id
    seller_id = $userB.id
    dm_thread_id = $inquiryThreadId
    status = 'open'
    initial_message = 'seed'
  } -PreferMinimal
  if ($inquirySeed.status -ge 400) {
    throw "inquiry seed failed: $($inquirySeed.status) $($inquirySeed.body)"
  }
  $inquiryInsert = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_inquiries' -Headers $headersA -Body @{
    listing_id = $inquiryListingId
    buyer_id = $userA.id
    seller_id = $userB.id
    dm_thread_id = $inquiryThreadId
    status = 'open'
    initial_message = 'exploit'
  }
  $inquiryUpdate = Invoke-Supabase -Method PATCH -Path "/rest/v1/marketplace_inquiries?id=eq.$inquiryId" -Headers $headersA -Body @{ status = 'purchased' }
  $inquiryInsertBlocked = $inquiryInsert.status -in 401, 403
  $inquiryUpdateBlocked = $inquiryUpdate.status -in 401, 403
  Write-Host "marketplace_inquiries INSERT blocked: $inquiryInsertBlocked (expect True) status=$($inquiryInsert.status)"
  Write-Host "marketplace_inquiries UPDATE blocked: $inquiryUpdateBlocked (expect True) status=$($inquiryUpdate.status)"

  $passed = $escalationBlocked -and $auditBlocked -and $platformBlocked -and $milestoneBlocked -and $memberBlocked -and $adminAllowed -and $walletBlocked -and $pointsBlocked -and $selfJoinBlocked -and $activityBlocked -and $inquiryInsertBlocked -and $inquiryUpdateBlocked
  $result = [ordered]@{
    profiles_escalation_blocked = $escalationBlocked
    admin_audit_log_blocked = $auditBlocked
    platform_admins_blocked = $platformBlocked
    favorite_milestones_blocked = $milestoneBlocked
    group_member_delete_blocked = $memberBlocked
    group_admin_delete_allowed = $adminAllowed
    wallet_balance_escalation_blocked = $walletBlocked
    profiles_points_escalation_blocked = $pointsBlocked
    group_self_join_blocked = $selfJoinBlocked
    study_activity_write_blocked = $activityBlocked
    marketplace_inquiries_insert_blocked = $inquiryInsertBlocked
    marketplace_inquiries_update_blocked = $inquiryUpdateBlocked
    all_passed = $passed
  }
  $result | ConvertTo-Json
  if (-not $passed) { exit 1 }
}
finally {
  foreach ($id in $userIds) { Remove-AuthUser -Id $id }
  if ($groupId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/groups?id=eq.$groupId" -Headers $script:AdminHeaders | Out-Null
  }
  if ($inquiryListingId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_inquiries?listing_id=eq.$inquiryListingId" -Headers $script:AdminHeaders | Out-Null
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_listings?id=eq.$inquiryListingId" -Headers $script:AdminHeaders | Out-Null
  }
  if ($inquiryThreadId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/dm_threads?id=eq.$inquiryThreadId" -Headers $script:AdminHeaders | Out-Null
  }
}
