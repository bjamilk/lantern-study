# Handover — resume here

**Date:** 2026-08-23 · **Branch:** `main` · **HEAD:** `0f75fcb` (clean, pushed)
**API:** live · **Web:** live · **Supabase:** `tiizkjhbrnaibaagmurl`

Phases 1–4 of the Knowledge Network are built and deployed, audited adversarially,
and the audit's findings are largely fixed. This doc is the **remaining work**,
written so a fresh session can pick up any item without re-deriving it.

---

## 0. Migrations — apply these two

Everything else is applied. Copiable runbook:
https://claude.ai/code/artifact/d76bc8e5-83ad-424b-9314-b3b178b4bd26

| Migration | What | Blocking? |
|---|---|---|
| `20260824126000_drop_notes_view_count.sql` | Drops dead `notes.view_count` | No |
| `20260826120000_course_topics.sql` | **NEW this session** — `course_topics` + `topic_id` | No — routes fail closed until applied |

`20260826120000` is one statement short of trivial to verify:
`SELECT count(*) FROM course_topics;` after applying.

**Why `notes.view_count` must be DROPPED, not wired:** `public.notes` is in the
`supabase_realtime` publication and web subscribes **unfiltered**, so every
increment broadcasts to every connected client, each debouncing into
`loadNotes()`. A counter there is a self-amplifying write on a high-traffic read
path.

---

## 1. State of play

| Phase | Status |
|---|---|
| 1 Foundations (A/F, B, C, D, E) | Live |
| 2 Creator loop (G, H, I, J) | Live |
| 3 Network (L, M, N, O, P) | Live |
| 4 Density | **Q, R live** · S/T/U/V/W not started |

The adversarial audit is `docs/AUDIT-2026-08-23-phases-1-4.md` — **read it before
trusting any "shipped" claim**, including in this file. Its headline finding is
worth repeating:

> "The code is written and the gates are green" is not the same as "the feature
> works." Three Phase 3 features shipped with passing types, passing tests and a
> green build, and did nothing at all: presence had no caller, a Discover route
> had no component, and a counter had no reader.

**When you build anything here, grep for CALLERS of it, not just definitions.**

---

## 2. In flight — `course_topics` (Phase 1 A)

**Server half is DONE and committed** (`0f75fcb`): migration, service
(`apps/api-server/src/services/courseTopics.ts`), routes mounted at
`/api/v1/courses/:courseId/topics`. Verified 14/14 against Postgres 16.

**Not done — the client half:**
1. **Artefact write-through.** `topic_id` exists on `notes`, `note_folders`,
   `decks`, `test_sessions`, `marketplace_listings`, and
   `CourseTopicsService.resolveForArtefact(topicId, courseId)` is written and
   ready — but **no create/patch path calls it yet**. Wire it wherever `courseId`
   is already accepted (search `courseId` in `apps/api-server/src/routes/`).
2. **Topic picker on both clients**, beside the existing `CoursePicker`
   (web `components/CoursePicker.tsx`, mobile `apps/mobile/src/components/CoursePicker.tsx`).
   A topic is only selectable once a course is chosen — `resolveForArtefact`
   rejects a topic without a course, and a topic from a *different* course.
3. **Library third level.** The Library tree is currently academicYear → course.
   Topic is the natural third level and the whole reason the entity exists.
4. **Shared types** — `CourseTopic` in `packages/shared/src/types`, `topicId?` on
   `StudyNote`, `Deck`, `NoteFolder`, `MarketplaceListing`.

**Do not merge topics into `concepts`.** They coexist deliberately — see the
migration header for the reasoning.

---

## 3. Remaining work, in the order I would do it

### 3.1 F instrumentation
- `profiles.activated_at`, an activation stage in `admin_analytics`, a
  server-side onboarding flag (`settings.featureTips` — today it is
  localStorage/AsyncStorage only, so onboarding replays on a new device), and
  time-to-first-study-action.
- **Reuse `referral_activation_check`** from `20260825120000_referrals.sql`.
  Activation is already defined server-side there (≥10 `learning_events` across
  ≥2 distinct UTC days by `created_at`). Do **not** invent a second definition.
- **Trap:** never measure activation on `occurred_at` — it is client-supplied
  with no window check and is forgeable in one HTTP burst. `created_at` is a
  server default no emitter can set.

### 3.2 `authored_difficulty` — needs a decision first
The column exists with **no writer and no source for a value**. Two honest options:
- **(a)** have the AI generator emit a difficulty per card and store it — needs
  `packages/shared/src/api/ai.ts` `AIGenerated*` shapes extended and the prompt
  changed; or
- **(b)** derive it from `user_question_stats` p-correct and drop the authored
  column as misnamed.
They are not the same feature. (a) is "how hard the author thinks it is";
(b) is "how hard it turned out to be". **Pick one before writing code.**

### 3.3 Question difficulty (Phase 3 P)
p-correct across users from `user_question_stats`. Needs a **min-cohort floor**
like `course_topic_mastery`'s (n ≥ 20) — with 3 respondents, "80% got this wrong"
identifies people.

### 3.4 Q completion
- Ambassador **badge + leaderboard** (`is_ambassador` and `listAmbassadors`
  already exist; the badge and leaderboard do not).
