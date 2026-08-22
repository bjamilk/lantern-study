# Phase 1 · C — `learning_events` + concepts: implementation contract

Status: **queued** (2026-08-22). Parent plan: `docs/PLAN-2026-08-22-knowledge-network.md` §4 C. Decision D9 taken: learning events are **product data** (needed to run the learning product: mastery, readiness, recommendations), written **server-side regardless of the analytics cookie**, retained while the account exists, exported and deleted with the account. They are NOT `product_events` (consent-gated, 90-day, "anonymous product events" promise in `legal.ts:306`).

## 1. Database — `supabase/migrations/20260822150000_learning_events_and_concepts.sql` (after `20260822140000`; apply BEFORE the API deploy together with `130000`/`140000` — the create paths write the new columns unconditionally; `20260822170000_phase1_hardening.sql` sequences after `160000`, see `docs/RELEASING.md`)

```sql
CREATE TABLE IF NOT EXISTS public.learning_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN (
    'card_reviewed','question_shown','question_answered','resource_opened','note_created',
    'card_generated','question_generated','bank_downloaded','bank_score_recorded','group_question_posted')),
  target_type text CHECK (target_type IN ('flashcard','question','note','deck','listing','group','test_session')),
  target_id text,                           -- uuid or messages.id text (question ids are text)
  deck_id uuid, group_id uuid, note_id uuid, course_id uuid, session_id uuid, listing_id uuid,
  rating smallint,                          -- flashcard grade (again/hard/good/easy → 1-4)
  is_correct boolean,
  response_ms integer,
  confidence smallint,                      -- reserved (no capture yet)
  attempt_no smallint,
  count integer,                            -- for *_generated (items per call)
  srs_before jsonb, srs_after jsonb,
  surface text CHECK (surface IN ('web','mobile','api')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS learning_events_user_time_idx ON public.learning_events (user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_target_idx ON public.learning_events (target_type, target_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS learning_events_course_idx ON public.learning_events (course_id, occurred_at DESC) WHERE course_id IS NOT NULL;
ALTER TABLE public.learning_events ENABLE ROW LEVEL SECURITY;
-- service_role only (no policies for anon/authenticated); no UPDATE/DELETE except cascade.

CREATE TABLE IF NOT EXISTS public.concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,                       -- normalised lower-kebab of name
  name text NOT NULL,
  parent_id uuid REFERENCES public.concepts(id) ON DELETE SET NULL,
  course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('ai','user','import','backfill')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS concepts_course_slug_uidx
  ON public.concepts (COALESCE(course_id,'00000000-0000-0000-0000-000000000000'::uuid), slug);
CREATE INDEX IF NOT EXISTS concepts_slug_trgm_idx ON public.concepts USING gin (name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS public.concept_links (
  concept_id uuid NOT NULL REFERENCES public.concepts(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('flashcard','question','note','deck')),
  target_id text NOT NULL,
  confidence real NOT NULL DEFAULT 1.0,
  source text NOT NULL DEFAULT 'user' CHECK (source IN ('ai','user','import','backfill')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS concept_links_target_idx ON public.concept_links (target_type, target_id);
-- RLS: concepts SELECT authenticated, INSERT authenticated (created_by = auth.uid()); concept_links SELECT authenticated; writes service_role.

ALTER TABLE public.flashcards ADD COLUMN IF NOT EXISTS authored_difficulty text
  CHECK (authored_difficulty IN ('easy','medium','hard'));   -- NOT 'difficulty': srs_data.difficulty is FSRS state
-- Questions keep it in messages.question_data->>'authored_difficulty' (no column; JSONB payload).

-- Backfill concepts + links from existing free-text tags (idempotent, ON CONFLICT DO NOTHING):
--   flashcards.tags (jsonb array of strings) → concept per distinct lower(tag), link target_type 'flashcard'
--   messages.question_data->'tags' (type = 'QUESTION') → link target_type 'question' (target_id = messages.id::text)
--   course_id left NULL on backfill (no course attribution exists yet); source 'backfill'.
```

