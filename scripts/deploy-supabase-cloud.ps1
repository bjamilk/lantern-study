# Link this repo to Supabase Cloud and push migrations.
# Run from repo root in PowerShell (requires interactive terminal for login).

$ErrorActionPreference = "Stop"
$ProjectRef = "tiizkjhbrnaibaagmurl"

Write-Host "Lantern Study — Supabase Cloud setup" -ForegroundColor Cyan
Write-Host "Project ref: $ProjectRef"
Write-Host "Dashboard:  https://supabase.com/dashboard/project/$ProjectRef"
Write-Host ""

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "Node.js/npx is required."
}

Write-Host "Step 1: Log in to Supabase CLI (browser will open)..." -ForegroundColor Yellow
npx supabase login

Write-Host "Step 2: Link project (enter DB password from Dashboard → Settings → Database)..." -ForegroundColor Yellow
npx supabase link --project-ref $ProjectRef

Write-Host "Step 3: Push migrations..." -ForegroundColor Yellow
npx supabase db push

Write-Host ""
Write-Host "Done. Next:" -ForegroundColor Green
Write-Host "  1. Copy API keys from Dashboard → Settings → API into .env and apps/api-server/.env"
Write-Host "  2. Configure Auth URLs — see docs/deploy/02-supabase-cloud.md"
Write-Host "  3. Smoke test: npm run dev:web and sign up with a real email"
