# Handover — resume here

**Date:** 2026-08-24 · **Branch:** `main` · **HEAD:** `72c0db8` (clean, pushed, deployed)
**API:** live · **Web:** live · **Supabase:** `tiizkjhbrnaibaagmurl`

Phases 1–4 of the Knowledge Network are built and deployed, audited adversarially,
and the audit's findings are largely fixed. This doc is the **remaining work**,
written so a fresh session can pick up any item without re-deriving it.

---

## 0. Migrations — ALL APPLIED

Nothing is pending. Both migrations the previous handover listed are applied and
verified in production on 2026-08-24:

| Migration | What | State |
|---|---|---|
| `20260824126000_drop_notes_view_count.sql` | Drops dead `notes.view_count` | **Was already applied** — the previous handover listed it as pending; it was not. Probe: `notes.view_count` → `42703`. |
| `20260826120000_course_topics.sql` | `course_topics` + `topic_id` on 5 artefact tables | **Applied 2026-08-24.** Probe: `course_topics` → `42501` (exists, anon denied), `notes.topic_id` → `42501`. |

**Probe technique that actually proves a column exists:** an unknown column errors
at *parse* time (`42703`) before the permission check (`42501`). So a column probe
that stops saying `42703` and starts saying `42501` has gained the column. A bare
`42501` in isolation still proves nothing — you need the before/after transition.

**Why `notes.view_count` was DROPPED, not wired:** `public.notes` is in the
`supabase_realtime` publication and web subscribes **unfiltered**, so every
increment broadcasts to every connected client, each debouncing into
`loadNotes()`. A counter there is a self-amplifying write on a high-traffic read
path. (This is also why the Notes screen legitimately re-fetches `/notes` at
~20/min with a tab open — that is the realtime subscription, not a render loop.)

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

## 2. DONE — `course_topics` (Phase 1 A) shipped `72c0db8`

Both halves are live and E2E-verified against production, not just gate-green.

**Server half** (`0f75fcb`): migration, `services/courseTopics.ts`, routes at
`/api/v1/courses/:courseId/topics`.

**Client half** (`72c0db8`, 71 files): `resolveArtefactTopic` wired into every
create/patch that already took a `courseId`; `TopicPicker` + `useTopicSearch` on
both clients wired into every artefact surface; Library third level
(year → course → topic) with `?topicId=` filters reaching the network on both
clients; `CourseTopic` + `topicId?` in `packages/shared`.

**Verified in production 2026-08-24** (signed-in session, test data cleaned up):
create → 201 pos 10; find-or-create returns the same id for the same title *and*
for a different case; note created with `courseId`+`topicId` round-trips
`topicId`; overview shows the topic node with `notes: 1` and
`topics[] + untopiced === course total` per kind; `?topicId=<id>` → 1 note,
`?topicId=null` → 0; a topic with no course → `400 "A topic needs a course"`;
web note editor renders `note-topic` **disabled → "Pick a course first"**, and
**enabled → "No topic"** once a course is chosen.

**Deliberately NOT wired: `note_folders.topic_id`.** A folder is not a filed
artefact; nothing reads the column. The whole surface (validation, routes,
service writes, mapper, `NoteFolder.topicId`) was **removed** rather than given a
picker to justify it. The column still exists and is unwritten — dropping it is a
separate decision, and unlike `view_count` it is not a write-amplifying counter,
so it is harmless where it is.

**Do not merge topics into `concepts`.** They coexist by design — see the
migration header.

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

## 4. Discovery notes — READ THESE BEFORE BUILDING ANY OF §3

`docs/NOTES-2026-08-23-remaining-work-discovery.md` has implementation-ready
detail for every §3 item, and several traps that would each have shipped a real
bug. The four worth knowing before you start anything:

- **P difficulty:** every AI question lands in `learning_events.target_id` as
  `q-0`, `q-1`… so a plain `GROUP BY target_id` merges thousands of unrelated
  questions into one bucket that then clears any cohort floor — it would publish
  a **fabricated statistic**. The defence must be a `REFERENCES messages(id)` FK.
- **S:** `DEFAULT_AI_DAILY_LIMIT = 20` and a draft costs 5 → **max 4 drafts/day**.
  "One click turns your semester into products" is false above N=4, and parallel
  POSTs each pass their own atomic reserve and leave a ragged partial result.
- **Concepts UI is BLOCKED:** the API is write-only — no GET of a target's links
  and no unlink — so chips could be added but never shown again or removed.
- **U:** `RESEND_API_KEY` is absent from `render.yaml` entirely, so email alerts
  already silently no-op in production; `cron.weeklySummary` will do nothing
  until it is added to the worker env.

Plus: `featureTips` is rebuilt field-by-field in five places and silently drops
unlisted keys; a new badge with `threshold: 0` mass-awards itself to every user;
and the onboarding flag disagrees across clients (`'1'` on web, `'true'` on
mobile).

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
7. **`npm run build` alone is a FALSE gate — it full-cache-hits.** On a 71-file
   diff turbo reported "3 cached, 3 total, FULL TURBO" in 275ms. Always run
   `npm run build -- --force` and confirm `Cached: 0 cached` before believing it.
8. **The "~55-error mobile tsc baseline" is STALE — it is 0.** Measured
   2026-08-24: `apps/mobile` `tsc --noEmit` exits 0 with zero error lines, and
   `--listFiles` confirms it really checks 326 files under `strict`. Do not
   subtract a phantom baseline; any mobile error is yours.
9. **`apps/web` vitest does NOT cover root `stores/`, `services/` or `hooks/`.**
   Its config scopes to `apps/web/src/**`, `components/**`, `utils/**`. Changes to
   `stores/notesStore.ts`, `services/academic.ts` etc. have types and build only —
   which by trap #1 is not evidence they work.
10. **Root `tsc` is a FALSE gate.** Real gates: `npm run build` (turbo/web),
   per-workspace `tsc`, jest from *inside* `apps/api-server`, vitest from
   `apps/web`.
11. **Shared types resolve to `dist/` for the API**, so `packages/shared` must be
   rebuilt (`npm run build`) before api-server tsc sees a change. The API also
   has its **own** `Group`/`User` types in `apps/api-server/src/types`.
12. **Two client trees** — web in root `components/` + `services/`, mobile in
   `apps/mobile`. Every screen change lands twice or parity drifts.
13. **PGlite is the way to test SQL** — no local Postgres exists. See the
    scratchpad harnesses; load `pg_trgm` from `@electric-sql/pglite/contrib`.
14. `UNFILED_COURSE_ID` is the **string** `'null'` (truthy), and so is the
    topic filter's "in this course, under no topic" value.
15. Repo is `~/Desktop/lantern-study` (lowercase); `~/Desktop/Lanternstudy` is a
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
