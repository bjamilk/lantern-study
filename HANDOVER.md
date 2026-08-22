# Lantern Study — Session Handover

**Date:** 2026-08-22  
**Branch:** `main`  
**HEAD:** `04404b1` (clean tree, pushed — matches `origin/main`)  
**Production:** https://lanternstudy.com (SW `lantern-mt4ba648-cee27c47`) · API https://lantern-study-api.onrender.com (`/health` = `04404b1`)  
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

Deploy: Cloudflare Pages (web, **git-connected — auto-deploys on push to `main`** via `.github/workflows/deploy-web.yml`), Render (API + worker, auto from `main`), Supabase (Postgres/Auth), EAS/local for mobile.

---

## 2. Current deploy state (at HEAD `04404b1`)

| Target | State | Verify by |
|--------|-------|-----------|
| **Web → Cloudflare Pages** | **LIVE `04404b1`** — auto-deployed on merge; workflow verifies prod Supabase + live SW id before succeeding | `curl -s https://lanternstudy.com/sw.js \| grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'` |
| **API → Render** | **LIVE `04404b1`** — auto from `main` | `curl -s https://lantern-study-api.onrender.com/health` → commit |
| **Mobile Android** | **v1.0.28 (versionCode 83) PUBLISHED** — release `v1.0.28` on `bjamilk/lantern-study-releases`, the site Download button tracks it (asset byte-verified 81,199,242 B == `apps/mobile/build-android-1.0.28-088e85b.apk`) | release asset size + on-device |
| **iOS** | `apps/mobile/build-ios-sim-1.0.28-088e85b.tar.gz` — simulator parity build, boot-verified; **no distributable** (Apple signing not set up; runbook exists) | `tar -xzf … && xcrun simctl install booted LanternStudyDev.app` |
| **Supabase** | no migrations this session; question-banks migration `20260818…` still awaiting hand-application | — |

**Type-checking gates:** root `npx tsc --noEmit` is a FALSE gate (~3.9k pre-existing errors; wrong tsconfig scope). Real gates: **`npm run build`** (turbo) for web, per-workspace `tsc` for `apps/mobile` and `apps/api-server`.

### Active detail docs (newest first)

