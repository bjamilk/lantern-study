# Mobile ↔ Web persistence smoke test (API layer)
# Creates data via the shared API and verifies it can be read back (same DB web uses).

$ErrorActionPreference = 'Stop'

$ApiBaseUrl = if ($env:API_BASE_URL) { $env:API_BASE_URL } else { 'http://127.0.0.1:3001' }
$SupabaseUrl = if ($env:SUPABASE_URL) { $env:SUPABASE_URL } else { 'http://127.0.0.1:55421' }
$SupabaseAnonKey = $env:SUPABASE_ANON_KEY
$SupabaseServiceRoleKey = $env:SUPABASE_SERVICE_ROLE_KEY
if (-not $SupabaseAnonKey -or -not $SupabaseServiceRoleKey) {
    throw 'Set SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY (local Supabase defaults are in apps/api-server/.env).'
}
$Password = 'Password123!'

function Test-Ok($status) { $status -eq 200 -or $status -eq 201 }

function Invoke-JsonApi($Method, $Url, $Headers, $BodyObj) {
  try {
    if ($null -ne $BodyObj) {
      $json = $BodyObj | ConvertTo-Json -Depth 12
      return @{ status = 200; body = (Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers -ContentType 'application/json' -Body $json) }
    }
    return @{ status = 200; body = (Invoke-RestMethod -Method $Method -Uri $Url -Headers $Headers) }
  } catch {
    $status = 0
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    $text = $_.ErrorDetails.Message
    return @{ status = $status; body = $text }
  }
}

$health = Invoke-JsonApi 'GET' "$ApiBaseUrl/health" @{} $null
if (-not (Test-Ok $health.status)) { throw "API unhealthy ($($health.status))" }
Write-Host "OK health"

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$email = "mobile.smoke.$ts@example.com"
$authAdminHeaders = @{ Authorization = "Bearer $SupabaseServiceRoleKey"; apikey = $SupabaseServiceRoleKey }

$createUser = Invoke-JsonApi 'POST' "$SupabaseUrl/auth/v1/admin/users" $authAdminHeaders @{
  email = $email; password = $Password; email_confirm = $true; user_metadata = @{ name = 'Mobile Smoke User' }
}
if ($createUser.status -ne 200) { throw "Create user failed: $($createUser.status) $($createUser.body)" }
$userId = $createUser.body.id

$login = Invoke-JsonApi 'POST' "$SupabaseUrl/auth/v1/token?grant_type=password" @{ apikey = $SupabaseAnonKey } @{
  email = $email; password = $Password
}
if ($login.status -ne 200) { throw "Login failed" }
$token = $login.body.access_token
$headers = @{ Authorization = "Bearer $token" }

$profile = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/users" $headers @{
  id = $userId; name = 'Mobile Smoke User'
}
$results = @{}
$results['profile_create'] = if ($profile.status -eq 200 -or $profile.status -eq 409) { 200 } else { $profile.status }

# Deck + flashcard
$deck = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/decks" $headers @{
  name = "Smoke Deck $ts"; description = 'mobile-web sync'
}
$results['deck_create'] = $deck.status
$deckId = $deck.body.data.id

$decks = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/decks" $headers $null
$results['deck_read'] = if ($decks.body.data | Where-Object { $_.id -eq $deckId }) { 200 } else { 404 }

$card = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/flashcards" $headers @{
  deckId = $deckId; type = 'BASIC'; front = 'Smoke Q'; back = 'Smoke A'
}
$results['flashcard_create'] = $card.status

$inviteId = [guid]::NewGuid().ToString('N')

# Group + message
$group = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/groups" $headers @{
  name = "Smoke Group $ts"; invite_id = $inviteId
}
$results['group_create'] = $group.status
$groupId = $group.body.data.id

$msg = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/messages/group/$groupId" $headers @{
  content = "Smoke message $ts"
}
$results['message_create'] = $msg.status

$msgs = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/messages/group/$groupId" $headers $null
$results['message_read'] = $msgs.status

# Test result
$testResult = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/tests" $headers @{
  config = @{ testName = "Smoke Test $ts" }
  questions = @()
  user_answers = @{}
  start_time = (Get-Date).ToString('o')
  end_time = (Get-Date).ToString('o')
  score = 85
}
$results['test_result_create'] = $testResult.status

$testResults = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/tests" $headers $null
$results['test_result_read'] = $testResults.status

# Note
$note = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/notes" $headers @{
  title = "Smoke Note $ts"; content = 'mobile-web persistence'
}
$results['note_create'] = $note.status
$noteId = $note.body.data.id

$notes = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/notes" $headers $null
$results['note_read'] = if ($notes.body.data | Where-Object { $_.id -eq $noteId }) { 200 } else { 404 }

# Budget transaction (Supabase direct — same path mobile + web use)
$txId = [guid]::NewGuid().ToString()
$tx = Invoke-JsonApi 'POST' "$SupabaseUrl/rest/v1/budget_transactions" @{
  Authorization = "Bearer $token"; apikey = $SupabaseAnonKey; Prefer = 'return=minimal'
} @{
  id = $txId; user_id = $userId; type = 'expense'; amount = 42; category = 'Food & Drink'; description = 'Smoke tx'; date = (Get-Date).ToString('yyyy-MM-dd')
}
$results['transaction_create'] = $tx.status

