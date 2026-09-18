-- "Sync with your class": a syllabus and an exam date on a study set.
--
-- WHY. A brand-new set lands a student on an empty room. The reference's first
-- landing is not the room at all — it is one card that asks for the two facts
-- that make everything after it sharper: WHEN the exam is, and WHICH topics
-- belong to it. Lantern had neither on a set. It had `user_courses.exam_date`
-- (20260822130000), which only exists for a student enrolled in a course, and
-- a course-less set — which is most of them — could not carry a date at all.
--
-- exam_date. This column was already written, in 20260911140000, and that file
-- was never hand-applied: the whole client stack downstream of it — the
-- projection ladder in services/studySets.ts, `examDateUnsupported` riding
-- back on a 200, `EXAM_DATE_UNSUPPORTED_COPY` in the web field, the mobile
-- Home "Upcoming exam" card reading `set.examDate` — is code that has never
-- had a column under it. It is re-declared here, with `IF NOT EXISTS`, so ONE
-- hand-apply switches on the whole feature rather than two, and so a database
-- that already ran 20260911140000 is untouched. Applying this file is what
-- makes the existing exam-date UI stop saying "not switched on yet".
--
-- syllabus_note_id. The syllabus is STORED AS A NOTE of the set — the same
-- object every other uploaded document becomes — so it needs no table of its
-- own, it appears in the set's materials, and it is deleted, searched and
-- exported by the machinery that already exists. This column only records
-- WHICH note it is. ON DELETE SET NULL: deleting the note must unlink the
-- syllabus, never delete the set.
--
-- syllabus_summary. The extracted schedule, as JSONB:
--   { "weeks": [{ "week": 1, "title": "…", "date": "YYYY-MM-DD"|null,
--                 "examLabel": "Midterm"|null }],
--     "examDates": ["YYYY-MM-DD"], "extractedAt": "…" }
-- Denormalised on purpose: it is read once, whole, by the set room, and it is
-- derived data — a re-upload replaces it. It is capped on the way in by
-- `normalizeSyllabusSummary` (packages/shared/src/study/syllabusSummary.ts),
-- which is the ONLY writer; the CHECK below is the second wall, because the
-- API is not the only thing that can write this table.
--
-- RLS is unchanged: `study_sets` is already owner-scoped by four policies from
-- 20260911120000, and these are columns on that same row.
--
-- APPLIED BY HAND. Nothing replays migrations here. Until this file is applied
-- against the linked project the API's `studySetSyllabus` capability probes
-- false: the set list and the set home degrade to "no syllabus card", and
-- POST /study-sets/:id/syllabus answers 503 naming this file rather than
-- charging an AI use for work it cannot store. See
-- apps/api-server/src/services/schemaCapabilities.ts.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS exam_date date;

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS syllabus_note_id uuid;

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS syllabus_summary jsonb;

-- The FK is added as a NAMED constraint in its own statement rather than
-- inline on ADD COLUMN: `ADD COLUMN IF NOT EXISTS` carrying an inline
-- REFERENCES is skipped WHOLESALE on a re-run if the column already exists
-- without it, so the constraint would silently never arrive. Same idiom as
-- 20260918120000_practice_folders.sql.
ALTER TABLE public.study_sets
  DROP CONSTRAINT IF EXISTS study_sets_syllabus_note_id_fkey;
ALTER TABLE public.study_sets
  ADD CONSTRAINT study_sets_syllabus_note_id_fkey
  FOREIGN KEY (syllabus_note_id) REFERENCES public.notes(id) ON DELETE SET NULL;

-- `IF NOT EXISTS` does not exist for CHECK constraints, so the re-run guard is
-- a catalog lookup. DROP-then-ADD would briefly leave the table unconstrained.
--
-- The CHECK is a SHAPE check, not a schema: an object with a `weeks` array. It
-- deliberately does not enumerate the week fields — that is
-- `normalizeSyllabusSummary`'s job and duplicating it in SQL would mean two
-- validators drifting apart. What it does stop is the one failure a client
-- cannot recover from: a scalar or an array landing where the readers expect
-- an object, which would make every set room throw on read.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.study_sets'::regclass
      AND conname = 'study_sets_syllabus_summary_shape_check'
  ) THEN
    ALTER TABLE public.study_sets
      ADD CONSTRAINT study_sets_syllabus_summary_shape_check
      CHECK (
        syllabus_summary IS NULL
        OR (
          jsonb_typeof(syllabus_summary) = 'object'
          AND jsonb_typeof(syllabus_summary -> 'weeks') = 'array'
          AND jsonb_array_length(syllabus_summary -> 'weeks') <= 60
        )
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.study_sets.exam_date IS
  'The set''s own exam date (YYYY-MM-DD), so a course-less set can have one too. Wins over user_courses.exam_date — see resolveExamDate in packages/shared/src/learning/studyCalendar.ts. NULL means no date set.';

COMMENT ON COLUMN public.study_sets.syllabus_note_id IS
  'The note holding the uploaded syllabus document. The syllabus is an ordinary note of this set, so it lists, opens and deletes like any other material; this column only records which one it is. NULL means no syllabus uploaded.';

COMMENT ON COLUMN public.study_sets.syllabus_summary IS
  'Derived schedule extracted from the syllabus: { weeks: [{ week, title, date, examLabel }], examDates: [], extractedAt }. Written only by normalizeSyllabusSummary (packages/shared/src/study/syllabusSummary.ts), which caps it; a re-upload replaces it. NULL means no syllabus has been read.';
