# Lantern Study — Session Handover

**Date:** 2026-08-20  
**Branch:** `main`  
**HEAD:** `5278b54` (clean tree, pushed — matches `origin/main`)  
**Production:** https://lanternstudy.com · API https://lantern-study-api.onrender.com  
**Supabase project:** `tiizkjhbrnaibaagmurl`

This is the canonical "resume here" pointer. Point a new agent at `@HANDOVER.md` plus
the specific task. Per-session detail lives in the dated docs under `docs/` (linked in §2)
and in the agent memory files — don't duplicate it here.

> **Repo trap:** the real repo is `~/Desktop/lantern-study`. `~/Desktop/Lanternstudy`
> is a **stale clone** that can hijack the session cwd, agent worktrees, and slash
> commands. Confirm you're in `lantern-study` (lowercase) before anything.

---

## 1. What this project is

Monorepo study / social / marketplace app:

| Surface | Path |
|---------|------|
| React web | `apps/web/`, `components/`, `services/supabase.ts`, `stores/` |
| Expo mobile | `apps/mobile/` |
| Express API | `apps/api-server/` |
| Shared | `packages/shared/` |
| DB / Auth / Storage | Supabase (`supabase/migrations/`) |

Deploy: Cloudflare Pages (web), Render (API + worker), Supabase (Postgres/Auth), EAS/local for mobile.

---

## 2. Current deploy state (at HEAD `5278b54`)

