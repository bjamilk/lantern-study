# Provision lantern-study-gotenberg on Render and set GOTENBERG_URL on the API service.
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent

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

$renderKey = $env:RENDER_API_KEY
if (-not $renderKey) {
    $renderKey = (Read-DotEnvFile (Join-Path $RepoRoot '.env.render'))['RENDER_API_KEY']
}
if (-not $renderKey) { throw 'RENDER_API_KEY missing' }

$headers = @{ Authorization = "Bearer $renderKey"; Accept = 'application/json' }
$base = 'https://api.render.com/v1'
$owners = Invoke-RestMethod -Uri "$base/owners?limit=20" -Headers $headers
$ownerId = $owners[0].owner.id
$services = Invoke-RestMethod -Uri "$base/services?ownerId=$ownerId&limit=50" -Headers $headers
$gotenberg = $services | ForEach-Object { $_.service } | Where-Object { $_.name -eq 'lantern-study-gotenberg' } | Select-Object -First 1

if (-not $gotenberg) {
    Write-Host 'Creating lantern-study-gotenberg service...' -ForegroundColor Yellow
    $body = @{
        type           = 'web_service'
        name           = 'lantern-study-gotenberg'
        ownerId        = $ownerId
        image          = @{ ownerId = $ownerId; imagePath = 'docker.io/gotenberg/gotenberg:8' }
        serviceDetails = @{
            env             = 'image'
            plan            = 'free'
            region          = 'oregon'
            healthCheckPath = '/health'
        }
    } | ConvertTo-Json -Depth 10
    $created = Invoke-RestMethod -Method POST -Uri "$base/services" -Headers $headers -ContentType 'application/json' -Body $body
    $gotenberg = if ($created.service) { $created.service } else { $created }
    Write-Host "Created gotenberg service $($gotenberg.id)"
} else {
    Write-Host "Found gotenberg service $($gotenberg.id)"
}

# Gotenberg listens on 3000 by default; Render routes traffic on PORT (10000).
Write-Host 'Ensuring API_PORT_FROM_ENV=PORT on gotenberg...' -ForegroundColor Yellow
Invoke-RestMethod -Method PUT -Uri "$base/services/$($gotenberg.id)/env-vars/API_PORT_FROM_ENV" -Headers $headers -ContentType 'application/json' -Body (@{ value = 'PORT' } | ConvertTo-Json) | Out-Null

$deadline = (Get-Date).AddMinutes(15)
do {
    Start-Sleep -Seconds 20
    $deploys = Invoke-RestMethod -Uri "$base/services/$($gotenberg.id)/deploys?limit=1" -Headers $headers
    $d = $deploys[0].deploy
    $status = $d.status
    Write-Host "  gotenberg deploy: $status"
} while (
    $status -notin @('live', 'deactivated') -and
    (Get-Date) -lt $deadline -and
    $status -notin @('build_failed', 'update_failed', 'canceled')
)

if ($status -notin @('live', 'deactivated')) {
    throw "Gotenberg deploy failed: $status"
}

# Internal hostname + Render PORT (10000 when API_PORT_FROM_ENV=PORT).
$gotenbergUrl = 'https://lantern-study-gotenberg.onrender.com'
Write-Host "GOTENBERG_URL=$gotenbergUrl" -ForegroundColor Green

$apiService = $services | ForEach-Object { $_.service } | Where-Object { $_.name -eq 'lantern-study-api' } | Select-Object -First 1
if (-not $apiService) { throw 'lantern-study-api service not found' }

Invoke-RestMethod -Method PUT -Uri "$base/services/$($apiService.id)/env-vars/GOTENBERG_URL" -Headers $headers -ContentType 'application/json' -Body (@{ value = $gotenbergUrl } | ConvertTo-Json) | Out-Null
Write-Host 'Set GOTENBERG_URL on lantern-study-api'

# Persist for deploy-render-api.ps1
$apiEnvPath = Join-Path $RepoRoot 'apps/api-server/.env'
if (Test-Path $apiEnvPath) {
    $content = Get-Content $apiEnvPath -Raw
    if ($content -match '(?m)^GOTENBERG_URL=.*$') {
        $content = [regex]::Replace($content, '(?m)^GOTENBERG_URL=.*$', "GOTENBERG_URL=$gotenbergUrl")
    } else {
        $content += "`nGOTENBERG_URL=$gotenbergUrl`n"
    }
    Set-Content -Path $apiEnvPath -Value $content -NoNewline
}
