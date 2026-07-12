# Auth-02 PoC: authenticated users must not INSERT/UPDATE marketplace_inquiries via PostgREST.
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
  $params = @{ Method = $Method; Uri = $uri; Headers = $Headers; UseBasicParsing = $true }
  if ($PreferMinimal) { $params.Headers['Prefer'] = 'return=minimal' }
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
    -Headers @{ apikey = $AnonKey; 'User-Agent' = 'lantern-auth02-poc/1.0' } `
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
  'User-Agent'  = 'lantern-auth02-poc/1.0'
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$password = 'Password123!'
$buyerId = $null
$sellerId = $null
$listingId = [guid]::NewGuid().ToString()
$inquiryId = [guid]::NewGuid().ToString()
$threadId = $null

Write-Host "Auth-02 PoC against $SupabaseUrl" -ForegroundColor Cyan

try {
  $buyer = New-AuthUser -Email "auth02.buyer.$ts@example.com" -Password $password -Name 'Auth02 Buyer'
  $seller = New-AuthUser -Email "auth02.seller.$ts@example.com" -Password $password -Name 'Auth02 Seller'
  $buyerId = $buyer.id
  $sellerId = $seller.id
  $threadId = (@($buyerId, $sellerId) | Sort-Object) -join '-'

  $buyerJwt = Get-UserJwt -Email $buyer.email -Password $password
  $buyerHeaders = @{ Authorization = "Bearer $buyerJwt"; apikey = $AnonKey; 'User-Agent' = 'lantern-auth02-poc/1.0' }

  foreach ($u in @($buyer, $seller)) {
    $upsertHeaders = $script:AdminHeaders.Clone()
    $upsertHeaders['Prefer'] = 'resolution=merge-duplicates'
    Invoke-Supabase -Method POST -Path '/rest/v1/profiles' -Headers $upsertHeaders `
      -Body @{ id = $u.id; username = "a2$($u.id.Substring(0,8))"; name = $u.user_metadata.name } | Out-Null
  }

  $listingCreate = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_listings' -Headers $script:AdminHeaders -Body @{
    id = $listingId
    user_id = $sellerId
    title = "Auth02 PoC Listing $ts"
    description = 'ephemeral security test listing'
    price = 1000
    category = 'books'
    status = 'active'
    images = @()
  } -PreferMinimal
  if ($listingCreate.status -ge 400) {
    throw "listing create failed: $($listingCreate.status) $($listingCreate.body)"
  }

  $threadCreate = Invoke-Supabase -Method POST -Path '/rest/v1/dm_threads' -Headers $script:AdminHeaders -Body @{
    id = $threadId
    participant_ids = @($buyerId, $sellerId)
    participants = @(
      @{ id = $buyerId; name = $buyer.user_metadata.name },
      @{ id = $sellerId; name = $seller.user_metadata.name }
    )
  } -PreferMinimal
  if ($threadCreate.status -ge 400) {
    throw "dm thread seed failed: $($threadCreate.status) $($threadCreate.body)"
  }

  $inquiryCreate = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_inquiries' -Headers $script:AdminHeaders -Body @{
    id = $inquiryId
    listing_id = $listingId
    buyer_id = $buyerId
    seller_id = $sellerId
    dm_thread_id = $threadId
    status = 'open'
    initial_message = 'seed inquiry'
  } -PreferMinimal
  if ($inquiryCreate.status -ge 400) {
    throw "inquiry seed failed: $($inquiryCreate.status) $($inquiryCreate.body)"
  }

  $insertAttempt = Invoke-Supabase -Method POST -Path '/rest/v1/marketplace_inquiries' -Headers $buyerHeaders -Body @{
    listing_id = $listingId
    buyer_id = $buyerId
    seller_id = $sellerId
    dm_thread_id = $threadId
    status = 'open'
    initial_message = 'direct insert exploit'
  }
  $insertBlocked = $insertAttempt.status -in 401, 403

  $updateAttempt = Invoke-Supabase -Method PATCH -Path "/rest/v1/marketplace_inquiries?id=eq.$inquiryId" -Headers $buyerHeaders `
    -Body @{ status = 'purchased' }
  $updateBlocked = $updateAttempt.status -in 401, 403

  $offerAfter = Invoke-RestMethod -Method GET -Uri "$SupabaseUrl/rest/v1/marketplace_inquiries?id=eq.$inquiryId&select=status" -Headers $script:AdminHeaders
  $statusUnchanged = $offerAfter[0].status -eq 'open'

  $selectAttempt = Invoke-Supabase -Method GET -Path "/rest/v1/marketplace_inquiries?id=eq.$inquiryId&select=id,status" -Headers $buyerHeaders
  $selectAllowed = $selectAttempt.ok -and $selectAttempt.body -match $inquiryId

  Write-Host "buyer INSERT inquiry blocked: $insertBlocked (expect True) status=$($insertAttempt.status)"
  Write-Host "buyer UPDATE inquiry blocked: $updateBlocked (expect True) status=$($updateAttempt.status)"
  Write-Host "inquiry status unchanged after exploit: $statusUnchanged (expect True) status=$($offerAfter[0].status)"
  Write-Host "buyer SELECT own inquiry allowed: $selectAllowed (expect True) status=$($selectAttempt.status)"

  $passed = $insertBlocked -and $updateBlocked -and $statusUnchanged -and $selectAllowed
  $result = [ordered]@{
    finding = 'Auth-02 marketplace_inquiries client write bypass'
    buyer_insert_blocked = $insertBlocked
    buyer_update_blocked = $updateBlocked
    inquiry_status_unchanged = $statusUnchanged
    buyer_select_allowed = $selectAllowed
    all_passed = $passed
  }
  $result | ConvertTo-Json
  if (-not $passed) { exit 1 }
}
finally {
  if ($inquiryId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_inquiries?id=eq.$inquiryId" -Headers $script:AdminHeaders | Out-Null
  }
  if ($listingId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/marketplace_listings?id=eq.$listingId" -Headers $script:AdminHeaders | Out-Null
  }
  if ($threadId) {
    Invoke-Supabase -Method DELETE -Path "/rest/v1/dm_threads?id=eq.$threadId" -Headers $script:AdminHeaders | Out-Null
  }
  Remove-AuthUser -Id $buyerId
  Remove-AuthUser -Id $sellerId
}
