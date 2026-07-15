# Start Lantern Study in Expo Go (no custom dev client required).
# Usage:
#   .\scripts\start-expo-go.ps1              # LAN - phone must be on same Wi-Fi
#   .\scripts\start-expo-go.ps1 -Tunnel       # Tunnel — works across networks (slower)
#   .\scripts\start-expo-go.ps1 -EmulatorOnly # Sets up adb reverse for Android emulator
#   .\scripts\start-expo-go.ps1 -Watch        # Opt into hot reload (unstable on this Windows workspace)

param(
  [switch]$Tunnel,
  [switch]$EmulatorOnly,
  [switch]$Clear,
  [switch]$Watch
)

$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
Set-Location $mobileRoot

# EAS commands can leave these values in a reused terminal session. If they
# leak into Expo Go, app.config resolves as a preview build or spends long
# enough resolving update metadata for Expo Go to time out.
Remove-Item Env:CI -ErrorAction SilentlyContinue
Remove-Item Env:EAS_BUILD_PROFILE -ErrorAction SilentlyContinue
Remove-Item Env:EAS_SKIP_AUTO_FINGERPRINT -ErrorAction SilentlyContinue
Remove-Item Env:EXPO_OFFLINE -ErrorAction SilentlyContinue
$env:APP_VARIANT = 'development'
if (-not $Watch) {
  # Metro's Windows watcher can time out in this large workspace before it
  # serves a manifest. Stable mode bundles on demand without watch mode.
  $env:CI = '1'
}

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

if ($EmulatorOnly) {
  $lanIp = '127.0.0.1'
} elseif (-not $lanIp -or $lanIp -eq '127.0.0.1') {
  # Fast fallback: prefer Wi-Fi 192.168/10.x from ipconfig (avoid slow Get-NetIPAddress)
  $ipconfigLines = ipconfig | Out-String
  $matches = [regex]::Matches($ipconfigLines, 'IPv4 Address[^:]*:\s*(192\.168\.[\d.]+|10\.[\d.]+)')
  if ($matches.Count -gt 0) {
    $lanIp = $matches[0].Groups[1].Value
  }
}

if ($lanIp) {
  $env:EXPO_PUBLIC_LAN_API_HOST = $lanIp
  if ($EmulatorOnly) {
    Write-Host 'Using adb reverse for the Android emulator.'
  } else {
    Write-Host "Using LAN host for API/Supabase on physical device: $lanIp"
    Write-Host "Ensure Windows Firewall allows inbound TCP 3001, 55421, and 8081."
  }
} else {
  Write-Host "Could not detect LAN IP - set EXPO_PUBLIC_LAN_API_HOST in .env for physical device."
}

# Optional adb reverse for Android emulator + Expo Go
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (Test-Path $adb) {
  function Invoke-AdbTimed([string[]]$AdbArgs) {
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $adb
    $startInfo.Arguments = $AdbArgs -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    [void]$process.Start()
    if (-not $process.WaitForExit(5000)) {
      $process.Kill()
      Write-Warning "adb $($AdbArgs -join ' ') timed out; continuing."
      return ''
    }
    return $process.StandardOutput.ReadToEnd()
  }

  $devices = Invoke-AdbTimed @('devices')
  if ($devices -match 'emulator-\d+\s+device') {
    foreach ($port in @(8081, 3001, 55421)) {
      Invoke-AdbTimed @('reverse', "tcp:${port}", "tcp:${port}") | Out-Null
    }
    Write-Host "adb reverse configured for emulator (8081, 3001, 55421)."
    Write-Host "On emulator: open Expo Go and scan the QR code, or enter exp://127.0.0.1:8081"
    Write-Host ""
  } elseif ($EmulatorOnly) {
    Write-Warning 'No responsive Android emulator detected; starting Metro anyway.'
  }
}

# Offline mode blocks Expo from signing the development manifest → Expo Go
# shows "Failed to download remote update" on physical devices.
# Skip Expo API dependency doctor when network to expo.dev is flaky.
$env:EXPO_NO_DEPENDENCY_VALIDATION = '1'
# Avoid pre-crawling every workspace in this large monorepo. metro.config.js
# explicitly watches the shared package used by mobile and resolves root modules.
$env:EXPO_NO_METRO_WORKSPACE_ROOT = '1'

# Tell Metro to use Expo Go stubs (no remote push, etc.)
$env:EXPO_PUBLIC_APP_RUNTIME = 'expo-go'

# Ensure Metro advertises the correct LAN IP (fixes stale/wrong QR URLs on physical devices)
if ($lanIp) {
  $env:REACT_NATIVE_PACKAGER_HOSTNAME = $lanIp
}

# Warn if Metro port is busy (skip slow Get-NetTCPConnection when possible)

$expoArgs = @('expo', 'start', '--port', '8081', '--go')
if ($Clear) {
  $expoArgs += '--clear'
}
if ($Tunnel) {
  # Tunnel needs network; --offline breaks ngrok and unsigned manifests.
  $expoArgs += '--tunnel'
  Write-Host "Starting Expo Go with tunnel (scan QR with Expo Go app on your phone)..."
} elseif ($EmulatorOnly) {
  $expoArgs += '--localhost'
  Write-Host 'Starting Expo Go for the Android emulator via adb reverse...'
} else {
  # Prefer online LAN so Expo can sign the development manifest (required by modern Expo Go).
  $expoArgs += '--lan'
  Write-Host "Starting Expo Go on LAN (scan QR with Expo Go - same Wi-Fi as this PC)..."
}

# Prefer production cloud endpoints so physical devices do not hit unreachable localhost Supabase.
if (-not $env:EXPO_PUBLIC_API_URL) {
  $env:EXPO_PUBLIC_API_URL = 'https://lantern-study-api.onrender.com'
}
if (-not $env:EXPO_PUBLIC_SUPABASE_URL) {
  $env:EXPO_PUBLIC_SUPABASE_URL = 'https://tiizkjhbrnaibaagmurl.supabase.co'
}
if (-not $env:EXPO_PUBLIC_SUPABASE_ANON_KEY -and (Test-Path $dotenvPath) -eq $false) {
  Write-Host "WARNING: EXPO_PUBLIC_SUPABASE_ANON_KEY not set. Add it to apps/mobile/.env for cloud auth."
}

Write-Host ""
Write-Host "Tip: If LAN fails, stop (Ctrl+C) and run: .\scripts\start-expo-go.ps1 -Tunnel"
Write-Host ""

$nodeMajor = [int](& node -p 'parseInt(process.versions.node)')
if ($nodeMajor -ne 20) {
  $monorepoRoot = Resolve-Path (Join-Path $mobileRoot '..\..')
  $expoCli = Join-Path $monorepoRoot 'node_modules\expo\bin\cli'
  $cliArgs = $expoArgs[1..($expoArgs.Count - 1)]
  Write-Host "Node $nodeMajor is outside the pinned Expo SDK 54 toolchain; using Node 20 LTS."
  & npx --yes node@20 $expoCli @cliArgs
} else {
  & npx @expoArgs
}
