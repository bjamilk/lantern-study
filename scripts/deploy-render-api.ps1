# Deploy Lantern Study API to Render via REST API.
# Requires RENDER_API_KEY in .env.render or environment.
#
# Usage (repo root):
#   .\scripts\deploy-render-api.ps1
# Or:
#   $env:RENDER_API_KEY = 'rnd_...'; .\scripts\deploy-render-api.ps1

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ServiceName = 'lantern-study-api'
$WorkerServiceName = 'lantern-study-worker'
$GitHubRepo = 'https://github.com/bjamilk/lantern-study'
$Branch = 'main'
$HealthPath = '/health'
$ProductionFrontendUrl = 'https://lanternstudy.com'
$ApiBase = 'https://api.render.com/v1'

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

function Get-RenderApiKey {
    if ($env:RENDER_API_KEY) { return $env:RENDER_API_KEY.Trim() }
    $renderEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.render')
    if ($renderEnv['RENDER_API_KEY']) { return $renderEnv['RENDER_API_KEY'].Trim() }
    throw @"
RENDER_API_KEY is missing.
1. Open https://dashboard.render.com/u/settings#api-keys
2. Create an API key
3. Save it in .env.render (copy from .env.render.example) OR run:
   `$env:RENDER_API_KEY = 'rnd_...'
"@
}

function Invoke-RenderApi {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )
    $headers = @{
        Authorization = "Bearer $script:RenderApiKey"
        Accept        = 'application/json'
    }
    $uri = "$ApiBase$Path"
    if ($null -ne $Body) {
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20)
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Get-RenderItems([object]$Response) {
    if ($null -eq $Response) { return @() }
    if ($Response -is [System.Array]) {
        return @($Response | ForEach-Object {
            if ($_.service) { $_.service }
            elseif ($_.owner) { $_.owner }
            elseif ($_.deploy) { $_.deploy }
            else { $_ }
        })
    }
    return @($Response)
}

function Get-OwnerId {
    $owners = Get-RenderItems (Invoke-RenderApi -Method GET -Path '/owners?limit=20')
    if ($owners.Count -eq 0) { throw 'No Render workspaces found for this API key.' }
    return $owners[0].id
}

function Get-ExistingService([string]$OwnerId) {
    $items = Get-RenderItems (Invoke-RenderApi -Method GET -Path "/services?ownerId=$OwnerId&limit=50")
    return $items | Where-Object { $_.name -eq $ServiceName } | Select-Object -First 1
}

function New-JwtSecret {
    return -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 48 | ForEach-Object { [char]$_ })
}

function Build-EnvVars([hashtable]$ApiEnv) {
    $jwt = if ($ApiEnv['JWT_SECRET']) { $ApiEnv['JWT_SECRET'] } else { New-JwtSecret }
    $vars = @(
        @{ key = 'NODE_ENV'; value = 'production' },
        @{ key = 'PORT'; value = '3001' },
        @{ key = 'FRONTEND_URL'; value = $ProductionFrontendUrl },
        @{ key = 'WEB_APP_URL'; value = 'https://lantern-study.pages.dev' },
        @{ key = 'REDIS_ENABLED'; value = 'true' },
        @{ key = 'REDIS_URL'; value = $ApiEnv['REDIS_URL'] },
        @{ key = 'GOTENBERG_URL'; value = $ApiEnv['GOTENBERG_URL'] },
        @{ key = 'ALLOW_DEV_AUTH_BYPASS'; value = 'false' },
        @{ key = 'ENABLE_MARKETPLACE_JOBS'; value = 'true' },
        @{ key = 'SUPABASE_URL'; value = 'https://tiizkjhbrnaibaagmurl.supabase.co' },
        @{ key = 'SUPABASE_SERVICE_ROLE_KEY'; value = $ApiEnv['SUPABASE_SERVICE_ROLE_KEY'] },
        @{ key = 'GROQ_API_KEY'; value = $ApiEnv['GROQ_API_KEY'] },
        @{ key = 'JWT_SECRET'; value = $jwt },
        @{ key = 'API_KEY_SALT_ROUNDS'; value = '12' },
        @{ key = 'API_KEY_MAX_PER_USER'; value = '10' },
        @{ key = 'API_KEY_DEFAULT_TTL_DAYS'; value = '0' },
        @{ key = 'PUBLIC_READ_RATE_LIMIT_MAX'; value = '120' },
        @{ key = 'PUBLIC_WRITE_RATE_LIMIT_MAX'; value = '10' },
        @{ key = 'API_KEY_AUTH_RATE_LIMIT_MAX'; value = '20' },
        @{ key = 'ANON_IP_RATE_LIMIT_MAX'; value = '300' },
        @{ key = 'AUTHENTICATED_RATE_LIMIT_MAX'; value = '1200' },
        @{ key = 'AI_POST_BURST_MAX'; value = '15' },
        @{ key = 'UPLOAD_BURST_MAX'; value = '10' },
        @{ key = 'BULLMQ_ENABLED'; value = 'true' },
        @{ key = 'ADMIN_RATE_LIMIT_MAX'; value = '300' }
    )
    if ($ApiEnv['SENTRY_DSN']) {
        $vars += @(
            @{ key = 'SENTRY_DSN'; value = $ApiEnv['SENTRY_DSN'] },
            @{ key = 'SENTRY_RELEASE'; value = $ApiEnv['SENTRY_RELEASE'] },
            @{ key = 'SENTRY_TRACES_SAMPLE_RATE'; value = $ApiEnv['SENTRY_TRACES_SAMPLE_RATE'] }
        )
    }
    return $vars
}

function Build-WorkerEnvVars([hashtable]$ApiEnv) {
    return @(
        @{ key = 'NODE_ENV'; value = 'production' },
        @{ key = 'BULLMQ_ENABLED'; value = 'true' },
        @{ key = 'REDIS_ENABLED'; value = 'true' },
        @{ key = 'REDIS_URL'; value = $ApiEnv['REDIS_URL'] },
        @{ key = 'SUPABASE_URL'; value = 'https://tiizkjhbrnaibaagmurl.supabase.co' },
        @{ key = 'SUPABASE_SERVICE_ROLE_KEY'; value = $ApiEnv['SUPABASE_SERVICE_ROLE_KEY'] },
        @{ key = 'GROQ_API_KEY'; value = $ApiEnv['GROQ_API_KEY'] },
        @{ key = 'ENABLE_MARKETPLACE_JOBS'; value = 'true' },
        @{ key = 'ENABLE_DATA_RETENTION_JOBS'; value = 'true' }
    )
}

function Get-ExistingServiceByName([string]$OwnerId, [string]$Name) {
    $items = Get-RenderItems (Invoke-RenderApi -Method GET -Path "/services?ownerId=$OwnerId&limit=50")
    return $items | Where-Object { $_.name -eq $Name } | Select-Object -First 1
}

function Ensure-WorkerService([string]$OwnerId, [array]$EnvVars) {
    $existing = Get-ExistingServiceByName -OwnerId $OwnerId -Name $WorkerServiceName
    if ($existing) {
        Write-Host "Found existing worker: $($existing.name) ($($existing.id))"
        return $existing
    }

    Write-Step "Creating Render background worker '$WorkerServiceName'..."
    $body = @{
        type           = 'background_worker'
        name           = $WorkerServiceName
        ownerId        = $OwnerId
        repo           = $GitHubRepo
        branch         = $Branch
        autoDeploy     = 'yes'
        envVars        = $EnvVars
        serviceDetails = @{
            runtime            = 'docker'
            plan               = 'free'
            region             = 'oregon'
            envSpecificDetails = @{
                dockerfilePath = './apps/api-server/Dockerfile'
                dockerContext  = '.'
                dockerCommand  = 'node apps/api-server/dist/worker.js'
            }
        }
    }
    $created = Invoke-RenderApi -Method POST -Path '/services' -Body $body
    $service = if ($created.service) { $created.service } else { $created }
    Write-Ok "Created worker $($service.name)"
    return $service
}

function Ensure-Service([string]$OwnerId, [array]$EnvVars) {
    $existing = Get-ExistingService -OwnerId $OwnerId
    if ($existing) {
        Write-Host "Found existing service: $($existing.name) ($($existing.id))"
        return $existing
    }

    Write-Step "Creating Render web service '$ServiceName'..."
    $body = @{
        type           = 'web_service'
        name           = $ServiceName
        ownerId        = $OwnerId
        repo           = $GitHubRepo
        branch         = $Branch
        autoDeploy     = 'yes'
        envVars        = $EnvVars
        serviceDetails = @{
            runtime            = 'docker'
            plan               = 'free'
            region             = 'oregon'
            healthCheckPath    = $HealthPath
            envSpecificDetails = @{
                dockerfilePath = './apps/api-server/Dockerfile'
                dockerContext  = '.'
            }
        }
    }
    $created = Invoke-RenderApi -Method POST -Path '/services' -Body $body
    $service = if ($created.service) { $created.service } else { $created }
    Write-Ok "Created service $($service.name)"
    return $service
}

function Update-ServiceEnvVars([string]$ServiceId, [array]$EnvVars) {
    Write-Step 'Updating environment variables...'
    foreach ($ev in $EnvVars) {
        if (-not $ev.value) {
            Write-Host "  skip $($ev.key) (empty)"
            continue
        }
        $body = @{ value = [string]$ev.value }
        Invoke-RenderApi -Method PUT -Path "/services/$ServiceId/env-vars/$($ev.key)" -Body $body | Out-Null
        Write-Host "  set $($ev.key)"
    }
}

function Start-Deploy([string]$ServiceId) {
    Write-Step 'Triggering deploy...'
    $deploy = Invoke-RenderApi -Method POST -Path "/services/$ServiceId/deploys" -Body @{}
    $d = if ($deploy.deploy) { $deploy.deploy } else { $deploy }
    return $d.id
}

function Wait-Deploy([string]$ServiceId, [string]$DeployId) {
    Write-Step 'Waiting for deploy to finish (up to 20 min)...'
    $deadline = (Get-Date).AddMinutes(20)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        $items = Get-RenderItems (Invoke-RenderApi -Method GET -Path "/services/$ServiceId/deploys?limit=5")
        $deploy = $items | Where-Object { $_.id -eq $DeployId } | Select-Object -First 1
        if (-not $deploy) { continue }
        $status = $deploy.status
        Write-Host "  deploy status: $status"
        if ($status -in @('live', 'deactivated')) {
            return $true
        }
        if ($status -in @('build_failed', 'update_failed', 'canceled')) {
            throw "Deploy failed with status: $status"
        }
    }
    throw 'Deploy timed out after 20 minutes.'
}

function Get-ServiceUrl([object]$Service) {
    if ($Service.serviceDetails -and $Service.serviceDetails.url) {
        return $Service.serviceDetails.url.TrimEnd('/')
    }
    return "https://$ServiceName.onrender.com"
}

function Update-RootEnv([string]$ApiUrl) {
    $envPath = Join-Path $RepoRoot '.env'
    if (-not (Test-Path $envPath)) { return }
    $content = Get-Content $envPath -Raw
    if ($content -match '(?m)^VITE_API_URL=.*$') {
        $content = [regex]::Replace($content, '(?m)^VITE_API_URL=.*$', "VITE_API_URL=$ApiUrl")
    } else {
        $content += "`nVITE_API_URL=$ApiUrl`n"
    }
    Set-Content -Path $envPath -Value $content -NoNewline
    Write-Ok "Updated .env VITE_API_URL=$ApiUrl"
}

function Test-Health([string]$BaseUrl) {
    $url = "$BaseUrl$HealthPath"
    for ($i = 1; $i -le 12; $i++) {
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 30
            if ($resp.StatusCode -eq 200 -and $resp.Content -match '"status"\s*:\s*"ok"') {
                return $true
            }
        } catch {
            Write-Host "  health attempt $i failed: $($_.Exception.Message)"
        }
        Start-Sleep -Seconds 10
    }
    return $false
}

Write-Host 'Lantern Study - Render API deploy' -ForegroundColor Cyan
$script:RenderApiKey = Get-RenderApiKey
$apiEnv = Read-DotEnvFile (Join-Path $RepoRoot 'apps/api-server/.env')
if (-not $apiEnv['SUPABASE_SERVICE_ROLE_KEY']) {
    throw 'SUPABASE_SERVICE_ROLE_KEY missing in apps/api-server/.env'
}
if (-not $apiEnv['GROQ_API_KEY']) {
    Write-Host 'Warning: GROQ_API_KEY missing in apps/api-server/.env (AI routes may fail).' -ForegroundColor DarkYellow
}
if (-not $apiEnv['REDIS_URL']) {
    Write-Host 'Warning: REDIS_URL missing in apps/api-server/.env (production startup requires Redis).' -ForegroundColor DarkYellow
}

$envVars = Build-EnvVars -ApiEnv $apiEnv
$ownerId = Get-OwnerId
Write-Host "Render workspace id: $ownerId"
$service = Ensure-Service -OwnerId $ownerId -EnvVars $envVars
Update-ServiceEnvVars -ServiceId $service.id -EnvVars $envVars
$deployId = Start-Deploy -ServiceId $service.id
Wait-Deploy -ServiceId $service.id -DeployId $deployId | Out-Null

$workerEnvVars = Build-WorkerEnvVars -ApiEnv $apiEnv
$worker = Ensure-WorkerService -OwnerId $ownerId -EnvVars $workerEnvVars
Update-ServiceEnvVars -ServiceId $worker.id -EnvVars $workerEnvVars
$workerDeployId = Start-Deploy -ServiceId $worker.id
Wait-Deploy -ServiceId $worker.id -DeployId $workerDeployId | Out-Null

$service = Get-ExistingService -OwnerId $ownerId
$serviceUrl = Get-ServiceUrl -Service $service
Write-Step "Checking $serviceUrl$HealthPath ..."
if (Test-Health -BaseUrl $serviceUrl) {
    Write-Ok 'Health check passed.'
} else {
    Write-Host 'Deploy finished but health check not yet OK (free tier may still be waking up).' -ForegroundColor DarkYellow
}
Update-RootEnv -ApiUrl $serviceUrl
Write-Host ''
Write-Ok 'Render deploy complete.'
Write-Host "API URL: $serviceUrl"
Write-Host "Dashboard: https://dashboard.render.com/web/$($service.id)"
Write-Host "Worker dashboard: https://dashboard.render.com/worker/$($worker.id)"