$txReadUrl = "$SupabaseUrl/rest/v1/budget_transactions?id=eq.$txId&select=id"
$txs = Invoke-JsonApi 'GET' $txReadUrl @{ Authorization = "Bearer $token"; apikey = $SupabaseAnonKey } $null
$results['transaction_read'] = if ($txs.body -and $txs.body.Count -gt 0) { 200 } else { 404 }

# Budget extras via preferences
$prefs = Invoke-JsonApi 'POST' "$ApiBaseUrl/api/v1/preferences" $headers @{
  userId = $userId; theme = 'light'; preferences = @{
    budgetExtras = @{
      savingsGoals = @(@{ id = "goal-$ts"; userId = $userId; name = 'Smoke Goal'; targetAmount = 1000; currentAmount = 100; createdAt = (Get-Date).ToString('o') })
      expenseSplits = @()
      walletBalance = 50
    }
  }
}
$results['budget_extras_save'] = $prefs.status

$prefsRead = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/preferences/$userId" $headers $null
$wallet = $prefsRead.body.data.preferences.budgetExtras.walletBalance
$results['budget_extras_read'] = if ($wallet -eq 50) { 200 } else { 404 }

# Settings — category patch, GET read-back, CAS conflict
$settings = Invoke-JsonApi 'PUT' "$ApiBaseUrl/api/v1/users/$userId/settings" $headers @{
  settings = @{
    appearance = @{ theme = 'dark'; lowDataMode = $true }
    study = @{ srsNewCardsPerDay = 25; dailyCardGoal = 40 }
    notifications = @{ pushEnabled = $true; reminderTime = '07:30' }
  }
}
$results['settings_save'] = $settings.status
$settingsVersion = $settings.body.data.settingsVersion

$settingsGet = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/users/$userId/settings" $headers $null
$gotTheme = $settingsGet.body.data.settings.appearance.theme
$gotCards = $settingsGet.body.data.settings.study.srsNewCardsPerDay
$gotGoal = $settingsGet.body.data.settings.study.dailyCardGoal
$gotReminder = $settingsGet.body.data.settings.notifications.reminderTime
$results['settings_read'] = if (
  $settingsGet.status -eq 200 -and
  $gotTheme -eq 'dark' -and
  $gotCards -eq 25 -and
  $gotGoal -eq 40 -and
  $gotReminder -eq '07:30'
) { 200 } else { 404 }

# Stale version must 409; fresh version succeeds with another category patch
$stale = Invoke-JsonApi 'PUT' "$ApiBaseUrl/api/v1/users/$userId/settings" $headers @{
  settings = @{ study = @{ srsNewCardsPerDay = 30 } }
  expectedSettingsVersion = 0
}
$results['settings_cas_conflict'] = if ($stale.status -eq 409) { 200 } else { $stale.status }

$fresh = Invoke-JsonApi 'PUT' "$ApiBaseUrl/api/v1/users/$userId/settings" $headers @{
  settings = @{ study = @{ srsNewCardsPerDay = 30 } }
  expectedSettingsVersion = $settingsVersion
}
$results['settings_cas_success'] = $fresh.status
$freshCards = $fresh.body.data.settings.study.srsNewCardsPerDay
$freshTheme = $fresh.body.data.settings.appearance.theme
$results['settings_patch_preserves'] = if ($freshCards -eq 30 -and $freshTheme -eq 'dark') { 200 } else { 404 }

# Test presets must not wipe settings (dedicated column) and must round-trip on GET
$presetId = "preset-$ts"
$presetSave = Invoke-JsonApi 'PUT' "$ApiBaseUrl/api/v1/users/$userId" $headers @{
  test_presets = @(@{ id = $presetId; name = 'Smoke'; config = @{ mode = 'study' } })
}
$results['test_presets_save'] = $presetSave.status
$afterPreset = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/users/$userId/settings" $headers $null
$results['test_presets_preserve_settings'] = if (
  $afterPreset.body.data.settings.appearance.theme -eq 'dark' -and
  $afterPreset.body.data.settings.study.srsNewCardsPerDay -eq 30
) { 200 } else { 404 }
$profileAfterPreset = Invoke-JsonApi 'GET' "$ApiBaseUrl/api/v1/users/$userId" $headers $null
$profileData = $profileAfterPreset.body.data
$loadedPresets = if ($null -ne $profileData.testPresets) {
  @($profileData.testPresets)
} elseif ($null -ne $profileData.test_presets) {
  @($profileData.test_presets)
} else {
  @()
}
$results['test_presets_roundtrip'] = if (
  ($loadedPresets | Where-Object { $_.id -eq $presetId -and $_.name -eq 'Smoke' }).Count -gt 0
) { 200 } else { 404 }

Write-Host "`n=== Mobile-Web Persistence Smoke Results ==="
$failed = @()
foreach ($k in $results.Keys) {
  $ok = Test-Ok $results[$k]
  Write-Host ("{0,-22} {1}" -f $k, $(if ($ok) { 'PASS' } else { "FAIL ($($results[$k]))" }))
  if (-not $ok) { $failed += $k }
}

# Cleanup test user
Invoke-JsonApi 'DELETE' "$SupabaseUrl/auth/v1/admin/users/$userId" $authAdminHeaders $null | Out-Null

if ($failed.Count -gt 0) {
  throw "Smoke test failed: $($failed -join ', ')"
}

Write-Host "`nAll persistence checks passed."
