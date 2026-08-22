# Handover — Exam lock · dark mode rebuild · AI-credit honesty · offline durability · auth overhaul

**Date:** 2026-08-21 → 2026-08-22 (overnight session)
**Branch:** `main` · **HEAD:** `04404b1` (clean tree, pushed)
**Web:** LIVE — lanternstudy.com serves SW `lantern-mt4ba648-cee27c47` (from `04404b1`)
**API:** LIVE — `/health` = `04404b1` (Render auto-deploy)
**Supabase:** `tiizkjhbrnaibaagmurl` — no migrations this session
**Mobile:** **v1.0.28 (versionCode 83) is the public download** — release `v1.0.28` on `bjamilk/lantern-study-releases`, asset byte-verified (81,199,242 B). iOS simulator parity build boot-verified. v1.0.27 (vc 82) was published mid-session and superseded.

Six squash-merged PRs, two published mobile releases, three deep audits (Lantern AI, Offline, Auth), and a full responsive/theme pass. Every multi-file batch went through an adversarial verification workflow before merge — those reviews caught a real blocker in three separate batches (details below; keep doing this).

---

## 1. Commits this session (newest first, all on `main`)

```
04404b1 Auth hardening: 3-field signup, fail-closed captcha, 8-char passwords, expired-link recovery (#32)
a0cde34 Auth funnel: honest flows, no info leaks, password-manager friendly (#31)
088e85b Mobile: version 1.0.28 — companion parity, offline Study mode, sturdier sync (#30)
fb6975b Ranked backlog: offline durability, AI credit refunds, companion parity (#29)
4b3e5fe Web+mobile: working dark mode, AA contrast, AI-credit honesty, offline sync integrity (#28)
7499b02 Mobile: per-test exam lock actually works for group tests (1.0.27) (#27)
```

`gh pr merge` was classifier-blocked early in the session and started working after the user's explicit "merge, commit, deploy" — if it blocks again, ask the user rather than working around it.

## 2. Deploy / release state

| Target | State | Verify by |
|---|---|---|
| Web → Cloudflare Pages | LIVE `04404b1` (SW `lantern-mt4ba648-cee27c47`) | `curl -s https://lanternstudy.com/sw.js \| grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'` |
| API → Render | LIVE `04404b1` | `curl -s .../health` → `"commit"` |
| Android public download | **v1.0.28** vc83 from `088e85b` | release asset size 81,199,242 B == local `apps/mobile/build-android-1.0.28-088e85b.apk` |
| iOS | `build-ios-sim-1.0.28-088e85b.tar.gz`, boots to sign-in on the simulator | still sim-only; device/TestFlight blocked on Apple signing |

Build artifacts were pruned on user request — only the `1.0.27-4b3e5fe` and `1.0.28-088e85b` pairs remain in `apps/mobile/`.

## 3. Exam lock (#27) — and how it nearly shipped broken twice

The per-test "Lock answered questions" toggle did nothing on mobile because the **group question-bank flow uses `startQuestionSet`, which ignored config** (only `startTest` honored it). Threaded end-to-end now. Two adversarial rounds then caught:

