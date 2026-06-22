# Create Lantern Study Sentry projects (web, api, mobile) and print DSNs.
# Requires SENTRY_AUTH_TOKEN in .env.sentry or environment.
#
# Usage (repo root):
#   .\scripts\setup-sentry-projects.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ApiBase = 'https://sentry.io/api/0'

function Write-Step([string]$Message) {
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
    Write-Host $Message -ForegroundColor Green
}

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

function Get-SentryAuthToken {
    if ($env:SENTRY_AUTH_TOKEN) { return $env:SENTRY_AUTH_TOKEN.Trim() }
    $sentryEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.sentry')
    if ($sentryEnv['SENTRY_AUTH_TOKEN']) { return $sentryEnv['SENTRY_AUTH_TOKEN'].Trim() }
    throw @"
SENTRY_AUTH_TOKEN is missing.
1. Open https://sentry.io/settings/account/api/auth-tokens/
2. Create token with scopes: project:write, org:read, team:read
3. Save in .env.sentry (copy from .env.sentry.example) OR run:
   `$env:SENTRY_AUTH_TOKEN = 'sntrys_...'
"@
}

function Invoke-SentryApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $headers = @{
        Authorization = "Bearer $script:SentryToken"
        Accept        = 'application/json'
    }
    $uri = "$ApiBase$Path"
    if ($null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json)
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Get-OrCreateProject {
    param(
        [string]$Org,
        [string]$Team,
        [string]$Name,
        [string]$Slug,
        [string]$Platform
    )

    try {
        $existing = Invoke-SentryApi -Method GET -Path "/projects/$Org/$Slug/"
        Write-Host "  exists: $($existing.slug) ($($existing.platform))"
        return $existing
    } catch {
        if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }

    Write-Step "  creating $Slug ($Platform)..."
    return Invoke-SentryApi -Method POST -Path "/teams/$Org/$Team/projects/" -Body @{
        name          = $Name
        slug          = $Slug
        platform      = $Platform
        default_rules = $true
    }
}

function Get-ProjectDsn {
    param([string]$Org, [string]$Slug)
    $keys = Invoke-SentryApi -Method GET -Path "/projects/$Org/$Slug/keys/"
    $defaultKey = $keys | Where-Object { $_.name -eq 'Default' } | Select-Object -First 1
    if (-not $defaultKey) { $defaultKey = $keys | Select-Object -First 1 }
    return $defaultKey.dsn.public
}

function Update-EnvFile {
    param(
        [string]$Path,
        [hashtable]$Updates
    )
    if (-not (Test-Path $Path)) {
        Write-Host "  skip missing $Path"
        return
    }
    $content = Get-Content $Path -Raw
    foreach ($key in $Updates.Keys) {
        $value = $Updates[$key]
        $pattern = '(?m)^' + [regex]::Escape($key) + '=.*$'
        if ($content -match $pattern) {
            $content = [regex]::Replace($content, $pattern, ($key + '=' + $value))
        } else {
            $content += "`n$key=$value`n"
        }
    }
    Set-Content -Path $Path -Value ($content.TrimEnd() + "`n") -NoNewline
    Write-Ok "  updated $Path"
}

Write-Host 'Lantern Study — Sentry project setup' -ForegroundColor Cyan
$script:SentryToken = Get-SentryAuthToken
$sentryEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.sentry')
$org = if ($env:SENTRY_ORG_SLUG) { $env:SENTRY_ORG_SLUG } elseif ($sentryEnv['SENTRY_ORG_SLUG']) { $sentryEnv['SENTRY_ORG_SLUG'] } else { 'lantern-study' }
$team = if ($env:SENTRY_TEAM_SLUG) { $env:SENTRY_TEAM_SLUG } elseif ($sentryEnv['SENTRY_TEAM_SLUG']) { $sentryEnv['SENTRY_TEAM_SLUG'] } else { $org }

Write-Step "Organization: $org  Team: $team"

try {
    $teams = Invoke-SentryApi -Method GET -Path "/organizations/$org/teams/"
    if ($teams.slug -notcontains $team -and $teams.Count -gt 0) {
        $team = $teams[0].slug
        Write-Host "  using first team: $team"
    }
} catch {
    Write-Host "  could not list teams (will try default team slug): $($_.Exception.Message)"
}

$projects = @(
    @{ Name = 'Lantern Study Web'; Slug = 'lantern-study-web'; Platform = 'javascript' }
    @{ Name = 'Lantern Study API'; Slug = 'lantern-study-api'; Platform = 'node' }
    @{ Name = 'Lantern Study Mobile'; Slug = 'lantern-study-mobile'; Platform = 'react-native' }
)

$dsns = @{}
foreach ($p in $projects) {
    $proj = Get-OrCreateProject -Org $org -Team $team -Name $p.Name -Slug $p.Slug -Platform $p.Platform
    $dsn = Get-ProjectDsn -Org $org -Slug $proj.slug
    $dsns[$p.Slug] = $dsn
    Write-Ok "  $($p.Slug): $dsn"
}

Write-Step 'Updating local .env files (DSNs only)...'
Update-EnvFile -Path (Join-Path $RepoRoot '.env') -Updates @{
    'VITE_SENTRY_DSN' = $dsns['lantern-study-web']
}
Update-EnvFile -Path (Join-Path $RepoRoot 'apps/api-server/.env') -Updates @{
    'SENTRY_DSN' = $dsns['lantern-study-api']
}
$mobileEnv = Join-Path $RepoRoot 'apps/mobile/.env'
if (-not (Test-Path $mobileEnv)) {
    $mobileEnv = Join-Path $RepoRoot '.env'
}
Update-EnvFile -Path $mobileEnv -Updates @{
    'EXPO_PUBLIC_SENTRY_DSN' = $dsns['lantern-study-mobile']
}

Write-Host ''
Write-Ok 'Sentry projects ready.'
Write-Host 'Dashboard: https://lantern-study.sentry.io/projects/'
Write-Host ''
Write-Host 'Add SENTRY_DSN to Render and EXPO_PUBLIC_SENTRY_DSN to EAS secrets for production.'
