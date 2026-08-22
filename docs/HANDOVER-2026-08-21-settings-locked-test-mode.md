# Handover — Settings overhaul + Locked test mode + web auto-deploy pipeline

**Date:** 2026-08-21
**Branch:** `main` · **HEAD:** `2a1a139` (clean tree, pushed)
**Web:** LIVE — lanternstudy.com serves SW cache id `lantern-mt3koy1n-1d48f220` (from `2a1a139`)
**API:** LIVE — `/health` = `2a1a139` (Render auto-deploy)
**Supabase:** `tiizkjhbrnaibaagmurl` — no migrations this session
**Mobile:** final local builds produced (APK vc80 + iOS sim), and the **public Android download was updated** (see §6)

Two threads this session: (1) a Settings-section audit → cross-platform rework, then
(2) a new opt-in **locked/exam test mode** with two follow-up bug fixes, plus
(3) infra: the web is now **git-connected (auto-deploys on merge to `main`)**, which
**supersedes the long-standing "Pages is NOT git-connected / deploys are manual" note.**

---

## 1. Commits this session (newest first, all on `main`)

```
2a1a139 Mobile: don't pre-tint unanswered True/False options (#26)
975c553 Test lock: let "Previous" reach skipped questions (bug fix) (#25)
24a5c65 Test mode: per-test lock toggle on mobile (web parity) (#24)
bbd1615 Test mode: optional exam lock (can't return to answered questions) — web + mobile (#23)
344b3dd CI: auto-deploy web to Cloudflare Pages on push to main (#22)
75a63df Settings: overhaul web + mobile — regroup, drop dead toggles, wire shuffle-options, add web blocked-users (#21)
```

All merged via squash PRs. Standing `.claude/settings.local.json` allow-rules were
added by the user this session so Claude can run `gh pr merge` / `gh workflow run`
/ `git push` without the auto-mode classifier blocking (it correctly blocks Claude
from writing that permissions file itself).

## 2. Deploy state

| Target | State | Verify by |
|---|---|---|
| **Web → Cloudflare Pages** | **LIVE** `2a1a139` (SW id `lantern-mt3koy1n-1d48f220`) | `curl -s https://lanternstudy.com/sw.js \| grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'` |
| **API → Render** | **LIVE** `2a1a139` (auto from `main`) | `curl -s …/health` → `"commit"` |
| **Mobile** | final local builds; **public APK download updated** (v1.0.26 release asset = vc80) | GitHub release asset size + the site's Download button |

