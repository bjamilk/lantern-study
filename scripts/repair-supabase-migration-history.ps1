# Reconcile Supabase Cloud migration history with local supabase/migrations/*.sql
# Use when db push fails with "Remote migration versions not found" or history mismatch
# (common after MCP-applied migrations with different version timestamps).
#
# Prerequisites: linked project (npx supabase link) or SUPABASE_ACCESS_TOKEN in .env.resend
#
# Usage (repo root):
#   .\scripts\repair-supabase-migration-history.ps1
#   .\scripts\repair-supabase-migration-history.ps1 -DryRun

param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path $PSScriptRoot -Parent
$BatchSize = 15

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

function Ensure-CliEnv {
    if (-not $env:SUPABASE_ACCESS_TOKEN) {
        $resendEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.resend')
        if ($resendEnv['SUPABASE_ACCESS_TOKEN']) {
            $env:SUPABASE_ACCESS_TOKEN = $resendEnv['SUPABASE_ACCESS_TOKEN']
        }
    }
    if (-not $env:SUPABASE_DB_PASSWORD) {
        foreach ($path in @('.env.resend', '.env')) {
            $dotenv = Read-DotEnvFile (Join-Path $RepoRoot $path)
            if ($dotenv['SUPABASE_DB_PASSWORD']) {
                $env:SUPABASE_DB_PASSWORD = $dotenv['SUPABASE_DB_PASSWORD']
                break
            }
        }
    }
    if (-not $env:SUPABASE_ACCESS_TOKEN) {
        throw 'SUPABASE_ACCESS_TOKEN missing. Set in .env.resend or environment.'
    }
}

function Get-LocalMigrationVersions {
    $migrationsDir = Join-Path $RepoRoot 'supabase/migrations'
    return Get-ChildItem -Path (Join-Path $migrationsDir '*.sql') | ForEach-Object {
        if ($_.BaseName -match '^(\d{14})_') { $Matches[1] }
    } | Where-Object { $_ } | Sort-Object -Unique
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

function Get-MigrationListRows {
    $result = Invoke-SupabaseCli @('migration', 'list', '--linked')
    if ($result.ExitCode -ne 0) { throw "migration list failed: $($result.Output)" }
    $raw = $result.Output
    $rows = @()

    # Newer CLI emits JSON: {"migrations":[{"local":"...","remote":"..."}, ...]}
    $jsonStart = $raw.IndexOf('{')
    if ($jsonStart -ge 0) {
        try {
            $parsed = $raw.Substring($jsonStart) | ConvertFrom-Json
            foreach ($m in @($parsed.migrations)) {
                $local = if ($m.local) { [string]$m.local } else { '' }
                $remote = if ($m.remote) { [string]$m.remote } else { '' }
                if ($local -or $remote) {
                    $rows += [PSCustomObject]@{ Local = $local; Remote = $remote }
                }
            }
            if ($rows.Count -gt 0) { return $rows }
        } catch {
            Write-Host "  JSON migration list parse failed; falling back to table parse." -ForegroundColor DarkYellow
        }
    }

    # Legacy ASCII table: local | remote |
    foreach ($line in ($raw -split "`n")) {
        if ($line -notmatch '^\s+(\d{8,14})?\s+\|\s+(\d{8,14})?\s+\|') { continue }
        $local = if ($Matches[1]) { $Matches[1].Trim() } else { '' }
        $remote = if ($Matches[2]) { $Matches[2].Trim() } else { '' }
        if ($local -or $remote) {
            $rows += [PSCustomObject]@{ Local = $local; Remote = $remote }
        }
    }
    return $rows
}

function Invoke-RepairBatch([string]$Status, [string[]]$Versions) {
    if ($Versions.Count -eq 0) { return }
    for ($i = 0; $i -lt $Versions.Count; $i += $BatchSize) {
        $end = [Math]::Min($i + $BatchSize - 1, $Versions.Count - 1)
        $batch = @($Versions[$i..$end])
        Write-Host "  repair --status $Status ($($batch.Count)): $($batch -join ', ')"
        if (-not $DryRun) {
            $cliArgs = @('migration', 'repair', '--status', $Status) + $batch
            $repair = Invoke-SupabaseCli $cliArgs
            if ($repair.ExitCode -ne 0) {
                throw "migration repair failed for status=$Status`n$($repair.Output)"
            }
        }
    }
}

Push-Location $RepoRoot
try {
    Ensure-CliEnv
    Write-Host 'Lantern Study — repair Supabase migration history' -ForegroundColor Cyan
    if ($DryRun) { Write-Host 'DRY RUN — no changes will be applied.' -ForegroundColor DarkYellow }

    $localVersions = Get-LocalMigrationVersions
    Write-Host "Local migration files (14-digit versions): $($localVersions.Count)"

    $rows = Get-MigrationListRows
    $remoteOnly = $rows | Where-Object { $_.Remote -and -not $_.Local } | ForEach-Object { $_.Remote } | Sort-Object -Unique
    $localOnly = $rows | Where-Object { $_.Local -and -not $_.Remote } | ForEach-Object { $_.Local } | Sort-Object -Unique

    Write-Host "Remote-only versions to revert: $($remoteOnly.Count)"
    Write-Host "Local-only versions to mark applied: $($localOnly.Count)"

    if ($remoteOnly.Count -gt 0) {
        Write-Host 'Reverting remote-only versions...' -ForegroundColor Yellow
        Invoke-RepairBatch -Status 'reverted' -Versions $remoteOnly
    }

    $toApply = @($localOnly | Where-Object { $_ -in $localVersions })
    if ($toApply.Count -gt 0) {
        Write-Host 'Marking local versions as applied on remote...' -ForegroundColor Yellow
        Invoke-RepairBatch -Status 'applied' -Versions $toApply
    }

    if (-not $DryRun) {
        Write-Host 'Running db push...' -ForegroundColor Yellow
        $push = Invoke-SupabaseCli @('db', 'push')
        if ($push.ExitCode -ne 0) { throw "db push failed after repair: $($push.Output)" }
    }

    Write-Host 'Migration history repair complete.' -ForegroundColor Green
} finally {
    Pop-Location
}