## 2. Shared

- `src/learning/events.ts`: `LearningEventType` union, `LearningEventInput` type, `normalizeConceptSlug(name)`; export `./learning` subpath + root.
- Types: `Concept`, `ConceptLink`; `Flashcard.authoredDifficulty?`; `GeneratedQuestion` already has `difficulty` — clients must persist it as `authored_difficulty` in `question_data` (web `hooks/useAIHandlers.ts:101-114`, mobile `GroupChatScreen.tsx:~164`).
- `src/api/endpoints.ts`: `fetchConcepts({ q, courseId })`, `createConcept(...)`, `linkConcept(...)` (thin; UI for concept tagging is Phase 3 P).

## 3. API — emitters (all server-side, fire-and-forget but awaited within the request; failures logged, never fail the user action)

New module `apps/api-server/src/services/learningEvents.ts` exporting `recordLearningEvent(service, input)` and `recordLearningEvents(service, inputs[])` (batch insert via the service-role client; coalesce obvious nulls; cap batch 500).

| Where | Event |
|---|---|
| `SupabaseService.reviewFlashcard` (`supabase.ts:~4192-4224`) | `card_reviewed` with `rating`, `srs_before`/`srs_after` (already in hand), `deck_id`, `target_id = flashcardId`, `surface` from a new optional param the route passes (`req.header('x-lantern-surface')` → 'web'|'mobile'|'api'; default 'api'). Also the offline replay path (pending flashcard reviews) → same emitter with `occurred_at = reviewedAt` when present. |
| Test completion (`completeTestDraft` ~`:6026` and `createTestResult` ~`:6254`) | one `question_answered` per `user_answers` entry: `target_id = questionId`, `is_correct`, `response_ms = timeSpentSeconds*1000`, `session_id`, `group_id = config.groupId`, `course_id = session course_id \|\| config.courseId`, `listing_id` parsed from `config.bundleId` (`qbank-<uuid>`) when present. Guard against double-emission when both paths run for one session (emit in the single function both call, or dedupe on (user_id, session_id) by checking `test_results` upsert result). |
| `upsertUserQuestionStat` (`~:4507`) | no event (covered by test completion). |
| Notes: `POST /notes` (create), `GET /notes/:noteId` (single fetch) | `note_created`, `resource_opened` (target note; course_id from the note). |
| AI: `POST /ai/generate-questions`, `POST /ai/generate-flashcards`, `POST /notes/:id/generate-flashcards`, `POST /notes/:id/quiz` | `question_generated` / `card_generated` with `count` and `note_id` where applicable. |
| Question banks: download (`marketplaceQuestionBanks.ts downloadQuestionBank`) → `bank_downloaded` (`listing_id`); score record → `bank_score_recorded`. |
| Group question posted (`POST /messages/group/:groupId` with type QUESTION) | `group_question_posted` (`group_id`, `target_id = message id`). |

Lifecycle: `apps/api-server/src/services/userDataLifecycle.ts` export includes `learning_events` (paged) and `concept_links` authored by the user; delete-immediate relies on CASCADE; `dataRetention.ts` does NOT purge learning_events; document in `docs/compliance/retention-schedule.md` ("Learning activity — kept while the account exists; deleted with the account") and `docs/compliance/ropa.md` (new row; ALSO add the missing `product_events` row while there), and `packages/shared/src/legal.ts` privacy policy gets a short "Learning activity data" paragraph (what, why, basis = performance of the service, retention, export/delete) — no cookie-consent dependency stated.

## 4. Tests & gates

Shared: slug normaliser. API: `recordLearningEvents` batching + null coalescing (stub client), `reviewFlashcard` emits with before/after, test completion emits N rows and never twice per session, export includes the table. Gates as usual (api tsc + jest, `npm run build`, mobile tsc). No stash/checkout; no commit.