- **Pause/resume released the lock** — mobile drafts never carried it. Fix persists `lockAnsweredQuestions` (web's field name) in the draft config and **re-derives** `lockedQuestionIds` on resume as *answered ∧ ¬current* (provably equivalent because `answerQuestion` only touches the current question and `goToQuestion` is the single nav choke point; no server change — PATCH whitelists config).
- **Offline downloads dropped the toggle at three layers**; also the **tri-state trap**: flows with no toggle must emit `undefined`, never `false` — an explicit false in cloud bundle config overrides a global lock-ON after sync.
- Bonus: diagram-labeling answers were being lost on resume (parser had no `diagramAnswers` branch) — fixed; it doubled as a lock bypass.

Known accepted leak: force-quit after navigating (no pause) leaves the single most-recent answer editable on resume.

## 4. Dark mode & contrast (#28) — the structural bug

**Web dark mode never worked**: boot (`applyDesignTokensToDom` from index.tsx and applyUserSettingsToDom) inlined the entire LIGHT palette as inline styles on `<html>`; inline custom properties outrank the stylesheet, so `.dark { --color-* }` could never apply. Now `index.css :root/.dark` is the single source of truth (values mirror `packages/shared/src/design/tokens.ts`); `applyDesignTokensToDom` only cleans legacy inline vars and applies a custom accent when ≠ default `#6366f1`. **Never re-introduce palette inlining.**

Contrast: dark primary/accent fills get dark ink via two scoped index.css rules (white was 2.98/1.77:1 → measured 5.98/10.69 live); tokens darkened for AA (`accent`/`warning` #b45309, `success` #047857, `textTertiary` #5b6a7f) in **both** index.css and shared tokens.ts, so mobile inherits. Full-route sweep (24 authed routes × 320–1440px × both themes via an in-page probe): zero horizontal page overflow; the one real layout bug (dashboard chart toggle clipped ~768px — `flex-shrink-0` on a viewport-breakpoint row inside a container-narrow column) fixed.

**Probe trap:** theme-toggle contrast probes must wait >400 ms or `transition-colors` mid-flight values produce false "invisible text" findings — several 1.0x readings were artifacts; always re-verify against code/screenshot.

## 5. AI credits honesty (#28 + #29)

- Companion `/message` had `trackUsage: false` — **all mobile chat and web non-stream sends never moved the counter**. Fixed at the shared client; zero-credit stream shows the real limit message and corrects the badge from the 429 body.
- Server refunds: `aiRateLimitWithCost` refunds non-2xx + restates headers; companion SSE errors refund explicitly (SSE ends as HTTP 200, so the middleware's non-2xx hook never fires); **async 202 jobs refund on permanent failure** — charge stamped on the job record **at enqueue** (post-response stamping races the worker), refund claimed via Redis `SET NX`, the worker `failed` hook covers crashed/stalled jobs, and OCR (costliest, was fully outside the net) refunds on its soft-fail path. Removed a pre-existing **double refund** on the summarize 400 path that minted free credits.
- Credits are visible where they're spent (web companion footer `AIUsageInline`, mobile panel inline badge); a failed send restores the typed message (`failedMessage` store field, both platforms).

## 6. Offline durability (#28 + #29)

- **Web result replay was unlocked and non-idempotent** (audit blocker): Sync button + reconnect auto-sync racing created duplicate sessions and double points → runs coalesce on one in-flight promise; replay no longer re-increments local question stats (submit already counted them — it pushed doubled totals); a permanently-rejected result (4xx ≠ 408/429) is dropped instead of wedging the queue.
- **SW precaches the app shell**: install fetches index.html, parses its `/assets/` URLs as the manifest, caches them; `/assets/*` is cache-first (immutable) with an ok-and-not-HTML guard. **A failed shell precache rejects the install** so activate can't delete the last working cache.
- **Cross-account queues**: `lantern_offline_owner` stamp; login by a different user purges `pendingSyncResults`, `lantern_pending_flashcard_reviews`, `lantern_pending_qbank_scores` + the hydrated store copies. The verification round caught a **stale-closure persist effect** (`useAppEffects` deps `[pendingSyncResults, currentUser]`) that re-uploaded the previous user's queue under the new user — effects that run on user switch must read `useStore.getState()`, not render props.
- **Shared SyncQueue**: transient network errors (`isTransientSyncError`) halt the run without burning retries — but only because **all 9 mobile handlers now rethrow them** (they used to swallow → the queue-side classification was dead code); `failedOperations` drains at boot and on reconnect (`retryFailed()` existed with zero callers); event-type entities (`flashcard_review`, `test_result`) are exempt from enqueue dedupe.
- **Same-card offline reviews all sync**: queued replays call `reviewFlashcard` with **no CAS** — every op of a double review carried the same pre-sync version, so all but one self-409'd (on BOTH platforms). Reviews are events; the server applies each on current state.
- Mobile honesty: "Sync Results" reports synced/remaining; cloud bundle refresh **merges** instead of replacing (a bundle whose fire-and-forget cloud save failed was silently deleted); bundles get an untimed **Study** mode; the offline screen lists all groups (was silently first-5).

## 7. Companion parity (#29)

Mobile chat gained the assistant's **action chips** (nav subset via `navigationRef`: dashboard/chat/flashcards/notes/note-learn), **feedback thumbs** (optimistic + race-safe revert), and bold/bullet/numbered formatting (tiny in-house formatter — deliberately no RN markdown dep because of the EAS slim-lockfile trap). Web renders replies via `react-markdown` **only when complete** (plain + caret while streaming; single newlines become hard breaks outside code fences); Past chats has per-conversation delete (two-tap trash, 4s auto-disarm for Safari); the assistant is named **"Lantern AI"** everywhere; AI Tools CTAs act on the deck/quiz just created.

## 8. Auth funnel (#31 + #32) — audited live on prod

Highlights (full ledger in the PR bodies):

- **Enumeration-protected fake success**: Supabase `signUp` with an existing confirmed email returns `data.user` with `identities: []`, no session, **no email** — users were stranded on verify-email forever. Detected → "already registered, log in instead". A bare 422 is no longer blanket-mapped to "already registered".
- **Signup is 3 fields** (email/password/confirm). Username + names are collected post-signin by `UsernameRequiredModal` (opens on `currentUser && !currentUser.username` — same flow OAuth always used); phone lives in Profile settings. The email-link verification path now creates the profile with the same metadata as the OTP path (it used to drop username/names/phone).
- **No leaks**: login errors generic; login 429 no longer showed *signup* quota copy with internal Supabase-dashboard admin instructions; forgot-password says "If an account exists…" and honors its cooldown on both buttons; reset-password revokes other sessions; the false "requires OAuth configuration in Supabase Dashboard" note under the OAuth buttons is deleted (Google OAuth verified working on prod).
- **Expired links explain themselves**: `#error_code=otp_expired`/`access_denied` hashes are captured in **index.tsx before anything rewrites the URL** (App-level capture is racy — child effects run before parent effects), stashed, routed to `/login`, surfaced. Verified end-to-end on prod.
- **Turnstile is fail-closed client-side** (token required when the widget rendered; ad-blocker load failure passes through so the server toggle decides). The dashboard toggle is **still OFF** — user action.
- Form craft: `new-password` autocomplete on signup, 8-char minimum shown upfront (signup/reset only — login untouched), eye toggles named + `aria-pressed`, `?next=` survives OAuth and signup confirmation (`emailRedirectTo`), open-redirect guards hardened (`://`, backslash), cookie banner sits at the true bottom signed-out, hero CTA reads "Get started free", APK size shown before download.

## 9. USER ACTIONS outstanding (all in `docs/APPLE-SIGN-IN-SETUP.md` / the 🍎 runbook artifact)

1. **Supabase → URL Configuration → add `https://lanternstudy.com/login*` to Redirect URLs.** Until then, the OAuth `?next=` carry silently falls back to the Site URL (affects Google TODAY).
2. Supabase → Attack protection → enable CAPTCHA (Turnstile) — makes the fail-closed client gate authoritative.
3. Supabase → Email provider → password minimum **8** (client + dev config already enforce it).
4. Apple sign-in: App ID + Services ID + `.p8` key (downloadable once) → Supabase Apple provider with `com.lanternstudy.app.web,com.lanternstudy.app` and the client-secret JWT (**6-month expiry — calendar it**; when it lapses, web Apple dies quietly, native keeps working).
5. Apple Developer enrollment + `eas credentials -p ios` → TestFlight for the native Apple button and iOS distribution generally.
6. **PKCE**: one-line flip (`flowType: 'pkce'` in `services/supabase.ts`) prepared but NOT applied — run the runbook checklist **plus** an email-confirmation and reset-link round-trip first (untestable here: account creation is off-limits for the agent).

## 10. Deferred / next backlog

- Real token streaming for the companion (multi-provider failover chain → needs per-provider SSE, mid-stream failover semantics, action-tail parsing).
- Mobile purchased-question-bank updates (web-only today); bundle content-window skew (newest-200 slice); mobile per-row chat delete.
- Landing social proof + product screenshot (no fabricated numbers; needs real assets).
- `finishAuthSession` failure after a successful OTP verify still strands on the auth screen with a spent token (banner no longer lies, but full recovery = route into the app and let boot rebuild the profile).
- Verify-email "Edit email" resends to whatever address is typed — semantics for typo'd signups need a real change-email path.
- Offline-audit mediums not yet done: purchased-bank update parity, download configurator unification on mobile.

## 11. Gotchas confirmed this session

- **Root `npx tsc --noEmit` is a FALSE gate**: ~3.9k pre-existing errors on unmodified main (root tsconfig sweeps api-server tests without jest types). The real gates: `npm run build` (turbo) for web, `apps/mobile` and `apps/api-server` tsc for those. Also: `cmd > log; echo EXIT >> log` wrappers report the wrapper's exit — read the log's EXIT line, never the task status.
- **EAS local builds archive the working tree at start** — uncommitted edits leak into the build. The safe dance: stash → start build → confirm the copy under `/var/folders/.../eas-build-local-nodejs/<id>/build/` predates your edits → pop.
- The browser pane's SPA must be **hard-reloaded** (`navigate force:true`) before probing a fresh deploy — pushState probes happily test the old bundle.
- The pane's prod session expired mid-session; signed-in prod verification needs the user to sign in once (agent cannot enter passwords). localhost:5173 still holds a signed-in session — don't sign it out.
- Turnstile/`health` note: `"turnstile":"enforced"` in `/health` covers only the contact form, not the auth funnel.

## 12. Artifacts & references

- 🏮 **Ship Log** (session dashboard): claude.ai/code/artifact/87011c15-5a4d-4d25-9bed-1eb5c662ca9d
- 🍎 **Apple Sign-In Runbook**: claude.ai/code/artifact/eb83f3ec-025f-4155-bbc3-40e915551736 (mirrors `docs/APPLE-SIGN-IN-SETUP.md`)
- Memory files updated: `lantern-study-exam-lock`, `lantern-study-web-theme-tokens`, `lantern-study-backlog-round` (+ MEMORY.md index)
