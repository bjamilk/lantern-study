# Handover — Knowledge Network Phase 1 shipped; Phases 2–4 designed, not built

**Date:** 2026-08-22
**Branch:** `main` · **HEAD:** `504b32c` (pushed, clean tree)
**Web:** LIVE — https://lanternstudy.com (Cloudflare Pages, SW `lantern-mt4zulk1-f0bc8650`; Pages is **not** git-connected → manual `wrangler pages deploy`)
**API:** LIVE — https://lantern-study-api.onrender.com (`/health` = `504b32c`; auto-deploys from `main` on Render)
**Supabase project:** `tiizkjhbrnaibaagmurl` — the 7 Phase-1 migrations `20260822*` were hand-applied before this API build deployed.

This session extracted a strategy from the user's ChatGPT thread, turned it into a plan, and **built + reviewed + shipped Phase 1** of it. Phases 2–4 are fully designed but **not implemented** — this doc is the map to pick them up.

---

## 0. THE reference doc — read this first

**`docs/PLAN-2026-08-22-knowledge-network.md`** is the *Lantern Knowledge Network* implementation plan — the master strategy + roadmap this whole effort follows. It has:
- the adopted thesis (§1): *Lantern = the academic social & commerce network for students* — free study is the acquisition engine, a digital-first creator marketplace is the commercial engine, four graphs (learning/content/social/commerce) are the moat;
- the verified state-of-the-codebase capability matrix (§2);
- **the full phase breakdown §4 (Phases 0–4)** and the workstream letters (A–W) referenced throughout this handover;
- the 12 open decisions §6, metrics §5, risks §7.
- Appendix A is the raw extract of the source ChatGPT thread.
- Shareable artifact mirror: https://claude.ai/code/artifact/3fb8cd74-bc6d-476c-b7c9-0daa81ef5885

