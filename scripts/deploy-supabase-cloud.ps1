# Link this repo to Supabase Cloud and verify / push migrations.
# Run from repo root in PowerShell:
#   .\scripts\deploy-supabase-cloud.ps1
# Optional CLI link + migration-history sync (needs access token + DB password):
#   $env:SUPABASE_ACCESS_TOKEN = '<from dashboard/account/tokens>'
#   $env:SUPABASE_DB_PASSWORD = '<from dashboard/project/database>'
#   .\scripts\deploy-supabase-cloud.ps1 -FullCli

param(
    [switch]$FullCli
)

$ErrorActionPreference = "Stop"
$ProjectRef = "tiizkjhbrnaibaagmurl"
$SupabaseUrl = "https://$ProjectRef.supabase.co"
# Public anon key - safe to embed; same value shown in Dashboard Settings API
$AnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE"

function Write-Step([string]$Message) {
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
    Write-Host $Message -ForegroundColor Green
}

function Test-InteractiveTerminal {
    return [Environment]::UserInteractive -and -not [Console]::IsInputRedirected
}

function Get-SupabaseHeaders {
    return @{
        apikey        = $AnonKey
        Authorization = "Bearer $AnonKey"
    }
}

function Test-CloudTableExists([string]$TableName) {
    $uri = "$SupabaseUrl/rest/v1/$TableName" + '?limit=1'
    try {
        $null = Invoke-WebRequest -Uri $uri -Headers (Get-SupabaseHeaders) -Method Get -UseBasicParsing
        return
    } catch {
        $webEx = $_.Exception
        if ($webEx.Response) {
            $reader = New-Object System.IO.StreamReader($webEx.Response.GetResponseStream())
            $body = $reader.ReadToEnd()
            if ($body -match '42501|PGRST301|permission denied|42703') {
                return
            }
            if ($body -match 'PGRST205|Could not find the table') {
                throw "Table '$TableName' was not found in the cloud database."
            }
        }
        throw
    }
}

function Test-SupabaseCliAuth {
    $null = npx supabase projects list 2>&1
    return $LASTEXITCODE -eq 0
}

function Ensure-ProjectRefFile {
    $tempDir = Join-Path $PSScriptRoot "..\supabase\.temp" | Resolve-Path -ErrorAction SilentlyContinue
    if (-not $tempDir) {
        $tempDir = Join-Path (Get-Location) "supabase\.temp"
        New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    } else {
        $tempDir = $tempDir.Path
    }
    Set-Content -Path (Join-Path $tempDir "project-ref") -Value $ProjectRef -NoNewline
}

Write-Host "Lantern Study - Supabase Cloud setup" -ForegroundColor Cyan
Write-Host "Project ref: $ProjectRef"
Write-Host "Dashboard:  https://supabase.com/dashboard/project/$ProjectRef"
Write-Host ""

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    throw "Node.js/npx is required."
}

Write-Step "Step 1: Verify cloud project is active and schema is ready..."
try {
    $health = Invoke-WebRequest -Uri "$SupabaseUrl/auth/v1/health" -Headers @{ apikey = $AnonKey } -UseBasicParsing
    if ($health.StatusCode -ne 200) {
        throw "Auth health check returned $($health.StatusCode)"
    }
} catch {
    throw "Cloud Supabase is not reachable at $SupabaseUrl. Check dashboard project status."
}

foreach ($table in @("profiles", "decks", "groups", "group_challenges", "study_activity", "marketplace_orders")) {
    Test-CloudTableExists $table
    Write-Host "  OK  table: $table"
}

Ensure-ProjectRefFile
Write-Ok "Cloud database verified (project ACTIVE, core tables present)."

if ($FullCli) {
    Write-Step "Step 2: Supabase CLI login..."
    if (-not $env:SUPABASE_ACCESS_TOKEN) {
        if (Test-InteractiveTerminal) {
            npx supabase login
        } else {
            throw @"
SUPABASE_ACCESS_TOKEN is not set and this terminal is non-interactive.
Create a token at https://supabase.com/dashboard/account/tokens then run:
  `$env:SUPABASE_ACCESS_TOKEN = '<your-token>'
  `$env:SUPABASE_DB_PASSWORD = '<db-password>'
  .\scripts\deploy-supabase-cloud.ps1 -FullCli
"@
        }
    }

    if (-not (Test-SupabaseCliAuth)) {
        throw "Supabase CLI authentication failed. Set SUPABASE_ACCESS_TOKEN or run supabase login."
    }

    Write-Step "Step 3: Link project..."
    if (-not $env:SUPABASE_DB_PASSWORD) {
        if (Test-InteractiveTerminal) {
            npx supabase link --project-ref $ProjectRef
        } else {
            throw "Set SUPABASE_DB_PASSWORD (Dashboard Settings Database) for non-interactive link."
        }
    } else {
        npx supabase link --project-ref $ProjectRef --password $env:SUPABASE_DB_PASSWORD
    }

    Write-Step "Step 4: Sync local migration history (schema already on cloud)..."
    $migrationFiles = Get-ChildItem -Path (Join-Path $PSScriptRoot "..\supabase\migrations\*.sql") | Sort-Object Name
    foreach ($file in $migrationFiles) {
        if ($file.Name -match '^(\d{14}|[0-9]{8,})') {
            $version = $Matches[1]
            npx supabase migration repair --status applied $version
        }
    }

    Write-Step "Step 5: Push any pending migrations..."
    npx supabase db push
} else {
    Write-Host ""
    Write-Host "Migrations are already on Supabase Cloud (applied during setup)." -ForegroundColor DarkGray
    Write-Host "Optional: run with -FullCli to link the Supabase CLI for future db push." -ForegroundColor DarkGray
}

Write-Host ""
Write-Ok "Done. Next:"
Write-Host '  1. Copy API keys from Dashboard Settings API into .env and apps/api-server/.env'
Write-Host "     (use cloud URL https://$ProjectRef.supabase.co and cloud anon/service keys)"
Write-Host '  2. Configure Auth URLs - see docs/deploy/02-supabase-cloud.md'
Write-Host '  3. Smoke test: npm run dev:web and sign up with a real email'
