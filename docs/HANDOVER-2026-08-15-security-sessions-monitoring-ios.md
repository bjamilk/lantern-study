# Handover — bot protection, cookie sessions, monitoring, first iOS build

Written Aug 15 2026. Everything below is **on `main` and pushed** (level with
`origin/main`, tree clean). Continues
[`HANDOVER-2026-08-11-releases-credits-xp.md`](./HANDOVER-2026-08-11-releases-credits-xp.md).

## Deployment state

- **API → Render: live on `01098c1`.** `curl -s https://lantern-study-api.onrender.com/health`
  now returns three facts, all of which cost a debugging cycle to learn the hard way:

  ```json
  {"status":"ok","commit":"01098c1","turnstile":"enforced","sentry":"on"}
  ```

  Use it. `turnstile` reports `enforced` / `missing-secret` / `missing-hostnames` / `off`,
  so a half-configured deployment is visible without submitting the contact form
  (which delivers a real email — that is how we found it the first time).
- **Web → Cloudflare Pages: live**, entry bundle `index-16JO_u7b.js`. Pages is **not**
  git-connected: `npm run build:web && npx wrangler pages deploy apps/web/dist
  --project-name lantern-study --branch main`. **Verify by bundle hash or behaviour,
  never by the build log** — see Traps.
- **Mobile: 1.0.17 (versionCode 66) SHIPPED**, sha256 `c272accf…09976`, verified by
  downloading from the public latest-URL and comparing byte for byte.
- **iOS: runs locally in the simulator for the first time.** Not distributable —
  see [iOS](#ios-status).

## Commits (oldest → newest)

| Commit | What |
|---|---|
| `81dda81` | Marketplace direct-payment rewrite — **superseded, see `7af658a`** |
| `7af658a` | Restores in-app checkout; keeps demo-mode removal + admin relabel |
| `4cf0552` | 1.0.14 |
| `d281849` | Notes: PDFs/slides open fullscreen and come back |
| `c80b1c2` | Deep links point at a domain that exists; two unused Android permissions dropped |
| `3ad7179` | **Admin console: filters actually refetch**; failures stop blanking tabs |
| `3dbd05d` | Admin: honest email search, bulk-send counts, visible caps |
| `db88038` | **Generated questions: correct answer is no longer always first** |
| `38e5bed` | Dependabot — surface *new* advisories, not only gate known ones |
| `a5dd0cd` | **Turnstile** on the contact form (+ signup widget, held) |
| `01c078a` | `/health` reports Turnstile status; invalid CSP source removed |
| `152c708` | `/health` says *which half* of the Turnstile config is missing |
| `bf0537d` | **Web sessions move to HttpOnly cookies**; localStorage tokens migrate out |
| `cfd5d3d` | Budget reads move off PostgREST; adds the GET route they needed |
| `a3a849f` | **Sentry on** across web/API/mobile; web captures `console.error` |
| `82e1b23` | 1.0.17 |
| `38e9af3` | iOS simulator build script + `RELEASING.md` section |
| `01098c1` | Removes a stray root `app.json` |

## The pre-launch security checklist

Audited against a 20-point list; artifact (private, shareable):
<https://claude.ai/code/artifact/4c17627a-2cc3-4b1c-99a6-e4390765ea65>

**18 pass, 2 partial, 0 missing.** Two verdicts were revised *down* on inspection
and are worth not re-litigating:

- The "10 high npm advisories" are **2 distinct GHSA advisories** in `image-size`,
  reached only through metro/`@expo/cli`, never running in the deployed API or web
  app, both allowlisted with documented unblock conditions. `node scripts/check-audit.mjs`
  passes on its own terms. Do not "fix" these — npm's suggested fix is a downgrade
  to `expo@53`, which would undo the Reanimated 3 / Legacy Architecture pin.
- The wildcard `select('*')` calls reach five tables, every column of which was
  inspected: no emails, credentials, payment or bank data, all user-scoped and
  RLS-scoped. Rewriting them risks breaking consumers for no security gain.

Still genuinely open: **#5 encryption posture** (relies on Supabase at-rest + TLS;
no application-level encryption) and **#17** as described above.

## Bot protection (Turnstile)

