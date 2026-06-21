# Start Lantern Study in Expo Go (no custom dev client required).
# Usage:
#   .\scripts\start-expo-go.ps1              # LAN - phone must be on same Wi-Fi
#   .\scripts\start-expo-go.ps1 -Tunnel       # Tunnel — works across networks (slower)
#   .\scripts\start-expo-go.ps1 -EmulatorOnly # Sets up adb reverse for Android emulator

param(
  [switch]$Tunnel,
  [switch]$EmulatorOnly
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location $mobileRoot

# Load apps/mobile/.env if present (Expo also reads this; script needs LAN host early)
$dotenvPath = Join-Path $mobileRoot '.env'
if (Test-Path $dotenvPath) {
  Get-Content $dotenvPath | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    $key = $parts[0].Trim()
    $val = $parts[1].Trim().Trim('"')
    if ($key -and $val) { Set-Item -Path "Env:$key" -Value $val }
  }
}

$lanIp = $env:EXPO_PUBLIC_LAN_API_HOST

if (-not $lanIp -or $lanIp -eq '127.0.0.1') {
  # Fast fallback: prefer Wi-Fi 192.168/10.x from ipconfig (avoid slow Get-NetIPAddress)
  $ipconfigLines = ipconfig | Out-String
  $matches = [regex]::Matches($ipconfigLines, 'IPv4 Address[^:]*:\s*(192\.168\.[\d.]+|10\.[\d.]+)')
  if ($matches.Count -gt 0) {
    $lanIp = $matches[0].Groups[1].Value
  }
}

if ($lanIp) {
  $env:EXPO_PUBLIC_LAN_API_HOST = $lanIp
  Write-Host "Using LAN host for API/Supabase on physical device: $lanIp"
  Write-Host "  API:     http://${lanIp}:3001"
  Write-Host "  Supabase: http://${lanIp}:55421"
  Write-Host ""
  Write-Host "Ensure Windows Firewall allows inbound TCP 3001, 55421, and 8081."
} else {
  Write-Host "Could not detect LAN IP - set EXPO_PUBLIC_LAN_API_HOST in .env for physical device."
}

# Optional adb reverse for Android emulator + Expo Go
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (Test-Path $adb) {
  $devices = & $adb devices 2>$null
  if ($devices -match 'emulator-\d+\s+device') {
    foreach ($port in @(8081, 3001, 55421)) {
      & $adb reverse "tcp:${port}" "tcp:${port}" | Out-Null
    }
    Write-Host "adb reverse configured for emulator (8081, 3001, 55421)."
    Write-Host "On emulator: open Expo Go and scan the QR code, or enter exp://127.0.0.1:8081"
    Write-Host ""
  } elseif ($EmulatorOnly) {
    throw 'No Android emulator detected.'
  }
}

Remove-Item Env:CI -ErrorAction SilentlyContinue

# Tell Metro to use Expo Go stubs (no remote push, etc.)
$env:EXPO_PUBLIC_APP_RUNTIME = 'expo-go'

# Ensure Metro advertises the correct LAN IP (fixes stale/wrong QR URLs on physical devices)
if ($lanIp) {
  $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
}

# Warn if Metro port is busy (skip slow Get-NetTCPConnection when possible)

$expoArgs = @('expo', 'start', '--port', '8081', '--go', '--offline')
if ($Tunnel) {
  $expoArgs += '--tunnel'
  Write-Host "Starting Expo Go with tunnel (scan QR with Expo Go app on your phone)..."
} else {
  Write-Host "Starting Expo Go on LAN (scan QR with Expo Go - same Wi-Fi as this PC)..."
}

Write-Host ""
Write-Host "Tip: If LAN fails, stop (Ctrl+C) and run: .\scripts\start-expo-go.ps1 -Tunnel"
Write-Host ""

& npx @expoArgs
