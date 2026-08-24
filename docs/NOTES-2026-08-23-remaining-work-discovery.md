# Discovery notes for the remaining work

Companion to `docs/HANDOVER-2026-08-23-remaining-work.md`. Produced by a
read-only survey of the codebase; each item is implementation-ready. **The traps
are the valuable part** — several would have shipped a real bug.

---

## F instrumentation

**Build by DELEGATION to `referral_activation_check`, never by restating `10`/`2`.**
That function is live and pays real coins (`REFERRAL_REWARD_REFERRER = 200`), so
a second copy of the thresholds diverges silently the day someone tunes one.
Suggested shape: `profiles.activated_at` + `first_study_action_at`, written
server-side only, protected by a trigger exactly like `verification_level` —
otherwise a client writing through PostgREST could **self-activate and self-pay**.

Traps:
- **The onboarding key already disagrees across clients.** Web writes
  `localStorage['lantern_onboarding_complete'] = '1'`; mobile writes `'true'` and
  strictly compares `=== 'true'`. Latent today (different stores), fatal for any
  shared server-side reader.
- **`featureTips` is rebuilt field-by-field in five places** —
  `normalizeFeatureTips`, `toPersistentFeatureTips`, `mergeFeatureTipsProgress`
  (`settings/progress.ts`), `normalizeFeatureTipsSettings`
  (`settings/userSettings.ts`), `sanitizeFeatureTips` (`settingsPatch.ts`) — plus
  an explicit object literal in each client's `featureTipStore`. **An unlisted
  key is silently dropped on every read.** No route change is needed (`featureTips`
  is already an accepted settings category); the field list is the whole job.
- **`admin_analytics` v3 is a full 472-line restatement** (`CREATE OR REPLACE`
  needs the whole body), and its TS mirror is duplicated in **two** files:
  `apps/api-server/src/services/supabase.ts` and `services/admin.ts`.
- `acquisitionFunnel` already mixes denominators — `signupsCompleted` counts
  `profiles.created_at`, the rest count `product_events`, which are
  **consent-gated**, so `onboardingCompleted` is biased by consent rate. Web's
  *skip* path never fires the event at all.

## `authored_difficulty` — still needs your decision

Unchanged: the column has no writer **and no source for a value**. Author-asserted
vs derived-from-p-correct are different features sharing a column name.

## Question difficulty (Phase 3 P)

**Definition worth keeping:** first-attempt, learner-weighted —
`p_correct(Q) = distinct learners whose FIRST attempt was correct / distinct
learners who attempted`. One learner, one observation. That single rule kills
counter inflation, re-test bias (a second attempt measures memory, not item
difficulty), and makes the cohort floor count *people*.

- **Source `learning_events`, NOT `user_question_stats`** — the latter is
  mobile-only, client-authored, unordered and re-test-inflated.
- **THE TRAP THAT WOULD SHIP A FABRICATED STATISTIC:** every AI-generated
  question lands in `learning_events.target_id` as `q-0`, `q-1`, …
  (`testHelpers.ts` → `id: String(q.id || \`q-${index}\`)`). A plain
  `GROUP BY target_id` merges **thousands of unrelated questions** into one
  bucket that then clears any cohort floor. The defence must be structural: a
  `question_id uuid REFERENCES public.messages(id)` primary key, so a non-uuid id
  cannot be inserted at all.
- Copy `refresh_user_topic_mastery`'s architecture wholesale: one statement of
  CTEs (never temp tables — the pooled-connection plan-cache reason is documented
  in that migration), `SECURITY DEFINER`, service-role-only, and NULL rather than
  a fabricated 0 when evidence is thin.

## Q completion

- **Ambassador badge is ~40 lines and needs no migration** — add the id to
  `BadgeId` and a definition to `gamification.ts`; the admin console already
  iterates the catalogue, so granting works with no new endpoint or UI.
- **Never give a new badge a level-1 `threshold: 0`.** `checkAndAwardBadges`
  tests `currentStatValue >= nextLevel.threshold` with the value defaulting to 0,
  so threshold 0 mass-awards it to every user on the next sync.
- **`mapUserStatsFromApi` hard-codes every stat key.** A new `UserStats` field not
  added there reads 0 forever — the badge is never awarded and nothing errors.
  Same for `initialUserStats`.
- Extend the existing `GET /gamification/leaderboard` with
  `institutionId`/`ambassador` filters rather than building a second leaderboard.

## Concepts UI

**The API is WRITE-ONLY and that is blocking.** `routes/concepts.ts` has three
routes: find/create/link. There is **no GET of a target's links and no unlink** —
so chips can be added but never displayed on reload or removed. Add both first;
`assertCanAccessTarget` already exists and is reusable for each.

Then clone the existing "search a shared vocabulary, mine-first, with inline
find-or-create" pattern rather than inventing one: web
`components/academic/useCourseSearch.ts`, and the mobile `CoursePicker`.

## Phase 4 S — semester → products

**The credit ceiling makes the headline feature a lie if ignored.**
`DEFAULT_AI_DAILY_LIMIT = 20` and a draft costs 5 → **a maximum of 4 drafts per
day**. "One click turns your semester into products" is false above N=4. Return
`creditsRemaining` in the proposal payload, cap the selection client-side, and
**create sequentially** — `aiRateLimitWithCost` reserves atomically per request,
so N parallel POSTs each pass their own reserve check and leave a ragged partial
result.

Otherwise genuinely thin: one method on the existing `StudyPackFactoryService`
(inside the class, so it reuses the private `classify()` and `suggestPriceKobo()`
and prices come from the same median-of-comparables), reusing
`getLibrarySearchService().getOverview()` for the semester's courses. No
migration, no new table, no second factory.

## Phase 4 U — retention loops

Genuinely producers, not infrastructure: reuse the `marketplace-alerts` queue and
its single cron worker, `scheduleRepeatableCronJobs()`, `wrapProcessor`, and
`SupabaseService.createNotification` (which already does preference-gating +
in-app row + Expo push). Clone `job_reminders_sent` for idempotent claims.

Traps:
- **`RESEND_API_KEY` is absent from `render.yaml` entirely** (web *and* worker),
  so `isAlertMailConfigured()` is already false in production and job-alert
  emails silently no-op today. **`cron.weeklySummary` will do nothing until it is
  added to the worker env.**
- **Emails live in `auth.users`, not `profiles`.**

## Phase 4 V — study rooms

One hand-applied migration repurposing the dormant `study_sessions` /
`study_session_participants` tables (extend RLS), rooms attached to courses and
communities rather than only groups, plus the existing `CreateLabModal`.

---

*Full agent output, if more detail is ever needed:*
`Workflow({ scriptPath: ".../remaining-work-discovery-wf_b3136bf6-386.js", resumeFromRunId: "wf_b3136bf6-386" })`
replays from cache.
