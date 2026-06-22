# Configure Supabase Auth URLs and rate limits (Management API).
# Requires SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens
#
# Usage (repo root):
#   $env:SUPABASE_ACCESS_TOKEN = 'sbp_...'
#   .\scripts\configure-supabase-auth-urls.ps1
# Optional:
#   .\scripts\configure-supabase-auth-urls.ps1 -PagesUrl 'https://lantern-study.pages.dev' -SignupConfirmationSeconds 10

param(
    [string]$PagesUrl,
    [string]$ProjectRef = 'tiizkjhbrnaibaagmurl',
    [int]$SignupConfirmationSeconds = 10,
    [int]$PasswordResetSeconds = 10,
    [int]$EmailSentPerHour = 0,
    [switch]$SkipUrls,
    [switch]$SkipRateLimits
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'deploy-constants.ps1')
if (-not $PagesUrl) { $PagesUrl = $script:ProductionWebUrl }
$ApiBase = 'https://api.supabase.com/v1'

function Write-Step([string]$Message) {
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
    Write-Host $Message -ForegroundColor Green
}

function Get-AccessToken {
    if ($env:SUPABASE_ACCESS_TOKEN) { return $env:SUPABASE_ACCESS_TOKEN.Trim() }
    throw @"
SUPABASE_ACCESS_TOKEN is missing.
1. Open https://supabase.com/dashboard/account/tokens
2. Create a token
3. Run: `$env:SUPABASE_ACCESS_TOKEN = 'sbp_...'; .\scripts\configure-supabase-auth-urls.ps1
"@
}

function Invoke-AuthConfigPatch([hashtable]$Body) {
    $token = Get-AccessToken
    $headers = @{
        Authorization = "Bearer $token"
        Accept        = 'application/json'
    }
    $json = $Body | ConvertTo-Json -Compress
    return Invoke-RestMethod -Method PATCH -Uri "$ApiBase/projects/$ProjectRef/config/auth" -Headers $headers -ContentType 'application/json' -Body $json
}

$redirectUrls = (Get-AuthRedirectUrlList -SiteUrl $PagesUrl) -join ','

if (-not $SkipUrls) {
    Write-Step "Updating Auth URL config for $ProjectRef ..."
    Write-Host "  Site URL: $PagesUrl"
    try {
        $resp = Invoke-AuthConfigPatch -Body @{
            site_url       = $PagesUrl
            uri_allow_list = $redirectUrls
        }
        Write-Ok 'Auth URL configuration updated.'
        if ($resp.site_url) {
            Write-Host "  Confirmed site_url: $($resp.site_url)"
        }
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "Failed to update auth URLs: $detail"
    }
}

if (-not $SkipRateLimits) {
    Write-Step 'Updating Auth rate limits (testing-friendly defaults)...'
    Write-Host "  Signup confirmation cooldown: ${SignupConfirmationSeconds}s"
    Write-Host "  Password reset cooldown: ${PasswordResetSeconds}s"
    $rateBody = @{
        rate_limit_signup_confirmation = $SignupConfirmationSeconds
        rate_limit_password_reset      = $PasswordResetSeconds
    }
    if ($EmailSentPerHour -gt 0) {
        Write-Host "  Emails sent per hour: $EmailSentPerHour (requires custom SMTP)"
        $rateBody['rate_limit_email_sent'] = $EmailSentPerHour
    }
    try {
        Invoke-AuthConfigPatch -Body $rateBody | Out-Null
        Write-Ok 'Auth rate limits updated.'
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        Write-Host "Rate limit update failed: $detail" -ForegroundColor DarkYellow
        Write-Host 'Set limits manually: https://supabase.com/dashboard/project/' + $ProjectRef + '/auth/rate-limits'
    }
}

Write-Host ''
Write-Ok 'Done.'
Write-Host "  URL config: https://supabase.com/dashboard/project/$ProjectRef/auth/url-configuration"
Write-Host "  Rate limits: https://supabase.com/dashboard/project/$ProjectRef/auth/rate-limits"
Write-Host '  Custom SMTP (raises email quota): https://supabase.com/dashboard/project/' + $ProjectRef + '/auth/smtp'
