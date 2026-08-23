# Handover — Phase 4 Q + R SHIPPED and E2E-verified

**Date:** 2026-08-23 · **Branch:** `main` · **HEAD:** `276ce5c`
**API:** live on `d1aeef5` · **Web:** live

Phase 4 is plan §4 **Q–W**. This session built **Q**. See
`docs/HANDOVER-2026-08-23-phase3-network.md` for Phase 3.

---

## 0. Migration state

`20260825120000_referrals.sql` is **APPLIED** (verified: `referrals` table and
both functions return `42501`). The only outstanding migration in the whole
programme is now **step 7**, `20260824126000_drop_notes_view_count.sql` —
not deploy-blocking.

Runbook: https://claude.ai/code/artifact/d76bc8e5-83ad-424b-9314-b3b178b4bd26

---

## 1. Scope decision

| Workstream | State | Why |
|---|---|---|
| **Q** Campus playbook + referrals | **SHIPPED** | this session |
| **R** SEO campus/programme pages | **SHIPPED** | this session |
| **S** Turn my semester into products | not started | thin layer over Phase 2 H |
| **T** Learning effectiveness | **DEFERRED — plan-gated** | "needs C + P to have accrued data". `learning_events` has ~2 days; `user_topic_mastery` was first populated 2026-08-23. Building now would fit a model to noise. |
| **U** Retention loops | not started | needs retained users |
| **V** Study rooms | not started | needs density |
| **W** Physical/merchant commerce | **DEFERRED — plan-gated** | "LAST, only after digital liquidity per campus is proven". Paystack is still in TEST mode and zero communities exist. |

Reward decision (user): **wallet coins to both sides on referee activation.**

---

## 2. The attribution finding — the important part

**The plan's stated consumption point was wrong and would have silently lost
most referrals.** It said to consume the referral code in the web client's
`finishAuthSession`. Two independently fatal problems:

1. `handle_new_user()` — an `AFTER INSERT` trigger on `auth.users` — already
   creates the `profiles` row **at signup time, before email confirmation**. So
   `finishAuthSession`'s "profile missing → build it from metadata" branch is
   **already dead code** on the real path. Anything hung off it never runs.
2. Confirming by **clicking the emailed link** lands on `/login#access_token=…`,
   which `detectSessionInUrl` consumes; `onAuthStateChange` sets the user and
   `App.tsx` stops rendering `AuthScreen` — so `finishAuthSession` **never
   runs**. Only the 6-digit OTP paste path reaches it. The repo had already
   learned this once (`useAppEffects.ts:476`).

**What was built instead:** attribution is consumed in the trigger. Server-side,
`SECURITY DEFINER`, fires exactly once per user, identical for web, mobile, OTP
and email-link flows. The clients only *attach* the code to `signUp` metadata.

---

## 3. What shipped

- **Migration `20260825120000`**: `profiles.referral_code` (case-insensitive
  unique) + `is_ambassador`, a `protect_referral_fields` trigger (mirroring the
  Phase 2 J fix for `verification_level`), `generate_referral_code()`, the
  `referrals` table, `handle_new_user()` extended, a backfill, and
  `referral_activation_check()`.
- **`services/referrals.ts`** — summary, lazy code minting, ambassadors, and
  `checkActivation()` which pays both sides.
- **Routes** `GET /api/v1/referrals`, `GET /api/v1/referrals/ambassadors`.
  Deliberately **no** endpoint to claim a referral.
- **Clients**: web `AuthScreen` reads `?ref=` (mirrored into sessionStorage so it
  survives the login↔signup toggle and the confirmation bounce); mobile
  `SignUpScreen` reads it from the invite deep link. New web
  `InviteFriendsScreen` + `AppMode.INVITE_FRIENDS` + `/invite` + sidebar entry.

### The three rules that make it hard to abuse
1. **Signup is worth nothing.** Mobile signup has no Turnstile, so anything
   payable at signup is free money for a script. The reward needs *activation*.
2. **Activation is measured on `learning_events`** — the only engagement signal
   safe to hang money on, because it is written solely by the service-role
   client with grants revoked from `anon`/`authenticated`. By contrast
   `POST /gamification/activity/record` takes `{type, amount}` as a pure client
   assertion and mints XP and coins from it.
