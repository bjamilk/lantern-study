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

## Gaps that remain, ranked

### Makes a shipped feature not work
- **`groups.visibility` defaults to `private` with no UI to change it**, so
  `discoverGroups`' `visibility IN ('public','community')` filter matches nothing
  — Discover's Groups tab can only ever be empty (L).
- **No code path creates a horizontal/topic community**, so the join machinery has
  nothing non-derived to act on (L).
- **6 of 10 `activity_events` verbs have no writer** — `shared_note`,
  `joined_community`, `completed_challenge`, `unlocked_badge`,
  `added_deck_collaborator`, `answered_question` (M).
- **Feed panel is web-only**; mobile's dashboard has none (M).
- **Condition-filtered browse returns no trust** — that path bypasses
  `attachSellerTrust`; and browse *cards* never render trust on either client (N).
- **Study-pack update/republish and restore have no UI caller** on either
  platform (G).
- **`concepts` API has zero callers** outside the server (C).
- **`learning_events.surface` is always `'api'`** — the privacy policy tells users
  otherwise (C).

### Plan deliverables never built
- `course_topics` / `topic_id` (A) — deferred by contract, but never landed.
- F's whole instrumentation half: `profiles.activated_at`, an activation stage in
  `admin_analytics`, server-side onboarding flag, time-to-first-study-action.
- Trending tab in Discover (L/M) — the 4th tab the plan names.
- Ambassador badge + leaderboard, invite unfurl `functions/invite/[id].ts`, and
  the campus playbook seeding (Q).
- IndexNow, and a seeded UNILAG (R).
- Entitlement-based review eligibility (G) — a defect the plan explicitly called out.
- Question difficulty from `user_question_stats` (P).

### Not built at all — plan-gated, confirmed absent
**S, T, U, V, W.** No code exists for any of them.

---

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
