# Phase 1 · A+F — Academic identity, courses, onboarding: implementation contract

Status: **building** (2026-08-22). **2026-08-22 review hardening:** the `institutions` view is `WITH (security_invoker = true)` and filters `active = TRUE` (it bypassed `marketplace_campuses` RLS and exposed deactivated campuses); `supabase/migrations/20260822170000_phase1_hardening.sql` (apply LAST) backfills `offline_bundles.course_id` for already-purchased packs (`bundle_id = 'qbank-<listingId>'`) from the listing. Apply `20260822130000` → `170000` in order BEFORE deploying the API — the create paths write `course_id` unconditionally (`docs/RELEASING.md`). Parent plan: `docs/PLAN-2026-08-22-knowledge-network.md` §4 (A, F). This file is the single source of truth for names/shapes so the DB/API builder and the web/mobile builders cannot disagree. Decisions taken (user can override): D2 promote `marketplace_campuses`; D3 one shared course row per (institution, code) — `is_canonical` marks curated rows; D4 faculty/programme as text; `course_topics` deferred to the concepts work (Phase 1 C).

## 1. Database — migration `supabase/migrations/20260822130000_academic_identity_and_courses.sql` (hand-applied; sequence after `20260822120000`; REQUIRED before the API deploy; `20260822170000_phase1_hardening.sql` follows it)

```sql
-- 1a. Institutions = marketplace_campuses, promoted.
ALTER TABLE public.marketplace_campuses
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'university'
  CHECK (kind IN ('university','polytechnic','college','other'));
UPDATE public.marketplace_campuses SET kind = CASE
  WHEN slug = 'other-city-nigeria' OR slug LIKE 'other-%' THEN 'other'
  WHEN name ILIKE '%polytechnic%' THEN 'polytechnic'
  WHEN name ILIKE '%college%' THEN 'college'
  ELSE 'university' END;
CREATE OR REPLACE VIEW public.institutions AS
  SELECT id, name, city, state, country_code, slug, kind, geopolitical_zone, active
  FROM public.marketplace_campuses WHERE kind <> 'other';
GRANT SELECT ON public.institutions TO anon, authenticated, service_role;

-- 1b. Academic profile columns (single writer for "my university").
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS faculty text,
  ADD COLUMN IF NOT EXISTS programme text,
  ADD COLUMN IF NOT EXISTS study_level smallint CHECK (study_level BETWEEN 100 AND 900),
  ADD COLUMN IF NOT EXISTS entry_year smallint CHECK (entry_year BETWEEN 1990 AND 2100),
  ADD COLUMN IF NOT EXISTS expected_graduation_year smallint CHECK (expected_graduation_year BETWEEN 1990 AND 2100);
CREATE INDEX IF NOT EXISTS profiles_institution_id_idx ON public.profiles (institution_id);
-- Backfill from the marketplace preference (settings.marketplace.campus_id), skipping sentinels.
UPDATE public.profiles p SET institution_id = c.id
  FROM public.marketplace_campuses c
  WHERE p.institution_id IS NULL
    AND (p.settings->'marketplace'->>'campus_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND c.id = (p.settings->'marketplace'->>'campus_id')::uuid
    AND c.kind <> 'other';

-- 1c. Courses: ONE row per (institution, code); shared by every student.
CREATE TABLE IF NOT EXISTS public.courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id uuid REFERENCES public.marketplace_campuses(id) ON DELETE SET NULL,
  code text NOT NULL,                    -- normalised: trim, uppercase, single spaces, e.g. 'BIO 201'
  title text NOT NULL,
  faculty text,
  level smallint CHECK (level BETWEEN 100 AND 900),
  semester smallint CHECK (semester IN (1,2)),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_canonical boolean NOT NULL DEFAULT false,   -- curated by Lantern/admins
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS courses_institution_code_uidx
  ON public.courses (COALESCE(institution_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(code));
CREATE INDEX IF NOT EXISTS courses_search_trgm_idx ON public.courses USING gin ((code || ' ' || title) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS courses_institution_idx ON public.courses (institution_id);
-- updated_at trigger: reuse public.update_updated_at_column() (exists since 20251121000000).

-- 1d. Enrolment = the student's archive spine. Archiving a semester = status='archived'; nothing moves.
CREATE TABLE IF NOT EXISTS public.user_courses (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  academic_year text NOT NULL,           -- '2026/2027' (API computes the default; see §2)
  semester smallint CHECK (semester IN (1,2)),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  exam_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, course_id, academic_year)
);
CREATE INDEX IF NOT EXISTS user_courses_course_idx ON public.user_courses (course_id);

-- 1e. Nullable course_id on every artefact table (ON DELETE SET NULL, each indexed):
--   notes, note_folders, decks, groups, test_sessions, offline_bundles,
--   marketplace_listings, marketplace_question_banks
-- (test_sessions.course_id replaces the dead config->>'subject' path.)

-- 1f. RLS: courses — SELECT authenticated; INSERT authenticated WITH CHECK (created_by = auth.uid());
--     UPDATE/DELETE service_role only. user_courses — owner ALL (user_id = auth.uid()); service_role ALL.
--     Enable RLS on both tables.
```

