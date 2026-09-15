# F-01 PoC: authenticated users must not INSERT/UPDATE marketplace_offers via PostgREST.
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
# is rejected by Postgres with 23502 before this PoC can prove anything, so
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
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-f01-poc/1.0' } `
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
  'User-Agent'  = 'lantern-f01-poc/1.0'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$buyerId = $null
$sellerId = $null
$listingId = [guid]::NewGuid().ToString()
$offerId = [guid]::NewGuid().ToString()

Write-Host "F-01 PoC against $SupabaseUrl" -ForegroundColor Cyan

try {
  $buyer = New-AuthUser -Email "f01.buyer.$ts@example.com" -Password $password -Name 'F01 Buyer'
  $seller = New-AuthUser -Email "f01.seller.$ts@example.com" -Password $password -Name 'F01 Seller'
  $buyerId = $buyer.id
  $sellerId = $seller.id

  $buyerJwt = Get-UserJwt -Email $buyer.email -Password $password
  $buyerHeaders = @{ Authorization = "Bearer $buyerJwt"; apikey = $AnonKey; 'User-Agent' = 'lantern-f01-poc/1.0' }

  foreach ($u in @($buyer, $seller)) {
    $upsertHeaders = $script:AdminHeaders.Clone()
    $upsertHeaders['Prefer'] = 'resolution=merge-duplicates'
    $profileUpsert = Invoke-Supabase -Method POST -Path '/rest/v1/profiles' -Headers $upsertHeaders `
      -Body @{ id = $u.id; username = "f01$($u.id.Substring(0,8))"; name = $u.user_metadata.name }
    if ($profileUpsert.status -ge 400) {
      throw "profile seed failed for $($u.id): $($profileUpsert.status) $($profileUpsert.body)"
    }
  }

  $campusId = Get-SeedCampusId

  $listingCreate = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_listings' -Headers $script:AdminHeaders -Body @{
    id = $listingId
    user_id = $sellerId
    title = "F01 PoC Listing $ts"
    description = 'ephemeral security test listing'
    price = 1000
    category = 'textbook_exchange'
    status = 'active'
    campus_id = $campusId
    country_code = 'NG'
    currency = 'NGN'
    images = @()
  } -PreferMinimal
  if ($listingCreate.status -ge 400) {
    throw "listing create failed: $($listingCreate.status) $($listingCreate.body)"
  }

  $offerCreate = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_offers' -Headers $script:AdminHeaders -Body @{
    id = $offerId
    listing_id = $listingId
    buyer_id = $buyerId
    seller_id = $sellerId
    amount = 800
    status = 'pending'
    # NOT NULL since 20260730120000 (it defaults to 'buyer'; set it explicitly
    # so the seeded row states whose turn it is rather than relying on a default).
    proposed_by = 'buyer'
    expires_at = (Get-Date).AddHours(48).ToUniversalTime().ToString('o')
  } -PreferMinimal
  if ($offerCreate.status -ge 400) {
    throw "offer seed failed: $($offerCreate.status) $($offerCreate.body)"
  }

  # Exploit attempt 1: buyer accepts own offer via direct PostgREST UPDATE (F-01)
  $acceptAttempt = Invoke-Supabase -Method PATCH -Path "/rest/v1/marketplace_offers?id=eq.$offerId" -Headers $buyerHeaders `
    -Body @{ status = 'accepted' }
  $acceptBlocked = $acceptAttempt.status -in 401, 403

  $offerAfter = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/marketplace_offers?id=eq.$offerId&select=status" -Headers $script:AdminHeaders
  $statusUnchanged = $offerAfter[0].status -eq 'pending'

  # Exploit attempt 2: buyer INSERT new offer via PostgREST
  $insertAttempt = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_offers' -Headers $buyerHeaders -Body @{
    listing_id = $listingId
    buyer_id = $buyerId
    seller_id = $sellerId
    amount = 700
    status = 'pending'
    expires_at = (Get-Date).AddHours(48).ToUniversalTime().ToString('o')
  }
  $insertBlocked = $insertAttempt.status -in 401, 403

  # Control: buyer can still SELECT own offer
  $selectAttempt = Invoke-Supabase -Method GET -Path "/rest/v1/marketplace_offers?id=eq.$offerId&select=id,status" -Headers $buyerHeaders
  $selectAllowed = $selectAttempt.ok -and $selectAttempt.body -match $offerId

  Write-Host "buyer UPDATE accept blocked: $acceptBlocked (expect True) status=$($acceptAttempt.status)"
  if ($acceptAttempt.body) { Write-Host "  body: $($acceptAttempt.body)" }
  Write-Host "offer status unchanged after exploit: $statusUnchanged (expect True) status=$($offerAfter[0].status)"
  Write-Host "buyer INSERT offer blocked: $insertBlocked (expect True) status=$($insertAttempt.status)"
  Write-Host "buyer SELECT own offer allowed: $selectAllowed (expect True) status=$($selectAttempt.status)"

  $passed = $acceptBlocked -and $statusUnchanged -and $insertBlocked -and $selectAllowed
  $result = [ordered]@{
    finding = 'F-01 marketplace_offers client write bypass'
    buyer_update_accept_blocked = $acceptBlocked
    offer_status_unchanged = $statusUnchanged
    buyer_insert_blocked = $insertBlocked
    buyer_select_allowed = $selectAllowed
    all_passed = $passed
  }
  $result | ConvertTo-Json
  if (-not $passed) { exit 1 }
}
finally {
  if ($offerId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_offers?id=eq.$offerId" -Headers $script:AdminHeaders | Out-Null
  }
  if ($listingId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_listings?id=eq.$listingId" -Headers $script:AdminHeaders | Out-Null
  }
  Remove-AuthUser -Id $buyerId
  Remove-AuthUser -Id $sellerId
}
