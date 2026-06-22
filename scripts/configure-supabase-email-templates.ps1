# Configure Supabase Auth email templates (OTP signup + password reset) via Management API.
# Requires SUPABASE_ACCESS_TOKEN in .env.resend or environment.
#
# Usage (repo root):
#   .\scripts\configure-supabase-email-templates.ps1

param(
    [string]$ProjectRef = 'tiizkjhbrnaibaagmurl'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')

$RepoRoot = Split-Path $PSScriptRoot -Parent
$ApiBase = 'https://api.supabase.com/v1'

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

$resendEnv = Read-DotEnvFile (Join-Path $RepoRoot '.env.resend')

function Get-AccessToken {
    if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN.Trim() }
    if ($resendEnv['SUPABASE_ACCESS_TOKEN']) { return $resendEnv['SUPABASE_ACCESS_TOKEN'].Trim() }
    throw 'SUPABASE_ACCESS_TOKEN missing (see .env.resend or dashboard/account/tokens).'
}

$confirmationContent = @'
<h2>Confirm your Lantern Study signup</h2>
<p>Your verification code: <strong>{{ .Token }}</strong></p>
<p>Or confirm by clicking this link:</p>
<p><a href="{{ .ConfirmationURL }}">Confirm your email</a></p>
<p>If you did not sign up, you can ignore this email.</p>
'@.Trim()

$recoveryContent = @'
<h2>Reset your Lantern Study password</h2>
<p>Follow this link to choose a new password:</p>
<p><a href="{{ .ConfirmationURL }}">Reset password</a></p>
<p>If you did not request a reset, you can ignore this email.</p>
<p>This link expires soon for your security.</p>
'@.Trim()

$token = Get-AccessToken
$headers = @{
    Authorization = "Bearer $token"
    Accept        = 'application/json'
}

$body = @{
    mailer_subjects_confirmation           = 'Confirm your Lantern Study signup'
    mailer_templates_confirmation_content  = $confirmationContent
    mailer_subjects_recovery               = 'Reset your Lantern Study password'
    mailer_templates_recovery_content      = $recoveryContent
} | ConvertTo-Json -Compress

Write-Host 'Updating Supabase Auth email templates...' -ForegroundColor Yellow
Invoke-RestMethod -Method PATCH -Uri "$ApiBase/projects/$ProjectRef/config/auth" -Headers $headers -ContentType 'application/json' -Body $body | Out-Null
Write-Host 'Email templates updated (signup OTP + password reset).' -ForegroundColor Green
Write-Host "  Dashboard: https://supabase.com/dashboard/project/$ProjectRef/auth/templates"