## 2. API (apps/api-server) — all under `/api/v1`, `authMiddleware` unless noted

Course code normalisation (shared util `normalizeCourseCode` in `packages/shared/src/academic/courses.ts`): trim → collapse whitespace → uppercase; insert a single space between the alphabetic prefix and digits if missing (`bio201` → `BIO 201`). Academic year default (shared util `currentAcademicYear(date)`): month ≥ 9 → `YYYY/YYYY+1`, else `YYYY-1/YYYY` (Nigerian calendar; the user can pass `academicYear` explicitly).

| Method & path | Body / query | Returns | Notes |
|---|---|---|---|
| `GET /courses?institutionId&q&limit=20` | — | `{ success, data: Course[] }` | ILIKE/trigram on `code || ' ' || title`; canonical first, then by code. `institutionId` optional (null-institution courses included when omitted). |
| `POST /courses` | `{ institutionId?, code, title, faculty?, level?, semester? }` | `{ success, data: Course }` 201 (created) / 200 (existing) | Find-or-create on normalised code. Title required on create (≥2 chars); ignored if the row exists. Sets `created_by`. |
| `GET /users/me/courses?status=active|archived|all&academicYear` | — | `{ success, data: UserCourse[] }` | Default `active`. |
| `PUT /users/me/courses` | `{ courseIds: string[], academicYear? }` | `{ success, data: UserCourse[] }` | Upserts the given set for that year as `active`; rows for that year not in the list are **deleted** (not archived). Max 40 ids. |
| `PATCH /users/me/courses/:courseId` | `{ examDate?: 'YYYY-MM-DD'|null, semester?: 1|2|null, status?: 'active'|'archived', academicYear? }` | `{ success, data: UserCourse }` | |
| `DELETE /users/me/courses/:courseId?academicYear` | — | `{ success }` | |
| `POST /users/me/courses/archive-semester` | `{ academicYear }` | `{ success, data: { archived: number } }` | Sets every row of that year to `archived`. |
| `PUT /users/:userId` (existing) | adds `institutionId?, faculty?, programme?, studyLevel?, entryYear?, expectedGraduationYear?` | existing shape + academic fields | Extend `validateUpdateUser` (validation.ts), `NON_ADMIN_UPDATABLE_FIELDS` (users.ts), the service mapper, and `toPublicUser`. `institutionId` must reference a non-`other` campus (400 otherwise). When `institutionId` is set and `settings.marketplace.campus_id` is null, also set that preference (write-through; never the other direction). |
| `GET /users/me`, `GET /users/:userId` | — | academic fields added | Public projection: `institutionId`, `institution: {id,name,slug} \| null`, `faculty`, `programme`, `studyLevel`. Owner/admin additionally: `entryYear`, `expectedGraduationYear`. |
| Artefact create/patch: `POST/PATCH /notes`, `POST/PUT /notes/folders`, `POST/PUT /decks`, `POST/PUT /groups`, `POST /tests` + drafts, `POST /offline-bundles`, `POST/PUT /marketplace/listings`, `POST /marketplace/question-banks/publish` | accept `courseId?: uuid \| null` | — | Validate uuid (400), store in the new column (and in `config.courseId` for test_sessions/offline_bundles). Question-bank publish writes `course_id` on both listing and bank. `validateCreateGroup` must gain the rule (it currently validates only name/description). |
| Artefact lists: `GET /notes`, `GET /decks`, `GET /tests`, `GET /offline-bundles`, `GET /marketplace/my-listings` | `?courseId=` | filtered | `GET /tests?subject=` is retired in favour of `courseId`; `/tests/stats/subject` groups by course (label = code) instead of the never-written `config.subject`. |

Error shapes follow the existing `{ success:false, error }` convention with `PublicError` for user-facing messages.

Cache: `GET /courses` results may be cached 5 min per (institutionId, q); invalidate on `POST /courses`. User-course routes are uncached.

## 3. Shared (packages/shared)