Live on the **contact form** and verified in production with a real token minted on
`lanternstudy.com`: genuine token 200, replay 403, fabricated 403. Canonical
server-side siteverify checks `success` + `action` + hostname and fails closed on
every uncertainty including network errors.

**Signup is deliberately unprotected and must stay that way for now.** The widget
ships and sends `captchaToken`, but Supabase's Bot-and-Abuse setting is
**project-wide**: turning it on rejects every `/auth/v1` request without a token.
It was enabled briefly during this session and **broke all logins on web and
mobile** until switched off (the tell is
`{"error_code":"captcha_failed","msg":"captcha protection: request disallowed"}`).
Before it can be enabled:

1. Web **login** and **password reset** need the widget + `captchaToken` (only
   signup is wired today).
2. Mobile needs a **WebView-based** Turnstile flow — React Native cannot render the
   widget natively — shipped in a build and adopted by users.
3. Only then flip the Supabase setting.

Two safety valves exist so a half-configured deploy degrades rather than rejecting
real users: no sitekey → no widget renders; missing `TURNSTILE_SECRET` **or**
`TURNSTILE_HOSTNAMES` → no enforcement.

## Web sessions are now HttpOnly cookies

Auth tokens are out of `localStorage`. The cookie BFF had existed since July but
shipped disabled, blamed on Cloudflare Pages Functions stripping `Set-Cookie`.
**That diagnosis was wrong** — probing production shows both auth cookies pass the
`/api` proxy intact, rewritten to `SameSite=Lax`. The real causes were two of our
own bugs, both fixed in `bf0537d`:

- `GET /session` cleared **both** cookies whenever the access cookie failed
  verification. Access tokens expire hourly, so the 401 that should have triggered a
  refresh destroyed the refresh cookie needed to perform it — every cookie session
  died about an hour after login.
- The client substitutes the placeholder `'cookie-managed'` for the refresh token the
  server never returns to the browser, then exchanged that *back* through
  `/exchange`, overwriting the real refresh cookie with the literal placeholder
  string. Guarded on both sides now.

Cookie mode is the **production default** (`VITE_AUTH_COOKIE_MODE` overrides either
way; dev keeps localStorage). Legacy sessions migrate into cookies on first load and
the localStorage copy is deleted — kept only on network failure, so a Render cold
start delays migration rather than ending a session. Verified live: session survived
the flip, zero tokens in localStorage, refresh rotation works.

`autoRefreshToken` is off in cookie mode (the browser never holds the refresh token),
so a timer refreshes five minutes before expiry with a `visibilitychange` catch-up.

**Consequence worth knowing:** direct PostgREST queries from web race GoTrue session
setup at boot and run as `anon` (42501). Budget reads were moved to the API for
this. `saveUserBudget` is the one remaining PostgREST write on web — user-action
timing, no boot race, but worth moving for consistency.

## Monitoring

Sentry was fully wired on all three tiers and dormant for want of a DSN. Now live:

- **Web** — DSN baked as a committed constant (publishable; ships in every bundle by
  design), plus `captureConsoleIntegration({levels:['error']})`. That last part
  matters: the anon-query regression above was a *handled* failure logged with
  `console.error`, which default Sentry never sees.
- **API** — `SENTRY_DSN` on Render; `/health` reports `sentry: on|off`.
- **Mobile** — DSN baked for release builds, live as of 1.0.17. Verified on Android
  by logcat (`RNSentry: Starting with DSN`) and on iOS by the `SentryCrash` /
  `io.sentry` state files the SDK writes at init.

Sentry is active in **any Release build regardless of app variant** — the gate is
`__DEV__`, not `APP_VARIANT`.

## Admin console

It was wired correctly end to end; the failures were a layer up.

**Every filter was a silent no-op.** `runTabLoad` guarded on refs mirrored from state
*during render*, so they lagged a commit: "invalidate then reload" in one effect saw
the stale `loaded=true` and skipped the fetch. Orders were pinned to
`status=disputed` forever (the network log showed exactly one orders request per
session), and user search, pagination, report-status and both period selectors were
dead. Guard refs are now owned and updated synchronously.

