param(
  [Parameter(Mandatory = $true)]
  [string]$UserId,
  [string]$SupabaseUrl,
  [string]$SupabaseServiceRoleKey,
  [bool]$IsPlatformAdmin = $true,
  [string]$EnvFilePath
)

$ErrorActionPreference = 'Stop'

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
  (Join-Path $projectRoot 'apps/api-server/.env'),
  (Join-Path $projectRoot '.env')
)

$envCombined = @{}
foreach ($f in $candidateEnvFiles) {
  $parsed = Parse-EnvFile -Path $f
  foreach ($k in $parsed.Keys) {
    if (-not $envCombined.ContainsKey($k)) { $envCombined[$k] = $parsed[$k] }
  }
}

$SupabaseUrl = First-NonEmpty @(
  $SupabaseUrl,
  $env:SUPABASE_URL,
  $env:STAGING_SUPABASE_URL,
  $envCombined['SUPABASE_URL'],
  $envCombined['STAGING_SUPABASE_URL'],
  $envCombined['VITE_SUPABASE_URL']
)

$SupabaseServiceRoleKey = First-NonEmpty @(
  $SupabaseServiceRoleKey,
  $env:SUPABASE_SERVICE_ROLE_KEY,
  $env:STAGING_SUPABASE_SERVICE_ROLE_KEY,
  $envCombined['SUPABASE_SERVICE_ROLE_KEY'],
  $envCombined['STAGING_SUPABASE_SERVICE_ROLE_KEY']
)

if (-not $SupabaseUrl -or -not $SupabaseServiceRoleKey) {
  throw 'Missing Supabase URL or service role key.'
}

$headers = @{
  Authorization = "Bearer $SupabaseServiceRoleKey"
  apikey = $SupabaseServiceRoleKey
}

$getUrl = "$SupabaseUrl/auth/v1/admin/users/$UserId"
$current = Invoke-RestMethod -Method Get -Uri $getUrl -Headers $headers

if (-not $current -or -not $current.id) {
  throw "User not found: $UserId"
}

$currentAppMeta = @{}
if ($current.app_metadata) {
  $currentAppMeta = @{}
  foreach ($prop in $current.app_metadata.PSObject.Properties) {
    $currentAppMeta[$prop.Name] = $prop.Value
  }
}

$currentAppMeta['is_platform_admin'] = $IsPlatformAdmin

$updateUrl = "$SupabaseUrl/auth/v1/admin/users/$UserId"
$body = @{ app_metadata = $currentAppMeta } | ConvertTo-Json -Depth 10
$updated = Invoke-RestMethod -Method Put -Uri $updateUrl -Headers $headers -ContentType 'application/json' -Body $body

if ($IsPlatformAdmin) {
  $platformAdminBody = @{ user_id = $UserId } | ConvertTo-Json
  $platformAdminUrl = "$SupabaseUrl/rest/v1/platform_admins"
  $restHeaders = @{
    Authorization = "Bearer $SupabaseServiceRoleKey"
    apikey = $SupabaseServiceRoleKey
    Prefer = 'resolution=merge-duplicates'
  }
  [void](Invoke-RestMethod -Method Post -Uri $platformAdminUrl -Headers $restHeaders -ContentType 'application/json' -Body $platformAdminBody)
} else {
  $deleteUrl = "$SupabaseUrl/rest/v1/platform_admins?user_id=eq.$UserId"
  $restHeaders = @{ Authorization = "Bearer $SupabaseServiceRoleKey"; apikey = $SupabaseServiceRoleKey }
  try {
    [void](Invoke-RestMethod -Method Delete -Uri $deleteUrl -Headers $restHeaders)
  } catch {}
}

$result = [ordered]@{
  user_id = $updated.id
  email = $updated.email
  is_platform_admin = $updated.app_metadata.is_platform_admin
  supabase_url = $SupabaseUrl
}

$result | ConvertTo-Json -Depth 6
