$ErrorActionPreference = 'Stop'

$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path $adb)) {
  throw 'adb.exe not found under Android SDK platform-tools.'
}

$devices = & $adb devices
if (-not ($devices -match 'emulator-\d+\s+device')) {
  throw 'No running Android emulator detected.'
}

$ports = @(8081, 3001, 55421)
foreach ($port in $ports) {
  & $adb reverse "tcp:${port}" "tcp:${port}" | Out-Null
  Write-Host "adb reverse tcp:${port} tcp:${port}"
}

Write-Host 'Emulator network ready (127.0.0.1 -> host for Metro, API, Supabase).'
