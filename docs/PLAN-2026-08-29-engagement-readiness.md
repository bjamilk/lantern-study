# Engagement & exam readiness — how communities, groups, people and the academic graph tie together

*2026-08-29. Companion to `docs/PLAN-2026-08-22-knowledge-network.md` (the phase letters
below are its vocabulary). The first slice shipped with this doc; see §4.*

## 1. The spine, and what hangs off it

Everything in Lantern hangs off one spine — the **academic graph**:

```
Institution → Programme → Level → Course → Topic
```

A student's profile pins them to a point on that spine (A). Every artefact —
note, deck, test, question bank, study pack — is **filed** to a course and topic
on it (B). Every study action — a card reviewed, a question answered, a bank
downloaded — is **recorded** against it (`learning_events`, C). And the three
social surfaces are just the same spine viewed as *people*:

- **Communities** (Phase 3 · L/M) are the spine's *places*: your campus room,
  programme room, level room and one room per course, auto-derived from the
  academic profile. They are where a course's accumulated knowledge is visible
  as a living thing — who is here, what they publish, what is trending.
- **Groups** are the spine's *workrooms*: chat, shared decks, group challenges,
  offline test packs. Communities are ambient; groups are where studying
  actually happens together.
- **People** are the spine's *edges*: classmates at your level, seniors who
  took the course last year, creators whose packs cover it, mentors one DM
  away. Trust levels and creator stats make the good ones findable.

## 2. The loop the user described — and how the data delivers it

> A new student gains admission (or moves up a level, or transfers into a new
> programme) and, from day one, is exposed to what they need to know — based on
> the records and the difficulties of the students before them — and their exam
> readiness is constantly gauged.

That loop closes with pieces that all exist:

1. **Day one — placement.** Setting the academic profile drops the student
   into their campus/programme/level/course communities (already live) and
   enrols their courses (`user_courses`). This works identically for a fresh
   admission, a level change, or a transfer: change the profile, the rooms and
   courses follow. Nothing else needs re-entering.
2. **Day one — the syllabus is the map.** Each course carries a shared outline
   (`course_topics`, seedable from what previous students actually tagged —
   `seed_course_topics_from_tags`). A brand-new student immediately sees the
   territory: *18 topics, here is the first one* ("Start here").
3. **The record of previous students.** Three community assets cover "what
   they need to know": artefacts filed to the course (notes/decks/banks in the
   Library and, when the pilot opens, the marketplace), the course community
   room, and the **class signal** — `course_topic_mastery`, the population
   aggregate of what students of this course find hardest, cohort-floored at
   20 so a small class is never re-identifiable.
4. **Constantly gauged.** Every test submission and (since this slice) every
   flashcard review refreshes the student's **mastery graph**
   (`user_topic_mastery`: accuracy per topic + FSRS card maturity, honest NULL
   when evidence is thin). The **readiness rollup** joins that graph to the
   course outline: coverage (topics started / outline) blended with mastery
   (0.4 / 0.6) into one honest number per course, with the exam countdown when
   an exam date is set.
5. **The loop closes socially.** A readiness gap points at a topic → the topic
   points at community artefacts and the course room → studying them writes
   events → the graph moves → the gauge updates → streaks, leaderboards and
   "you helped N people learn" (O) feed the motivation to go again. Chat is
   the connective tissue throughout — this system doesn't replace it, it gives
   chat something concrete to be about.

## 3. Honesty rules (carried over, non-negotiable)

- A topic with no evidence is **"not enough data yet"**, never 0 %.
- Coverage alone never fabricates a readiness score — starting 3 topics tells
  you nothing about how well they went.
- Population signals only appear at cohort ≥ 20 (`MASTERY_MIN_COHORT`), and
  say so when locked.
- Being strong on 2 of 18 topics must not read as exam-ready — hence the
  coverage blend.

## 4. Shipped in this slice (2026-08-29)

- **Shared** `computeCourseReadiness` (`packages/shared/src/network`): the one
  place that bridges `course_topics.title` ↔ `user_topic_mastery.topic`
  (case/whitespace-insensitive — nothing in the DB joins them) and rolls up
  coverage, mastery, readiness, "Start here" and weakest topics. Tested.
- **API** `GET /api/v1/mastery/readiness[?courseId=]` — every ACTIVE course
  (no exam date required, unlike `/exam-readiness`), plus the class signal on
  the single-course form. Mastery now also refreshes on the flashcard-review
  path (debounced), not only on test submission.
- **Web**: `CourseReadinessCard` on the Dashboard — per-course bars,
  countdowns, Start-here, expandable per-topic breakdown + class signal.
- **Mobile**: matching Dashboard card; the `Mastery` screen (previously
  registered but unreachable) is now its tap-through, upgraded to lead with
  the course rollup and accept a `courseId` focus.

## 5. Next slices, in leverage order

1. **Seed outlines at enrolment** — prompt course creators/first enrollees to
   seed topics (the RPC exists); an outline is what makes day one concrete.
2. **Topic → artefact hop**: "Start here: Enzymes" should open the Library
   filtered to that topic (`?topicId=` filters already exist on both clients)
   and offer the course room + best community artefacts beside your own.
3. **Fold question-bank scores in** (`marketplace_question_bank_scores` →
   listing → course): purchased-bank practice should move readiness.
4. **Difficulty (P) done right**: first-attempt, learner-weighted p-correct
   from `learning_events` — with the structural guard against the `q-0`
   target-id collision (see `docs/NOTES-2026-08-23-remaining-work-discovery.md`).
5. **Retention producers (U)**: due-cards / exam-countdown reminders through
   the existing notification + cron plumbing.
6. **Effectiveness (T)**: Δ-mastery after `resource_opened`/`bank_downloaded`
   — makes "this pack actually helps" a measurable claim on listings.
