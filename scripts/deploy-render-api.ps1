# Deploy Lantern Study API to Render via REST API.
# Requires RENDER_API_KEY in .env.render or environment.
#
# Usage (repo root):
#   .\scripts\deploy-render-api.ps1
# Or:
#   $env:RENDER_API_KEY = 'rnd_...'; .\scripts\deploy-render-api.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ServiceName = 'lantern-study-api'
$WorkerServiceName = 'lantern-study-worker'
$GitHubRepo = 'https://github.com/bjamilk/lantern-study'
$Branch = 'main'
$HealthPath = '/health'
$ProductionFrontendUrl = $script:ProductionWebUrl
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
        [object]$Body = $null,
        [int]$MaxAttempts = 5
    )
    $headers = @{
        Authorization = "Bearer $script:RenderApiKey"
        Accept        = 'application/json'
    }
    $uri = "$ApiBase$Path"
    $lastError = $null

    for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
        try {
            if ($null -ne $Body) {
                return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 20)
            }
            return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
        } catch {
            $lastError = $_
            $retryable = $false
            if ($_.Exception -is [System.Net.WebException]) {
                $status = [int]$_.Exception.Response.StatusCode
                if ($status -ge 500 -or $status -eq 429) { $retryable = $true }
            }
            if ($_.Exception.Message -match 'could not be resolved|timed out|connection|temporarily unavailable') {
                $retryable = $true
            }
            if (-not $retryable -or $attempt -eq $MaxAttempts) {
                throw
            }
            $delay = [Math]::Min(30, 2 * $attempt)
            Write-Host "  Render API $Method $Path failed (attempt $attempt/$MaxAttempts): $($_.Exception.Message). Retrying in ${delay}s..." -ForegroundColor DarkYellow
            Start-Sleep -Seconds $delay
        }
    }

    throw $lastError
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

function Build-EnvVars([hashtable]$ApiEnv, [hashtable]$ResendEnv) {
    $jwt = if ($ApiEnv['JWT_SECRET']) { $ApiEnv['JWT_SECRET'] } else { New-JwtSecret }
    $vars = @(
        @{ key = 'NODE_ENV'; value = 'production' },
        @{ key = 'PORT'; value = '3001' },
        @{ key = 'FRONTEND_URL'; value = $ProductionFrontendUrl },
        @{ key = 'WEB_APP_URL'; value = $script:ProductionWebUrl },
        @{ key = 'REDIS_ENABLED'; value = 'true' },
        @{ key = 'REDIS_URL'; value = $ApiEnv['REDIS_URL'] },
        @{ key = 'GOTENBERG_URL'; value = $ApiEnv['GOTENBERG_URL'] },
        @{ key = 'ALLOW_DEV_AUTH_BYPASS'; value = 'false' },
        @{ key = 'ENABLE_MARKETPLACE_JOBS'; value = 'true' },
        @{ key = 'SUPABASE_URL'; value = 'https://tiizkjhbrnaibaagmurl.supabase.co' },
        @{ key = 'SUPABASE_SERVICE_ROLE_KEY'; value = $ApiEnv['SUPABASE_SERVICE_ROLE_KEY'] },
        @{ key = 'SUPABASE_ANON_KEY'; value = $ApiEnv['SUPABASE_ANON_KEY'] },
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
        # Retention cron runs on the worker when BullMQ is on; keep flag true for fallback/docs.
        @{ key = 'ENABLE_DATA_RETENTION_JOBS'; value = 'true' },
        @{ key = 'ADMIN_RATE_LIMIT_MAX'; value = '300' }
    )
    # Optional: YouTube transcript managed fallback (set in apps/api-server/.env or Render dashboard)
    if ($ApiEnv['SUPADATA_API_KEY']) {
        $vars += @{ key = 'SUPADATA_API_KEY'; value = $ApiEnv['SUPADATA_API_KEY'] }
    }
    if ($ApiEnv['SENTRY_DSN']) {
        $vars += @(
            @{ key = 'SENTRY_DSN'; value = $ApiEnv['SENTRY_DSN'] },
            @{ key = 'SENTRY_RELEASE'; value = $ApiEnv['SENTRY_RELEASE'] },
            @{ key = 'SENTRY_TRACES_SAMPLE_RATE'; value = $ApiEnv['SENTRY_TRACES_SAMPLE_RATE'] }
        )
    }
    if ($ResendEnv['RESEND_API_KEY']) {
        $contactTo = if ($ResendEnv['CONTACT_TO_EMAIL']) { $ResendEnv['CONTACT_TO_EMAIL'] } else { $script:SupportEmail }
        $fromName = if ($ResendEnv['RESEND_SENDER_NAME']) { $ResendEnv['RESEND_SENDER_NAME'] } else { 'Lantern Study' }
        $fromEmail = if ($ResendEnv['RESEND_FROM_EMAIL']) { $ResendEnv['RESEND_FROM_EMAIL'] } else { $script:ProductionFromEmail }
        $contactFrom = if ($ResendEnv['CONTACT_FROM_EMAIL']) {
            $ResendEnv['CONTACT_FROM_EMAIL']
        } else {
            "$fromName <$fromEmail>"
        }
        $vars += @(
            @{ key = 'RESEND_API_KEY'; value = $ResendEnv['RESEND_API_KEY'] },
            @{ key = 'CONTACT_TO_EMAIL'; value = $contactTo },
            @{ key = 'CONTACT_FROM_EMAIL'; value = $contactFrom },
            @{ key = 'RESEND_FROM_EMAIL'; value = $fromEmail }
        )
    } else {
        Write-Host 'Warning: RESEND_API_KEY missing in .env.resend (contact form and auth email may fail).' -ForegroundColor DarkYellow
    }
    return $vars
}

