# Configure Supabase Auth to send email via Resend SMTP (Management API).
# Reads secrets from .env.resend (gitignored) or environment.
#
# Prerequisites:
#   1. Resend API key: https://resend.com/api-keys
#   2. Verified domain in Resend (or use onboarding@resend.dev for limited testing)
#   3. Supabase access token: https://supabase.com/dashboard/account/tokens
#
# Usage (repo root):
#   Copy .env.resend.example → .env.resend and fill values, then:
#   .\scripts\configure-supabase-resend-smtp.ps1
#
# Or:
#   $env:RESEND_API_KEY = 're_...'
#   $env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
#   $env:RESEND_FROM_EMAIL = 'noreply@yourdomain.com'
#   .\scripts\configure-supabase-resend-smtp.ps1

param(
    [string]$ProjectRef = 'tiizkjhbrnaibaagmurl',
    [string]$PagesUrl,
    [string]$FromEmail,
    [string]$SenderName = 'Lantern Study',
    [int]$SmtpPort = 465,
    [int]$EmailSentPerHour = 100,
    [int]$SignupConfirmationSeconds = 10,
    [switch]$SkipUrls,
    [switch]$SkipRateLimits
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')
if (-not $PagesUrl) { $PagesUrl = $script:ProductionWebUrl }
$RepoRoot = Split-Path $PSScriptRoot -Parent
$ApiBase = 'https://api.supabase.com/v1'

function Write-Step([string]$Message) { Write-Host $Message -ForegroundColor Yellow }
function Write-Ok([string]$Message) { Write-Host $Message -ForegroundColor Green }

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

function Get-ResendApiKey {
    if ($env:RESEND_API_KEY) { return $env:RESEND_API_KEY.Trim() }
    if ($resendEnv['RESEND_API_KEY']) { return $resendEnv['RESEND_API_KEY'].Trim() }
    throw 'RESEND_API_KEY missing. Set in .env.resend or `$env:RESEND_API_KEY`.'
}

function Get-SupabaseAccessToken {
    if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN.Trim() }
    if ($resendEnv['SUPABASE_ACCESS_TOKEN']) { return $resendEnv['SUPABASE_ACCESS_TOKEN'].Trim() }

    $legacyTokenPath = Join-Path $env:USERPROFILE '.supabase\access-token'
    if (Test-Path $legacyTokenPath) {
        $legacy = (Get-Content $legacyTokenPath -Raw).Trim()
        if ($legacy) { return $legacy }
    }

    throw @"
SUPABASE_ACCESS_TOKEN missing.
1. Open https://supabase.com/dashboard/account/tokens
2. Create a token (sbp_...) and add to .env.resend, or run:
   `$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'; .\scripts\configure-supabase-resend-smtp.ps1
3. Or: npx supabase login   (then re-run this script; uses CLI-stored token if available)
"@
}

function Get-FromEmail {
    if ($FromEmail) { return $FromEmail.Trim() }
    if ($env:RESEND_FROM_EMAIL) { return $env:RESEND_FROM_EMAIL.Trim() }
    if ($resendEnv['RESEND_FROM_EMAIL']) { return $resendEnv['RESEND_FROM_EMAIL'].Trim() }
    throw 'RESEND_FROM_EMAIL missing. Use a domain verified in Resend (see .env.resend.example).'
}

function Get-SenderName {
    if ($env:RESEND_SENDER_NAME) { return $env:RESEND_SENDER_NAME.Trim() }
    if ($resendEnv['RESEND_SENDER_NAME']) { return $resendEnv['RESEND_SENDER_NAME'].Trim() }
    return $SenderName
}

function Invoke-AuthConfigPatch([string]$Token, [hashtable]$Body) {
    $headers = @{
        Authorization = "Bearer $Token"
        Accept        = 'application/json'
    }
    $json = $Body | ConvertTo-Json -Compress
    return Invoke-RestMethod -Method PATCH -Uri "$ApiBase/projects/$ProjectRef/config/auth" -Headers $headers -ContentType 'application/json' -Body $json
}

Write-Host 'Lantern Study — configure Supabase Auth + Resend SMTP' -ForegroundColor Cyan

$resendKey = Get-ResendApiKey
$accessToken = Get-SupabaseAccessToken
$from = Get-FromEmail
$sender = Get-SenderName

Write-Step 'Configuring Resend SMTP on Supabase Auth...'
Write-Host "  Host: smtp.resend.com:$SmtpPort"
Write-Host "  From: $from ($sender)"

$smtpBody = @{
    external_email_enabled             = $true
    mailer_secure_email_change_enabled = $true
    mailer_autoconfirm                 = $false
    smtp_admin_email                   = $from
    smtp_sender_name                   = $sender
    smtp_host                          = 'smtp.resend.com'
    smtp_port                          = [string]$SmtpPort
    smtp_user                          = 'resend'
    smtp_pass                          = $resendKey
}

try {
    $resp = Invoke-AuthConfigPatch -Token $accessToken -Body $smtpBody
    Write-Ok 'Resend SMTP configured on Supabase.'
    if ($resp.smtp_host) { Write-Host "  smtp_host: $($resp.smtp_host)" }
} catch {
    $detail = $_.ErrorDetails.Message
    if (-not $detail) { $detail = $_.Exception.Message }
    throw "SMTP configuration failed: $detail"
}

if (-not $SkipUrls) {
    $redirectUrls = (Get-AuthRedirectUrlList -SiteUrl $PagesUrl) -join ','
    Write-Step 'Updating Auth URL configuration...'
    try {
        Invoke-AuthConfigPatch -Token $accessToken -Body @{
            site_url       = $PagesUrl
            uri_allow_list = $redirectUrls
        } | Out-Null
        Write-Ok "Site URL set to $PagesUrl"
    } catch {
        Write-Host "URL update failed: $($_.ErrorDetails.Message)" -ForegroundColor DarkYellow
    }
}

if (-not $SkipRateLimits) {
    Write-Step 'Raising Auth email rate limits (custom SMTP)...'
    $rateBody = @{
        rate_limit_email_sent          = $EmailSentPerHour
        rate_limit_signup_confirmation = $SignupConfirmationSeconds
        rate_limit_password_reset      = 10
    }
    try {
        Invoke-AuthConfigPatch -Token $accessToken -Body $rateBody | Out-Null
        Write-Ok "Email rate limit: $EmailSentPerHour/hour; signup cooldown: ${SignupConfirmationSeconds}s"
    } catch {
        Write-Host "Rate limit update failed: $($_.ErrorDetails.Message)" -ForegroundColor DarkYellow
    }
}

Write-Host ''
Write-Ok 'Resend + Supabase Auth configuration complete.'
Write-Host '  Verify: https://supabase.com/dashboard/project/' + $ProjectRef + '/auth/smtp'
Write-Host '  Rate limits: https://supabase.com/dashboard/project/' + $ProjectRef + '/auth/rate-limits'
Write-Step 'Updating email templates (OTP + password reset)...'
try {
    & (Join-Path $PSScriptRoot 'configure-supabase-email-templates.ps1') -ProjectRef $ProjectRef
} catch {
    Write-Host "Email template update failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
}
if ($from -eq 'onboarding@resend.dev') {
    Write-Host ''
    Write-Host 'Note: onboarding@resend.dev is for testing only.' -ForegroundColor DarkYellow
    Write-Host 'Verify your domain in Resend, set RESEND_FROM_EMAIL=noreply@yourdomain.com, and re-run this script.'
}