- `src/academic/courses.ts`: `normalizeCourseCode`, `currentAcademicYear`, `isValidAcademicYear`, `STUDY_LEVELS = [100,200,...,900]`, `studyLevelLabel(level)` ("100 level"). Export from `src/academic/index.ts` and from the root `src/index.ts`; add the `./academic` subpath to `package.json` exports (mirror `./marketplace`).
- `src/types/index.ts`: `Course { id; institutionId: string|null; code; title; faculty?: string|null; level?: number|null; semester?: 1|2|null; isCanonical: boolean }`, `UserCourse { course: Course; academicYear: string; semester?: 1|2|null; status: 'active'|'archived'; examDate?: string|null }`; `User` gains `institutionId?: string|null; institution?: {id; name; slug} | null; faculty?; programme?; studyLevel?; entryYear?; expectedGraduationYear?`; `courseId?: string|null` on `StudyNote`, `NoteFolder`, `Deck`, `Group`, `TestConfig`, `OfflineSessionBundle`, `MarketplaceListing`.
- `src/utils/apiMappers.ts`: map the new profile columns (snake → camel) wherever users are mapped.
- `src/api/endpoints.ts` (shared client): `fetchCourses({ institutionId?, q?, limit? })`, `createCourse(input)`, `fetchMyCourses({ status?, academicYear? })`, `setMyCourses({ courseIds, academicYear? })`, `updateMyCourse(courseId, patch)`, `removeMyCourse(courseId, academicYear?)`, `archiveSemester(academicYear)`. Mobile re-exports through `apps/mobile/src/services/api.ts` like the other marketplace functions; web wraps in `services/*.ts` as needed.

## 4. Web (root `components/`, `services/`, `stores/`, `hooks/`)

- **Profile setup step** (replaces the body of `UsernameRequiredModal`, still opened by `hooks/useAppEffects.ts:697-701` when `!currentUser.username`; ALSO open it when `currentUser.username && !currentUser.institutionId && !localStorage['lantern_academic_setup_dismissed']`): username (required; first/last optional), **institution** (required; `CampusSearchSelect` over `fetchMarketplaceCampuses()` filtered with `!slug.startsWith('other-')`), **programme** (text, optional), **level** (select 100–700, required), **courses** (typeahead multi-select using `fetchCourses({ institutionId, q })`, with an "Add ‘BIO 201’" row that calls `createCourse`; optional). Saves via `PUT /users/:id` + `PUT /users/me/courses`. "Skip for now" sets the dismissed flag (a banner on Dashboard offers to finish later).
- **OnboardingFlow** (`components/OnboardingFlow.tsx`): 3 steps — welcome → **starter deck** (existing AI generate path `App.tsx:1977-1991`, prompt pre-seeded with programme + first course code/title when known) → "Open Learn mode". Remove the goal and streak screens; set `studyGoal` to the existing default and streak target 7 silently via the settings API.
- **Settings → Academic** section in `SettingsModal.tsx`: institution, programme, level, entry year, expected graduation year; "My courses" list with add (same typeahead), remove, exam date, and "Archive this semester".
- **Course picker** (`components/academic/CoursePicker.tsx`, single-select, uses my courses first then search): wired into `NoteEditorScreen` (note meta), `CreateDeckModal`, `CreateGroupScreen` + `CreateGroupModal`, `TestConfigModal` (default from the group's `courseId`), `CreateMarketplaceListingModal` (replaces the free-text `courseCode`; keep writing `category_specific_fields.courseCode` = the course's code for backwards compat), `marketplace/PublishQuestionBankModal.tsx`, `EditMarketplaceListingModal`.
- Library/Notes/Flashcards lists: pass `courseId` filter when the user picks a course chip (a simple chip row of *my active courses* above Notes and Decks; the full Library tree is slice B).
- Dashboard: a one-line "Finish setting up your profile" banner when `institutionId` is null.

## 5. Mobile (apps/mobile)

- `SignUpScreen`: replace the `+1` phone block with **institution** (`CampusPicker`, no sentinels), **programme** (text), **level** (segmented 100–700); default phone country `+234` if the phone field stays anywhere. Write the new columns in the existing PostgREST profile insert (`SignUpScreen.tsx:275-281`) AND after sign-in call `PUT /users/:id` (the API is the source of truth; the insert is best-effort).
- `OnboardingScreen`: welcome → starter deck (call the shared AI generate endpoint with programme/course) → done. Remove goal/streak screens (set defaults silently).
- `UsernameRequiredModal` (OAuth path): same academic fields as web.
- Settings → Academic section (same as web); "My courses" management.
- `CoursePicker` component (`apps/mobile/src/components/CoursePicker.tsx`) wired into note editor, CreateDeck, CreateGroup, TestConfig, CreateListing/EditListing (adds course metadata mobile never had), `settings/PublishQuestionBankModal.tsx`.
- Stores: `authStore` user type gains the academic fields; `mapRemoteListing` maps `course_id`.

## 6. Out of scope for this slice (next slices)

Library course tree + `/library/search` (B) · `learning_events` + concepts (C) · store distribution (D) · attestation/reports/strikes/terms (E, beyond the takedown lock already done) · SEO campus pages (Phase 4).

## 7. Gates

`apps/api-server`: `npx tsc --noEmit` + `npx jest` (new tests: course code normaliser + academic-year util in shared; course find-or-create + user-course set semantics in API with the prototype+stub pattern used in `supabase.listingModerationLock.test.ts`). Root `npm run build` (web). `apps/mobile`: `npx tsc --noEmit`. No `git stash/checkout/restore/clean`. Do not commit.