| Target | State | Verify by |
|--------|-------|-----------|
| **Web → Cloudflare Pages** | **LIVE, bundle `index-CW8Loyo2.js`** — the full **chat overhaul (#19) + auth fix (#20)** (**manual** deploy — Pages is NOT git-connected) | bundle hash on lanternstudy.com, **never** the build log |
| **API → Render** | unchanged by #19/#20 (web/mobile/shared only) — auto-deploys from `main` | `curl -s https://lantern-study-api.onrender.com/health` → commit + AI-key presence |
| **Mobile** | overhaul is on `main` + the iOS **dev** build, but **NOT in the released APK** (`v1.0.26` predates it) — needs a new build/release | GitHub release + on-device |
| **iOS** | simulator dev build only; **no distributable** (needs Apple membership) | — |
| **Supabase** | FK RESTRICT migration `20260821120000` **hand-applied** 2026-08-20. `20260821130000` (allow `'archived'` status) **NOT yet applied** — DELETE-listing archive still 500s until it is | run it in the SQL editor; verify constraint |

**Test suites at handover, all green:** API **453**, shared **496**, web **51**, mobile **53**.
Root `tsc` carries a large **pre-existing baseline** — diff the set, never chase zero.
`apps/web` BUILD tsc (`noUncheckedIndexedAccess`) is **stricter** than root tsc — see Trap 1.

### Active detail docs (newest first)

- **[docs/HANDOVER-2026-08-21-marketplace-listing-archive-fix.md](docs/HANDOVER-2026-08-21-marketplace-listing-archive-fix.md)** — DELETE-listing 500 fix: widen `marketplace_listings_status_check` to permit `'archived'` + regression guard. **Uncommitted; needs migration `20260821130000` hand-applied.** *(latest work)*
- [docs/HANDOVER-2026-08-20-chat-ux-overhaul.md](docs/HANDOVER-2026-08-20-chat-ux-overhaul.md) — the whole chat redesign (declutter/responsive/correctness/mobile parity + Phase 6 marketplace) & the spurious sign-out fix; both **LIVE**.
- [docs/HANDOVER-2026-08-20-marketplace-jobs-library-audits.md](docs/HANDOVER-2026-08-20-marketplace-jobs-library-audits.md) — Jobs / Goods / Library section audits, 1.0.26 mobile publish.
- [docs/HANDOVER-2026-08-20-payments-live-ai-recovery-admin.md](docs/HANDOVER-2026-08-20-payments-live-ai-recovery-admin.md) — Paystack live in test mode, AI outage recovery, admin telemetry.
- Prior: `…-08-15-security-sessions-monitoring-ios.md`, `…-08-11-releases-credits-xp.md`.

Chat-overhaul detail + the iOS-sim verify recipe are in memory:
`lantern-study-chat-ux-overhaul`. Deploy/build traps: `lantern-study-web-deploy-traps`,
`lantern-study-eas-slim-lockfile`, `lantern-study-local-android-build`.

---

## 3. Recent commits on `main` (newest first)

```
5278b54 Chat UX overhaul: declutter, responsive, correctness, mobile parity + Phase 6 marketplace (#19)
9fe496c Recover spurious sign-outs from refresh-token 400s (#20)
3967462 Refresh root HANDOVER pointer to HEAD 7eda3c7
7eda3c7 Handover: Jobs/Goods/Library audits shipped + 1.0.26 mobile published
```

---

## 4. Still outstanding

- **Chat overhaul → mobile**: it's live on web but the released Android APK
  (`v1.0.26`) predates it — build + release a new version to get it onto phones.
  Also **verify the mobile order lifecycle on-device** (Pay-now/Mark-ready/Confirm) —
  only the web money flow is live-verified. See the chat-overhaul dated doc.
- **`DELETE` marketplace listing 500s** — **FIXED (code-complete, uncommitted)**: the
  archive path wrote `status = 'archived'` but the check constraint didn't allow it.
  Migration `20260821130000` widens it; **still 500s in prod until that migration is
  hand-applied**. See the 2026-08-21 dated doc in §2.
- **Two pre-gate junk postings on the live jobs board** — Ezeobi's
  "Internship — [team / function]" (test account, needs admin removal) and
  Benjamin's "Tutor needed for [PHM 101]". The publish gate blocks new ones; these predate it.
- **Digital study bundles (question banks)** — phases 1–2 code is live but **inert** until
  migration `20260818…` is hand-applied. See memory `lantern-study-question-banks`.
- `JOB_EMPLOYER_BULK_STATUSES` in shared still lists `chatting` though the API now rejects it (harmless drift).
- **Deferred leads worth their own pass:** collaborative note editing is whole-body
  last-write-wins (only conflict *detection* was added); a report that editor-collaborators
  can corrupt the owner's folder assignment beyond the owner-only guard; search can't find
  imported content past the 2000-char/note cap; grade buttons lack Anki-style history chips.
- **iOS distribution** is not wired to the releases flow (Android-only); ships via TestFlight/EAS with the Apple membership.

---

## 5. Traps — read before shipping

1. **The web build can ship STALE and lie about it.** `apps/web` build is `tsc && vite build`;
   a strict-tsc failure exits non-zero and `wrangler pages deploy` then ships the PREVIOUS
   dist with "Deployment complete". Turbo can also cache-HIT and skip tsc. Root `tsc` and
   vitest both miss these. **Always** confirm `npm run build:web` printed `✓ built` with fresh
   hashes AND that the served bundle hash matches `apps/web/dist/index.html`. → `lantern-study-web-deploy-traps`.
2. **Parallel agents in one working tree collide.** An agent `git stash` once wiped every
   session's uncommitted edits. Rule for every delegated agent: **no** checkout/restore/stash/clean/reset;
   commit finished slices early by explicit path; put any shared contract text in **both** agents' prompts.
3. **Measure before "fixing".** Several reported bugs were false alarms confirmed by measurement,
   not code-reading (dev-only StrictMode double-fetch, offer-decline state, in-panel sort). Reproduce first.
4. **`X.id` in a `useCallback`/effect DEPENDENCY ARRAY crashes when X is null.** A
   `currentUser.id` dep crashed the whole app for logged-out users (deps eval every render).
   Use `currentUser?.id`. Grep new deps arrays for bare `.id` on nullables. → chat-overhaul doc.

---

## 6. Commands cheat sheet (macOS · Node 20)

```bash
cd ~/Desktop/lantern-study

# Build & test
npm run build:web           # tsc && vite build — confirm "✓ built" + fresh hashes
npm test                    # or per-workspace: cd apps/api-server && npm test

# Web deploy (manual — Pages is NOT git-connected)
npm run build:web && npx wrangler pages deploy apps/web/dist \
  --project-name lantern-study --branch main
# then verify the served bundle hash matches apps/web/dist/index.html

# API deploy: push to origin/main; Render redeploys from GitHub main
# verify: curl -s https://lantern-study-api.onrender.com/health

# Mobile Android release (one command; refuses to double-publish)
bash scripts/publish-android-release.sh
```

Local Android APK build (zero EAS credits): Node 20 + JDK 17 with the Gradle Metaspace
raise — see memory `lantern-study-local-android-build`.

---

## 7. Architecture reminders for agents

- **API uses the service role** — it bypasses RLS; enforce auth in **every** handler.
- **Admin bypass paths** use `isLivePlatformAdmin` (live `platform_admins` DB check), not JWT `isAdmin` alone.
- **Profile avatars** — signed URLs require owner or `profile_visible_to_viewer()`.
- **Marketplace inquiries/offers** — client INSERT/UPDATE revoked; mutations go through the API only.
- **DELETE listing** does not cascade paid orders (open → 409, terminal → archive), enforced by the FK RESTRICT migration.
- **Do not commit** unless the user asks. **Do not force-push** `main`.

---

*Updated 2026-08-20 to track HEAD `5278b54` (chat overhaul #19 + auth fix #20, both live). This root file is the pointer; put session detail in a new `docs/HANDOVER-<date>-<topic>.md` and link it in §2.*
