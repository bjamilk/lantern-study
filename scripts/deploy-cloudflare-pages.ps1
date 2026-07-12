# Deploy Lantern Study web app to Cloudflare Pages via REST API.
# Requires CLOUDFLARE_API_TOKEN in .env.cloudflare or environment.
#
# Usage (repo root):
#   .\scripts\deploy-cloudflare-pages.ps1
# Or:
#   $env:CLOUDFLARE_API_TOKEN = '...'; .\scripts\deploy-cloudflare-pages.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ProjectName = 'lantern-study'
$GitHubOwner = 'bjamilk'
$GitHubRepo = 'lantern-study'
$Branch = 'main'
$BuildCommand = 'npm ci && npm run build:web'
$OutputDir = 'dist'
$NodeVersion = '20'
$ApiBase = 'https://api.cloudflare.com/client/v4'
$SupabaseProjectUrl = 'https://supabase.com/dashboard/project/tiizkjhbrnaibaagmurl/auth/url-configuration'
$RenderServiceId = 'srv-d8rm0rj6sc1c73belnk0'

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

function Get-CloudflareApiToken {
    if ($env:CLOUDFLARE_API_TOKEN) { return $env:CLOUDFLARE_API_TOKEN.Trim() }
    $cfEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.cloudflare')
    if ($cfEnv['CLOUDFLARE_API_TOKEN']) { return $cfEnv['CLOUDFLARE_API_TOKEN'].Trim() }
    throw @"
CLOUDFLARE_API_TOKEN is missing.
1. Open https://dash.cloudflare.com/profile/api-tokens
2. Create token with Account → Cloudflare Pages → Edit (+ Account Settings → Read)
3. Save in .env.cloudflare (copy from .env.cloudflare.example) OR run:
   `$env:CLOUDFLARE_API_TOKEN = 'your_token'
"@
}

function Invoke-CloudflareApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $headers = @{
        Authorization = "Bearer $script:CloudflareApiToken"
        Accept        = 'application/json'
    }
    $uri = "$ApiBase$Path"
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Depth 20 -Compress
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Assert-CloudflareSuccess([object]$Response, [string]$Context) {
    if ($Response.success -eq $false) {
        $errors = ($Response.errors | ForEach-Object { $_.message }) -join '; '
        throw "$Context failed: $errors"
    }
}

function Get-AccountId([hashtable]$CfEnv) {
    if ($env:CLOUDFLARE_ACCOUNT_ID) { return $env:CLOUDFLARE_ACCOUNT_ID.Trim() }
    if ($CfEnv['CLOUDFLARE_ACCOUNT_ID']) { return $CfEnv['CLOUDFLARE_ACCOUNT_ID'].Trim() }
    Write-Step 'Resolving Cloudflare account id...'
    $resp = Invoke-CloudflareApi -Method GET -Path '/accounts?per_page=10'
    Assert-CloudflareSuccess -Response $resp -Context 'List accounts'
    if (-not $resp.result -or $resp.result.Count -eq 0) {
        throw 'No Cloudflare accounts found for this API token.'
    }
    return $resp.result[0].id
}

function New-EnvVarEntry([string]$Value) {
    return @{
        type  = 'plain_text'
        value = [string]$Value
    }
}

function Build-DeploymentConfigs([hashtable]$RootEnv) {
    $envVars = @{
        NODE_VERSION            = (New-EnvVarEntry -Value $NodeVersion)
        VITE_SUPABASE_URL       = (New-EnvVarEntry -Value $RootEnv['VITE_SUPABASE_URL'])
        VITE_SUPABASE_ANON_KEY  = (New-EnvVarEntry -Value $RootEnv['VITE_SUPABASE_ANON_KEY'])
        VITE_API_URL            = (New-EnvVarEntry -Value $RootEnv['VITE_API_URL'])
    }
    if ($RootEnv['VITE_SENTRY_DSN']) {
        $envVars['VITE_SENTRY_DSN'] = (New-EnvVarEntry -Value $RootEnv['VITE_SENTRY_DSN'])
        if ($RootEnv['VITE_SENTRY_RELEASE']) {
            $envVars['VITE_SENTRY_RELEASE'] = (New-EnvVarEntry -Value $RootEnv['VITE_SENTRY_RELEASE'])
        }
        if ($RootEnv['VITE_SENTRY_TRACES_SAMPLE_RATE']) {
            $envVars['VITE_SENTRY_TRACES_SAMPLE_RATE'] = (New-EnvVarEntry -Value $RootEnv['VITE_SENTRY_TRACES_SAMPLE_RATE'])
        }
    }
    return @{
        production = @{ env_vars = $envVars }
        preview    = @{ env_vars = $envVars }
    }
}

function Get-ExistingProject([string]$AccountId) {
    try {
        $resp = Invoke-CloudflareApi -Method GET -Path "/accounts/$AccountId/pages/projects/$ProjectName"
        Assert-CloudflareSuccess -Response $resp -Context 'Get project'
        return $resp.result
    } catch {
        if ($_.Exception.Message -match '8000007|Project not found|404') { return $null }
        throw
    }
}

function Ensure-Project([string]$AccountId, [hashtable]$RootEnv) {
    $existing = Get-ExistingProject -AccountId $AccountId
    $deploymentConfigs = Build-DeploymentConfigs -RootEnv $RootEnv
    $buildConfig = @{
        build_command   = $BuildCommand
        destination_dir = $OutputDir
        root_dir        = ''
    }

    if ($existing) {
        Write-Host "Found existing Pages project: $ProjectName"
        Write-Step 'Updating build config and environment variables...'
        $body = @{
            build_config       = $buildConfig
            deployment_configs = $deploymentConfigs
        }
        $resp = Invoke-CloudflareApi -Method PATCH -Path "/accounts/$AccountId/pages/projects/$ProjectName" -Body $body
        Assert-CloudflareSuccess -Response $resp -Context 'Update project'
        return $resp.result
    }

    Write-Step "Creating Cloudflare Pages project '$ProjectName' (GitHub: $GitHubOwner/$GitHubRepo)..."
    $body = @{
        name               = $ProjectName
        production_branch  = $Branch
        source             = @{
            type   = 'github'
            config = @{
                owner                 = $GitHubOwner
                repo_name             = $GitHubRepo
                production_branch     = $Branch
                deployments_enabled   = $true
                pr_comments_enabled   = $true
                preview_deployment_setting = 'all'
            }
        }
        build_config       = $buildConfig
        deployment_configs = $deploymentConfigs
    }
    $resp = Invoke-CloudflareApi -Method POST -Path "/accounts/$AccountId/pages/projects" -Body $body
    Assert-CloudflareSuccess -Response $resp -Context 'Create project'
    Write-Ok "Created project $($resp.result.name)"
    return $resp.result
}

function Start-Deployment([string]$AccountId) {
    Write-Step "Triggering production deploy (branch: $Branch)..."
    $body = @{ branch = $Branch }
    $resp = Invoke-CloudflareApi -Method POST -Path "/accounts/$AccountId/pages/projects/$ProjectName/deployments" -Body $body
    Assert-CloudflareSuccess -Response $resp -Context 'Create deployment'
    return $resp.result
}

function Wait-Deployment([string]$AccountId, [string]$DeploymentId) {
    Write-Step 'Waiting for Cloudflare build (up to 25 min)...'
    $deadline = (Get-Date).AddMinutes(25)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        $resp = Invoke-CloudflareApi -Method GET -Path "/accounts/$AccountId/pages/projects/$ProjectName/deployments/$DeploymentId"
        Assert-CloudflareSuccess -Response $resp -Context 'Get deployment'
        $deployment = $resp.result
        $stage = $deployment.latest_stage.name
        $status = $deployment.latest_stage.status
        Write-Host "  stage: $stage ($status)"
        if ($status -eq 'success' -and $stage -eq 'deploy') {
            return $deployment
        }
        if ($status -eq 'failure') {
            throw "Deploy failed at stage '$stage'. Check Cloudflare dashboard build logs."
        }
    }
    throw 'Deploy timed out after 25 minutes.'
}

function Get-PagesUrl([object]$Project, [object]$Deployment) {
    if ($Deployment.url) { return $Deployment.url.TrimEnd('/') }
    if ($Project.subdomain) { return "https://$($Project.subdomain).pages.dev" }
    return "https://$ProjectName.pages.dev"
}

function Update-RenderFrontendUrl([string]$PagesUrl) {
    $renderKey = $null
    if ($env:RENDER_API_KEY) { $renderKey = $env:RENDER_API_KEY.Trim() }
    if (-not $renderKey) {
        $renderEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.render')
        if ($renderEnv['RENDER_API_KEY']) { $renderKey = $renderEnv['RENDER_API_KEY'].Trim() }
    }
    if (-not $renderKey) {
        Write-Host 'Skipping Render FRONTEND_URL update (RENDER_API_KEY not set).' -ForegroundColor DarkYellow
        return
    }
    Write-Step "Updating Render FRONTEND_URL -> $PagesUrl ..."
    $headers = @{
        Authorization = "Bearer $renderKey"
        Accept        = 'application/json'
    }
    $body = @{ value = $PagesUrl } | ConvertTo-Json
    $uri = "https://api.render.com/v1/services/$RenderServiceId/env-vars/FRONTEND_URL"
    try {
        Invoke-RestMethod -Method PUT -Uri $uri -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
        Write-Ok 'Render FRONTEND_URL updated (CORS).'
    } catch {
        Write-Host "Could not update Render FRONTEND_URL: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
}

function Test-PagesUrl([string]$Url) {
    for ($i = 1; $i -le 10; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 30
            if ($resp.StatusCode -eq 200 -and $resp.Content -match '<html|<!DOCTYPE html') {
                return $true
            }
        } catch {
            Write-Host "  smoke test attempt $i failed: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 8
    }
    return $false
}

function Ensure-WebDist {
    $distPath = Join-Path $RepoRoot $OutputDir
    Write-Step 'Running fresh web build (npm run build:web)...'
    Push-Location $RepoRoot
    try {
        npm run build:web
        if ($LASTEXITCODE -ne 0) { throw "build:web failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path (Join-Path $distPath 'index.html'))) {
        throw "Build completed but $($OutputDir)/index.html is missing."
    }
    return $distPath
}

function Deploy-ViaWrangler {
    $distPath = Ensure-WebDist
    Write-Step "Deploying via Wrangler CLI (project: $ProjectName, branch: $Branch)..."
    Push-Location $RepoRoot
    try {
        npx wrangler pages deploy $OutputDir --project-name $ProjectName --branch $Branch
        if ($LASTEXITCODE -ne 0) { throw "wrangler pages deploy failed with exit code $LASTEXITCODE" }
    } finally {
        Pop-Location
    }
    $pagesUrl = $script:ProductionWebUrl
    Write-Step "Checking $pagesUrl ..."
    if (Test-PagesUrl -Url $pagesUrl) {
        Write-Ok 'Production URL responds with HTML.'
    } else {
        Write-Host 'Wrangler deploy finished but smoke test did not pass yet (CDN may still be propagating).' -ForegroundColor DarkYellow
    }
    Update-RenderFrontendUrl -PagesUrl $script:ProductionWebUrl
    Write-Host ''
    Write-Ok 'Cloudflare Pages deploy complete (Wrangler).'
    Write-Host "Production URL: $($script:ProductionWebUrl)"
    Write-Host "Preview URL: https://$ProjectName.pages.dev"
}

function Try-GetCloudflareApiToken {
    try {
        return Get-CloudflareApiToken
    } catch {
        return $null
    }
}

Write-Host 'Lantern Study - Cloudflare Pages deploy' -ForegroundColor Cyan
$script:CloudflareApiToken = Try-GetCloudflareApiToken
if (-not $script:CloudflareApiToken) {
    Write-Host 'CLOUDFLARE_API_TOKEN not set - falling back to Wrangler CLI.' -ForegroundColor DarkYellow
    Deploy-ViaWrangler
    Write-Step 'Notifying search engines (sitemap ping + IndexNow)...'
    try {
        node (Join-Path $RepoRoot 'scripts/seo/notify-search-engines.mjs')
    } catch {
        Write-Host "Search engine notify failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
    exit 0
}

$cfEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.cloudflare')
$rootEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env')

foreach ($key in @('VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_API_URL')) {
    if (-not $rootEnv[$key]) {
        throw "$key missing in root .env (needed for Cloudflare build env vars)."
    }
}

$accountId = Get-AccountId -CfEnv $cfEnv
Write-Host "Cloudflare account id: $accountId"

$project = Ensure-Project -AccountId $accountId -RootEnv $rootEnv
$deployment = Start-Deployment -AccountId $accountId
Wait-Deployment -AccountId $accountId -DeploymentId $deployment.id | Out-Null

$project = Get-ExistingProject -AccountId $accountId
$pagesUrl = Get-PagesUrl -Project $project -Deployment $deployment
Write-Step "Checking $pagesUrl ..."
if (Test-PagesUrl -Url $pagesUrl) {
    Write-Ok 'Pages URL responds with HTML.'
} else {
    Write-Host 'Deploy finished but smoke test did not pass yet (CDN may still be propagating).' -ForegroundColor DarkYellow
}

Update-RenderFrontendUrl -PagesUrl $script:ProductionWebUrl

if ($env:SUPABASE_ACCESS_TOKEN) {
    Write-Step 'Updating Supabase Auth URL configuration...'
    try {
        & (Join-Path $RepoRoot 'scripts/configure-supabase-auth-urls.ps1') -PagesUrl $script:ProductionWebUrl
    } catch {
        Write-Host "Supabase Auth URL update failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    }
} else {
    $resendEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.resend')
    if ($resendEnv['SUPABASE_ACCESS_TOKEN']) {
        $env:SUPABASE_ACCESS_TOKEN = $resendEnv['SUPABASE_ACCESS_TOKEN']
        Write-Step 'Updating Supabase Auth URL configuration...'
        try {
            & (Join-Path $RepoRoot 'scripts/configure-supabase-auth-urls.ps1') -PagesUrl $script:ProductionWebUrl
        } catch {
            Write-Host "Supabase Auth URL update failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
        }
    } else {
        Write-Host 'Tip: set SUPABASE_ACCESS_TOKEN in .env.resend to auto-configure Auth URLs.' -ForegroundColor DarkYellow
    }
}

Write-Host ''
Write-Ok 'Cloudflare Pages deploy complete.'
Write-Host "Pages URL: $pagesUrl"
Write-Host "Production URL: $($script:ProductionWebUrl)"
Write-Host "Dashboard: https://dash.cloudflare.com/$accountId/pages/view/$ProjectName"
Write-Host ''
Write-Host 'Custom domain: run .\scripts\attach-cloudflare-pages-domain.ps1 if not attached yet.' -ForegroundColor Cyan

Write-Step 'Notifying search engines (sitemap ping + IndexNow)...'
try {
    node (Join-Path $RepoRoot 'scripts/seo/notify-search-engines.mjs')
} catch {
    Write-Host "Search engine notify failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
    Write-Host 'Run manually: npm run seo:notify' -ForegroundColor DarkYellow
}
