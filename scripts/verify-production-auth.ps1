# Verify cloud Supabase auth (public signup + password login).
# Same API path as https://lanternstudy.com
#
# Usage (repo root):
#   .\scripts\verify-production-auth.ps1
# With a specific email/password (after you sign up on production):
#   .\scripts\verify-production-auth.ps1 -Email 'you@example.com' -Password 'your-password'

param(
    [string]$Email,
    [string]$Password
)

$ErrorActionPreference = 'Stop'

$ProjectRef = 'tiizkjhbrnaibaagmurl'
$SupabaseUrl = "https://$ProjectRef.supabase.co"
$AnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRpaXpramhicm5haWJhYWdtdXJsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjMyMjMsImV4cCI6MjA5NjQzOTIyM30.dzI3L5Blbao5DItW3xgMIUzAi9LBijZncFaNBLTMvoE'

function Write-Step([string]$Message) {
    Write-Host $Message -ForegroundColor Yellow
}

function Write-Ok([string]$Message) {
    Write-Host $Message -ForegroundColor Green
}

function Invoke-AuthJson {
    param([string]$Method, [string]$Path, [object]$Body = $null)
    $headers = @{
        apikey        = $AnonKey
        Authorization = "Bearer $AnonKey"
        Accept        = 'application/json'
    }
    $uri = "$SupabaseUrl/auth/v1$Path"
    if ($null -ne $Body) {
        $json = $Body | ConvertTo-Json -Compress
        return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -ContentType 'application/json' -Body $json
    }
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

Write-Host 'Lantern Study - production auth smoke test' -ForegroundColor Cyan

if (-not $Email -or -not $Password) {
    Write-Step 'No -Email/-Password supplied; running public signup smoke test...'
    $Email = "prod-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com"
    $Password = 'LanternSmokeTest123!'
    try {
        $signup = Invoke-AuthJson -Method POST -Path '/signup' -Body @{ email = $Email; password = $Password }
        if ($signup.user) {
            Write-Ok "Public signup succeeded for $Email"
            Write-Host '  Email confirmation is enabled on cloud — login may fail until you verify email.'
            Write-Host '  Sign up on https://lanternstudy.com and complete OTP verification.'
        }
    } catch {
        throw "Public signup failed: $($_.ErrorDetails.Message)"
    }
    exit 0
}

Write-Step "Testing password login for $Email ..."
try {
    $session = Invoke-AuthJson -Method POST -Path '/token?grant_type=password' -Body @{
        email    = $Email
        password = $Password
    }
    if (-not $session.access_token) {
        throw 'No access_token returned.'
    }
    Write-Ok 'Password login succeeded (no 400 invalid_credentials).'
} catch {
    $detail = $_.ErrorDetails.Message
    if ($detail -match 'invalid_credentials|Invalid login credentials') {
        Write-Host ''
        Write-Host 'Login failed: Invalid login credentials' -ForegroundColor Red
        Write-Host '  - Local Supabase accounts do NOT exist on cloud.'
        Write-Host '  - Sign up at https://lanternstudy.com (not Log in).'
        Write-Host '  - If you already signed up, verify your email (OTP) before logging in.'
    }
    throw "Password login failed: $detail"
}
