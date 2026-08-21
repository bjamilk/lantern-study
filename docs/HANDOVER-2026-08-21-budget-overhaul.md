# Handover — Budget overhaul (rename, correctness, recurring, mobile parity) + marketplace archive fix

**Date:** 2026-08-21
**Branch:** `main` · **HEAD:** `943360b` (clean tree, pushed)
**Web:** LIVE — lanternstudy.com serves `index-C8HaQ8aH.js`
**API:** LIVE — `/health` = `943360b`
**Supabase:** `tiizkjhbrnaibaagmurl` — both this session's migrations **hand-applied & confirmed**

Audit-driven overhaul of the **Budget** feature (formerly "Campus Pocket") across
web + mobile + API, plus a marketplace listing-delete fix. Everything web is live;
mobile ships in a build (a dev APK was produced, not a store release).

---

## 1. Commits this session (newest first, all on `main`)

```
943360b Budget polish: unified add-transaction sheet, mobile coin-award toast, contribute idempotency key
3728b74 Mobile: recurring transactions UI (parity with web)
0c17a11 Mobile budget parity: expense splits, savings goals, over-budget banner
b605c9a Fix recurring auto-post 500: partial index can't arbitrate ON CONFLICT
3c81dfd Budget: rename Campus Pocket->Budget, correctness/UX overhaul, recurring txns
8b1dd3e Marketplace: allow 'archived' listing status so terminal-order deletes don't 500
```

## 2. Deploy state

| Target | State | Verify by |
|---|---|---|
| **Web → Cloudflare Pages** | **LIVE** `index-C8HaQ8aH.js` (manual deploy — Pages is NOT git-connected) | bundle hash on lanternstudy.com, never the build log |
| **API → Render** | **LIVE** `943360b` (auto-deploys from `main`) | `curl -s …/health` |
| **Supabase migrations** | `20260821130000` (listing archived) + `20260821140000` (recurring) **applied** | `SELECT to_regclass('public.budget_recurring_transactions')` |
| **Mobile** | on `main`, **NOT released** — a dev APK exists (`apps/mobile/build-mobile-parity-dev-1.0.15.apk`, `com.lanternstudy.app.dev`). Prod release = `scripts/publish-android-release.sh` | GitHub release + on-device |

## 3. What changed in Budget

- **Rename** Campus Pocket → **Budget** everywhere (screen titles, nav, coach tip).
- **Correctness (money/data):** category-budget modal re-sync (was wiping saved
  allocations); wallet-refresh merges instead of dropping plannedIncome/savings;
  unified the two contradicting "% spent" denominators; transaction saves tracked
  as pending + reconciled on refetch (no silent loss) with retry;
  `walletService.saveBudgetExtras` preserves fresh server wallet fields (was
  clobbering concurrent awards); `saveUserBudget` goes through the service-role API
  (was a direct PostgREST upsert racing boot auth); fixed the server overspend
  query's invalid `-32` date; UTC→local month; clear `plansByMonth` on account
  switch; mobile SetCategoryBudget preserves the cap.
- **UX/visual:** budget **ring** hero; stable per-category colours in the shared
  def (web + mobile); folded Insights into Overview (web → 3 tabs); removed "Add
  Investment", relocated the Study wallet to the app nav; `window.alert`→toast.
- **Fast capture:** optional description, "Add another" keeps the sheet open, no
  blocking mobile "Success" alert; **unified add-transaction sheet** (web) with an
  Expense/Income toggle + quick-amount chips.
- **Recurring transactions (NEW, web + mobile):** `budget_recurring_transactions`
  table; `/budget/recurring` CRUD + `/run` materialise (idempotent); web
  `RecurringModal` + mobile `RecurringScreen`; auto-posts due rules on budget open.
- **Mobile parity (verified live on a Pixel_8 emulator, signed in as nimaj22):**
  multi-participant expense splits with even division + category (aligned to the
  web ExpenseSplit shape so it syncs); savings goals (icon picker, deadline,
  completed handling); over-budget banner; coin-award toast.