- **[docs/HANDOVER-2026-08-22-night-ship-marathon.md](docs/HANDOVER-2026-08-22-night-ship-marathon.md)** — this session: exam lock (#27), **dark-mode rebuild + AA contrast + AI-credit honesty + offline sync integrity** (#28), **ranked backlog: SW app-shell precache, cross-account queue guard, sync durability, 202-credit-refunds, companion parity** (#29), v1.0.27→v1.0.28 releases (#30), **auth funnel overhaul** (#31–#32: 3-field signup, fail-closed captcha, 8-char passwords, expired-link recovery, no enumeration leaks), Apple sign-in runbook. *(HEAD — latest work)*
- [docs/APPLE-SIGN-IN-SETUP.md](docs/APPLE-SIGN-IN-SETUP.md) — Apple portal + Supabase provider + iOS signing + **the pending dashboard actions** (redirect allow-list, captcha toggle, password policy, PKCE test plan).
- [docs/HANDOVER-2026-08-21-settings-locked-test-mode.md](docs/HANDOVER-2026-08-21-settings-locked-test-mode.md) — settings overhaul, first locked-test-mode ship, web auto-deploy pipeline (#21–#26).
- [docs/HANDOVER-2026-08-21-budget-overhaul.md](docs/HANDOVER-2026-08-21-budget-overhaul.md) — Budget overhaul + marketplace archive fix.
- [docs/HANDOVER-2026-08-20-chat-ux-overhaul.md](docs/HANDOVER-2026-08-20-chat-ux-overhaul.md) — chat redesign; both LIVE.
- Prior: `…-08-20-marketplace-jobs-library-audits.md`, `…-08-20-payments-live-ai-recovery-admin.md`, `…-08-15-security-sessions-monitoring-ios.md`, `…-08-11-releases-credits-xp.md`.

Key memory files: `lantern-study-exam-lock`, `lantern-study-web-theme-tokens`,
`lantern-study-backlog-round`, `lantern-study-web-deploy-traps`,
`lantern-study-local-android-build`, `lantern-study-eas-slim-lockfile`.

---

## 3. Recent commits on `main` (newest first — all this session)

```
04404b1 Auth hardening: 3-field signup, fail-closed captcha, 8-char passwords, expired-link recovery (#32)
a0cde34 Auth funnel: honest flows, no info leaks, password-manager friendly (#31)
088e85b Mobile: version 1.0.28 — companion parity, offline Study mode, sturdier sync (#30)
fb6975b Ranked backlog: offline durability, AI credit refunds, companion parity (#29)
4b3e5fe Web+mobile: working dark mode, AA contrast, AI-credit honesty, offline sync integrity (#28)
7499b02 Mobile: per-test exam lock actually works for group tests (1.0.27) (#27)
```

---

## 4. Still outstanding

**USER dashboard actions (see the Apple runbook doc — do #1 regardless of Apple):**
1. Supabase → URL Configuration → add `https://lanternstudy.com/login*` to Redirect URLs — until then the OAuth `?next=` deep-link carry silently falls back to the Site URL (affects **Google today**).
2. Supabase → Attack protection → enable CAPTCHA (Turnstile) — client is fail-closed already; this makes the server authoritative.
3. Supabase → Email provider → password minimum **8**.
4. Apple sign-in setup (portal + provider + **6-month client-secret rotation reminder**) and Apple Developer enrollment → `eas credentials -p ios` → TestFlight.

**Engineering backlog:**
- **PKCE flip** prepared, not applied (`flowType: 'pkce'` in `services/supabase.ts`) — needs the runbook checklist + an email-confirmation and reset-link round-trip first.
- Real token streaming for the AI companion (per-provider SSE + mid-stream failover + action-tail parsing).
- Mobile: purchased-question-bank updates (web-only), per-row chat delete, bundle newest-200 content skew.
- Landing: social proof + product screenshot (real assets only).
- `finishAuthSession` failure after successful OTP verify still strands on the auth screen (banner honest now; full recovery = enter app, let boot rebuild profile).
- Two pre-gate junk postings on the live jobs board (Ezeobi "Internship — [team / function]", Benjamin "Tutor needed for [PHM 101]") — need admin removal.
- Digital study bundles phases 1–2 live but **inert** until migration `20260818…` is hand-applied (memory `lantern-study-question-banks`).
- Collaborative-notes last-write-wins body edits; note search misses content past the 2000-char cap; grade-history chips.

---

## 5. Traps — read before shipping

1. **Root `tsc` is a false gate & log-wrappers lie.** Use `npm run build` (web) and per-workspace tsc. A `cmd > log; echo EXIT >> log` wrapper reports the WRAPPER's exit — read the log's EXIT line.
2. **EAS local builds archive the working tree at start.** Uncommitted edits leak into the binary. Stash → start build → confirm the `/var/folders/.../eas-build-local-nodejs/<id>/build/` copy predates your edits → pop.
3. **The browser pane's SPA must be hard-reloaded** (`navigate force:true`) before probing a fresh deploy — pushState probes test the OLD bundle. Also: theme-toggle contrast probes need >400 ms settle or `transition-colors` yields false "invisible text" findings.
4. **Never re-introduce palette inlining on `<html>`.** Theme tokens live ONLY in `index.css :root/.dark` (mirroring `packages/shared/src/design/tokens.ts`); inline custom properties outrank the stylesheet and killed dark mode for months.
5. **Effects that run on user switch must read `useStore.getState()`,** not render-scope arrays — a stale-closure persist effect re-uploaded the previous user's offline queue into the new account.
6. **Sync handlers must RETHROW transient network errors** (`isTransientSyncError`) — returning `false` burns one of the operation's retries and strands work in `failedOperations`.
7. **Tri-state option fields:** flows without a toggle must emit `undefined`, never `false` — an explicit false in cloud config overrides a global ON after sync (exam lock bundles).
8. **Supabase signUp fake success:** existing confirmed email → `data.user` with `identities: []`, no session, NO email sent. Detect it or users strand on verify-email.
9. **Parallel agents in one working tree collide** (a stash once wiped everything). No checkout/restore/stash/clean/reset in delegated agents; commit slices early by path.
10. **Measure before "fixing"** — multiple reported bugs were false alarms; several probe findings were transition artifacts. Reproduce first.

---

## 6. Commands cheat sheet (macOS · Node 20)

```bash
cd ~/Desktop/lantern-study

# Gates
npm run build                                  # turbo — the real web gate
cd apps/mobile && npx tsc --noEmit             # mobile gate (baseline: 0 errors)
cd apps/api-server && npx tsc --noEmit         # server gate (baseline: 0 errors)

# Deploys are AUTOMATIC on merge to main (web workflow + Render).
# On-demand web deploy: gh workflow run deploy-web.yml -f ref=main

# Local Android APK (zero EAS credits): from apps/mobile, nvm use 20,
# JAVA_HOME=$( /usr/libexec/java_home -v 17 ), ANDROID_HOME=~/Library/Android/sdk
eas build -p android --profile preview --local --non-interactive --output=build-android-<ver>-<sha>.apk

# Local iOS simulator build (needs brew fastlane)
eas build -p ios --profile ios-simulator --local --non-interactive --output=build-ios-sim-<ver>-<sha>.tar.gz

# Publish Android (stable link tracks latest release)
gh release create vX.Y.Z --repo bjamilk/lantern-study-releases --title "…" --notes "…" lantern-study.apk
```

---

## 7. Architecture reminders for agents

- **API uses the service role** — it bypasses RLS; enforce auth in **every** handler.
- **Admin bypass paths** use `isLivePlatformAdmin` (live `platform_admins` DB check), not JWT `isAdmin` alone.
- **Mobile has TWO test-start paths** (`startTest` and `startQuestionSet`); thread any per-test option through both + the offline bundle chain.
- **AI credits:** middlewares record `res.locals.aiCharge`; async 202 jobs stamp it on the job record at enqueue and refund on permanent failure (idempotent SET NX). Companion `/message` must keep `trackUsage` on.
- **Marketplace inquiries/offers** — client INSERT/UPDATE revoked; mutations go through the API only.
- **Do not commit** unless the user asks. **Do not force-push** `main`. `gh pr merge` may be classifier-blocked — ask the user, don't work around.

---

*Updated 2026-08-22 to track HEAD `04404b1` (overnight marathon: exam lock, dark-mode rebuild, AI-credit honesty, offline durability, ranked backlog, auth overhaul; v1.0.28 published). This root file is the pointer; put session detail in a new `docs/HANDOVER-<date>-<topic>.md` and link it in §2.*
