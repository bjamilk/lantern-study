# Attach custom domain(s) to the Cloudflare Pages project.
# Uses CLOUDFLARE_API_TOKEN, or falls back to Wrangler OAuth (npx wrangler login).
#
# Usage (repo root):
#   .\scripts\attach-cloudflare-pages-domain.ps1

param(
    [string[]]$Domains = @('lanternstudy.com', 'www.lanternstudy.com'),
    [string]$PagesTarget = 'lantern-study.pages.dev'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ProjectName = 'lantern-study'
$DefaultAccountId = '825f1b169950dbd062df106b13586826'
$ApiBase = 'https://api.cloudflare.com/client/v4'

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

function Get-WranglerOAuthToken {
    $paths = @(
        (Join-Path $env:APPDATA 'xdg.config\.wrangler\config\default.toml'),
        (Join-Path $env:USERPROFILE '.wrangler\config\default.toml')
    )
    foreach ($path in $paths) {
        if (-not (Test-Path $path)) { continue }
        $raw = Get-Content $path -Raw
        if ($raw -match 'oauth_token\s*=\s*"(?<t>[^"]+)"') {
            return $Matches.t
        }
    }
    return $null
}

function Get-CloudflareBearerToken {
    if ($env:CLOUDFLARE_API_TOKEN) { return $env:CLOUDFLARE_API_TOKEN.Trim() }
    $cfEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.cloudflare')
    if ($cfEnv['CLOUDFLARE_API_TOKEN']) { return $cfEnv['CLOUDFLARE_API_TOKEN'].Trim() }
    $oauth = Get-WranglerOAuthToken
    if ($oauth) {
        Write-Host 'Using Wrangler OAuth token (run npx wrangler login if this fails).' -ForegroundColor DarkYellow
        return $oauth
    }
    throw @"
Cloudflare auth missing.
1. Run: npx wrangler login
   OR create API token: https://dash.cloudflare.com/profile/api-tokens
2. Save in .env.cloudflare (see .env.cloudflare.example)
"@
}

function Invoke-CloudflareApi {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $headers = @{
        Authorization = "Bearer $script:CloudflareBearerToken"
        Accept        = 'application/json'
    }
    $uri = "$ApiBase$Path"
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Compress
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Get-AccountId([hashtable]$CfEnv) {
    if ($CfEnv['CLOUDFLARE_ACCOUNT_ID']) { return $CfEnv['CLOUDFLARE_ACCOUNT_ID'].Trim() }
    return $DefaultAccountId
}

function Show-DnsSetupInstructions {
    Write-Host ''
    Write-Host 'DNS setup required (domain resolves only after these exist):' -ForegroundColor Yellow
    Write-Host "  Cloudflare Dashboard -> $script:ProductionWebDomain -> DNS -> Records"
    Write-Host ''
    Write-Host '  Add BOTH records (Proxy ON / orange cloud):'
    Write-Host "    Type CNAME | Name @   | Target $PagesTarget | Proxied"
    Write-Host "    Type CNAME | Name www | Target $PagesTarget | Proxied"
    Write-Host ''
    Write-Host '  Then open Pages custom domains and wait for Active:'
    Write-Host "    https://dash.cloudflare.com/$script:AccountId/pages/view/$ProjectName/domains"
    Write-Host ''
    Write-Host '  Test: https://lanternstudy.com (may take 2-10 minutes after DNS saves).'
}

Write-Host 'Lantern Study — attach Cloudflare Pages custom domains' -ForegroundColor Cyan
$script:CloudflareBearerToken = Get-CloudflareBearerToken
$cfEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.cloudflare')
$script:AccountId = Get-AccountId -CfEnv $cfEnv
Write-Host "Account: $($script:AccountId)"
Write-Host "Project: $ProjectName"
Write-Host "Canonical URL: $($script:ProductionWebUrl)"
Write-Host "Pages target: $PagesTarget"
Write-Host ''

foreach ($domain in $Domains) {
    Write-Host "Adding domain: $domain ..." -ForegroundColor Yellow
    try {
        $resp = Invoke-CloudflareApi -Method POST -Path "/accounts/$($script:AccountId)/pages/projects/$ProjectName/domains" -Body @{ name = $domain }
        if ($resp.success) {
            Write-Host "  Added: $domain (status: $($resp.result.status))" -ForegroundColor Green
        } else {
            $msg = ($resp.errors | ForEach-Object { $_.message }) -join '; '
            Write-Host "  Failed: $msg" -ForegroundColor DarkYellow
        }
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        if ($detail -match 'already exists|duplicate') {
            Write-Host "  Already attached: $domain" -ForegroundColor Green
        } else {
            Write-Host "  Failed: $detail" -ForegroundColor DarkYellow
        }
    }
}

Write-Host ''
Write-Host 'Current Pages domain status:' -ForegroundColor Cyan
try {
    $list = Invoke-CloudflareApi -Method GET -Path "/accounts/$($script:AccountId)/pages/projects/$ProjectName/domains"
    foreach ($d in $list.result) {
        $err = $d.verification_data.error_message
        if ($err) { Write-Host "  $($d.name): $($d.status) ($err)" }
        else { Write-Host "  $($d.name): $($d.status)" }
    }
} catch {
    Write-Host "  Could not list domains: $($_.Exception.Message)" -ForegroundColor DarkYellow
}

Show-DnsSetupInstructions
