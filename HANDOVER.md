# Lantern Study — Session Handover

**Date:** 2026-07-12  
**Branch:** `main`  
**HEAD:** `10a92cd` (local changes uncommitted — see §2)  
**Production:** https://lanternstudy.com · API https://lantern-study-api.onrender.com  
**Supabase project:** `tiizkjhbrnaibaagmurl`

Use this document to resume work in a new chat. Point the agent at `@HANDOVER.md` plus any specific task.

---

## 1. What this project is

Monorepo study/social/marketplace app:

| Surface | Path |
|---------|------|
| React web | `components/`, `services/supabase.ts`, `stores/` |
| Expo mobile | `apps/mobile/` |
| Express API | `apps/api-server/` |
| Shared | `packages/shared/` |
| DB / Auth / Storage | Supabase (`supabase/migrations/`) |

Deploy: Cloudflare Pages (web), Render (API + worker), Supabase (Postgres/Auth).

---

## 2. Completed in recent sessions

### HANDOVER remediation batch (2026-07-12, local — not yet committed)

| Item | Status |
|------|--------|
| **F-02** Profile avatar IDOR | Fixed in `canAccessStorageObject` → `isProfileVisibleToViewer`; unit test + `scripts/poc-f02-profile-avatar-idor.ps1` |
| **Auth-01** Stale JWT `isAdmin` | `isLivePlatformAdmin` in `authorizeResource`, `requestAuth`, `marketplace.ts`, `auth.ts`; unit test |
| **Auth-02** `marketplace_inquiries` lockdown | Migration `20260712130000` **applied to prod**; PoC **passed** |
| **Flashcard null decks** | Mobile `sanitizeDecks`; API `getDecks` filter; `debug_flashcard_error.md` resolved |
| **F-03** Default public visibility | Confirmed intentional; onboarding copy in web Settings + mobile Privacy modal |
| **F-04** `/user-stats` public-write flag | Removed from `isPublicWriteRequest` |
| **F-05** `/health` uptime leak | Production returns `{ status: 'ok' }` only |
| **Codemod** | Word-boundary replacements + forbidden-pattern `--check` in CI |
| **Sitemap pings** | Skipped by default (deprecated); IndexNow + GSC manual note kept |
| **CI** | `security-regression.yml` (PoC scripts when secrets configured); design-token check in `ci.yml` |

**PoC results (production Supabase):**

- F-01 regression: **passed**
- Auth-02 inquiries: **passed** (403 on INSERT/UPDATE; SELECT works)
- F-02 live API PoC: **pending** — Render deploys from `origin/main`; commit + push + redeploy API for F-02/Auth-01 code to go live

### Phase 3 — accessibility & design tokens (done)

- TabPanel migrations, Menu migration, form labels, design-token sweep, flashcard null-deck web fix

### Security — F-01 remediated (done)

- Migration `20260712120000_p0_security_marketplace_offers.sql` applied; PoC verified

### Deploy status (2026-07-12)

| Target | Status |
|--------|--------|
| `origin/main` | Still at `10a92cd` — **local remediation not pushed** |
| Render API | Live `/health` 200 (redeploy triggered; runs GitHub `main`) |
| Supabase Auth-02 migration | Applied |
| Supabase F-01 migration | Applied |

---

## 3. Recent commits on `origin/main` (newest first)

```
10a92cd Add F-01 marketplace offers PostgREST regression PoC script.
e7eca0c Lock down marketplace_offers client writes to fix F-01 offer bypass.
179cb0b Replace hardcoded slate and indigo classes with lantern design tokens across web and mobile.
```

---

## 4. Open findings & recommended next work

### Immediate

1. **Commit, push, redeploy** local remediation (API + web privacy copy + CI)
2. Re-run `scripts/poc-f02-profile-avatar-idor.ps1` after API deploy
3. Optional: Cloudflare Pages deploy for F-03 Settings copy

### Remaining gaps

| Item | Notes |
|------|-------|
| **Web/mobile E2E** | No Playwright/Cypress yet; security-regression workflow covers PostgREST PoCs when secrets set |
| **Service-role completeness** | Architectural — every new handler must enforce auth |
| **Google Search Console** | Manual sitemap submit (`/sitemap.xml`, `/sitemap/marketplace.xml`) |

---

## 5. Key file map

```
# Security / auth (updated this session)
apps/api-server/src/services/supabase.ts          # F-02, Auth-02 inquiry guards, getDecks filter
apps/api-server/src/middleware/authorizeResource.ts   # Auth-01
apps/api-server/src/utils/requestAuth.ts
apps/api-server/src/middleware/auth.ts
apps/api-server/src/routes/marketplace.ts
apps/api-server/src/routes/health.ts             # F-05
apps/api-server/src/middleware/publicRoutes.ts   # F-04

# Migrations (security)
supabase/migrations/20260712120000_p0_security_marketplace_offers.sql
supabase/migrations/20260712130000_p0_security_marketplace_inquiries.sql

# Regression / verify
scripts/poc-f01-marketplace-offers.ps1
scripts/poc-f02-profile-avatar-idor.ps1
scripts/poc-auth02-marketplace-inquiries.ps1
scripts/verify-rls-privileges.ps1
.github/workflows/security-regression.yml

# Flashcards
apps/mobile/src/stores/flashcardStore.ts
stores/flashcardStore.ts
debug_flashcard_error.md
```

---

## 6. Commands cheat sheet

```powershell
cd "c:\Users\Mindi Caron\Desktop\lantern-study__ 111625"

# Security PoCs (needs .env + apps/api-server/.env)
powershell -File .\scripts\poc-f01-marketplace-offers.ps1
powershell -File .\scripts\poc-f02-profile-avatar-idor.ps1
powershell -File .\scripts\poc-auth02-marketplace-inquiries.ps1
powershell -File .\scripts\verify-rls-privileges.ps1

# Build & test
cd apps/api-server; npm run build; npm test
node scripts/migrate-design-tokens.mjs --check

# Deploy (after commit/push for Render to pick up code)
powershell -File .\scripts\deploy-render-api.ps1
powershell -File .\scripts\deploy-cloudflare-pages.ps1
```

---

## 7. Architecture reminders for agents

- **API uses service role** — bypasses RLS; enforce auth in every handler.
- **Admin bypass paths** now use `isLivePlatformAdmin` (live `platform_admins` DB check), not JWT `isAdmin` alone.
- **Profile avatars** — signed URLs require owner or `profile_visible_to_viewer()`.
- **Marketplace inquiries/offers** — client INSERT/UPDATE revoked; mutations via API only.
- **Do not commit** unless user asks. **Do not force-push** main.

---

## 8. Suggested prompts for next session

```
Read @HANDOVER.md. Commit, push, and deploy the HANDOVER remediation batch; re-run F-02 PoC.
```

```
Read @HANDOVER.md. Add Playwright smoke tests for marketplace inquiry flow.
```

---

## 9. Assurance statement

F-01 and Auth-02 are **fixed and PoC-verified** on production Supabase. F-02, Auth-01, and hygiene fixes are **implemented locally** with unit tests; live API verification pending push/deploy. Audits do not prove full security.

---

*Updated after HANDOVER open-findings remediation. Commit local changes when ready.*
