# Create an auto-confirmed auth user on Supabase Cloud (bypasses signup email / 429 limits).
# Requires SUPABASE_SERVICE_ROLE_KEY (legacy JWT or sb_secret) in apps/api-server/.env
#
# Usage (repo root):
#   .\scripts\create-cloud-auth-user.ps1 -Email 'you@example.com' -Password 'YourPassword123!'
# List / remove unconfirmed users:
#   .\scripts\create-cloud-auth-user.ps1 -ListUnconfirmed
#   .\scripts\create-cloud-auth-user.ps1 -RemoveUnconfirmed -Email 'stuck@example.com'

param(
    [string]$Email,
    [string]$Password,
    [switch]$ListUnconfirmed,
    [switch]$RemoveUnconfirmed,
    [string]$ProjectRef = 'tiizkjhbrnaibaagmurl'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$SupabaseUrl = "https://$ProjectRef.supabase.co"

function Write-Step([string]$Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Ok([string]$Message) { Write-Host $Message -ForegroundColor Green }

function Read-DotEnvFile([string]$Path) {
    $vars = @{}
    if (-not (Test-Path $Path)) { return $vars }
    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }
        if ($line -match '^(?<k>[A-Za-z_][A-Za-z0-9_]*)=(?<v>.*)$') {
            $vars[$Matches.k] = $Matches.v.Trim().Trim('"').Trim("'")
        }
    }
    return $vars
}

function Get-ServiceRoleKey {
    $apiEnv = Read-DotEnvFile (Join-Path $RepoRoot 'apps/api-server/.env')
    if ($apiEnv['SUPABASE_SERVICE_ROLE_KEY']) { return $apiEnv['SUPABASE_SERVICE_ROLE_KEY'].Trim() }
    throw 'SUPABASE_SERVICE_ROLE_KEY missing in apps/api-server/.env'
}

function Invoke-AuthAdmin {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $headers = @{
        apikey                         = $script:ServiceRoleKey
        Authorization                  = "Bearer $script:ServiceRoleKey"
        Accept                         = 'application/json'
        'User-Agent'                   = 'Lantern-Study-Deploy-Script/1.0'
        'X-Client-Info'                = 'lantern-study-create-cloud-auth-user'
    }
    $uri = "$SupabaseUrl/auth/v1/admin$Path"
    if ($null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress)
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

$script:ServiceRoleKey = Get-ServiceRoleKey

if ($ListUnconfirmed) {
    Write-Step 'Fetching users (first 200)...'
    $resp = Invoke-AuthAdmin -Method GET -Path '/users?page=1&per_page=200'
    $unconfirmed = @($resp.users | Where-Object { -not $_.email_confirmed_at })
    if ($unconfirmed.Count -eq 0) {
        Write-Ok 'No unconfirmed users found.'
    } else {
        $unconfirmed | ForEach-Object { Write-Host "  $($_.email)  id=$($_.id)  created=$($_.created_at)" }
    }
    exit 0
}

if ($RemoveUnconfirmed) {
    if (-not $Email) { throw '-Email is required with -RemoveUnconfirmed' }
    $encoded = [uri]::EscapeDataString($Email)
    $found = Invoke-AuthAdmin -Method GET -Path "/users?email=$encoded"
    $user = $found.users | Select-Object -First 1
    if (-not $user) { throw "No user found for $Email" }
    if ($user.email_confirmed_at) { throw "User $Email is already confirmed; not removing." }
    Invoke-AuthAdmin -Method DELETE -Path "/users/$($user.id)" | Out-Null
    Write-Ok "Removed unconfirmed user $Email"
    exit 0
}

if (-not $Email -or -not $Password) {
    throw @"
Usage:
  .\scripts\create-cloud-auth-user.ps1 -Email 'you@example.com' -Password 'YourPassword123!'

Dashboard alternative (no script):
  https://supabase.com/dashboard/project/$ProjectRef/auth/users → Add user → Auto Confirm User
"@
}

Write-Step "Creating auto-confirmed user $Email ..."
try {
    $created = Invoke-AuthAdmin -Method POST -Path '/users' -Body @{
        email         = $Email
        password      = $Password
        email_confirm = $true
    }
    Write-Ok "Created user $($created.id)"
    Write-Host 'Log in at https://lanternstudy.com (no signup email required).'
} catch {
    $detail = $_.ErrorDetails.Message
    if ($detail -match 'already been registered|already exists') {
        Write-Host "User already exists. Confirm in Dashboard or use -RemoveUnconfirmed if unconfirmed."
    }
    throw "Admin create failed: $detail"
}
