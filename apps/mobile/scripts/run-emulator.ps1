$ErrorActionPreference = 'Stop'

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  throw 'adb.exe not found under Android SDK platform-tools.'
}

Write-Host 'Checking emulator connection...'
$devices = & $adb devices
$hasEmulator = $devices -match 'emulator-\d+\s+device'
if (-not $hasEmulator) {
  throw 'No running Android emulator detected.'
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $scriptDir 'setup-emulator-network.ps1')

Write-Host 'Starting Expo Go dev server (offline, localhost)...'
Set-Location (Join-Path $scriptDir '..')
Remove-Item Env:CI -ErrorAction SilentlyContinue
npx expo start --offline --android