- **`functions/invite/[id].ts`** so WhatsApp unfurls group invites. Model it on
  `functions/marketplace/listing/[id].ts` — bot-only, every failure path
  `context.next()`. **Nothing private may appear in the unfurl**: a group invite
  preview must not leak member names.
- **Campus seeding** — a data/ops task (courses, communities, ambassadors).

### 3.5 Concepts UI (Phase 1 C)
The API works (`routes/concepts.ts`) and has **zero client callers**. Add concept
tagging beside the existing free-text tags on notes/decks/cards — beside, not
replacing: `flashcards.tags` is a jsonb array people already rely on.

### 3.6 Phase 4 S — "Turn My Semester Into Products"
**Must be a thin layer over Phase 2 H.** Reuse `POST /ai/study-pack/draft` and
the existing drafts screens; do not build a second factory. Roughly: an endpoint
that proposes N packs from a semester's `user_courses`, and a screen that fires
the existing per-course draft creation. **Each draft costs 5 AI credits** — a
"turn my whole semester into products" button that silently spends 40 credits is
a support ticket. Show the cost before firing.

### 3.7 Phase 4 U — retention loops
`cron.*` plumbing already exists (`apps/api-server/src/queue/enqueue.ts`,
`queue/processors/index.ts`, alongside `cron.jobReminders`/`cron.jobAlerts`).
This is **producers, not infrastructure**: `cron.studyReminders` (due cards /
streak at risk, via the existing expo push sender) and `cron.weeklySummary`
(Resend, honouring `shouldSendWeeklyDigest`). Use an idempotent claim table like
the existing `job_reminders_sent` or you will double-send.

### 3.8 Phase 4 V — cross-university study rooms
Repurpose the dormant `study_sessions` / `study_session_participants` tables
(extend RLS) + a Supabase presence channel; wire the existing `CreateLabModal`.
Rooms attach to courses/communities, not only groups.

### 3.9 Phase 4 T and W — still plan-gated
- **T** (learning effectiveness) needs `learning_events` + `user_topic_mastery`
  to have accrued. Both are days old. Building now fits a model to noise.
- **W** (paid boosts, promoted placement, merchant tiers) is "only after digital
  liquidity per campus is proven". Paystack is still in TEST mode and zero
  communities exist. It also **charges people money** — get an explicit decision
  before enabling anything.

### 3.10 Trending tab (L/M)
The 4th Discover tab the plan names. `product_events` is consent-gated and
90-day so it cannot be the source; `learning_events` needs more data to rank
anything honestly.

---

## 4. Unfinished discovery you can resume

A read-only discovery workflow was mapping F-instrumentation, Q-completion,
P-difficulty, concepts-UI, and S/U/V when this session ended. Resume it rather
than re-deriving:

```
Workflow({ scriptPath: "/Users/jamin/.claude/projects/-Users-jamin/54b4c7c5-dca6-4720-b845-db95eb816b2d/workflows/scripts/remaining-work-discovery-wf_b3136bf6-386.js" })
```

---

## 5. Traps — the expensive ones

1. **Grep for callers, not definitions.** The single most costly pattern here.
2. **`supabase-js` RESOLVES on Postgres errors, it does not reject.** `await
   client.rpc(...)` without destructuring `{ error }` swallows failures.
3. **The API client is the SERVICE ROLE — RLS protects nothing.** On any public
   endpoint, hand-write `active` / `status='active'` / `visibility='public'`.
4. **An RLS policy without a matching table GRANT is dead code**, and a policy
   that queries its own table raises `42P17` at *runtime*, not at CREATE.
5. **Never add a counter to a `supabase_realtime`-published table.**
6. **Every web write must go through `withApiCredentials`** — it supplies the
   `X-Requested-With` header that CSRF requires.
7. **Root `tsc` is a FALSE gate.** Real gates: `npm run build` (turbo/web),
   per-workspace `tsc`, jest from *inside* `apps/api-server`, vitest from
   `apps/web`.
8. **Shared types resolve to `dist/` for the API**, so `packages/shared` must be
   rebuilt (`npm run build`) before api-server tsc sees a change. The API also
   has its **own** `Group`/`User` types in `apps/api-server/src/types`.
9. **Two client trees** — web in root `components/` + `services/`, mobile in
   `apps/mobile`. Every screen change lands twice or parity drifts.
10. **PGlite is the way to test SQL** — no local Postgres exists. See the
    scratchpad harnesses; load `pg_trgm` from `@electric-sql/pglite/contrib`.
11. `UNFILED_COURSE_ID` is the **string** `'null'` (truthy).
12. Repo is `~/Desktop/lantern-study` (lowercase); `~/Desktop/Lanternstudy` is a
    stale clone that hijacks cwd.

---

## 6. Verifying anything in production

```bash
curl -s https://lantern-study-api.onrender.com/health          # deployed short SHA
gh run list --workflow=deploy-web.yml --limit 1                # web deploy
```

Anon PostgREST probe: `42501` = table/column EXISTS, `PGRST205` = table missing,
`42703` = column missing. **A `42501` on a COLUMN probe proves nothing** —
table-level denial fires first. RPC probes need the correct named-arg signature
or you get a misleading `PGRST202`.

The production web app calls **same-origin `/api/v1/...`**; `/__lantern_api` is
the dev proxy and returns the SPA shell with status 200 in production — a false
positive that looks like a passing probe.
