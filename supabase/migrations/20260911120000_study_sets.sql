-- Personal study sets: the default container on the Study tab.
-- A course is an optional tag. Creating a set does not require enrolment.

CREATE TABLE IF NOT EXISTS public.study_sets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  course_id UUID REFERENCES public.courses(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_sets_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS study_sets_user_id_idx
  ON public.study_sets (user_id, updated_at DESC);

DROP TRIGGER IF EXISTS update_study_sets_updated_at ON public.study_sets;
CREATE TRIGGER update_study_sets_updated_at
  BEFORE UPDATE ON public.study_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS study_set_id UUID REFERENCES public.study_sets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notes_study_set_id_idx ON public.notes (study_set_id);

ALTER TABLE public.decks
  ADD COLUMN IF NOT EXISTS study_set_id UUID REFERENCES public.study_sets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS decks_study_set_id_idx ON public.decks (study_set_id);

ALTER TABLE public.study_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS study_sets_select ON public.study_sets;
DROP POLICY IF EXISTS study_sets_insert ON public.study_sets;
DROP POLICY IF EXISTS study_sets_update ON public.study_sets;
DROP POLICY IF EXISTS study_sets_delete ON public.study_sets;

CREATE POLICY study_sets_select ON public.study_sets
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY study_sets_insert ON public.study_sets
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY study_sets_update ON public.study_sets
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY study_sets_delete ON public.study_sets
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
