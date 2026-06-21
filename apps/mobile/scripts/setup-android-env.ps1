# Persist Android toolchain env vars for Expo native builds (Windows user scope).
$ErrorActionPreference = 'Stop'

$javaHome = 'C:\Program Files\Android\Android Studio1\jbr'
$androidHome = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
$platformTools = Join-Path $androidHome 'platform-tools'

if (-not (Test-Path (Join-Path $javaHome 'bin\java.exe'))) {
  throw "JDK not found at $javaHome. Install Android Studio or update JAVA_HOME in this script."
}
if (-not (Test-Path $androidHome)) {
  throw "Android SDK not found at $androidHome."
}

[Environment]::SetEnvironmentVariable('JAVA_HOME', $javaHome, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_HOME', $androidHome, 'User')
[Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', $androidHome, 'User')

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$pathEntries = @($platformTools, (Join-Path $androidHome 'emulator')) | Where-Object { Test-Path $_ }
foreach ($entry in $pathEntries) {
  if ($userPath -notlike "*$entry*") {
    $userPath = if ($userPath) { "$userPath;$entry" } else { $entry }
  }
}
[Environment]::SetEnvironmentVariable('Path', $userPath, 'User')

# Apply to current session
$env:JAVA_HOME = $javaHome
$env:ANDROID_HOME = $androidHome
$env:ANDROID_SDK_ROOT = $androidHome
foreach ($entry in $pathEntries) {
  if ($env:Path -notlike "*$entry*") {
    $env:Path = "$entry;$env:Path"
  }
}

Write-Host "JAVA_HOME=$env:JAVA_HOME"
Write-Host "ANDROID_HOME=$env:ANDROID_HOME"
Write-Host "adb: $(Get-Command adb -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
Write-Host "java: $(Get-Command java -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)"