function Build-WorkerEnvVars([hashtable]$ApiEnv) {
    $vars = @(
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
    if ($ApiEnv['SUPADATA_API_KEY']) {
        $vars += @{ key = 'SUPADATA_API_KEY'; value = $ApiEnv['SUPADATA_API_KEY'] }
    }
    return $vars
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
            # Match the API service plan (starter). Free workers are not available on paid workspaces
            # that have upgraded, and free-plan create fails with "only web services allowed".
            plan               = 'starter'
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
    Write-Step 'Waiting for deploy to finish (up to 35 min)...'
    $deadline = (Get-Date).AddMinutes(35)
    $consecutivePollErrors = 0
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 20
        try {
            $items = Get-RenderItems (Invoke-RenderApi -Method GET -Path "/services/$ServiceId/deploys?limit=5")
            $consecutivePollErrors = 0
        } catch {
            $consecutivePollErrors++
            Write-Host "  deploy poll failed ($consecutivePollErrors): $($_.Exception.Message)" -ForegroundColor DarkYellow
            if ($consecutivePollErrors -ge 8) {
                Write-Host '  too many consecutive poll failures; will verify via health check instead.' -ForegroundColor DarkYellow
                return $false
            }
            continue
        }

        # Render list payloads are often { deploy: { id, status, ... } }.
        $deploy = $null
        foreach ($item in $items) {
            $candidate = if ($item.deploy) { $item.deploy } else { $item }
            if ($candidate.id -eq $DeployId) {
                $deploy = $candidate
                break
            }
        }
        if (-not $deploy) {
            # Fallback: newest deploy may be the one we just triggered.
            $newest = $items | Select-Object -First 1
            $deploy = if ($newest.deploy) { $newest.deploy } else { $newest }
        }
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
    Write-Host 'Deploy wait timed out after 35 minutes (service may still be live on free tier).' -ForegroundColor DarkYellow
    return $false
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
$rootEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env')
$resendEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.resend')
# Auth routes need the anon key; accept common local names from root .env.
if (-not $apiEnv['SUPABASE_ANON_KEY']) {
    if ($rootEnv['SUPABASE_ANON_KEY']) { $apiEnv['SUPABASE_ANON_KEY'] = $rootEnv['SUPABASE_ANON_KEY'] }
    elseif ($rootEnv['VITE_SUPABASE_ANON_KEY']) { $apiEnv['SUPABASE_ANON_KEY'] = $rootEnv['VITE_SUPABASE_ANON_KEY'] }
    elseif ($rootEnv['EXPO_PUBLIC_SUPABASE_ANON_KEY']) { $apiEnv['SUPABASE_ANON_KEY'] = $rootEnv['EXPO_PUBLIC_SUPABASE_ANON_KEY'] }
}
if (-not $apiEnv['SUPABASE_SERVICE_ROLE_KEY']) {
    throw 'SUPABASE_SERVICE_ROLE_KEY missing in apps/api-server/.env'
}
if (-not $apiEnv['SUPABASE_ANON_KEY']) {
    throw 'SUPABASE_ANON_KEY missing (set in apps/api-server/.env or VITE_SUPABASE_ANON_KEY in root .env). Auth routes will fail without it.'
}
if (-not $apiEnv['GROQ_API_KEY']) {
    Write-Host 'Warning: GROQ_API_KEY missing in apps/api-server/.env (AI routes may fail).' -ForegroundColor DarkYellow
}
if (-not $apiEnv['REDIS_URL']) {
    Write-Host 'Warning: REDIS_URL missing in apps/api-server/.env (production startup requires Redis).' -ForegroundColor DarkYellow
}

$envVars = Build-EnvVars -ApiEnv $apiEnv -ResendEnv $resendEnv
$ownerId = Get-OwnerId
Write-Host "Render workspace id: $ownerId"
$service = Ensure-Service -OwnerId $ownerId -EnvVars $envVars
Update-ServiceEnvVars -ServiceId $service.id -EnvVars $envVars
$deployId = Start-Deploy -ServiceId $service.id
$apiDeployOk = Wait-Deploy -ServiceId $service.id -DeployId $deployId
if (-not $apiDeployOk) {
    Write-Host 'Continuing to health check despite deploy wait timeout.' -ForegroundColor DarkYellow
}

$worker = $null
$workerDeployId = $null
try {
    $workerEnvVars = Build-WorkerEnvVars -ApiEnv $apiEnv
    $worker = Ensure-WorkerService -OwnerId $ownerId -EnvVars $workerEnvVars
    Update-ServiceEnvVars -ServiceId $worker.id -EnvVars $workerEnvVars
    $workerDeployId = Start-Deploy -ServiceId $worker.id
    $workerDeployOk = Wait-Deploy -ServiceId $worker.id -DeployId $workerDeployId
    if (-not $workerDeployOk) {
        Write-Host 'Worker deploy wait timed out; skipping worker health verification.' -ForegroundColor DarkYellow
    }
} catch {
    $workerMessage = $_.Exception.Message
    if ($workerMessage -match 'only web services allowed for plan') {
        Write-Host 'Worker deploy skipped: current Render plan allows web services only (API deploy succeeded).' -ForegroundColor DarkYellow
    } else {
        Write-Host "Worker deploy skipped: $workerMessage" -ForegroundColor DarkYellow
    }
}

$service = Get-ExistingService -OwnerId $ownerId
$serviceUrl = Get-ServiceUrl -Service $service
Write-Step "Checking $serviceUrl$HealthPath ..."
$healthOk = Test-Health -BaseUrl $serviceUrl
if ($healthOk) {
    Write-Ok 'Health check passed.'
} else {
    Write-Host 'Deploy finished but health check not yet OK (free tier may still be waking up).' -ForegroundColor DarkYellow
}
Update-RootEnv -ApiUrl $serviceUrl
Write-Host ''
Write-Host "API URL: $serviceUrl"
Write-Host "Dashboard: https://dashboard.render.com/web/$($service.id)"
if ($worker) {
    Write-Host "Worker dashboard: https://dashboard.render.com/worker/$($worker.id)"
}
if ($healthOk -or $apiDeployOk) {
    Write-Ok 'Render deploy complete.'
    exit 0
}

Write-Host 'Render deploy did not reach live status and health check failed.' -ForegroundColor Red
exit 1