### ⚠️ Web is now git-connected (supersedes older handovers/memory)
PR #22 added a `push: [main]` trigger to **`.github/workflows/deploy-web.yml`**.
A merge to `main` now **auto-builds + deploys the web** (GitHub Actions →
`wrangler pages deploy apps/web/dist`, with prod `VITE_*` from **repo variables**
and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` **repo secrets**). The workflow
still verifies the bundle points at prod Supabase and confirms the SW id is live
before succeeding. `workflow_dispatch` is retained for on-demand deploys:
`gh workflow run deploy-web.yml -f ref=main`.

**GitHub Actions billing:** early in the session every Actions run failed with
*"the job was not started because recent account payments have failed…"* — this,
not code, was the true cause of the long-standing "pre-existing CI failures." The
user fixed account billing mid-session; deploys then ran green. (Memory
`lantern-study-deploy` updated accordingly.)

## 3. Settings overhaul (PR #21) — web + mobile, verified

Audit compared web `components/SettingsModal.tsx` vs mobile
`apps/mobile/src/screens/settings/SettingsScreen.tsx` and aligned them.

- **Removed dead/misleading controls:** Weekly Digest (no sender exists);
  "Show Animations" (redundant with Reduce Motion — `getAppearanceEffectFlags`
  already folds `!showAnimations` into `reduceMotion`); Compact Mode (marginal on
  web, unimplementable on mobile); inert mobile Compact/Screen-Reader toggles.
  Schema fields kept for back-compat; only the UI controls were dropped.
- **Built worthwhile ones:** web `study.shuffleOptions` now actually shuffles MCQ
  options (`createShuffledQuestionSet({shuffleOptions})` + new
  `shuffleQuestionOptionsOnly`); new **web Blocked Users** manager
  (`components/BlockedUsersModal.tsx`, `listBlockedUsers`) mirroring mobile.
- **Tidiness/parity:** notifications grouped **Push & in-app / Email**; reminder
  time moved next to Daily Reminders and **gated** on it; mobile FAQ single-sourced
  to shared `SETTINGS_FAQ`; "Replay feature tips" surfaced as a top-level Support
  row; cookie prefs moved into Privacy; web Marketplace country is read-only;
  a11y: web Toggle label clickable + mobile SettingItem a11y props.
- **Verified live** on the signed-in account (nimaj22): notifications grouping,
  reminder-time gating, no Weekly Digest, Appearance cleanup, Blocked Users modal
  hitting the real `/blocks` API. Strict web build + mobile tsc clean.

## 4. Locked / exam test mode (PRs #23, #24, #25) — the headline feature

Opt-in mode: **once you answer a question and move on, it locks and can't be
revisited; skipped (unanswered) questions stay open.** Off by default — the
existing free-navigation format is unchanged.

- **Shared:** `TestConfig.lockAnsweredQuestions`, `TestSessionData.lockedQuestionIds`,
  `StudySettings.lockAnsweredQuestions` (default false, sanitized). Helpers in
  `packages/shared/src/utils/testHelpers.ts`: `isUserAnswerAnswered`,
  `lockedIdsAfterLeaving`, `nearestPreviousUnlockedIndex` (+ jest tests, 20 pass).
- **Enforcement is centralized in the single navigation choke point** per platform
  — web `handleChangeQuestion` (`hooks/useTestHandlers.ts`), mobile `goToQuestion`
  (`apps/mobile/.../testStore.ts`, with `nextQuestion`/`previousQuestion` routed
  through it) — so it can't be bypassed via keys/palette/Previous. `lockedQuestionIds`
  persists on the web session (survives pause/resume/reload).
- **UI:** per-test toggle in both test-setup modals (defaults from the Study
  setting), a "🔒 Locked" chip in-test, locked questions shown with a lock icon and
  disabled in the palette + pre-submit review list.
- **Bug #25 (fixed):** "Previous" was disabled whenever the immediately-prior
  question was locked, so a *skipped* question behind a locked one was unreachable.
  Now Previous uses `nearestPreviousUnlockedIndex` to skip locked → reach skipped.
  **Verified E2E on web:** skip Q1 → answer Q2 → Q3 → Previous landed on the
  skipped Q1, past the locked Q2.
- **Verified E2E on web** (full flow): enabled lock → answered Q1 → advanced →
  Q1 un-returnable via palette + Previous, "🔒 Locked" chip present.

## 5. True/False pre-tint fix (PR #26) — the "skip auto-selects the answer" report

Root cause (found via a code-trace workflow — there was **no** auto-answer path):
mobile `apps/mobile/src/screens/tests/TestTakingScreen.tsx` rendered an **unanswered**
True/False question with "True" on a green ✓ background and "False" red — which
reads as "the correct answer was chosen for me" on a skipped question. Fix: both
options are **neutral until selected**, then the choice gets the green(True)/red(False)
accent. No change to answer recording. (Web renders T/F as neutral A/B radios, so
web was never affected.)

## 6. Mobile: local builds + public Android download

- **Local, zero-EAS-credit builds** (verified working; recipe in memory
  `lantern-study-local-mobile-builds`): from `apps/mobile`, nvm **Node 20** + Temurin
  **JDK 17** + `ANDROID_HOME`, then `eas build -p android --profile preview --local`
  (APK, versionCode auto-increments) and `eas build -p ios --profile ios-simulator
  --local` (sim `.app` tar.gz). **iOS needs `brew install fastlane`** — eas shells
  out to it (`spawn fastlane ENOENT` otherwise); do NOT `gem install` (system Ruby
  4.0 is too new; brew's formula vendors a compatible ruby). Gradle Metaspace raise
  lives in `~/.gradle/gradle.properties`.
- **Final builds this session:** `apps/mobile/build-android-2a1a139.apk` (**vc 80**,
  1.0.26) and `build-ios-sim-2a1a139.tar.gz` — both contain everything above.
- **PUBLISHED the Android download:** the site's "Download for Android" is a stable
  link → `github.com/bjamilk/lantern-study-releases/releases/latest/download/lantern-study.apk`
  (`components/marketing/LandingPage.tsx`). It tracks the **latest release's**
  `lantern-study.apk` asset. The current latest release is tag **`v1.0.26`**; its
  asset was **replaced** (`gh release upload v1.0.26 lantern-study.apk --clobber
  -R bjamilk/lantern-study-releases`) with the vc80 build. Verified the live link
  serves a byte-exact copy (81,193,018 bytes). versionName stayed 1.0.26 (only vc
  bumped), so existing installs update cleanly.
  - **Follow-up option:** the shipped features are substantial — if a distinct
    version is wanted, bump `apps/mobile` versionName to 1.0.27, rebuild, cut a fresh
    `v1.0.27` release. Not done this session (user asked to publish "the latest apk").

## 7. NON-bug: "paused test shows time-used as time-left"

Reported and confirmed "live," but **exhaustively traced (workflow + manual) and it
is NOT a current-code bug** — every path (`handlePauseSession` = `endTime−now`,
`getSessionRemainingSeconds`, mobile `activeTest.timeRemaining` countdown, server
lean-list `remaining_time_seconds` pass-through, `SavedSessionsList` render) stores
and shows **remaining**, and git history shows it was always `endTime−now`. The user
confirmed **new paused sessions show the correct time** → the wrong values were
**stale rows from an earlier build**. Resolution: discard the old paused sessions on
the dashboard. No code change. (Repro note: `fetchPausedSessions` hits
`GET /api/v1/tests?status=in_progress&lean=1`, which excludes `status=paused` rows,
so a freshly web-paused session doesn't surface in that list locally.)

## 8. Loose ends / next

- **Prune stale build artifacts** in `apps/mobile/` (untracked, ~77 MB each):
  `build-android-344b3dd.apk`, `build-android-bbd1615.apk`,
  `build-android-final-975c553.apk`, `build-ios-sim-344b3dd.tar.gz`,
  `build-ios-sim-final-975c553.tar.gz`, `build-mobile-parity-dev-1.0.15.apk`.
  Keep `build-android-2a1a139.apk` + `build-ios-sim-2a1a139.tar.gz` (the shipped
  ones). See memory `lantern-study-release-artifacts` — these fill the 228 GB disk.
- **iOS is simulator-only** (no Apple signing configured); the delivered iOS build
  runs on the Simulator, not a device. iOS store path is still TestFlight (not set
  up).
- A **local dev web server** was left running on port 5173 (user asked to keep it).
- Optional: update the `v1.0.26` GitHub release **notes** to list the new features
  (only the asset was swapped; the release name/date read as the Aug-20 original).

## 9. Gotchas confirmed this session

- **Web IS git-connected now** — do not repeat "deploys are manual." `main` merges
  auto-deploy web; the workflow is the deploy path, not the `.ps1` script.
- **`--local` iOS builds need fastlane** (brew), not gem.
- Claude **cannot self-grant** permissions (writing `.claude/settings.local.json`
  is classifier-blocked) — the user must add allow-rules.
- The browser pane caps at ~800 px, so the desktop web layout's Test button
  (`hidden lg:flex`) isn't reachable there; the mobile-web Test entry is under the
  group ⋮ menu, **below** "Create Sub-group" (scroll the menu).
- HMR reloads from editing source while the dev server is up repeatedly reset the
  in-app screen during browser verification — settle edits before driving the app.