Per-slice contracts (binding names/shapes): `docs/phase1-academic-identity-contract.md`, `docs/phase1-library-archive-contract.md`, `docs/phase1-learning-events-contract.md`, `docs/phase1-rights-moderation-contract.md`, and **`docs/phase2-creator-loop-contract.md`** (the next phase).
Go-live mechanics: `docs/PHASE1-GOLIVE.md` (+ `docs/phase1-all-migrations.sql`, and the copiable migrations artifact https://claude.ai/code/artifact/b64a52cf-974d-4855-b9de-de9b647de4dd).

---

## 1. What SHIPPED in Phase 1 (live now)

All of Phase 1 "Foundations" (§4 of the plan), across web (root `components/ services/ stores/ hooks/` + `apps/web`), mobile (`apps/mobile`), API (`apps/api-server`) and shared (`packages/shared`):

| Slice | What it is | Key surfaces |
|---|---|---|
| **A/F Academic identity** | `courses` / `user_courses` / `institutions` (promoted `marketplace_campuses`), academic profile columns, `course_id` on notes/folders/decks/groups/tests/offline_bundles/listings/question_banks. Profile-setup step, 3-step onboarding with a course-seeded starter deck, Settings→Academic, course picker everywhere. | `services/academicCourses.ts`, `routes/courses.ts` + `routes/userCourses.ts`; shared `@lantern/shared/academic`; web `components/academic/*` + mobile `components/CoursePicker.tsx` |
| **B Library archive** | `/library/overview` + `/library/search`; course tree/rail, search, Move-to-course, tag UI, purchased packs filed by course. | `services/librarySearch.ts`, `routes/library.ts`; web `components/library/*` + mobile `components/library/*` |
| **C Learning events** | append-only server-written `learning_events` log + `concepts`/`concept_links` + `flashcards.authored_difficulty`; emitters on review, test completion, notes, AI gen, bank download/score, group questions. Also fixed the AI study-coach's mislabelled inputs + the dead companion weak-topic path. | `services/learningEvents.ts`, `services/concepts.ts`, `services/companionWeakTopics.ts`; shared `@lantern/shared/learning` |
| **E Rights & moderation** | listing moderation lock (DB triggers + shared lifecycle table), `content_reports` (service-role only), `moderation_strikes` + suspension (`ACCOUNT_SUSPENDED` 403), publish-time attestation, leaked-exam content filter, takedown↔appeal, admin queue, report UI everywhere, legal docs (prohibited content, seller terms). | `services/moderation.ts`, `routes/reports.ts`; shared `@lantern/shared/marketplace/lifecycle` + `@lantern/shared/moderation`; web `components/moderation/*` + admin `AdminReports`/`AdminAppeals` + mobile `components/moderation/*` |
| **D Distribution prep** | Play submit config + AAB release script, `docs/store/*` (Data-Safety, App-Store, listing), PWA manifest + maskable icons + install banner, outcome-led landing, IndexNow. | `apps/mobile/eas.json`, `scripts/publish-android-aab.sh`, `docs/RELEASING.md` "Google Play", `public/manifest.json`, `components/pwa/InstallAppBanner.tsx` |

Also fixed in passing (the defects from earlier in the session): the seller-reversible takedown, admin `awardBadge` writing to non-existent tables, and the AI-coach input mislabelling.

**Two adversarial review rounds (server + client), both remediated** — incl. two HIGH DB fixes (suspensions now persist; account deletion no longer fails for sellers with a moderated listing), moderation-column leaks, a publish content-filter bypass, concept-link authz, a `courseId=null` 500, an appeal/reactivate double-sell, an archive-semester **data-loss** bug, and two infinite-render loops. A review agent also caught a `btrim(both …)` SQL syntax error that would have failed the migration hand-apply.

**Gates at ship:** shared 71 suites/608 tests · API 101/662 · web vitest 107 + build · mobile tsc 0 errors + 87. Prod smoke test: `GET /marketplace/listings` 200 with no moderation-column leak.

### Redeploy rule (permanent)
The API build writes `course_id` / `rights_*` / attestation columns **unconditionally** (no missing-column fallback). **Any future API deploy must have its migrations applied to Supabase FIRST.** Migrations are hand-applied (Pages/Render never apply them). Web is a manual `npm run build:web && wrangler pages deploy apps/web/dist --project-name lantern-study --branch main` (force the build — turbo can serve a stale bundle). See `docs/PHASE1-GOLIVE.md`.

---

## 2. Phases NOT implemented (the roadmap ahead)

All designed in the plan §4; letters below are its workstream ids. Nothing here is coded.

### Phase 2 — Creator loop (plan §4 G–K; full contract: `docs/phase2-creator-loop-contract.md`)
The money phase: turn the archive into sellable products and pay creators.
- **G — Study Pack product**: new `listing_kind='study_pack'` + `marketplace_study_packs` table, reusing the question-bank pipeline verbatim (entitlements, `offline_bundles` delivery, previews, versioning, restore). Delivery = questions→bundle, flashcards→`importDeck` once, guide→note once (idempotent via a new `delivered_refs`). Plus "Sell this deck" / "Sell this note".
- **H — AI Study Product Factory**: `POST /ai/study-pack/draft` (one credit charge, server-side BullMQ job) chaining summarise→flashcards→questions(+essay)→weak-section flags→classify(course)→price-suggest into a `study_pack_drafts` row; "Turn this into a Study Product" on any note/folder/course.
- **I — Fee model**: **DECIDED — creator-side 15% commission, buyer pays list price** on digital (`MARKETPLACE_CREATOR_FEE_BPS=1500`, `MARKETPLACE_DIGITAL_BUYER_FEE_BPS=0`; physical keeps today's 5% buyer surcharge). Needs `marketplace_payments.platform_fee_kobo`/`seller_payout_kobo`, the payout/refund math, `/payments/config`, and a seller earnings ledger.
- **J — Creator profiles + follows**: `profile_follows`, `profiles.bio`, a `creator_stats` (materialised: packs, learners-helped, followers, rating, trust) + trust score, extend SellerProfile into a public Creator profile; Verified v1 = email-confirmed + active payout profile.
- **K — Buyer-library parity**: unified `GET /marketplace/purchases`, mobile update-pull, packs in the Library tree.
- Order: G-api → G-clients + H + I + J. **Adversarially review the money paths (G+I) before merge.**

### Phase 3 — Network (plan §4 L–P)
The social/graph layer that makes it a network, not an app.
- **L — Communities + discovery**: `communities`/`community_members` (auto-membership from institution/programme/level + courses) layered over groups; `GET /groups/discover`; a Discover hub (decision D12: web "Explore" → Discover with marketplace nested).
- **M — Academic Feed + presence + counters**: `activity_events` written at existing hooks + `GET /feed`; "studied by N" counters; presence-as-intent ("23 studying cardiology tonight"). Pull-based (realtime channel budget is tight).
- **N — Lantern Verified + trust score + full reports/disputes/strikes**: builds on Phase-1 E (content_reports/strikes exist) + Phase-2 J (creator_stats); adds the dispute client entry point and email-domain / student-ID verification tiers.
- **O — North-Star metric — Weekly Active Learning Connections**: `learning_connections(actor,beneficiary,kind,week)` from existing events; weekly rollup next to `admin_analytics`.
- **P — Mastery Graph v1**: `user_topic_mastery` materialised server-side from full `test_sessions` + `user_question_stats` + `flashcards.srs_data` (the learning_events log from Phase-1 C feeds this); exam-readiness from `user_courses.exam_date`; population aggregates behind a min-cohort threshold.

### Phase 4 — Density & intelligence (plan §4 Q–W)
- **Q — Campus playbook + referrals/ambassadors** ("Lantern @ UNILAG" first; `referral_code` attribution via `supabase.auth.signUp` metadata, NOT `POST /users`).
- **R — SEO campus/programme pages** (`/campus/:slug`).
- **S — "Turn My Semester Into Products"** (end-of-semester factory over `user_courses` + the archive).
- **T — Learning effectiveness + population intelligence** (Δ-mastery after resource use; needs C + P to accrue).
- **U — Retention crons** (due-card / streak-at-risk push, weekly digest — the plumbing exists, needs producers).
- **V — Cross-university study rooms** (repurpose the dormant `study_sessions` tables).
- **W — Physical/merchant commerce — last** (paid boosts, lead-gen, merchant tiers) — only after digital liquidity per campus is proven.

### Explicitly NOT to build (plan §8)
Paid student tiers / premium AI · physical-first monetisation before digital liquidity · a TikTok feed · selling/exporting per-student data · a university-facing "intelligence" product before density · live video · Web Push before PWA adoption is measured · new chat infra · renaming `marketplace_campuses`.

---

## 3. Decisions — made vs still open (plan §6, D1–D12)
**Made:** D1 fee = creator 15% / buyer pays list (Phase 2). D2 institution table = promote `marketplace_campuses` (done). D3 courses canonical (done). D4 faculty/programme text (done). D5 Study Pack = new `listing_kind` (contract). D6 pack content per-buyer JSON (contract). D9 learning_events = product data written server-side (done).
**Still open (surface before the relevant slice):** D7 exact public creator-profile fields (recommend: university/programme/packs/rating/learners-helped/followers — never earnings) → Phase 2 J. D8 Verified badge tier → Phase 3 N. D11 legal counsel review of the **draft** prohibited-content + seller-terms (both marked "draft for counsel review" in `legal.ts`). D12 web "Explore" → Discover hub → Phase 3 L.

---

## 4. Pending USER / ops actions (not code — none block Phase 1 being live)
- **Paystack live keys**: still test-mode. Needs registered-business verification, live webhook URL, settlement-to-balance, and swapping the three Render vars to live values. ([[lantern-study-paystack-live]])
- **Google Play**: create the Console account (org avoids the 12-tester/14-day gate), decide Play App Signing **before first upload** (Path A upload EAS keystore = APK users upgrade in place; Path B Google key = add its SHA-256 as a 2nd `assetlinks.json` fingerprint + APK users reinstall), create the service account → `apps/mobile/play-service-account.json`, fill the Play forms from `docs/store/*`, screenshots + feature graphic. Then `npm run submit:android`. (`docs/RELEASING.md` "Google Play")
- **Apple**: Developer Program enrolment + App Store Connect record + signing (`.p8` for Sign in with Apple, per `docs/APPLE-SIGN-IN-SETUP.md`), then `npm run build:ios` / `submit:ios`.
- **Once store listings are live**: set `PLAY_STORE_URL` / `APP_STORE_URL` in `packages/shared/src/linking/index.ts` (landing shows store badges only when non-null).
- **Supabase dashboard** (carried from the prior handover): add `https://lanternstudy.com/login*` to Redirect URLs; enable CAPTCHA (Turnstile); email password minimum 8; Apple provider config; the one-line PKCE flip is prepared but untested (`services/supabase.ts` `flowType:'pkce'`).
- **Legal**: have counsel review the draft Terms additions (prohibited content, seller terms) before relying on them.

---

## 5. Gotchas / traps for the next agent
- **Repo trap**: real repo is `~/Desktop/lantern-study` (lowercase). `~/Desktop/Lanternstudy` is a stale clone that hijacks cwd/worktrees/slash-commands. ([[lantern-study-two-repos-trap]])
- **Root `npx tsc --noEmit` is a FALSE gate** (~3.9k pre-existing errors, wrong tsconfig scope). Real gates: `npm run build` (turbo, web), per-workspace `tsc` for `apps/mobile` and `apps/api-server`.
- **Migrations before API deploy** (see §1) — the single most important operational rule.
- **Web deploy is manual + stale-bundle prone**: force `npm run build:web -- --force`, confirm the `dist` SW id changed, then `wrangler pages deploy`. ([[lantern-study-web-deploy-traps]])
- **Two client trees**: web in root `components/…` + `apps/web`, mobile in `apps/mobile` — every screen change lands twice or parity drifts.
- **EAS local builds archive the working tree at start**; keep the slim lockfile (`scripts/package-lock.eas-mobile.json`) in sync; no new RN deps where a tiny in-house impl works. ([[lantern-study-eas-slim-lockfile]])
- **Parallel agents in one tree**: never `git stash/checkout/restore/clean`; commit finished slices early.
- **Jest scoping**: run `apps/api-server` tests from inside that dir (a loose pattern from repo root sweeps `packages/shared` + a stale `dist/*.test.js`).
- **`product_events` consent bias**: it's consent-gated + 90-day; never build learning/trust on it — that's why Phase-1 C uses a separate `learning_events` table.

---

## 6. Reference index
- **Plan (master):** `docs/PLAN-2026-08-22-knowledge-network.md` · artifact `3fb8cd74-…`
- **Contracts:** `docs/phase1-*-contract.md`, `docs/phase2-creator-loop-contract.md`
- **Go-live:** `docs/PHASE1-GOLIVE.md`, `docs/phase1-all-migrations.sql`, migrations artifact `b64a52cf-…`
- **Migrations:** `supabase/migrations/20260822{120000,121000,130000,140000,150000,160000,170000}*.sql`
- **Store prep:** `docs/store/*`, `docs/RELEASING.md`
- **Memory notes:** [[lantern-study-phase1-knowledge-network]] (this build, live state) · [[lantern-study-knowledge-network-plan]] (strategy) · [[lantern-study-rights-moderation]] · [[lantern-study-paystack-live]] · [[lantern-study-two-repos-trap]] · [[lantern-study-web-deploy-traps]]

*This root-level session detail lives in `docs/`. The canonical "resume here" pointer is the repo root `HANDOVER.md`, which points here.*