Also fixed: `Promise.all` → `allSettled` so one failing request stops blanking whole
tabs; Overview surfaces failures instead of rendering blank and never retrying; Jobs
mutations can no longer wedge every button disabled; `GET /admin/reports` now selects
`admin_note`/`resolved_at`, which the PUT writes but the GET never returned — the
resolution note, the "[warned]" badge and the CSV column were all permanently empty.

The **AI Ops** pills read event names that no code ever wrote (`companion_message`
vs the real `companion_message_sent`), so three of four were hardwired to zero.

## Practice tests

Generated questions had the correct answer first almost every time — the prompts
taught it, listing the answer as option A in both JSON examples, and models copy the
example's shape. Options are now shuffled after generation (the guarantee; prompt
wording only shifts a bias). True/False keeps conventional order. The shuffle runs
strictly *after* letter answers are resolved to option text, otherwise `"A"` would
point at whatever landed first. `generateQuestionsFromNotes` never called that
resolver at all, so a reply of `correctAnswer:"A"` stored the literal `"A"` — an
answer no choice could match.

## iOS status

**Runs locally in the simulator for the first time**, at 1.0.17 with full feature
parity (the source is shared; there is no iOS feature backlog). Both variants build:

```bash
cd apps/mobile
./scripts/run-ios-simulator.sh              # com.lanternstudy.app.dev
./scripts/run-ios-simulator.sh production   # com.lanternstudy.app, baked endpoints, OTA on
```

`RELEASING.md` documents the four traps the script encodes; the important one is that
**`npx expo run:ios` is broken under Xcode 26** and fails with a *code-signing* error
while never compiling — the real cause is `devicectl`'s changed JSON breaking Expo's
simulator-vs-device detection.

**Not distributable.** No Apple Developer membership ($99/yr) and no App Store Connect
record for `com.lanternstudy.app`, so no device or TestFlight build is possible. That
also blocks `apple-app-site-association` (needs the Team ID), so iOS Universal Links
will not open the app even though `associatedDomains` is correct.

## Outstanding

| Item | Notes |
|---|---|
| **Apply the admin email-search migration** | `supabase/migrations/20260817120000_admin_search_users_by_email.sql` — paste into the Supabase SQL Editor. **Never confirmed applied.** Harmless until then: the route falls back to the old ≤1000-user scan. |
| **Add Google's cert to `assetlinks.json`** | Enrolling in Play App Signing re-signs with Google's key; add its SHA-256 as a *second* fingerprint or Android App Links break. |
| iOS device/TestFlight | Blocked on the Apple membership + interactive login. |
| Supabase captcha sequencing | See Bot protection — do not enable early. |
| `saveUserBudget` | Last PostgREST write on web. |
| `DEMO_MODE` dead code | `false` constants and mock data still in five stores (`testStore`, `flashcardStore`, `budgetStore`, `statsStore`, `marketplaceStore`). Provably unreachable; ~1000 lines. |
| Play Store | Never submitted. 16 KB page size, targetSdk 36, non-debuggable all pass. Needs an **AAB** (only APKs have ever been built) and, for a personal account, 12 testers × 14 days closed testing. |

## Traps (learned the hard way this session)

- **Turbo was blind to two real inputs.** `apps/web/turbo.json` lacked `../../public/**`
  and `../../scripts/**`, so editing `_headers`, `_redirects`, `assetlinks.json` or the
  CSP builder replayed a cached `dist` — a green `FULL TURBO` build shipping the
  previous version of those files. Both added; it fired twice before being caught.
- **A wrangler deploy can fail while printing a log path instead of an error.** Confirm
  with `npx wrangler pages deployment list --project-name lantern-study`; a `Failure`
  row is the only tell. One deploy this session failed with an internal Cloudflare
  error and the retry succeeded.
- **The browser pane's console recorder never resets.** It accumulates for the life of
  the tab; `console.clear()` and reloads do not clear it, so the same errors re-read
  identically forever. Hours were lost chasing "recurring" 42501s that happened once.
  Verify by network log or fresh in-page fetches, never by re-reading console errors.
- **`select('*')` counts mislead.** 14 call sites resolved to 5 distinct tables.
- **npm audit counts mislead.** 10 "high" entries were 2 advisories propagated through
  a dependency chain.
