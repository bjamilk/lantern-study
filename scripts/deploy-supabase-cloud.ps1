# Link this repo to Supabase Cloud and verify / push migrations.

# Run from repo root in PowerShell:

#   .\scripts\deploy-supabase-cloud.ps1

# Optional CLI link + migration push:

#   $env:SUPABASE_ACCESS_TOKEN = '<from dashboard/account/tokens>'   # or in .env.resend

#   $env:SUPABASE_DB_PASSWORD = '<from dashboard/project/database>'  # optional if already linked

#   .\scripts\deploy-supabase-cloud.ps1 -FullCli

# Fix history mismatch (MCP-applied migrations with different version IDs):

#   .\scripts\deploy-supabase-cloud.ps1 -RepairHistory



param(

    [switch]$FullCli,

    [switch]$RepairHistory

)



$ErrorActionPreference = "Stop"

$ProjectRef = "tiizkjhbrnaibaagmurl"

$SupabaseUrl = "https://$ProjectRef.supabase.co"

$AnonKey = $env:SUPABASE_ANON_KEY
if (-not $AnonKey) {
    throw "Set SUPABASE_ANON_KEY before running deploy-supabase-cloud.ps1"
}

$RepoRoot = Split-Path $PSScriptRoot -Parent



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



function Ensure-AccessTokenFromEnvFile {

    if ($env:SUPABASE_ACCESS_TOKEN) { return }

    $resendEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.resend')

    if ($resendEnv['SUPABASE_ACCESS_TOKEN']) {

        $env:SUPABASE_ACCESS_TOKEN = $resendEnv['SUPABASE_ACCESS_TOKEN']

    }

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



function Invoke-SupabaseCli([string[]]$CliArgs) {
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & npx supabase @CliArgs 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    return @{ Output = ($output | Out-String); ExitCode = $exitCode }
}

function Get-MigrationHistoryStatus {
    $result = Invoke-SupabaseCli @('migration', 'list', '--linked')
    if ($result.ExitCode -ne 0) {
        return @{ Ok = $false; Message = $result.Output.Trim() }
    }

    $rows = @()
    foreach ($line in ($result.Output -split "`n")) {
        if ($line -notmatch '^\s+(\d{8,14})?\s+\|\s+(\d{8,14})?\s+\|') { continue }
        $local = $Matches[1].Trim()
        $remote = $Matches[2].Trim()
        if ($local) { $rows += [PSCustomObject]@{ Local = $local; Remote = $remote } }
        elseif ($remote) { $rows += [PSCustomObject]@{ Local = ''; Remote = $remote } }
    }

    $remoteOnly = @($rows | Where-Object { $_.Remote -and -not $_.Local } | ForEach-Object { $_.Remote })
    $localOnly = @($rows | Where-Object { $_.Local -and -not $_.Remote } | ForEach-Object { $_.Local })
    $aligned = @($rows | Where-Object { $_.Local -and $_.Remote -and $_.Local -eq $_.Remote })

    return @{
        Ok         = $true
        Total      = $rows.Count
        Aligned    = $aligned.Count
        RemoteOnly = $remoteOnly.Count
        LocalOnly  = $localOnly.Count
        IsSynced   = ($remoteOnly.Count -eq 0 -and $localOnly.Count -eq 0)
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



function Ensure-CliLinked {

    Ensure-AccessTokenFromEnvFile

    if (-not $env:SUPABASE_ACCESS_TOKEN) {

        if (Test-InteractiveTerminal) {

            Write-Step 'Supabase CLI login...'

            npx supabase login

        } else {

            throw @"

SUPABASE_ACCESS_TOKEN is not set and this terminal is non-interactive.

Create a token at https://supabase.com/dashboard/account/tokens then add to .env.resend or run:

  `$env:SUPABASE_ACCESS_TOKEN = '<your-token>'

"@

        }

    }



    if (-not (Test-SupabaseCliAuth)) {

        throw "Supabase CLI authentication failed. Set SUPABASE_ACCESS_TOKEN or run supabase login."

    }



    Write-Step 'Link project (skip if already linked)...'

    if (-not $env:SUPABASE_DB_PASSWORD) {

        if (Test-InteractiveTerminal) {

            npx supabase link --project-ref $ProjectRef

        } else {

            npx supabase link --project-ref $ProjectRef 2>&1 | Out-Null

        }

    } else {

        npx supabase link --project-ref $ProjectRef --password $env:SUPABASE_DB_PASSWORD

    }

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



foreach ($table in @("profiles", "decks", "groups", "group_challenges", "study_activity", "marketplace_orders", "notes")) {

    Test-CloudTableExists $table

    Write-Host "  OK  table: $table"

}



Ensure-ProjectRefFile
Write-Ok "Cloud database verified (project ACTIVE, core tables present)."

Ensure-AccessTokenFromEnvFile
if ($env:SUPABASE_ACCESS_TOKEN) {
    Write-Step 'Step 2: Check migration history alignment (CLI)...'
    $hist = Get-MigrationHistoryStatus
    if (-not $hist.Ok) {
        Write-Host "  Could not read migration list: $($hist.Message)" -ForegroundColor DarkYellow
        Write-Host '  Run with -FullCli after linking, or use -RepairHistory if db push fails.' -ForegroundColor DarkGray
    } elseif ($hist.IsSynced) {
        Write-Ok "Migration history aligned ($($hist.Aligned) versions)."
    } else {
        Write-Host "  Migration history mismatch: $($hist.RemoteOnly) remote-only, $($hist.LocalOnly) local-only." -ForegroundColor DarkYellow
        Write-Host '  Schema may still be correct if MCP applied migrations with different version IDs.' -ForegroundColor DarkGray
        Write-Host '  Fix: .\scripts\deploy-supabase-cloud.ps1 -RepairHistory' -ForegroundColor DarkYellow
    }
}

if ($RepairHistory) {

    Write-Step 'Repairing migration history (remote vs local version IDs)...'

    Ensure-CliLinked

    & (Join-Path $PSScriptRoot 'repair-supabase-migration-history.ps1')

    Write-Ok 'Migration history aligned.'

} elseif ($FullCli) {

    Ensure-CliLinked



    Write-Step 'Push pending migrations...'

    $push = Invoke-SupabaseCli @('db', 'push')
    if ($push.ExitCode -ne 0) {

        Write-Host ''

        Write-Host 'db push failed — likely migration history mismatch.' -ForegroundColor DarkYellow

        Write-Host 'Run: .\scripts\deploy-supabase-cloud.ps1 -RepairHistory' -ForegroundColor DarkYellow

        Write-Host 'Or:  .\scripts\repair-supabase-migration-history.ps1' -ForegroundColor DarkYellow

        throw 'supabase db push failed'

    }

    Write-Ok 'supabase db push complete.'

} else {

    Write-Host ""

    Write-Host "Schema spot-check passed. For CLI migration sync use -FullCli or -RepairHistory." -ForegroundColor DarkGray

    Write-Host "  .\scripts\deploy-supabase-cloud.ps1 -FullCli" -ForegroundColor DarkGray

    Write-Host "  .\scripts\deploy-supabase-cloud.ps1 -RepairHistory" -ForegroundColor DarkGray

}



Write-Host ""

Write-Ok "Done. Next:"

Write-Host '  1. Copy API keys from Dashboard Settings API into .env and apps/api-server/.env'

Write-Host "     (use cloud URL https://$ProjectRef.supabase.co and cloud anon/service keys)"

Write-Host '  2. Configure Auth URLs - see docs/deploy/02-supabase-cloud.md'

Write-Host '  3. Smoke test on https://lanternstudy.com'


