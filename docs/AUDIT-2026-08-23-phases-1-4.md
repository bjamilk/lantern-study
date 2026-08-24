# Implementation audit — Phases 1–4

**Date:** 2026-08-23 · **HEAD at audit:** `ca753e4` · **Fixes:** `7584c87`

16 agents audited every workstream against `docs/PLAN-2026-08-22-knowledge-network.md`
§4, the codebase and production, instructed to be adversarial and to treat the
handover docs as claims to verify rather than facts.

---

## Verdict

| Phase | Workstreams | Verdict |
|---|---|---|
| **1** Foundations | A/F, B, C, D, E | **Live, with gaps** |
| **2** Creator loop | G, H, I, J | **Live, with gaps** |
| **3** Network | L, M, N, O, P | **Live, with gaps** |
| **4** Density | Q, R built · S/T/U/V/W not built | **2 of 7** |

Infrastructure is real and verified in production: **19 tables** (courses,
user_courses, learning_events, concepts, concept_links, content_reports,
moderation_strikes, marketplace_study_packs, study_pack_drafts, profile_follows,
creator_stats, communities, community_members, activity_events, study_presence,
deck_studiers, learning_connections, user_topic_mastery, referrals) and **every
API route** returns 401/200, none 404.

Every workstream audited came back **partial**, not "implemented". The pattern is
consistent: the schema and the server are solid; what is thin is the **last mile**
— client parity, and callers for things that were built.

---

## Three things shipped that never worked — FIXED in `7584c87`

All three from Phase 3, all the same failure mode: plumbing built end to end with
nothing at the near end calling it.

1. **Presence was entirely dead.** `setStudyIntent()` had four references in the
   repo: two definitions and two doc comments. No screen called it, and the
   heartbeat only writes `study_presence` when a context is set — so the table was
   never written and "N studying right now" was permanently zero on both clients.
2. **`/discover/c/:slug` was a shipped dead end on web.** The route mapped to
   `AppMode.COMMUNITY_DETAIL` and every community card called
   `onNavigate('CommunityDetail')`, but App.tsx had zero references and no
   component existed. Mobile had the screen; web never got one.
3. **`decks.study_count` was write-only.** Incremented but never selected or
   rendered — the same dead-schema smell as `notes.view_count`, which was dropped
   for exactly this reason.

---

## Gaps — status after the fix pass

**Fixed in `4d7e62b` and `eab261c`** (both deployed and verified in production):

| Was | Now |
|---|---|
| `GET /communities/:id/members` leaked private profiles to anyone auto-added to the same community | Applies the same rule as `profile_visible_to_viewer`; 'groups' tier needs BOTH sides JOINED |
| `groups.visibility` unsettable → Discover Groups tab empty by construction | Settable (admin-only) with `communityId` + `tags` |
| No path created a horizontal community | `POST /communities`, restricted to `kind='topic'` |
| Trust attached but invisible; fallback browse had none | Fallback path attaches it; both clients render the chip |
| 6 of 10 `activity_events` verbs had no writer | All 10 wired |
| Feed panel web-only | Mobile dashboard panel added |
| Free-digital owners could not review (the defect the plan itself named) | Entitlement now counts as proof of delivery |
| No test pinned the auto/joined privacy boundary | 12 tests in `communities.test.ts` |
| `learning_events.surface` always `'api'` — contradicting the live privacy policy | CORS allows the header; both clients send it |
| Mobile offline study collapsed onto the sync day | Grade time stamped at queue and replayed |
| `/sitemap/campuses.xml` served the SPA shell to crawlers | Own Pages Function; registered for IndexNow |
| Sellers could not update a published pack | `UpdateStudyPackModal` from the source deck |

### Still open — deliberately, with reasons

- **Trending tab** (L/M). The plan names a 4th Discover tab. Needs a real
  trending signal; `product_events` is consent-gated and 90-day, so it cannot be
  the source, and `learning_events` needs more than two days of data to rank
  anything honestly. Building it now would ship a ranked list of noise.
- **`course_topics` / `topic_id`** (A). A whole entity the contract already
  deferred once; it changes the shape of every artefact table and every picker.
  Worth its own slice, not a tail-end patch.
- **F instrumentation** — `profiles.activated_at`, an activation stage in
  `admin_analytics`, server-side onboarding flag, time-to-first-study-action.
  Phase 4 Q's `referral_activation_check` now defines activation server-side, so
  this should be built ON that definition rather than inventing a second one.
- **Concepts UI callers** (C). The API works; the tagging UI it needs is the
  Phase 3 P work the contract explicitly deferred.
- **`authored_difficulty`** (C) — has no writer *and no source for a value*; the
  AI generation path does not produce one. Needs a product decision first.
- **Ambassador badge + leaderboard, invite unfurl, campus seeding** (Q). The
  `is_ambassador` flag and `listAmbassadors` exist; the badge, the leaderboard
  and `functions/invite/[id].ts` do not. Seeding is a data/ops task.
- **Question difficulty from `user_question_stats`** (P).
- **Phase 4 S, T, U, V, W** — not started. T and W remain plan-gated.

## Where the handovers overclaimed

The audit's blunt section. None of the handovers asserts anything false, but
several **overclaim by omission** — a reader taking "Phase N shipped" at face
value would believe more is done than is:

- **Phase 1 A/F "shipped"** omits that F's entire instrumentation clause is
  missing, and that `note_folders.course_id` has no client writer on either
  platform, so "every artefact create/edit has a course picker" is not met.
- **Phase 2 G** did not disclose that the plan's own called-out defect
  (free-download owners cannot review) is untouched, nor that update/restore have
  no UI callers.
- **Phase 3 M** claimed presence and counters as delivered when neither had a
  caller or a reader — the three defects fixed in `7584c87`.
- **Phase 3 L** claimed the Discover hub complete while web had an unclickable
  dead end and the Groups tab could never populate.

**The lesson, stated plainly:** "the code is written and the gates are green" is
not the same as "the feature works". Everything fixed in `7584c87` had passing
types, passing tests and a green build.
