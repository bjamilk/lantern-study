# Handover — Knowledge Network Phase 3 (Network) BUILT, migrations NOT applied

**Date:** 2026-08-23
**Branch:** `main` · **Base HEAD:** `36c4b7a`
**State:** all Phase 3 code is written and gate-green, **uncommitted**, and the
five migrations are **NOT yet hand-applied**.
**Supabase project:** `tiizkjhbrnaibaagmurl`

Phase 3 is workstreams **L** (communities + discovery), **M** (academic feed,
counters, presence), **N** (trust + disputes), **O** (Weekly Active Learning
Connections), **P** (Mastery Graph). Phases 0–2 are live; see
`docs/HANDOVER-2026-08-23-phase2-shipped-phases-3-4-remaining.md`.

---

## 0. STATUS AFTER THE E2E PASS (2026-08-23, later)

**The first five migrations ARE APPLIED in production** — verified by anon
PostgREST probe: all five new tables and all seven new functions return `42501`
(permission denied = exists), against a `PGRST205` negative control.

**One follow-up migration is NOT yet applied and should be:**

```
20260824125000_communities_select_grant.sql
```

It fixes two real defects found during the E2E (§4a). Apply it before deploying.

**The API code is still uncommitted, so Phase 3 is NOT deployed** — Render is
running `36c4b7a` and every Phase 3 route 404s in production. A full
UI → API → DB E2E is therefore still blocked; what was verified instead is in §4.

Original five, in dependency order (already applied):

```
20260824120000_communities.sql
20260824121000_activity_feed_presence.sql
20260824122000_trust_disputes.sql
20260824123000_learning_connections.sql
20260824124000_user_topic_mastery.sql
```

They are ordered by dependency: `121000` references `communities`, `124000`
references `concepts`/`courses`. Applying a partial set and deploying the API is
the failure mode that nearly broke all checkout in Phase 2.

**Copiable migration page:** https://claude.ai/code/artifact/d76bc8e5-83ad-424b-9314-b3b178b4bd26

Verify with an anon PostgREST probe before deploying — `42501` = table/column
EXISTS (permission denied, which is correct for a service-role table),
`PGRST205` = table missing, `42703` = column missing. Always probe a known-good
column as a control.

**Superseded:** the SQL has now been executed for real — see §4. It ran against
PGlite (WASM Postgres 16) with the migration files loaded verbatim, and against
production, where the first five are applied.

---

## 1. Decisions taken this session

