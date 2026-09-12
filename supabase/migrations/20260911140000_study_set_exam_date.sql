-- A study set carries its own exam date, so a course-less set can have one too.
ALTER TABLE public.study_sets ADD COLUMN IF NOT EXISTS exam_date date;