3. **It counts distinct days of `created_at`, never `occurred_at`.**
   `occurred_at` is client-supplied (`validateFlashcardReview` accepts any ISO
   string with no window check), so a distinct-days test on it is forgeable in a
   single HTTP burst.

Idempotency is layered: `rewarded_at` short-circuits; `wallet_award_once` keyed
on the referral id is the real guard; `referee_id` is `UNIQUE` so nobody can be
referred twice, ever.

---

## 4. Verification

**13/13 against Postgres 16 (PGlite)**, including: a wrong code still creates the
account; self-referral records nothing; a 12-event single-day burst does **not**
activate; forged `occurred_at` across 12 days does **not** activate; a client
cannot self-grant ambassador or squat a code.

Gates: API tsc 0 + 107 suites/715 tests; shared 72/628; web build 3/3; mobile
tsc 0. Production after deploy: `/referrals` 401 (live, auth-gated), no
regressions.

**Not verified:** no E2E — the migration is unapplied, so no referral has been
recorded end to end. The mobile deep-link path has not been exercised on device.

---

## 5. R — what shipped (`276ce5c`)

- **`services/campusSummary.ts`** + public `GET /api/v1/campuses/:slug/summary`
  and `GET /api/v1/campuses`, mounted with the public rate limits.
- **`functions/campus/[slug].ts`** — bot prerender mirroring
  `functions/marketplace/listing/[id].ts`; every failure path is
  `context.next()`. `public/_routes.json` already includes `/*`.
- **`/api/v1/sitemap/campuses.xml`**.
- **`components/CampusScreen.tsx`** + `AppMode.CAMPUS_PAGE` + guest visibility
  via `isPublicAppPath`.

**The rule it is built around:** the API client uses the **service role**, so it
bypasses RLS entirely and every protective policy is inert. Each query
hand-writes `active`, `status='active'`, `visibility='public'`, `kind <> 'other'`.
The page exposes aggregate counts, course codes and programme names only — no
names, avatars, ids or user content. Programme names carry **no counts**, because
at a small campus "1 student studies X" identifies a person.

### E2E verified in production
- `GET /campuses/:slug/summary` **200 without any auth header**; response scanned
  for `email`/`avatar`/`user_id`/`phone`/`settings` — **none present**.
- Unknown slug → **404**, not 500.
- `sitemap/campuses.xml` generating real campus URLs.
- **Bot UA** gets `<title>AbdulKadir Kure University — study groups, past
  questions & notes</title>` and a campus-specific description; **human UA** gets
  the SPA shell. The bot/human split works.
- The page renders with real data (Minna, Niger · 2 listings · Join your campus).

### Not verified
- **Guest rendering.** Both browsers available were signed in, so `/campus/:slug`
  has only been seen as a logged-in user. The route is allowed by
  `isPublicAppPath` and the bot path is confirmed, but a real logged-out visit is
  unverified.
- **IndexNow** was not wired into `deploy-web.yml` — sitemap only.
- No `/campus` index page; only `/campus/:slug`.

## 6. Q — E2E verified in production
- Migration applied; `referral_code` backfilled (`GET /api/v1/referrals` returns
  a real code, e.g. `3HYKM7Q`).
- The Invite screen renders the link, the stat tiles and the honest activation
  explainer.
- **A referral has NOT been recorded end to end** — that needs a real signup, and
  creating a throwaway account on production is the account owner's call. The
  trigger logic is proven 13/13 in PGlite, and the referral insert is wrapped in
  `EXCEPTION WHEN OTHERS` so it cannot block a signup even if it errors.

### Fixed during the E2E (`59bfaeb`)
`readReferralCode()` only ran at signup submit and stashed as a side effect, so a
link landing on `/`, `/welcome` or a campus page lost the attribution before the
user ever reached the form. Capture now happens once at app boot in `index.tsx`
via `utils/referral.ts`, is cleared after signup, and lives in sessionStorage so
it cannot claim an unrelated signup weeks later. This also revived
`utils/xhrHeaders.test.ts`, which had never run — the vitest `include` omitted
`utils/`. Web suites are now 17 files / 115 tests.