## 4. Traps & learnings for the next agent

1. **Recurring `ON CONFLICT` with a PARTIAL unique index (fixed in b605c9a).**
   `uq_budget_tx_recurring` is partial (`WHERE recurring_rule_id IS NOT NULL`).
   Postgres won't accept a partial index as an `ON CONFLICT` arbiter unless the
   predicate is repeated, which the Supabase client can't emit — so `.upsert()`
   500'd. Use a plain insert and treat `23505` as an idempotent skip.
2. **Root `npx tsc -p tsconfig.json` reports ~3893 PRE-EXISTING errors** (shared
   `*.test.ts` without jest globals + `App.tsx` type drift). NOT a regression and
   NOT a reliable gate. The real gates: **`npm run build:web`** (apps/web strict
   tsc + vite) and per-workspace `npx tsc --noEmit` (apps/mobile, api-server).
3. **api-server is Jest, not vitest** (`npm test` = jest). vite HMR shows stale
   error-boundary crashes mid-edit → full reload clears; trust tsc + a fresh shot.
4. **Web deploy trap:** the build can ship STALE dist. Always confirm
   `npm run build:web` printed `✓ built` AND the served bundle hash on
   lanternstudy.com matches `apps/web/dist/index.html`.
5. **Android local build** (see §5) needs env the repo's PowerShell scripts assume;
   on macOS set it by hand.

## 5. Build/verify the mobile app (discovered this session)

- **iOS sim:** a dev build (`com.lanternstudy.app.dev`) is installed; it loads JS
  from Metro (port 8081). `expo start --dev-client`, relaunch the dev app.
- **Android APK (zero-credit, installable):**
  ```bash
  cd apps/mobile
  # one-time: point Gradle at the SDK
  echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
  nvm use 20                       # Gradle spawns node for JS bundling
  export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
  export ANDROID_HOME="$HOME/Library/Android/sdk"
  (cd android && ./gradlew assembleRelease)   # ~8 min cold, ~1 min warm
  # → android/app/build/outputs/apk/release/app-release.apk (signed w/ debug key)
  ```
  `APP_VARIANT` defaults to `development` → `.dev` bundle id; the `android/`
  prebuild was stale at 1.0.15 (app.config.ts says 1.0.26 — prod release must
  re-prebuild via the publish script). Gradle Metaspace raise already in
  `gradle.properties`.
- **Drive the emulator:** `emulator -avd Pixel_8`; `adb install -r <apk>` keeps
  the login; `adb exec-out screencap -p > shot.png`; taps use NATIVE coords
  (1080x2400) — the on-screen shots are ×1.20 to native.
- Disk was freed by deleting regenerable iOS build intermediates
  (`ios/simbuild` ~6G, `ios/build-dd` ~3G).

## 6. Still outstanding

- **Mobile production release** (1.0.26, `com.lanternstudy.app`) via
  `scripts/publish-android-release.sh` — the dev APK proves the code but isn't a
  store build.
- **Two pre-gate junk jobs postings** need admin removal (unchanged from prior
  handover).
- Minor: `JOB_EMPLOYER_BULK_STATUSES` drift; the deferred note-editing / search-cap
  leads from earlier handovers.
- Optional check: whether admin remove/suspend of a **marketplace listing** ever
  worked in prod before `20260821130000` (its constraint omitted the admin
  statuses too — the migration adds them; if listings were admin-actioned earlier,
  those writes may have been 500-ing).

## 7. Verification done (so it isn't re-litigated)

- Recurring E2E (web + mobile emulator): create → auto-post → next-date advance →
  idempotent second run → deleted → **test data cleaned up** (no `zz-*` rows left).
- Unified add-transaction sheet: toggle red↔green, income sources, chips
  (1000+500=1500) — verified live on web.
- Mobile splits (₦3000→₦1500 each), goal icon picker, doughnut colours — verified
  on the emulator. The over-budget banner + coin-award toast are conditional
  (spend≥80% / an actual award) so were left code-verified, not force-triggered
  against real data.
