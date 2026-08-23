# Handover — Knowledge Network Phase 2 shipped; Phases 3–4 designed, NOT built

**Date:** 2026-08-23
**Branch:** `main` · **HEAD:** `00350b3` (pushed, clean tree)
**Web:** LIVE — https://lanternstudy.com
**API:** LIVE — https://lantern-study-api.onrender.com (`/health` = the deployed short SHA)
**Supabase project:** `tiizkjhbrnaibaagmurl` — the four `20260823*` migrations are applied and verified.

Phase 2 (the creator loop) is **shipped, deployed and verified end-to-end in production**.
This doc is the map for picking up **Phase 3 and Phase 4, neither of which has any code**.

Read `docs/PLAN-2026-08-22-knowledge-network.md` first — §4 is the phase breakdown and
the workstream letters (A–W) used throughout. The Phase-1 handover is
`docs/HANDOVER-2026-08-22-knowledge-network-phase1.md`.

---

## 1. What is DONE (do not rebuild)

| Phase | State |
|---|---|
| **0 — Unblock** | done |
| **1 — Foundations** (A/F academic identity, B library archive, C learning_events, E rights & moderation, D distribution prep) | **LIVE** since `504b32c` |
| **2 — Creator loop** (G study packs, H AI study-product factory, I fee model, J creators) | **LIVE** since `af97879` (+ `8c86c1a`, `00350b3`) |

Phase 2 in one paragraph: students turn notes and decks into sellable **Study Packs**
(`listing_kind='study_pack'`), optionally letting the **AI factory** draft the guide,
flashcards and questions (5 credits, background job). Buyers pay the **list price** and the
platform takes a **15 % creator commission out of the payout** (physical listings keep the
old 5 % buyer surcharge). Buyers get a unified **Purchases** library with update-pull, and
sellers get a public **creator profile** with follows, stats and a trust level.

Contracts: `docs/phase2-creator-loop-contract.md`. Migrations `20260823120000` (study packs),
`121000` (drafts), `122000` (payments split), `123000` (creators) — all applied.

### Verified in production (2026-08-23)
Published a real paid study pack through the UI and traced it end to end: listing created,
preview served from `marketplace_study_packs`, browse finds it under the **Study Packs**
chip, `refresh_creator_stats` populated `creator_stats` (activePacks 2, learnersHelped 1,
avgRating 5, trustLevel `rising`), the seller **Earnings** ledger reads the new split columns
with the backfill correct, the publish modal shows **"You receive ₦1,700 · Lantern fee 15 %"**
on a ₦2,000 pack, and physical checkout still adds 5 % (₦700 → ₦735).
A test listing — *"From: N448_Gas_Exchange_Study_Guide"*, ₦2,000 — is intentionally left live.

---

## 2. Phase 3 — Network (plan §4 L–P). NOT BUILT.

The social/graph layer that makes this a network rather than an app. Nothing below exists.

### L — Communities + discovery (depends on A, J)
- `communities` + `community_members`, auto-membership derived from
  `profiles.institution_id/programme/study_level` + `user_courses`; horizontal communities joinable.
- `groups.community_id/visibility/tags/course_id`; `GET /groups/discover` — **must be a separate
  query + cache key**: `GET /groups` is memberships-only and cached per user.
- **Discover hub** (communities · groups · people · trending). **Decision D12 is still open**:
  does web "Explore" (today = marketplace, `Sidebar.tsx:330`) become Discover with the
  marketplace nested? Recommendation in the plan is yes.
- Web routes in `utils/appRoutes.ts` + Sidebar/BottomNav; mobile screens.
- **Trap:** `profile_visible_to_viewer` treats its "groups" tier as co-membership — fold
  community membership in or private-tier users disappear. Also `validateCreateGroup`'s whitelist.

### M — Academic Feed + counters + presence
- `activity_events(actor_id, verb, object_type, object_id, audience_type community|group|followers|public, audience_id, payload)`
  written at hooks that already exist: pack publish, note share, deck collaborator, challenge
  completed, group join, badge unlock, follow.
- `GET /feed` = followers ∪ my communities ∪ my groups → Feed panel on both dashboards.
  **Keep notifications for direct-to-me events** — per-recipient fan-out is already the
  expensive path.
- Counters `decks.study_count`, `notes.view_count`, `groups.question_count` maintained by the
  same writers ("studied by N").
