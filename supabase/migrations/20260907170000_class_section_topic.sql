-- Optional topic scope on a class (docs/phase-teach-portal-contract.md).
-- A lecturer may run a class for one syllabus topic (Fractions) rather than
-- the whole catalogue course (Mathematics / BIO 201). The course row stays
-- the parent; topic_id is null when the class covers the whole course.
--
-- Hand-apply after 20260907120000_class_sections.sql (and course_topics).
-- Idempotent.

ALTER TABLE public.class_sections
  ADD COLUMN IF NOT EXISTS topic_id uuid REFERENCES public.course_topics(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS class_sections_topic_id_idx
  ON public.class_sections (topic_id)
  WHERE topic_id IS NOT NULL;

COMMENT ON COLUMN public.class_sections.topic_id IS
  'When set, this class covers one course_topics row, not the whole course.';
