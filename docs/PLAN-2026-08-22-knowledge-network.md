# Lantern Knowledge Network — implementation plan

**Date:** 2026-08-22 · **Repo:** `~/Desktop/lantern-study` @ `a7d5f98` (main; prod web + API at `04404b1`)
**Inputs:** (1) the ChatGPT thread *"Abstract and Conclusion Draft"*, turns 13–20 — the Lantern-related part is extracted in Appendix A; (2) a 14-agent explore → adversarial-verify gap analysis of this codebase against the strategy (7 pillars, ~400 `path:line` citations re-opened by the verifiers). Every "exists / partial / missing" claim below is grounded in that analysis; file references are repo-relative.

---

## 0. TL;DR

**The strategy, in its final form (turn 20 supersedes 16 supersedes 14):** Lantern is *the academic social and commerce network for students*. Students use Lantern **free, permanently**, to study; their academic work accumulates in a **course-organised archive**; AI turns that archive into **sellable study products**; creators build **reputation** and **earn** (80–85 % to the creator); students **connect across universities and countries**; the platform monetises **marketplace commerce — digital-first** — never student subscriptions, never personal data. The long-run asset is four linked graphs (learning, content, social, commerce) that a Meta/LinkedIn-class acquirer cannot cheaply recreate.

**Where the code is today:** a strong study toolset, plus a *real, shipped* digital-product pipeline for exactly one product type (group question banks → listing → entitlement → delivery into the buyer's offline bundles, previews, versioning, leaderboards), Paystack checkout (test mode), groups/chat/DMs/notifications, a web admin console, first-party analytics, a working PWA. What is missing is the entire *network* layer: **no academic taxonomy** (no university/faculty/course on profiles or content — the only institution table is `marketplace_campuses`), **no follow graph**, **no public academic profile**, **no community directory or feed**, **no learning-event log** (FSRS state is overwritten per review; nothing is append-only), **no persisted rights/provenance**, **no store distribution** (direct APK only).

**The plan:** four phases over ~6 months, ordered so each phase keys on the one before.

| Phase | Window | Theme | Ships |
|---|---|---|---|
| **0** | this week | Unblock | pending migrations, accounts (Play/Apple/Paystack-live), the 12 decisions in §6 |
| **1** | weeks 1–4 | Foundations | academic identity + **Course entity**, Library-as-archive, **learning_events** log, **store distribution**, rights & takedown hygiene, onboarding rewrite |
| **2** | weeks 5–8 | Creator loop | **Study Pack** product, **AI Study Product Factory**, creator-side **fee model**, **creator profiles + follows**, buyer-library parity |
| **3** | weeks 9–12 | Network | **communities + discovery**, **Academic Feed** + presence, **Lantern Verified + trust score**, reports/disputes/strikes, **North-Star metric**, **Mastery Graph v1** |
| **4** | months 4–6 | Density & intelligence | campus playbook + **referrals/ambassadors**, SEO campus pages, **"Turn My Semester Into Products"**, effectiveness scores + population intelligence, retention crons, cross-university rooms |

**Bugs found on the way** (fix regardless): admin takedowns are seller-reversible; admin "Grant badge" writes to tables that don't exist; the AI study coach is fed mislabelled inputs and the companion's weak-topic code reads a field nothing produces; question-bank buyers on mobile can't pull updates; the root `HANDOVER.md` still says the question-bank migration is unapplied (it is applied). Details in §2.3.

---

## 1. The thesis we are adopting (from the thread)

The thread contains three escalating answers to three questions (full extract: Appendix A). Where they conflict, the latest wins:

1. **Turn 14 (critique):** Lantern scores well on concept/breadth/Africa-fit (8–9/10) and badly on differentiation (5), distribution (3: direct APK), monetisation (3) and data moat (2 today, "10 if designed right"). AI flashcards are commodity; the defensible combination is *Africa + offline + campus communities + collaborative study + local content + marketplace*. Indicative valuation $1.5–3 M pre-money; Tekedia fit 6/10 — pitch "Africa's learning graph", not "AI flashcards", and not before there are numbers. **Don't sell student data — build the Learning Graph** (Student → Institution → Course → Module → Concept → Resource → Question → Attempt → Mastery → Outcome).
2. **Turn 16 (after "students won't pay"):** students free forever; *Lantern Study → Lantern Network → Lantern Marketplace*; monetise supply side + transactions (commission, promoted listings, storefronts, lead-gen, escrow fees…); the moat is the aggregate **Student Intent Graph** (learning ⨝ commerce); build **hyperlocal density** ("Lantern @ UNILAG") before breadth; **Lantern Verified + Trust Score**; metric = **GMV**.
3. **Turn 20 (after "archive notes into sellable products + cross-university network + exit to a social platform"):** the product is a **student-owned knowledge network** — *My Lantern Library* (permanent course-organised vault) → *AI Study Product Factory* → *Student Creator* profiles (follow / buy / ask / message) → *Academic Social Graph* + hierarchical and horizontal **communities** → **digital-first marketplace (70–80 %)** with an 80–85/15–20 creator split → a serious **Content Rights System + Provenance record** (the biggest hidden legal risk) → **Academic Feed**, AI as the network's intelligence layer, alumni continuity, and **North Star = Weekly Active Learning Connections**. 12-month roadmap: archive + creator profiles → factory → digital marketplace → follows/feed → dominate 3–5 universities → communities → Verified → Ghana/Kenya/Uganda → cross-university rooms → physical categories last.

**What survives all three and becomes non-negotiable:** store distribution in month 1 · instrument everything · campus-by-campus density · a privacy-preserving learning graph / mastery model · verification & trust infrastructure · no PII selling · positioning as *the learning network for African universities*.

**What we explicitly drop** (recommended by turn 16, confirmed by you): paid student tiers, premium AI tiers, paid flashcards/plans, and university-SaaS as the *primary* engine.

---

## 2. Where Lantern stands today (verified)

### 2.1 Capability matrix

| # | Pillar | Status | What exists (cite) | What's missing |
|---|---|---|---|---|
| 1 | **Academic archive & course taxonomy** | 🔴 missing | Notes in user folders (`note_folders.parent_id` nestable in DB/API, flat in UI); decks flat; `flashcards.tags` stored but no UI; group-question tags free text inside `messages.question_data`; tests keyed to *group* (`TestConfig.groupId`); **`marketplace_campuses`** (~370 NG campuses) used by listings/jobs and an optional `settings.marketplace.campus_id`; web Library = Notes + Flashcards tabs; client-side notes-only search. | **No Course entity, no course FK anywhere, no institution/faculty/programme/level on `profiles`** (verifier grepped all 155 migrations); onboarding asks goal + streak only; no semester archive; no cross-artefact server search. |
| 2 | **Digital products & commerce** | 🟡 partial | One digital kind: `listing_kind='question_bank'` → `marketplace_question_banks` (frozen `{config,questions}`), `…_entitlements`, delivery = `offline_bundles` row `qbank-<listingId>` (idempotent), previews (allow-list sanitiser), versioning + optimistic lock + buyer update pull (web), restore/self-heal, leaderboards, publish/update UIs web + mobile. Paystack checkout, HMAC webhook, instant digital fulfilment, refunds/disputes, payout profiles (Paystack-verified), coupons, free boosts, seller analytics. AI stages exist separately (summarise 1–3 cr, flashcards, questions, OCR 2 cr, PDF/PPTX/YouTube/audio import, listing description) behind 20 credits/day. | No way to sell a **note**, **deck**, PDF, video or service; no **Study Pack**; no server-side chained **factory** (client-side Import & Study only, each stage a separate charge, partial work lost on failure); **fee model is a 5 % *buyer* surcharge and the seller keeps 100 %** (strategy wants 15–20 % *creator-side*); no revenue split; free-download owners can't review (order-based eligibility); cart path not digital-aware (server-side only — clients hide it); mobile can't pull bank updates. |
| 3 | **Creator identity, reputation, trust** | 🟡 partial | Username system; privacy/discoverability settings; **seller profile** (web + mobile) with per-request avg rating, `isVerified` heuristic (≥5 sold ∧ ≥4.5★ ∧ ≥3 reviews), trusted/top-seller badges; shop storefront; listing-scoped reviews with verified-purchase gating; Paystack payout profile `verified_at` (KYC-lite); employer (job company) verification + admin queue; user blocks; listing/job reports; admin ban; XP/badges/streaks/activity; notifications table + Expo push. | **No follow/followers model** (zero hits); no academic public profile (only seller profile); no bio/university on profile; no persisted trust score; `TRUSTED_SELLER` badge metrics never computed; admin `awardBadge` targets non-existent `user_badges`/`badges` tables; email confirmation never surfaced as a signal; no user/DM reports; disputes have **no client entry point** (`open_dispute` unsent by any screen) and no reason/evidence columns; mobile drops the `isVerified` pill. |
| 4 | **Social graph, communities, feed** | 🔴 missing | Groups (admins, permissions, pending invites, invite links, subgroups on **both** platforms), chat + DMs with realtime/typing/read/threads/mentions/edit-remove audit/mutes/message requests, presence heartbeat, username search, async challenge duels, notification centre, shared decks + collaborators, note share links with copy provenance, question-bank publish, gamification. | `GET /groups` returns **only the caller's memberships** (no directory, visibility flag, tags, course/university); no communities entity; no feed (notifications only); no "studied by N" counters; presence has no study context; study rooms are stubs (`study_sessions` tables have zero code refs; `CreateLabModal` returns null); no actor→beneficiary event table for the North Star. |
| 5 | **Rights, provenance, moderation** | 🟡 partial | Listing + job reports with admin triage; web admin console (users/ban/role, listing remove/suspend, disputes, reports, groups, messages, decks, jobs, AI ops, audit log); legal pages (privacy/terms/cookies) web + mobile; question-bank publish has an originality checkbox; notes `source_type`/`copied_from_note_id`/`version`; AI disclaimers + prompt-injection guard; a server-enforced scam phrase filter **for jobs** (`scamPlaybook.ts`). | **Attestation is client-only** (not in payload, not in DB); **Terms are a template** with no IP/copyright, notice-and-takedown, repeat-infringer, academic-integrity or prohibited-content sections; only listings/jobs reportable (no notes/decks/users/groups/DMs; "flag as similar" is a counter with no threshold/queue); **admin takedowns are seller-reversible** ("Mark Active" + `PUT /listings/:id/status` only check ownership; jobs board already locks these states); no AI/originality/rights/sources fields on any content; no strikes; no seller takedown notice/appeal. |
| 6 | **Telemetry, learning graph, mastery** | 🟡 partial | First-party consent-gated tracker → `POST /analytics/events` → `product_events` (21 allow-listed events, 90-day purge, service-role only); `ai_analytics`, `ai_inference_log`; Sentry; FSRS state in `flashcards.srs_data` (overwritten per review, CAS); `test_sessions.user_answers` (correctness + response time, web **and** mobile); `user_question_stats`; `study_activity`/streaks/quests/XP; client-side per-tag mastery (`buildTopicPerformance`) + AI study coach; admin analytics RPC (DAU/WAU/MAU, cohorts, funnels, GMV by campus). | **No append-only learning-event log** (every review without a log is unrecoverable data); tags free text; **AI-emitted `difficulty` discarded on save**; mastery computed on-device and **stripped by lean loads**; `companionContext` reads `result.tagBreakdown` which nothing produces (server weak-topics always empty); AI coach callers pass *streak* as `studyHoursThisWeek` and test accuracy as `flashcardAccuracy`; no exam date anywhere; **`product_events` already powers seller conversion + trending sort, so consent rate silently biases product features**; RoPA/privacy docs don't mention `product_events`. |
| 7 | **Distribution, onboarding, growth** | 🔴 weak | Android APK via public releases repo + landing link; EAS config (package id, app links + `assetlinks.json`, OTA); iOS simulator build + TestFlight/Apple-sign-in runbooks; **PWA** (manifest + app-shell precache SW, installable); web onboarding 3-field signup → OTP → `UsernameRequiredModal` → 6-step `OnboardingFlow` with AI starter deck; streaks/quests/daily quiz; Expo push for whitelisted types; Resend email (job alerts/contact only); guest marketplace/jobs/seller pages with bot prerender + OG + dynamic sitemaps; account pause/delete/export/import; `weeklyDigest` setting + server policy (no producer). | **Play Store never submitted** (no AAB ever built, `submit.production` empty, keystore state unknown, `assetlinks.json` needs Google Play App Signing cert, 12 testers × 14 days closed testing, no data-safety doc / screenshots / feature graphic); iOS blocked on Apple membership; PWA lacks maskable icons/screenshots/shortcuts/install prompt/**Web Push**; **no university/course capture at signup**; mobile signup 7 fields with `+1` default and no starter-deck step; no referral codes/attribution/rewards; no ambassador role; no SEO campus/course pages; no server-scheduled reminders (`srs_reminder` type whitelisted, nothing produces it); landing H1 is the brand name, no social proof, no store badges; deploy-web.yml doesn't call `seo:notify`. |

### 2.2 Things the analysis found that we can *reuse verbatim* (don't rebuild)

- **The question-bank pipeline is a Study Pack pipeline with one content type.** `grantEntitlement` (idempotent via deterministic bundle id + `UNIQUE(user_id,bundle_id)`), `restoreEntitlements`, `fulfillQuestionBankOrderIfDigital`, `listAvailableUpdates`, `updateQuestionBankContent` (optimistic lock), the preview allow-list (`utils/questionBankPreview.ts`), publish modals on both platforms, the RPC digital branches — all extend to a second kind. Delivery primitives for the other content types already exist: `exportDeck`/`importDeck` (frozen deck JSON → new deck), `POST /notes/:id/copy` (+ `copied_from_note_id` provenance).
- **`marketplace_campuses`** is the institution table (name/city/state/country_code/slug/geopolitical_zone, ~370 NG rows, public-read RLS, `GET /marketplace/campuses` unauthenticated + cached). Promote it; don't create a parallel one.
- **`user_blocks`** is the exact shape for `profile_follows` (pair PK, no-self CHECK, owner-side RLS); `search_users` already excludes mutual blocks — reuse the predicate.
- **`marketplace_search_listings`** (weighted tsvector + `pg_trgm` GIN + RPC) is the pattern for `/library/search` and for course typeahead — `pg_trgm` is already enabled.
- **AI topic → tag pipeline** exists on both platforms (server stamps `topic = q.topic || subject || 'General'`; clients save `tags:[topic]`) and **`buildTopicPerformance`** already drives "Topic insights" on web + mobile — fold into `concepts`/`course_topics` rather than start clean.
- **`product_events`** has a `campus` column and `admin_analytics` v3 already computes acquisition funnel + D1/D7/D30 cohorts + study funnel — extend for activation/campus funnels; but *do not* put learning events there (consent-gated, 90-day, anonymous-events promise).
- **Jobs board moderation** already has the two things the marketplace lacks: a status-transition table that locks `suspended_by_admin`/`removed_by_admin` against the owner (`packages/shared/src/jobs/lifecycle.ts` `EMPLOYER_TRANSITIONS`, enforced at `jobsBoard.ts:1311`) and a server-enforced phrase filter (`packages/shared/src/jobs/scamPlaybook.ts`, enforced on create/update/apply/headline). Copy both.
- **Notifications** table + routes + realtime + Expo push; **BullMQ cron** registry (`apps/api-server/src/queue/processors/index.ts:495-514`) + idempotent reminder-claim pattern (`job_reminders_sent`); **Resend** transport; **`shouldSendWeeklyDigest`** policy. Retention loops are plumbing-complete minus producers.
- **Shop browse** (`GET /marketplace/shops`: avgRating/totalReviews/campusLabel/activeListingCount, rendered on both platforms) is a working creator directory to extend.
- **Seller `isVerified` heuristic + badges**, **wallet coins** (`walletService`, streak/quest rewards), **XP leaderboard** (API + mobile screen) — bases for Verified/ambassador/referral rewards.
- **Dormant `study_sessions` / `study_session_participants`** (RLS present, zero readers/writers) — repurpose for study rooms or drop; don't name anything new "study_sessions".

### 2.3 Defects surfaced (fix regardless of the plan)

| Defect | Evidence | Fix |
|---|---|---|
| **Seller can reverse an admin takedown.** `MyListingsScreen` shows the raw `removed_by_admin` status and offers "Mark Active"; `PUT /marketplace/listings/:id/status` and the generic `PUT /listings/:id` (`assign('status')`) only check ownership; no DB trigger. | `components/MyListingsScreen.tsx:491,570-577`; `apps/api-server/src/routes/marketplace.ts:1237-1254,455-476`; `apps/api-server/src/services/supabase.ts:10631-10655,9457` | Shared listing-status transition table modelled on `jobs/lifecycle.ts:40-54`; enforce in `updateListingStatus`/`updateMarketplaceListing` + a BEFORE UPDATE trigger; render a proper "Removed by Lantern — reason" state. |
| **Admin "Grant badge" is broken.** `awardBadge` reads/writes `user_badges`/`badges` — no migration creates them; badges live in `profiles.badges` JSONB. | `apps/api-server/src/services/supabase.ts:7007-7045`; `admin.ts:1159-1176`; `components/admin/UserDetailDrawer.tsx:150-171` | Rewrite to `profiles.badges` (service-role) or remove the route. |
| **`TRUSTED_SELLER` / `MARKETPLACE_SELLER` / `OFFER_MAKER` badges are inert** — `recomputeDerivedUserStats` never derives `listingsCreated/listingsSold/fiveStarReviews/offersMade` (a test asserts this). | `supabase.ts:7211-7300`; `badgeStatsRecompute.test.ts:171-181` | Extend the recompute (sources: listings, orders, reviews, offers). |
| **AI study coach gets mislabelled inputs**; **companion weak-topics dead code.** Web passes `studyHoursThisWeek: studyStreak` and test-tag accuracy as `flashcardAccuracy`; mobile same; `companionContext.ts:81-93` reads `result.tagBreakdown` (no producer). | `components/DashboardScreen.tsx:1330-1341`; `apps/mobile/src/components/dashboard/AIStudyCoachCard.tsx:39-46`; `apps/api-server/src/services/companionContext.ts:81-93` | Fixed for real by Mastery Graph v1 (§4 P); short-term: pass honest fields, drop the dead read. |
| **Mobile buyers can't pull question-bank updates** (web-only `fetchQuestionBankUpdates`). | `components/OfflineModeScreen.tsx:64`; `apps/mobile/src/screens/settings/OfflineScreen.tsx` (no import) | Part of §4 K. |
| Free-download owners can't review (order-based eligibility); cart service has no `listing_kind` guard (clients hide it; API doesn't). | `supabase.ts:9636-9670`; `marketplaceCart.ts` | Entitlement-based eligibility; server guard. |
| `HANDOVER.md:43` says `20260818…` "still awaiting hand-application" — it is applied (E2E-verified 2026-08-16; `components/admin/productFeatures.ts:382`). | — | Correct the row. |
| Mobile `SellerProfileScreen` maps `is_verified` but never renders it. | `apps/mobile/src/screens/marketplace/SellerProfileScreen.tsx:196-245` | Render with the badges. |
| Mobile signup: no Turnstile, `+1` default country, 7 required fields vs web's 3. | `apps/mobile/src/screens/auth/SignUpScreen.tsx:131-145,252-261` | Part of §4 F. |

### 2.4 Migration state (for sequencing)

Applied in prod: `20260818120000` (question banks), `20260819120000` (leaderboards), `20260821130000` (listing `archived`/admin statuses), `20260821140000` (budget recurring). **Unconfirmed:** `20260821120000` (orders→listing FK RESTRICT backstop). Every new migration in this plan sequences **after `20260821140000`** and is hand-applied in the Supabase SQL editor (Pages/Render never apply migrations).

---

## 3. Design decisions the analysis settles (my recommendations)

1. **Institution = `marketplace_campuses`, promoted.** Add `kind` (`university|polytechnic|college|other`), exclude the sentinel rows (`other-city-nigeria`, per-city "Other" — `packages/shared/src/marketplace/campuses.ts:18-19`, `20260721090000`) from an `institutions` view; **backfill `profiles.institution_id` from `settings->'marketplace'->>'campus_id'`** and make the profile column the single writer (web `SettingsModal.tsx:602-617`, mobile `SettingsScreen.tsx:220-229` both currently write the JSONB). Pan-African coverage = seed rows, not a new table.
2. **Courses are canonical per institution** (`UNIQUE (institution_id, lower(code)) WHERE is_canonical` — as a `CREATE UNIQUE INDEX`, not inline) with user-created non-canonical rows merged by admins/usage. Canonical courses are what make "Turn My Semester Into Products", population intelligence and cross-student discovery possible. **Faculty/programme start as text on the profile**; a `faculties` table can come later.
3. **Study Pack = a new `listing_kind='study_pack'`**, content in a new `marketplace_study_packs` table mirroring `marketplace_question_banks`, **entitlements table reused as-is** (keys on `listing_id,user_id`) plus a `delivered_refs jsonb` column so deck/note delivery is idempotent. Accept the fan-out (every `listing_kind === 'question_bank'` literal: `isQuestionBankListing`, download, preview, `/listings/:id/full`, the offer block, both RPCs, shared type union, both clients) — overloading `question_bank` with a sub-kind would conflate the products in UI copy and in the `qbank-` bundle prefix.
4. **Fee model: creator-side take on digital products** — `MARKETPLACE_CREATOR_FEE_BPS` (recommend 1500 = 15 %), seller payout = `item_amount_kobo − platform_fee_kobo`; **drop the buyer surcharge for digital** (students pay list price; "students pay ₦0 to use Lantern, creators pay a commission" is the clean story). Keep the 5 % buyer surcharge on physical until you decide otherwise. This touches the `marketplace_payments` CHECK (`total = item + fee`), `transferSellerPayout`, `refundPaymentForOrder`/`payoutOnConfirmReceived`/`forcePayoutForOrder`, `/payments/config`, and fee copy on both clients — see §6 D1.
5. **`learning_events` is a separate, server-written, append-only table with a product-data legal basis** — *not* `product_events` (consent-gated, 90-day, "anonymous product events" promise). Update `legal.ts`, the privacy policy and `docs/compliance/ropa.md` (which doesn't even list `product_events` yet).
6. **Communities are a new entity layered over groups**, not a tagging hack: `communities(kind: country|university|faculty|programme|year|course|topic|horizontal, parent_id, slug)` + `community_members` with **auto-membership derived from profile/course fields**; a community may own a group for chat. Groups gain `visibility (private|unlisted|public)`, `tags`, `course_id`.
7. **Public profile = extend the seller profile into a Creator profile**; earnings stay owner-only (SEC-08 in `marketplace.ts:2452`); "learners helped", packs, rating, followers, university/programme become public (respecting `profileVisibility`).
8. **Lantern Verified tiers:** v1 = email confirmed (sync `auth.users.email_confirmed_at` into a column via the `auth.admin.getUserById` pattern) + active Paystack payout profile; v2 = institution email-domain match; v3 = student-ID review queue (new bucket + admin queue, modelled on job-company verification).
9. **Rights gate on `listing_kind` (and a `digital`/`is_academic_content` flag), never on `category`** — the category CHECK was dropped in `20260401000000`; sellers can publish notes under any custom category.

---

## 4. The plan

Legend per workstream: **Goal · Build · Reuse · Gotchas · Done when.** Workstreams within a phase can run in parallel; phases are sequential because of data dependencies (A → everything; C → O/P/T; G → H/S; J → L/M/N).

### Phase 0 — Unblock (this week)

- Confirm `20260821120000` applied (`SELECT conname FROM pg_constraint WHERE conname LIKE 'marketplace_orders_listing%'`); correct `HANDOVER.md:43`.
- Accounts: **Google Play Console** (organisation account avoids the 12-tester/14-day gate) · **Apple Developer Program** · **Paystack business verification** for live keys (test-mode checkout is verified E2E; go-live needs registered-business docs, live webhook URL, settlement).
- Decide §6 D1–D12 (fee model first — it changes Phase 2 scope).
- Legal: engage counsel for Terms IP/takedown/repeat-infringer/academic-integrity sections and a designated notice address (`legal.ts:229` says "template pending counsel").

### Phase 1 — Foundations (weeks 1–4)

**A. Academic identity + Course entity** — *the keystone; everything else references it.*
- Build: one migration — `marketplace_campuses.kind` + `institutions` view; `profiles` + `institution_id FK`, `faculty text`, `programme text`, `level smallint`, `entry_year smallint`, `expected_graduation_year smallint` (backfill `institution_id` from settings JSONB); `courses(id, institution_id, faculty_id?, code, title, level, semester, created_by, is_canonical)` + trigram index on `code||' '||title`; `course_topics(course_id, title, position)`; `user_courses(user_id, course_id, academic_year, semester, status active|archived, exam_date)` — *archiving a semester = `status='archived'`, no data moves*. Nullable `course_id` (+ optional `topic_id`) on `notes`, `note_folders` (a folder can *be* a course), `decks`, `groups`, `test_sessions` (retire the dead `config->>subject` path: `tests.ts:55`, `supabase.ts:5633`, `/tests/stats/subject`), `offline_bundles` (also write `config.courseId` in `hooks/useOfflineHandlers.ts:161`), `marketplace_listings` (replaces free-text `category_specific_fields.courseCode/year/semester`), `marketplace_question_banks` (inherit from listing at publish, `marketplaceQuestionBanks.ts:113-135`). RLS: courses readable by authenticated, insert by creator; `user_courses` owner-only.
- API: `GET /courses?institutionId&q`, `POST /courses`, `GET|PUT /users/me/courses`, `POST /users/me/courses/archive-semester`; `courseId` filters on `GET /notes` (`notes.ts:1965`), `GET /decks` (`decks.ts:28`), `GET /tests` (`tests.ts:43`), `GET /offline-bundles`; accept `courseId/topicId` on note/deck/group/listing create + patch. **Three gates to extend or new fields are silently dropped:** `validateUpdateUser` (`middleware/validation.ts:51-61`), `NON_ADMIN_UPDATABLE_FIELDS` (`routes/users.ts:33-39`) and `toPublicUser` (`users.ts:60-70`); `validateCreateGroup` (`validation.ts:68-75`) needs a new `body('courseId')` rule. `handle_new_user`: `CREATE OR REPLACE` the **`20260711120000`** body (not `20260707`) and re-apply the `20260721140000:67-69` revokes.
- Shared types: `Course`, `Faculty`, `UserCourse`; `courseId?/topicId?` on `StudyNote`, `NoteFolder`, `Deck`, `Group`, `TestConfig`, `OfflineSessionBundle`, `MarketplaceListing` (`packages/shared/src/types/index.ts`).
- Reuse: `CampusSearchSelect` / mobile `CampusPicker`; `GET /marketplace/campuses`; `pg_trgm`.
- Gotchas: don't stuff academic data into `profiles.settings` (CAS-versioned JSONB, unqueryable); question tags and listing `courseCode` free text need a one-off mapping or stay orphaned; mobile `CreateListingScreen` has no category-specific fields at all.
- Done when: a new user picks University → Programme → Level → Courses; every artefact create/edit has a course picker; `GET /notes?courseId` works on both platforms.

**B. Library as the archive ("My Lantern Library")**
- Build: Library (web `components/LibraryScreen.tsx`, mobile `screens/library/LibraryScreen.tsx`) gains a course tree (Institution → Year/Semester → Course → Topic) spanning notes, decks, tests, offline bundles *and purchased packs*; "Archive semester" action; `GET /library/search?q&courseId` — server-side union over notes (title/body/summary + attachment text), decks, flashcards, bundles with FTS/trigram indexes (pattern: `20260601010000_marketplace_indexed_search.sql`). Surface nested folders (API already accepts `parentId`). Tag UI for `flashcards.tags` (stored, never exposed).
- Done when: a student can see *everything* they made for BIO 201 in one place, on web and mobile, and find it by search.

**C. `learning_events` + concepts — start the clock**
- Build: `learning_events(id, user_id, event_type enum(card_reviewed, question_shown, question_answered, resource_opened, note_created, card_generated, question_generated, bank_downloaded, group_question_posted), target_type/target_id, deck_id, group_id, note_id, course_id, session_id, listing_id, rating, is_correct, response_ms, confidence?, attempt_no, srs_before, srs_after, surface, created_at)` — append-only, service-role, **written server-side regardless of analytics consent**. Emit from `reviewFlashcard` (`supabase.ts:4192-4224` — before/after `srs_data` already in hand), `completeTestDraft`/`createTestResult` (`:6026/:6254` — one row per `user_answers` entry; response time exists on both platforms), `upsertUserQuestionStat` (`:4507`), notes create, AI generate handlers (`ai.ts:86/117`), question-bank download/score. `concepts(id, slug, name, parent_id, course_id?, source ai|user|import)` + `concept_links(concept_id, target_type, target_id, confidence, source)` backfilled from `flashcards.tags`, `messages.question_data.tags` and AI `topic`; **persist AI `difficulty` as `authored_difficulty`** (not `difficulty` — collides with FSRS `srs_data.difficulty`) in `question_data` and flashcards metadata.
- Also: extend `userDataLifecycle.ts:101-120` export/delete and `dataRetention.ts` for the new tables; update cookie/privacy wording (`legal.ts:306`) and `docs/compliance/ropa.md`.
- Gotchas: `test_sessions.config.bundleId` is a `qbank-<listingId>` string — store a typed `listing_id` on events rather than parse it; `user_question_stats.question_id` is TEXT with no FK.
- Done when: every review/answer/generation writes a row; a week of data exists before Phase 3 builds mastery on it.

**D. Store distribution (the 3/10)**
- Build: run the existing **`production` EAS profile** (`eas.json:65-78`, no `buildType` → AAB; `npm run build:prod` exists) letting EAS hold the upload keystore; enrol in **Play App Signing** and add Google's cert SHA-256 as a **second fingerprint** in `public/.well-known/assetlinks.json` (one entry today) **before** release or every `lanternstudy.com` app link breaks; fill `eas.json submit.production.android` (`serviceAccountKeyPath`, `track: internal`) + `submit:android` script; extend `docs/RELEASING.md` + `scripts/publish-android-release.sh` to publish APK (GitHub) *and* AAB (Play internal) from one version; start the closed-testing cohort from current APK users; `docs/store/` with Data-Safety answers derived from `docs/compliance/{privacy-policy,retention-schedule,subprocessors,ai-system-card}.md`; 8 phone screenshots + 1024×500 feature graphic; privacy URL `https://lanternstudy.com/privacy`, deletion URL backed by `POST /users/:id/delete-immediate`. Permissions already pass (`app.config.ts:180-203`). **iOS:** Apple membership → `build:ios` / `submit:ios` + `docs/APPLE-SIGN-IN-SETUP.md`. **PWA:** `purpose: maskable` icons, `screenshots`, `shortcuts` (Study / Flashcards / Chat), `id` in `public/manifest.json`; `beforeinstallprompt` → "Install app" on Landing + Dashboard. **Landing:** H1 → *"Study smarter. Learn together. Everything you need for university in one place."* (`LandingPage.tsx:89-97`), store badges + APK fallback (`:101-110`), social-proof strip from real counts (`:143`). Add `seo:notify` to `.github/workflows/deploy-web.yml` (wired in the PowerShell deploy only).
- Gotcha: **if the released APKs were signed with a local key, switching to Play signing changes the cert and breaks in-place upgrades** — publish under Play's key from day one and tell APK users to reinstall once; keystore state is not derivable from the repo (`*.jks` gitignored) → §6 D10.
- Done when: internal-track build installable from Play; APK users migrated; iOS TestFlight live.

**E. Rights & takedown hygiene (can't wait for Phase 2 selling)**
- Build: **persist attestation** — `marketplace_listings.rights_attested_at/rights_attestation_version/rights_status (attested|under_review|takedown|cleared)`, `marketplace_question_banks.rights_attested_at/ai_assisted/sources_cited/originality_score`; require `body.attestation === true` in `POST /question-banks/publish` and listing create **when `listing_kind` is digital or an academic flag is set**; send it from both publish modals + `CreateMarketplaceListingModal` + add the missing mobile checkbox. **Lock moderation states** (§2.3 row 1). **Generic `content_reports`** (`target_type listing|question_bank|note|deck|user|group|message|dm_message|job_posting`, reasons incl. `copyright|leaked_exam|plagiarism|harassment`, `UNIQUE(reporter,target)`), `POST /reports`, admin queue filter + actions (`dismiss|warn|remove_content|suspend_user`) extending `AdminReports.tsx`; report entry points on `NoteEditorScreen`/`NotesScreen`, deck view, `SellerProfileScreen`, `ChatWindow`/`MessageItem`, mobile `DirectMessageScreen`/`GroupChatScreen`. **Takedown state** columns (`takedown_reason/at/by`, `appeal_status`), `force:true` seller notification on remove/suspend (`createNotification` otherwise honours mute settings), seller-visible state in `MyListingsScreen`, `POST /listings/:id/appeal`. **Terms:** add `prohibited` + `seller_terms` documents to `LegalDocumentId` (copyright agent, notice-and-takedown, repeat-infringer, academic-integrity, prohibited content) and a `copyright` contact category. **Strikes:** `moderation_strikes` + honour the reserved `settings.suspended_until` in `isUserBanned`/`rejectIfBanned` and let the admin status route accept `suspended` (today it's `active|banned` only). Copy `scamPlaybook.ts` into a shared content filter with leaked-exam / lecturer-slide heuristics for listings, packs, notes.
- Done when: no digital listing exists without a persisted attestation; an admin takedown sticks; a lecturer can report a note.

**F. Onboarding rewrite (University → Programme → Courses → Study, < 3 min)**
- Build: keep 3-field signup + OTP; fold `UsernameRequiredModal` (opened by `useAppEffects.ts:697-701`) into one **"Set up your profile"** step: username + institution + programme + level (+ courses typeahead); shrink `OnboardingFlow` (`components/OnboardingFlow.tsx:6`) to welcome → **starter deck pre-seeded with the chosen programme** (`App.tsx:1977-1991`) → "Open Learn mode"; default streak target silently. Mobile: same step in `SignUpScreen` (replace the `+1` phone block `:137-145`; default `+234`), add the starter-deck step to `OnboardingScreen.tsx:28`. Persist the onboarding flag server-side (`settings.featureTips`), add an **activation** event/stage to `admin_analytics` (it already has acquisition funnel + cohorts) and `profiles.activated_at` from `POST /activity/record`.
- Done when: time-to-first-study-action is measured and < 3 min on a campus network.

### Phase 2 — Creator loop (weeks 5–8)

**G. Study Pack product** (depends on A, E)
- Build: `listing_kind` CHECK + `'study_pack'`; `marketplace_study_packs(listing_id UNIQUE, published_by, source_course_id, version, content jsonb {guide:{markdown,toc}, summaries[], flashcards[], questions[], weakSections[]}, cover_url, rights_*/ai_assisted/sources_cited)`; entitlements reused + `delivered_refs jsonb {bundle_id, deck_id, note_id}`; `deliverStudyPack`: questions → `saveOfflineBundle` (verbatim), flashcards → `importDeck` **once** (check `delivered_refs` first — `importDeck` always creates a new deck), guide → note copy **once**; restore/update-pull re-use the same refs; preview = TOC + 1 summary + N cards with backs stripped + 3 questions (extend the allow-list); RPC branches `listing_kind IN ('question_bank','study_pack')` (`20260818120000:129,184,187,276`) + the offer block; cart server guard; add `study_pack` to client category constants (listings RPC `p_include_custom` defaults false); entitlement-based review eligibility. **Also:** "Sell this deck" (export JSON is the snapshot) and "Sell this note" as thin first cuts on the same tables.
- Gotchas: 1000-question / 2 MB caps; per-buyer JSON copies scale linearly with sales — fine for v1, revisit (§6 D6).
- Done when: a creator publishes a course-tagged Study Pack from their archive; a buyer gets a deck + note + offline bank in their Library, on web and mobile.

**H. AI Study Product Factory** (depends on G)
- Build: `POST /ai/study-pack/draft` behind `aiRateLimitWithCost(req => 4–6)` chaining server-side `resolveNoteStudyContent` → `summarizeNoteContent` (deep, `aiService.ts:1859`) → `generateFlashcardsFromNotes` (`:1221`) → `generateQuestionsFromNotes` (`:1138`, + essay variant) → weak-section flagging → `generateListingDescription` (`:1383`) → classify (course from `user_courses`, level, semester) → price suggestion (reuse the "Suggest ₦X" affordance); persist to `study_pack_drafts(user_id, source_note_ids, course_id, content, status)` so nothing is lost on failure; publish step reuses the question-bank publish modals; cover via `POST /marketplace/upload-image` (JPEG/PNG/GIF/WebP).
- Gotchas: 20 credits/day, `MAX_AI_CREDIT_COST=10` — a full run must be one charge; no diagram generation exists (image-occlusion cards are manual) — out of v1.
- Done when: "Turn this into a Study Product" on any note/folder yields a draft pack in one click.

**I. Fee model + payouts** (decision D1)
- Build: `MARKETPLACE_CREATOR_FEE_BPS`; `marketplace_payments.platform_fee_kobo` + `seller_payout_kobo`; rewrite CHECK; `transferSellerPayout` amount = `seller_payout_kobo` (`marketplacePayments.ts:681`); update refund/confirm/force-payout reads; `/payments/config` exposes both rates; fee copy on web + mobile checkout; seller-facing payments ledger (`paid|payout_pending|paid_out` + per-pack sales) — none exists today.
- Done when: a ₦2,000 pack pays the creator ₦1,700 and Lantern ₦300, and the buyer sees ₦2,000.

**J. Creator profiles + follows + creator_stats** (depends on A)
- Build: `profile_follows` (mirror `user_blocks` + block predicate); `POST/DELETE /users/:id/follows`, `GET …/followers|following` (respect `profile_visible_to_viewer`); `profiles.bio`; **creator_stats** (materialised/refresh-on-write) from existing tables: active/sold listings, completed orders, disputes, review count/avg/5★, packs (`published_by`), learners helped (`DISTINCT user_id` over entitlements by seller), follower count, points/badges, streaks, `active_days_90`, account age; owner-only `gross_earnings_kobo`; replace per-request math in `marketplace.ts:2500-2531` / `getSellerStats`; extend `SellerProfileScreen` (web + mobile) into a **Creator profile** with university/programme, packs, "learners helped", follow button; mobile renders `isVerified`; notifications for new follower / new pack.
- Done when: "Top Anatomy creator at UNILAG" is a real page someone can follow.

**K. Buyer-library parity**
- Build: mobile update pull for purchased banks/packs; a unified **Purchases** view (today: Offline Mode list vs order history); Purchased items filed under their course in Library (B).

### Phase 3 — Network (weeks 9–12)

**L. Communities + discovery** (depends on A, J)
- Build: `communities` + `community_members` (auto-membership from `profiles.institution_id/programme/level` + `user_courses`; horizontal communities joinable); `groups.community_id/visibility/tags/course_id`; `GET /groups/discover` (separate query + cache key — `GET /groups` is memberships-only and cached per user); **Discover hub** (communities · groups · people · trending) — decide whether web "Explore" (today = marketplace, `Sidebar.tsx:330`) becomes Discover with marketplace nested (§6 D12); web routes in `utils/appRoutes.ts` + Sidebar/BottomNav; mobile screens.
- Gotchas: `profile_visible_to_viewer` treats the "groups" tier as co-membership — fold community membership in or private-tier users vanish; `validateCreateGroup` whitelist.

**M. Academic Feed + counters + presence**
- Build: `activity_events(actor_id, verb, object_type, object_id, audience_type community|group|followers|public, audience_id, payload)` written at existing hooks (pack publish `marketplace.ts:726`, note share `notes.ts:2794/1632`, deck collaborator `decks.ts:182`, challenge completed `challengeService.ts:672-716`, group join `groups.ts:662/144`, badge unlock, follow) + `GET /feed` (followers ∪ my communities ∪ my groups) → Feed panel on both dashboards; **keep notifications for direct-to-me events** (fan-out per recipient is already the expensive path, `supabase.ts:8640-8660`). Counters `decks.study_count`, `notes.view_count`, `groups.question_count` maintained by the same writers ("studied by N"). Presence-as-intent: extend `POST /users/presence/heartbeat` with `{context, courseId, topic}` → `study_presence(expires_at)` → `GET /presence/now?courseId=` ("23 students studying cardiology tonight"), honouring `showStudyActivity`/`showOnlineStatus`. Trending topics via the `product_events` trending pattern (`20260816120000`).
- Gotchas: web already holds ~8 realtime channels per user; feed is pull-based, not a channel.

**N. Trust: Verified + trust score + reports/disputes/strikes** (depends on J, E)
- Build: `email_confirmed_at` sync column; `verification_level`; trust score (0–100) over `creator_stats` + verification rows with the weights in the analysis (verified +20/+15/+5, longevity, `log(completed_orders)`, −10 per lost dispute, reviews weighted by count; hard 0 if banned/deactivated) → `trust_level new|rising|trusted|verified` exposed on seller/creator profile, listing seller embeds (`supabase.ts:9084-9088`) and search; **dispute UI** (no client sends `open_dispute` today) + `dispute_reason/opened_by/disputed_at`; strikes → time-boxed suspension (E); `content_reports` on users/DMs live (E).

**O. North-Star metric — Weekly Active Learning Connections**
- Build: `learning_connections(actor_id, beneficiary_id, kind, object_type, object_id, created_at, week_start generated)` inserted from existing events: challenge completion (`challenge_participants`), answering a group-mate's question (`test_sessions.config.groupId` + message author), question votes (`question_votes`), question VERIFIED (`messages.ts:1132`), deck-collaborator study, note redemption/copy (`note_share_redemptions`, `copied_from_note_id`), pack entitlement/score, completed order, review, accepted DM request, follow. **Actor ≠ beneficiary; dedupe per pair per week.** Weekly rollup next to `admin_analytics` (`admin.ts:772`); new event names allow-listed in `packages/shared/src/analytics/events.ts`.

**P. Mastery Graph v1** (depends on C)
- Build: `user_topic_mastery(user_id, concept_or_tag, course_id, attempts, correct, accuracy, avg_response_s, last_attempt_at, cards_total, cards_mature, cards_due, avg_stability, avg_difficulty, leech_count)` materialised server-side from full `test_sessions` (questions tags × answers) + `user_question_stats` + `flashcards.srs_data` — a server port of `buildTopicPerformance` + `getDeckCardStats`, refreshed on completion/review; served via `/dashboard/summary` (lean rows currently strip topic insight, `supabase.ts:5768-5769`); feed `companionContext` (replace dead `tagBreakdown`) and `/ai/study-recommendations` (fix mislabelled inputs); **exam readiness** = `user_courses.exam_date` + mastery per course topic ("16 days to your exam — biggest gain: ETC and gluconeogenesis"); question difficulty = p-correct across users from `user_question_stats`; population aggregates by course/institution behind a **min-cohort threshold (n ≥ 20)** in a service-only RPC modelled on `marketplace_zone_analytics`.

### Phase 4 — Density & intelligence (months 4–6)

**Q. Campus playbook + referrals/ambassadors.** "Lantern @ UNILAG": seed canonical courses + communities + 50 ambassadors + 100 seed creators; `profiles.referral_code` + `referrals(referrer, referee UNIQUE, code, source, qualified_at, rewarded_at)`; **attribution rides `supabase.auth.signUp options.data`** (`AuthScreen.tsx:457-466`, `SignUpScreen.tsx:252-261`) and is consumed in `finishAuthSession` (`AuthScreen.tsx:295`) + the mobile PostgREST insert (`SignUpScreen.tsx:275-281`) or a `profiles` insert trigger — *not* `POST /users` (neither client hits it on the real path); reward on referee **activation** with wallet coins/XP (abuse: mobile signup has no Turnstile; don't enable Supabase captcha globally — `HANDOVER-2026-08-15:202`); ambassador role/badge + leaderboard (XP leaderboard API exists); public-safe invite preview + `functions/invite/[id].ts` so WhatsApp unfurls group invites.
**R. SEO campus/programme pages.** `/campus/:slug(/:programme)` guest routes (`utils/appRoutes.ts:266-291`, `App.tsx:862-868`), `GET /campuses/:slug/summary` (counts of public decks/groups/listings/jobs/creators), Pages prerender like `functions/marketplace/listing/[id].ts`, sitemap entries (`routes/sitemap.ts`), IndexNow in `deploy-web.yml`; seed UNILAG first.
**S. "Turn My Semester Into Products."** End-of-semester job over `user_courses` + the archive → proposes N packs with suggested prices + estimated sales (from `creator_stats` of comparable packs) → one click creates drafts (H). Also the "your old notes could become products" nudge in the feed/companion.
**T. Learning Effectiveness + population intelligence.** Δ-mastery on linked concepts after `resource_opened`/`bank_downloaded` vs baseline (needs C + P to accrue); per-pack effectiveness on the listing; campus demand signals for creators ("BIO 201 packs sell 3 weeks before resumption at UNILAG").
**U. Retention loops.** `cron.studyReminders` (due cards / streak at risk → existing `exp.host` sender for `srs_reminder`, idempotent claims like `job_reminders_sent`); `cron.weeklySummary` (Resend, honouring `shouldSendWeeklyDigest`); semester recap; Web Push (VAPID) once PWA installs are measured; `alumni` derived from `expected_graduation_year` (archive, products, followers persist).
**V. Cross-university study rooms.** Repurpose `study_sessions`/`study_session_participants` (extend RLS policies) + a Supabase presence channel; wire `CreateLabModal`; rooms attach to courses/communities, not only groups.
**W. Physical/merchant commerce — last.** Boosts (free today), coupons, shops, seller tools already exist; charge for boosts/promoted placement, add lead-gen/merchant tiers only after digital liquidity per campus is proven.

---

## 5. Metrics & instrumentation

- **North Star:** Weekly Active Learning Connections (O) — count of distinct (actor, beneficiary, kind) per week where a student benefited from another's contribution.
- **Creator loop:** packs published/week, creator % of WAU, buyer conversion, repeat purchase, creator earnings paid out, **marketplace liquidity per campus** (buyers · sellers · listings · transactions per institution), GMV.
- **Learning:** activation time, D1/D7/D30 (already in `admin_analytics`), reviews/answers per WAU (from `learning_events`), mastery delta per course, exam-readiness usage.
- **Network:** follows/user, community MAU, cross-university connections %, feed CTR, "N studying now" impressions.
- **Trust:** verified %, report → resolution time, takedowns, disputes, strike counts.
- **Instrumentation changes:** activation stage + `campus`/institution dimension in `admin_analytics`; `learning_events` (C) as the learning source of truth; `learning_connections` (O); creator analytics from `product_events` + orders (views → conversion) — note the consent bias and prefer server-side counts where it matters.

---

## 6. Decisions needed from you (before the corresponding phase)

| # | Decision | Recommendation | Blocks |
|---|---|---|---|
| D1 | **Fee model:** creator-side 15–20 % on digital (+ drop the buyer surcharge for digital) vs today's 5 % buyer surcharge | creator-side 15 %, digital only; physical unchanged for now | I, G |
| D2 | **Institution table:** promote `marketplace_campuses` vs new `institutions` | promote + `kind` + view | A |
| D3 | **Courses canonical per institution** vs personal | canonical (merge rule for user-created) | A, S, T |
| D4 | Faculty/programme as **text** in v1 vs tables | text now | A |
| D5 | **Study Pack** as new `listing_kind` vs sub-kind of `question_bank` | new kind | G |
| D6 | Pack content **per-buyer JSON** (current model) vs shared storage objects + signed URLs | JSON v1; revisit at 2 MB / scale | G |
| D7 | What is **public** on a creator profile | university, programme, packs, rating, learners helped, followers; **never earnings** | J |
| D8 | **Lantern Verified** tier for the public badge | email-confirmed + payout-active (v1) | N |
| D9 | `learning_events` **legal basis & retention**; privacy/RoPA wording | product data, written server-side; retain while account active | C |
| D10 | **Play/Apple/Paystack accounts**; was the APK signed with a local key? Organisation Play account? | org account; Play signing from day one | D |
| D11 | **Legal counsel** for Terms + designated notice agent + jurisdiction | engage now | E |
| D12 | Web **"Explore"** stays marketplace or becomes Discover (marketplace nested) | Discover hub | L |

---

## 7. Risks & traps (repo-specific)

- **Hand-applied migrations** — sequence after `20260821140000`; nothing ships until you paste them; degrade gracefully like `isMissingRelationError`.
- **Root `npx tsc --noEmit` is a false gate** (~3.9k pre-existing errors). Real gates: `npm run build` (turbo, web), per-workspace `tsc` for `apps/mobile` and `apps/api-server`; `apps/web` build tsc is stricter than vitest (`noUncheckedIndexedAccess`); a failed `build:web` leaves the old `dist` and wrangler deploys it happily.
- **EAS local builds archive the working tree at start** (stash → build → verify copy predates edits → pop). Mobile fixes ride the *next* build; keep the slim lockfile (`scripts/package-lock.eas-mobile.json`) in sync; avoid new RN deps where a tiny in-house implementation will do.
- **Parallel agents: no `git stash/checkout/restore/clean`** in the shared tree; commit finished slices early.
- **Two platforms, two legacies**: web lives in root `components/ services/ stores/ hooks/` + `apps/web`, mobile in `apps/mobile`; every screen change lands twice or parity drifts (leaderboard is mobile-only; update-pull web-only).
- **Play signing vs existing APK installs** (D10); `assetlinks.json` must carry Google's cert before the store build ships.
- **`profiles.settings` JSONB** holds ban state and privacy — don't add academic fields there; migrate ban/suspension state to columns before scoring trust.
- **Realtime channel budget** (~8/user on web, JWT-gated on mobile) — feed and presence are pull-based.
- **AI credits** (20/day, max 10/action) — the factory is one chained charge, server-side, with drafts persisted.
- **Paystack is test mode in prod**; go-live is a business-verification task, not code.
- **`product_events` consent bias** already affects seller conversion and trending; never build learning or trust on it.
- **Mobile signup has no Turnstile** — referral rewards need activation-gating + de-dup.
- **Privacy surfaces** (`profileVisibility`, `discoverableForInvites`, `showStudyActivity`, `allowDirectMessages`) must gate every new discovery/feed/presence surface.

## 8. What not to build now

Paid student tiers or premium AI · physical-first merchant monetisation (paid boosts, lead-gen, ads, logistics) · a TikTok-style feed · selling or exporting per-student data, or a university-facing "Lantern Intelligence" product before campus density exists (aggregate, thresholded, internal first) · live video duels/rooms · Web Push before PWA adoption is measured · new chat infrastructure · renaming `marketplace_campuses`.

## 9. First two weeks — PR-sized slices

1. **Migration 1 (A):** `institutions` view + `kind`; `profiles` academic columns + backfill; `courses`/`course_topics`/`user_courses`; nullable `course_id` on the 8 tables; indexes + RLS. Hand-apply.
2. **API (A):** validators/whitelists/`toPublicUser`/`handle_new_user`; `/courses*`, `/users/me/courses*`; `courseId` filters; shared types.
3. **Onboarding (F):** web profile-setup step + 3-step flow; mobile parity (`+234`, starter deck); activation event.
4. **Migration 2 (C):** `learning_events` + `concepts`/`concept_links` + `authored_difficulty`; emitters in `reviewFlashcard`, test completion, question stats, AI generate, bank download/score; export/delete/retention; privacy + RoPA text.
5. **Rights (E):** attestation columns + server requirement + mobile checkbox; listing status transition lock + trigger + UI; `content_reports` + generic route + admin filter; Terms drafts to counsel; `copyright` contact category.
6. **Distribution (D):** production AAB, Play App Signing + second `assetlinks` fingerprint, internal track + closed testing, `docs/store/` data-safety, screenshots/feature graphic, landing badges + H1, PWA manifest/install prompt, `seo:notify` in the deploy workflow; Apple enrolment.
7. **Library (B):** course tree + purchased items + nested folders + tag UI; `/library/search`.
8. **Fix-on-the-way:** §2.3 rows 2–9.

---

## Appendix A — The thread, extracted (turns 13–20)


### The three questions you asked ChatGPT

1. **Turn 13** — critique lanternstudy.com; name similar apps; estimate valuation; would Tekedia invest; a 6-month timeline to "unicorn + big-data platform".
2. **Turn 15 (your pivot)** — "students won't pay anything; any monetisation is via the marketplace."
3. **Turn 19 (your second pivot)** — Lantern as a place to study, *archive* notes/documents into sellable products for later cohorts, and an interaction platform across universities/countries, with the aim of an exit to a large social platform.

### Turn 14 — the critique (ChatGPT's assessment of the public product)

Scorecard: concept 8/10 · breadth 9/10 · Africa-fit 9/10 (offline/low-bandwidth) · differentiation 5/10 · positioning 6/10 (feature-led, not outcome-led) · **distribution 3/10** (direct APK + TestFlight) · social/network 6/10 potential · **monetisation 3/10** · **data moat 2/10 today** (10/10 if designed right) · investor readiness 5/10.

Key points:
- AI flashcards are commodity (Quizlet, Knowt, StudyFetch, RemNote, Anki, Brainscape, StuDocu, Coconote all do it). The defensible combination is *Africa + offline + campus communities + collaborative study + local content + marketplace*.
- "Trying to do too much" — needs one indispensable behaviour. Proposed reposition: **"The learning network for African universities"** — upload course → Lantern understands syllabus → study plan → materials from students at your university → tests you → learns weaknesses → connects classmates → predicts exam readiness.
- **Distribution must be Play Store + App Store + Web in month 1**; a raw APK undermines trust.
- **Empty marketplace is worse than none** — seed campus by campus (UNILAG → MBBS Y1, Law Y2, Eng 300L…), with past questions, course summaries, lecturer-specific notes, lab manuals, exam decks, textbooks, study groups.
- Comparables (as cited in the thread): Quizlet ~$1–2.5B EV; Knowt ~$10–15M; StudyFetch ~$11.5M raised, 8M+ students; RemNote 1M+; StuDocu 60M MAU / 50M resources. *(ChatGPT's citations — not independently verified here.)*
- **Indicative valuation: $1.5–3M pre-money (anchor $2.5M)**; ladder: 25k MAU → $3–6M; 100k MAU → $7–12M; 250–500k MAU + $20–50k MRR → $12–25M; 1M MAU → $25–60M; 3M+ MAU multi-country → $60–150M+.
- **Tekedia fit 6/10 today** — thesis match (earliest stage, education included, "category-king"), but not yet; pitch "Africa's learning graph", not "AI flashcards". Don't pitch until there are numbers (it suggested 100k users / 20 universities / 50k resources / 40% D30 / 3M monthly study events).
- **Don't sell student data.** Build the **Lantern Learning Graph**: Student → Institution → Course → Module → Concept → Resource → Question → Attempt → Mastery → Outcome; per-resource *Learning Effectiveness Score*; per-student *Mastery Graph* with exam-readiness guidance.
- Original 6-month sprint (pre-pivot): M1 product reset + telemetry + store launch; M2 five campuses + ambassadors + SEO campus pages; M3 learning graph v1 + mastery graph; M4 "Lantern Intelligence for Universities" B2B (₦5–25M/inst/yr); M5 Ghana/Kenya/SA; M6 fundraise. Moonshot numbers: 1M registered, 250k MAU, D30 ≥35–40%, 500k resources, 100M study events, $1M+ ARR.

### Turn 16 — revised after "students won't pay"

- **Students free permanently.** Study product = acquisition/engagement/identity/trust engine; **marketplace = commercial engine**. Three layers: *Lantern Study → Lantern Network → Lantern Marketplace*.
- Remove: paid subs, premium AI tiers, paid flashcards/plans, university SaaS as *main* engine.
- Who pays: **supply side + transactions** — commission (e.g. 3% on a ₦300k laptop), promoted listings, merchant storefronts, lead-gen (accommodation, driving schools, certifications), high-intent commerce ads, escrow/payment fees, logistics margin, later financial services via licensed partners.
- Moat = **Student Intent Graph** = Learning graph ⨝ Commerce graph (aggregate, never PII). Example: "laptop searches rise 43% three weeks before resumption".
- Flywheel: free tools → students → groups → campus density → buyers → sellers → inventory → transactions → better recs → more sellers → keep tools free. Second loop: transactions → reputation → safer marketplace.
- Positioning: consumer "Study smarter. Learn together. Everything you need for university in one place." Investor: "digital network for African university life; acquire via free AI learning, monetise via campus commerce."
- **Hyperlocal**: build "Lantern @ UNILAG" (2k buyers / 300 sellers / 5k listings) before the next campus; core metric = **marketplace liquidity per campus**.
- First categories: textbooks & study materials → electronics → accommodation → tutoring/services → student freelance → dorm furniture → events/tickets → food/local merchants.
- **Trust infra**: *Lantern Verified* (uni email, student ID, phone, institution, course, tx history, reviews) + *Lantern Trust Score* (verified + longevity + completed tx + disputes + reviews); don't expose identity publicly.
- Metric = **GMV** (₦10B GMV × 5% blended take = ₦500M).
- Revised 6 months: M1 perfect free learning + store distribution + instrument everything (10k engaged); M2 dominate campus #1 (50 ambassadors, 100 seed sellers, 20 businesses; 5k users / 2k listings / 500 tx); M3 trust + payments (Verified, ratings, disputes, in-app chat, escrow; ₦100M GMV); M4 replicate to UNILAG/UI/UNN/Covenant/UNIBEN (100k users, 25k marketplace MAU, ₦500M GMV); M5 **Lantern Merchant** (free storefront; paid boosts/analytics/inventory/verified-business/targeting/order mgmt; 2k merchants, ₦1B GMV); M6 internal **Lantern Intelligence** (demand prediction for sellers). Moonshot: 500k–1M students, 150–250k MAU, 50 campuses, 10k merchants, ₦3–5B GMV.
- Unicorn equation: students × engagement × campus density × tx frequency × GMV × take rate.

### Turn 20 — after "archive notes into sellable products + cross-university network + exit to a social platform"

Thesis: **a student-owned knowledge network** — "the place where a student's academic life accumulates, compounds in value, becomes social, and can eventually earn money." Four graphs: Learning + Content + Social + Commerce = "Lantern Campus Graph" — the asset a Meta/LinkedIn/ByteDance/Reddit/Discord can't cheaply recreate.

Product moves it prescribes:
1. **My Lantern Library** — permanent academic vault: Programme → Year → Course → Topic → notes / summaries / flashcards / questions / diagrams / study packs. Switching cost + raw material for products. Button: *Turn this into a Study Product*.
2. **AI Study Product Factory** — from messy notes: organise, clean, TOC, summaries, flashcards, practice questions, diagrams, flag weak sections, references, preview, cover, classify by uni/course/semester, suggest price → "BIO 201 Complete Exam Pack – UNILAG – 2026" (guide + 220 cards + 150 MCQs + 10 essays + summaries + checklist). Sell the *learning product*, not a Word file.
3. **Student Creator** profiles (uni, degree, rating, followers, packs, learners helped, earned) with Follow / Buy / Ask / Message / Join group; "Top 1% Anatomy Creator" style recognition.
4. **Academic Social Graph** — connect people for a *reason* (same course, same exam, same weak topic, different universities); Student → University → Faculty → Degree → Year → Courses → Subjects → Skills → Interests → Groups → Creators followed → Materials used.
5. **Hierarchical communities** (Country → University → Faculty → Programme → Year → Course → Topic) + horizontal ones (African Medical Students, PLAB 2027, ACCA Africa, Women in Engineering Africa…).
6. **Cross-country**: buy a thermodynamics pack made at UCT; African academic knowledge network independent of any one university.
7. **Digital-first marketplace (70–80%)**: notes, study packs, flashcards, revision guides, tutoring, mentoring, templates, coding help, diagrams, exam prep, student-made videos — *then* physical (textbooks, laptops, accommodation, furniture, services, events). Digital products reinforce the learning network; food doesn't.
8. **Creator economy**: ₦2,000 pack → creator 80–85%, Lantern 15–20%. "I made ₦85,000 selling my anatomy notes" is the acquisition story.
9. **Content Rights System (the big hidden legal risk)**: publish-time attestations (did you create this? lecturer slides? textbook? leaked exams? permission?), AI similarity flags, seller rights warranties, copyright complaints + notice-and-takedown, repeat-infringer policy, academic-integrity + prohibited-content rules, moderation, appeals. Clean provenance is part of the moat and of acquirability.
10. **Content Provenance record** per product: creator, created, university, course, originality score, AI-assisted flag, sources cited, rights status, sales, rating, revision date.
11. **Exit logic**: don't build for Meta — make it painful for Meta not to buy (verified students, academic relationships, study resources, creator transactions, dense campus communities, academic identity/reputation, course-level knowledge graph). Buyer ranking: Meta (Groups + Marketplace + WhatsApp Communities) › Microsoft/LinkedIn (education→professional identity) › ByteDance › Reddit › Discord › Snap; also Google/Amazon/Pearson/Coursera/Duolingo/Chegg/Quizlet.
12. **Follow students after graduation** (Lantern Alumni: archive, products, followers, reputation persist → professional exams, postgrad, jobs, mentoring).
13. **Habit loops**: daily (questions, cards, messages, rooms) · weekly (groups, new packs, creator posts, marketplace) · semester (archive, exams, past materials) · annual (new year, sell old materials) · lifetime.
14. **Academic Feed** (not a TikTok clone): "Ada published a new BCH 402 pack", "245 students at UI are reviewing Immunology tonight", "your pack earned ₦12,400 this week", trending topics among classmates.
15. **AI as the network's intelligence layer**: who to follow, what to study, which creator, which pack, which group, which of *your* old notes could become products.
16. **Killer feature — "Turn My Semester Into Products"**: end-of-semester review of the private archive → proposes N products with suggested prices + estimated annual sales → one click to create.
17. **North Star = Weekly Active Learning Connections** (studying someone's deck, buying notes, answering a question, joining a room, commenting, sharing, tutoring). Secondary: DAU/MAU, D30, creator %, content creation rate, buyer conversion, repeat purchase, cross-university connections, GMV, creator earnings, campus penetration.
18. **12-month roadmap**: M1–2 archive + creator profiles · M2–3 AI Study Product Factory · M3–4 digital study marketplace · M4–5 follows, profiles, messaging, academic feed · M5–6 dominate 3–5 universities · M6–8 country/university/course communities · M8–9 Lantern Verified + creator reputation · M9–10 Ghana/Kenya/Uganda · M10–11 cross-university study rooms + discovery · M11–12 physical categories + merchant tools. Year-1 aims: 500k–1M students, 100k+ WAU, 25k+ creators, 100k+ sellable products, 10M+ learning interactions/month, 30%+ D30, ₦1B+ annualised GMV.
19. **Company definition**: "Lantern is the academic social and commerce network for students. Students use Lantern free to study, preserve their academic work, transform that work into sellable learning products, build reputation and connect with students across universities and countries." Thesis: "Every generation of students creates knowledge that is mostly discarded after an exam. Lantern preserves that knowledge, makes it useful to the next generation, rewards the creator, and connects everyone around it."

### Where the three answers disagree (and what to keep)

- Turn 14 wanted B2C subscriptions + university B2B ("Lantern Intelligence for Universities") and $1M ARR; **turn 16 deletes student payments** and makes GMV the metric; **turn 20 narrows the marketplace to digital-first** and makes the archive/creator loop the core. The latest answer supersedes the earlier ones wherever they conflict.
- Survives all three: store distribution in month 1 · instrument everything · campus-by-campus density · learning graph / mastery (privacy-preserving, aggregate) · trust/verification · don't sell PII · "learning network for African universities" positioning.
