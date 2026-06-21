# Build and run Lantern Study dev client on Android emulator (Windows).
# Uses subst X: to avoid Windows 260-char path limit during Gradle/CMake builds.
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$mobileDir = Join-Path $repoRoot 'apps\mobile'
$substDrive = 'X:'

function Ensure-Subst {
  $existing = subst 2>$null | Select-String "^$substDrive"
  if (-not $existing) {
    Write-Host "Mapping $substDrive => $repoRoot"
    subst $substDrive $repoRoot
  }
}

& (Join-Path $PSScriptRoot 'setup-android-env.ps1')

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) { throw 'adb not found. Install Android SDK platform-tools.' }

$devices = & $adb devices 2>$null
if ($devices -notmatch 'emulator-\d+\s+device') {
  Write-Host 'Starting Pixel_7 emulator...'
  $emulator = Join-Path $env:LOCALAPPDATA 'Android\Sdk\emulator\emulator.exe'
  Start-Process -FilePath $emulator -ArgumentList '-avd', 'Pixel_7' -WindowStyle Minimized
  $deadline = (Get-Date).AddMinutes(3)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $devices = & $adb devices 2>$null
    if ($devices -match 'emulator-\d+\s+device') { break }
  }
  if ($devices -notmatch 'emulator-\d+\s+device') { throw 'Emulator did not boot in time.' }
}

Ensure-Subst
$buildDir = Join-Path $substDrive 'apps\mobile'
Write-Host "Building from $buildDir (short path)..."
Set-Location $buildDir
npx expo run:android --no-bundler

Write-Host 'Setting up port forwarding for emulator...'
& $adb reverse tcp:8081 tcp:8081
& $adb reverse tcp:3001 tcp:3001
& $adb reverse tcp:55421 tcp:55421

Write-Host ''
Write-Host 'Build complete. Start the dev server from the repo path (not X:):'
Write-Host "  cd `"$mobileDir`""
Write-Host '  npx expo start --dev-client'
Write-Host ''
Write-Host 'Then open Lantern Study Dev on the emulator (or it may auto-connect).'