| # | Decision | Answer |
|---|---|---|
| **D12** | Web "Explore" stays marketplace, or becomes a Discover hub | **Discover hub, marketplace nested** (the plan's recommendation). Sidebar "Explore" → **Discover**; the marketplace is one of Discover's four tabs on both clients. |
| — | Scope/sequencing | All five workstreams, server-first, then both clients. |

### A privacy decision the plan did not settle

The plan says to "fold community membership in" to
`profile_visible_to_viewer`'s `groups` tier. Folding in **all** membership would
have silently widened every `groups`-tier profile to their entire university,
because institution/programme/level membership is auto-derived.

**What was built instead:** only **explicitly joined** communities
(`source = 'joined'`) widen that tier. Auto-derived membership does not. This
keeps the tier meaning "people I chose to share a space with", which is what the
user agreed to when they picked it. Revisit only with a deliberate product call.

---

## 2. What was built

### L — Communities + discovery
- **Migration `20260824120000`**: `communities` (kinds institution/programme/level/course/topic,
  one canonical row per scope via partial unique indexes), `community_members`
  (`source` auto|joined, `opted_out_at`), `member_count` triggers,
  `groups.community_id/visibility/tags/member_count` (+ backfill),
  `ensure_scope_community()`, `refresh_auto_communities()`, and the
  `profile_visible_to_viewer` change above.
- **`services/communities.ts`** — listMine, discoverCommunities (campus-first,
  then a global fallback so Discover is never empty), getBySlug, join/leave,
  listMembers, `discoverGroups`, `discoverPeople`.
- **Routes** `/api/v1/communities/*` and `/api/v1/discover/*`.
- **Auto-membership hooks**: `PUT /users/:id` when an academic field changed
  (not on every save), and every `AcademicCoursesService` enrolment mutation.

**`GET /groups/discover` is a separate query with its own cache key.** `GET /groups`
stays memberships-only and cached per user; conflating them would put non-member
groups in every user's sidebar.

### M — Academic feed, counters, presence
- **Migration `20260824121000`**: `activity_events` (one row per action,
  addressed to an audience), `deck_studiers` + `decks.study_count`,
  `notes.view_count`, `groups.question_count` (trigger + backfill),
  `study_presence` (expiring).
- **`services/activityFeed.ts`** — `record()` (best-effort, never throws) and
  `getFeed()` (followers ∪ communities ∪ groups ∪ public, merged in memory,
  cursor-paged, blocks filtered, own actions excluded).
- **`services/studyPresence.ts`** — heartbeat + `now()` aggregate.
- **Feed writers wired** at existing hooks: study-pack publish, question-bank
  publish, follow, group join.
- **Presence rides the EXISTING heartbeat** on both clients
  (`setStudyIntent()` → the already-running beat carries `{context, courseId, topic}`).
  No second timer.

**The feed is pull-based and must stay that way** — web already holds ~8 realtime
channels per user, and notifications already own per-recipient fan-out.

### N — Trust + disputes
- **Migration `20260824122000`**: dispute columns on `marketplace_orders`
  (`dispute_reason`, `dispute_category`, `dispute_opened_by`, `disputed_at`,
  `dispute_outcome`, `dispute_resolved_at/by`, `dispute_resolution_note`) and
  **trust score v2**.
- **Trust score v2 fixes a real unfairness in the Phase 2 formula**: it counted
  disputes *currently open*, so a seller was punished the moment a buyer opened
  one and was never un-punished when it was withdrawn. It now counts disputes
  the seller **lost** (`dispute_outcome = 'seller'`), and hard-zeroes banned,
  deactivated or suspended accounts.
- `resolveDisputeAsAdmin` now **stamps the outcome** and refreshes the seller's
  trust immediately.
- **Trust on seller embeds** (the gap N called out): `toListingCardRecords`
  batches one `creator_stats` + `profiles` lookup per page and attaches
  `seller.trustLevel` / `seller.verificationLevel`.
- **Dispute UI on both clients** — `open_dispute` had been supported server-side
  since Phase 1 with no client able to reach it. Offered only once money has
  moved; on an unpaid order the honest action is still Cancel.

### O — Weekly Active Learning Connections (north-star)
- **Migration `20260824123000`**: `learning_connections` with the two invariants
  **in the schema, not in the callers** — a CHECK for `actor <> beneficiary` and
  a unique index for one row per (actor, beneficiary, kind) per ISO week. A
  dozen call sites write here; any one of them could get the rule wrong.
- `learning_connections_weekly()` rollup RPC + `GET /api/v1/admin/learning-connections`.
- **Writers wired**: pack entitlement grant, completed order, question upvote
  (downvotes deliberately excluded), follow.
- `isoWeekStart()` in TS mirrors the SQL trigger exactly and is unit-tested at
  the boundaries — if they ever disagree, per-user counts silently query a week
  the rows were never written into and **nothing fails loudly**.

### P — Mastery Graph
- **Migration `20260824124000`**: `user_topic_mastery` +
  `refresh_user_topic_mastery()` (a server port of `buildTopicPerformance` +
  `getDeckCardStats`, done in SQL) + `course_topic_mastery()` population
  aggregate behind a **20-student cohort floor**.
- **`services/topicMastery.ts`** — refresh (debounced 30 s), weak/strong topics,
  exam readiness from `user_courses.exam_date`, course aggregate.
- **Refresh hook**: test submission, fire-and-forget.
- **`companionContext` now prefers the Mastery Graph** for weak topics, falling
  back to the existing inline tally when the graph has no rows (new accounts, or
  a failing refresh RPC) — so the companion cannot regress to silence.

**The honesty rule, enforced in shared code and tested:** a NULL `mastery_score`
means *not enough evidence*, and is rendered as "Not enough data yet" — **never
as 0 %**. Telling a student they are weak at something we never tested them on
is the fastest way to lose their trust in everything else the product says.

---

## 3. Clients

**Shared** (`packages/shared/src/network/index.ts`, new `./network` subpath —
registered in BOTH `packages/shared/package.json` exports and
`apps/api-server/tsconfig.json` paths, which is the trap from Phase 1 · E):
types plus the display helpers both clients use, so web and mobile cannot
describe the same row two different ways. 15 unit tests.

**Web** — `components/DiscoverScreen.tsx`, `components/discover/DiscoverWorkspaceBar.tsx`,
`components/AcademicFeedPanel.tsx`, `components/MasteryPanel.tsx`,
`components/marketplace/OpenDisputeModal.tsx`; `AppMode.DISCOVER` /
`COMMUNITY_DETAIL`; routes `/discover` and `/discover/c/:slug`; sidebar
"Explore" → "Discover"; feed + mastery panels on the dashboard. Web hand-writes
its own fetch layer in `services/supabase.ts` (mobile uses the shared client) —
both were updated.

**Mobile** — `screens/discover/{DiscoverScreen,CommunityDetailScreen,FeedScreen,MasteryScreen}.tsx`
+ barrel + `MarketStack` entries + `MarketStackParamList` types; a **Discover**
chip leading the marketplace workspace bar; dispute flow on `OrderDetailScreen`.

---

## 4. E2E results

A full UI → API → DB pass is **blocked**: the Phase 3 code is uncommitted, so
Render still serves `36c4b7a` and every Phase 3 route 404s in production. There
is no `SUPABASE_SERVICE_ROLE_KEY` in any local env file either, so the API
cannot be booted against real data. What *was* verified:

| Layer | Method | Result |
|---|---|---|
| **Migrations applied?** | anon PostgREST probe vs a `PGRST205` negative control | **PASS** — 5 tables + 7 functions all `42501` (exist) |
| **SQL actually runs** | PGlite (WASM Postgres 16), migration files loaded **verbatim** | **PASS — 41/41 checks** |
| **API routing** | booted locally with dummy creds; curled all 15 routes | **PASS** — all `401` (mounted + auth-gated); control `404` |
| **API tsc / jest** | per-workspace | 0 errors · 107 suites / 715 tests |
| **shared jest** | — | 72 suites / 628 tests |
| **web build** | turbo | 3/3 |
| **mobile tsc** | — | 0 errors |
| **UI E2E** | — | **NOT RUN — blocked on deploy** |

The PGlite harness is the substantive part. It proves, among other things:
- `week_start` trigger agrees exactly with the TS `isoWeekStart()` (`2026-08-17`);
- the weekly-dedupe unique index rejects a duplicate, and the CHECK rejects a
  self-connection — the two invariants the metric depends on;
- `refresh_user_topic_mastery()` **runs** (plpgsql only parses a body at CREATE
  time, so "the function exists" never proved this), tallies 2/3 correct,
  computes `avg_response_s` in seconds, blends to 62, returns **NULL** for thin
  evidence rather than 0, is idempotent, and retires ghost rows after a retag —
  i.e. the `now()` vs `clock_timestamp()` trap is genuinely avoided;
- `refresh_auto_communities()` derives all four scopes, is idempotent, honours
  `opted_out_at` across a refresh, and retires a stale scope on a programme change;
- **the privacy invariant holds**: two users sharing only an AUTO community
  cannot see a `groups`-tier profile; sharing a JOINED one, they can; a stranger
  still cannot;
- **trust v2 behaves**: an OPEN dispute costs nothing, a LOST one costs 10, a WON
  one restores the score, and banned/suspended accounts hard-zero.

### 4a. Two real defects found and fixed

1. **The communities RLS policies were dead code.** `20260824120000` created
   `communities_select_public` and `community_members_select_own` but never issued
   a table-level `GRANT SELECT`, so PostgREST denied every read with `42501`
   *before* RLS was consulted. Phase 2's `profile_follows` has the grant; mine
   didn't. **Fail-closed, not a leak** — and no endpoint was broken, because the
   API uses the service role. But any direct client read would have failed.
2. **Granting SELECT would have exposed an RLS infinite recursion.**
   `community_members_select_own` contained a subquery over `community_members`
   from inside a policy *on* `community_members`. Postgres does not reject that at
   `CREATE POLICY` time — it fails at **runtime** with `42P17 infinite recursion
   detected in policy for relation`. Verified both halves in PGlite: the original
   policy raises 42P17, the fixed one returns the user's own row. The missing
   grant had been masking it, so fixing bug 1 alone would have traded a dead
   policy for a hard error.

Both are fixed in the source migration (for fresh environments) **and** in
`20260824125000_communities_select_grant.sql` (for production, where 120000 is
already applied). Co-member rosters are served by `GET /communities/:id/members`,
which runs as the service role and does the membership check in code.

## 5. Gates

See the table in §4 — all green. New tests this session:
`learningConnections.test.ts` (week boundaries + dedupe/self-connection),
`studyPresence.test.ts` (the privacy boundary), `network.test.ts` (shared display
helpers). The PGlite SQL harnesses live in the session scratchpad and are not
committed; re-create them from §4 if the migrations change.

## 6. Traps and known gaps

1. **SQL constructs that would each have failed** — caught by review before the
   first apply, and since confirmed by executing the migrations in PGlite (§4):
   - `week_start` could not be a `GENERATED` column — `AT TIME ZONE` and
     `date_trunc(text, timestamptz)` are STABLE, and generation expressions must
     be IMMUTABLE. It is a trigger-forced column instead.
   - `user_topic_mastery` could not use a `PRIMARY KEY (user_id, topic, course_id)`
     — a PK forces `course_id NOT NULL`, and a course-less row would need a
     sentinel that violates the FK to `courses`. It uses the repo's existing
     idiom: nullable column + a unique index over `COALESCE(course_id, zero-uuid)`.
   - `refresh_user_topic_mastery` was **rewritten from temp tables to CTEs**:
     plpgsql caches query plans per session, and a TEMP TABLE dropped and
     recreated across calls on a pooled connection invalidates them, so the
     second call fails with "relation with OID … does not exist".
2. **`refresh_creator_stats` is REPLACED by migration `122000`.** If you apply
   migrations out of order, the Phase 2 version wins and disputes stop counting.
3. **Auto vs joined membership is a privacy boundary** (§1), not a detail.
   Leaving an auto community records `opted_out_at` rather than deleting the
   row — a DELETE would be undone by the next profile save.
4. **The feed must stay pull-based.** Do not turn `activity_events` into a
   realtime channel or fan it out per recipient.
5. **Not every O writer is wired yet.** Wired: pack entitlement, completed
   order, question upvote, follow. **Not wired:** challenge completion,
   group-mate question answered, question VERIFIED, deck-collaborator study,
   note redemption/copy, pack score, review left, accepted DM request. The
   service and schema handle them; the hooks are one call each
   (`getLearningConnectionsService(...).record({...})`).
6. **Counters `notes.view_count` and `decks.study_count` have columns and an
   RPC (`record_deck_study`) but no writer wired yet** — nothing calls them, so
   they stay 0 until a study/view path calls the RPC.
7. **`Alert.prompt` is iOS-only.** The mobile dispute flow falls back to sending
   the category alone on Android rather than silently doing nothing; a proper
   Android text step is a follow-up.
8. All the standing repo traps still apply — real repo is `~/Desktop/lantern-study`
   (lowercase), root `tsc` is a FALSE gate, jest must run from inside
   `apps/api-server`, two client trees, `UNFILED_COURSE_ID` is the string
   `'null'`, no root-level mobile `Market` route.

---

## 7. Suggested next steps

1. Apply the five migrations in order; probe; then deploy the API and web.
2. E2E the loop in production: set an academic profile → auto communities appear
   in Discover → join a horizontal community → publish a pack → confirm the feed
   row and the `learning_connections` row → open a dispute → resolve it and watch
   trust move.
3. Wire the remaining O writers (§6.5) and the counter writers (§6.6).
4. Phase 4 (Q–W) is unchanged and still unbuilt; **S** is explicitly a thin
   layer over Phase 2 H and should reuse `POST /ai/study-pack/draft`.

*The canonical "resume here" pointer is the repo root `HANDOVER.md`.*
