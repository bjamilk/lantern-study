-- Current semester on the academic profile.
--
-- Courses and enrolments already carry `semester smallint CHECK (semester IN
-- (1,2))` (20260822130000), but the PROFILE only knew the study level — so a
-- student in 300 level could not say whether they are in first or second
-- semester, and nothing downstream (course lists, readiness, study packs)
-- could scope to the semester they are actually sitting.
--
-- Nullable by design: existing profiles keep working, and a student who does
-- not want to say simply leaves it unset (the UI offers "Not set").

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS current_semester smallint
    CHECK (current_semester IN (1, 2));

COMMENT ON COLUMN public.profiles.current_semester IS
  'Semester the student is currently in: 1 = first, 2 = second. NULL = not set.';

NOTIFY pgrst, 'reload schema';