- Presence-as-intent: extend `POST /users/presence/heartbeat` with `{context, courseId, topic}`
  → `study_presence(expires_at)` → `GET /presence/now?courseId=` ("23 studying cardiology
  tonight"), honouring `showStudyActivity` / `showOnlineStatus`.
- **Trap:** web already holds ~8 realtime channels per user — **the feed must be pull-based**,
  not another channel.

### N — Trust: Verified + trust score + disputes (depends on J, E)
Partly pre-built by Phase 2 J — **check before rebuilding**:
- ✅ already exist: `profiles.email_confirmed_at` / `verification_level`, the `/users/me` sync
  (1 h cached, via `auth.admin.getUserById`), `creator_stats.trust_score` / `trust_level`
  (`new|rising|trusted|verified`) computed by `refresh_creator_stats`, and the Verified badge +
  trust chip on creator profiles.
- ❌ still missing: exposing trust on **seller embeds in listings and search**; the **dispute UI**
  (no client sends `open_dispute` today) plus `dispute_reason/opened_by/disputed_at`; strikes →
  time-boxed suspension wiring beyond what E shipped; the richer verification tiers (D8 v2/v3).

### O — North-Star metric: Weekly Active Learning Connections
- `learning_connections(actor_id, beneficiary_id, kind, object_type, object_id, created_at, week_start generated)`
  inserted from events that already fire: challenge completion, answering a group-mate's
  question, question votes, question VERIFIED, deck-collaborator study, note redemption/copy,
  pack entitlement/score, completed order, review, accepted DM request, follow.
- **Actor ≠ beneficiary; dedupe per pair per week.** Weekly rollup next to `admin_analytics`;
  allow-list new event names in `packages/shared/src/analytics/events.ts`.

### P — Mastery Graph v1 (depends on C)
- `user_topic_mastery(user_id, concept_or_tag, course_id, attempts, correct, accuracy,
  avg_response_s, last_attempt_at, cards_total, cards_mature, cards_due, avg_stability,
  avg_difficulty, leech_count)` materialised **server-side** from full `test_sessions`
  (question tags × answers) + `user_question_stats` + `flashcards.srs_data` — effectively a
  server port of `buildTopicPerformance` + `getDeckCardStats`, refreshed on completion/review.
- Served via `/dashboard/summary` (lean rows currently strip topic insight); feeds
  `companionContext` (replacing the dead `tagBreakdown`) and `/ai/study-recommendations`.
- **Exam readiness** from `user_courses.exam_date` + per-course mastery.
- Population aggregates by course/institution behind a **min-cohort threshold (n ≥ 20)** in a
  service-only RPC modelled on `marketplace_zone_analytics`.
- The `learning_events` log from Phase 1 · C is the input and has been accruing since Aug 22 —
  check how much data exists before designing the rollup.

---

## 3. Phase 4 — Density & intelligence (plan §4 Q–W). NOT BUILT.

- **Q — Campus playbook + referrals/ambassadors.** "Lantern @ UNILAG": seed courses,
  communities, ambassadors, seed creators. `profiles.referral_code` + `referrals(...)`.
  **Attribution must ride `supabase.auth.signUp options.data`** and be consumed in
  `finishAuthSession` / the mobile PostgREST insert — **not `POST /users`**, which neither
  client hits on the real path. Reward on referee *activation*. Abuse note: mobile signup has
  no Turnstile, and Supabase captcha must not be enabled globally.
- **R — SEO campus/programme pages.** `/campus/:slug(/:programme)` guest routes,
  `GET /campuses/:slug/summary`, Pages prerender like `functions/marketplace/listing/[id].ts`,
  sitemap + IndexNow. Seed UNILAG first.
- **S — "Turn My Semester Into Products."** End-of-semester job over `user_courses` + the
  archive proposing N packs with suggested prices → one click creates drafts. **This is a thin
  layer over Phase 2 H** — it should reuse `POST /ai/study-pack/draft` and the drafts screen
  rather than introducing a second factory.
- **T — Learning effectiveness + population intelligence.** Δ-mastery on linked concepts after
  `resource_opened`/`bank_downloaded` vs baseline; per-pack effectiveness on the listing;
  campus demand signals for creators. **Needs C + P to have accrued data** — do not start early.
- **U — Retention loops.** `cron.studyReminders` (due cards / streak at risk via the existing
  `exp.host` sender, idempotent claims like `job_reminders_sent`); `cron.weeklySummary` (Resend,
  honouring `shouldSendWeeklyDigest`); semester recap; Web Push (VAPID) **only once PWA installs
  are measured**; `alumni` derived from `expected_graduation_year`. The cron plumbing exists —
  this is producers, not infrastructure.
- **V — Cross-university study rooms.** Repurpose the dormant `study_sessions` /
  `study_session_participants` tables (extend RLS) + a Supabase presence channel; wire
  `CreateLabModal`; rooms attach to courses/communities, not only groups.
- **W — Physical/merchant commerce — LAST.** Paid boosts, promoted placement, lead-gen and
  merchant tiers, only after digital liquidity per campus is proven.

---

## 4. Decisions still open (plan §6)

| # | Decision | Blocks | Status |
|---|---|---|---|
| D8 | Lantern Verified tiers beyond v1 | N | v1 (email-confirmed + active payout) SHIPPED; v2/v3 undecided |
| D11 | Legal counsel review of the **draft** prohibited-content + seller terms | E (live) | still marked "draft for counsel review" in `legal.ts` |
| D12 | Web "Explore" stays marketplace, or becomes a Discover hub with marketplace nested | L | **open — answer before starting L** |

D1–D7, D9 are settled and implemented. D10 (Play/Apple accounts) is an ops task, §5.

---

## 5. Pending USER / ops actions (not code)

- **Paystack is still in TEST mode.** Live keys need business verification, a live webhook URL,
  settlement-to-balance, and swapping the three Render vars. Until then no real money moves —
  including for study packs.
- **Google Play**: create the Console account (an organisation account avoids the 12-tester /
  14-day gate), decide Play App Signing **before first upload**, add the service account, fill
  the forms from `docs/store/*`. Then `npm run submit:android`.
- **Apple**: Developer Program enrolment, App Store Connect record, `.p8` for Sign in with Apple.
- Once store listings exist, set `PLAY_STORE_URL` / `APP_STORE_URL` in
  `packages/shared/src/linking/index.ts`.
- **Supabase dashboard**: add `https://lanternstudy.com/login*` to Redirect URLs; enable CAPTCHA
  (Turnstile); email password minimum 8; Apple provider; the prepared-but-untested PKCE flip.
- **Legal**: counsel review of the Terms additions before relying on them (D11).

---

## 6. Traps for the next agent

- **Repo:** the real repo is `~/Desktop/lantern-study` (lowercase). `~/Desktop/Lanternstudy` is a
  stale clone that hijacks cwd, worktrees and slash commands.
- **Migrations before API deploy** — the single most important operational rule. The API writes
  new columns unconditionally. Verify with an anon PostgREST probe before deploying:
  `42501` = table/column EXISTS, `PGRST205` = table missing, `42703` = column missing; always
  probe a known-good column as a control. Phase 2 nearly deployed against a half-applied set,
  which would have broken **all** checkout, not just the new features.
- **Web deploys are no longer manual-only** — `deploy-web.yml` works again and its build wins.
  A manual `wrangler pages deploy` can be silently superseded by CI's build of the same commit,
  so the local `dist` hash is NOT what production serves. Verify via
  `wrangler pages deployment list` (top row's commit) **and** by grepping the served bundle.
- **Grep the served bundle with `LC_ALL=C grep -a`** — plain grep dies on minified JS with
  "character not in range" and every check falsely reports MISSING. Lazy-loaded screens live in
  separate chunks, so their strings are legitimately absent from `index-*.js`.
- **Never clear the service worker on a live tab mid-session** — it puts the running app into an
  infinite "Fetching user profile" loop stuck on the auth splash. It is *not* a code regression;
  a clean reload recovers.
- **Root `npx tsc --noEmit` is a FALSE gate** (~3.9k pre-existing errors, wrong tsconfig scope).
  Real gates: `npm run build` (turbo/web), per-workspace `tsc` for `apps/mobile` and
  `apps/api-server`, and jest run **from inside `apps/api-server`** (running it from the repo
  root picks up the wrong babel config and fails to parse the TS tests).
- **Two client trees:** web in root `components/` + `apps/web`, mobile in `apps/mobile` — every
  screen change lands twice or parity drifts.
- **Mobile course filter:** `UNFILED_COURSE_ID` is the **string** `'null'` (truthy). Gate on
  `id !== UNFILED_COURSE_ID` or you send a non-uuid courseId and get a 400.
- **Mobile nav:** there is no root-level `Market` route — use
  `navigate('Main', { screen: 'MarketTab', params: { screen, params } })`.
- **`product_events` is consent-gated + 90-day** — never build learning or trust on it. That is
  why Phase 1 · C added the separate `learning_events` table.

---

## 7. Known gaps in what shipped (small, deliberate)

- **Review-screen section toggles** — publishing from an AI draft uses the whole draft via
  `draftId`; there is no per-section include/exclude yet.
- **Trust is not surfaced on listing seller embeds or search** — only on creator profiles (see N).
- **Study-pack quiz scoring/leaderboards** — question banks have `recordScore` + a leaderboard;
  study packs deliver questions into the offline bundle but have no equivalent scoring surface.
- **`replaceDeckCards` replaces the delivered deck wholesale**, so cards a buyer added to that
  deck are lost on update-pull. Accepted v1 tradeoff of the contract's delivery model.
- **Cross-process delivery race:** the per-buyer delivery mutex is in-process only; two API
  instances could in principle double-deliver a first purchase. Rare on a single Render instance.

---

## 8. Reference index

- **Plan (master):** `docs/PLAN-2026-08-22-knowledge-network.md`
- **Contracts:** `docs/phase1-*-contract.md`, `docs/phase2-creator-loop-contract.md`
- **Handovers:** `docs/HANDOVER-2026-08-22-knowledge-network-phase1.md` (Phase 1), this file (Phase 2 + what remains)
- **Migrations:** `supabase/migrations/20260822{120000..170000}*.sql` (Phase 1),
  `20260823{120000,121000,122000,123000}*.sql` (Phase 2)
- **Copiable migration page:** https://claude.ai/code/artifact/8f4e8519-bac3-442d-8d3f-ffc71fb76aac
- **Store prep:** `docs/store/*`, `docs/RELEASING.md`

*The canonical "resume here" pointer is the repo root `HANDOVER.md`, which links here.*
