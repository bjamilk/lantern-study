-- Wave 1 filing + Wave 3 plan + Wave 4 folders for personal study sets.
-- Tests live in test_sessions (there is no tests table).

ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS last_studied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS folder_id UUID,
  ADD COLUMN IF NOT EXISTS cover_path TEXT;

ALTER TABLE public.study_sets
  DROP CONSTRAINT IF EXISTS study_sets_description_len;
ALTER TABLE public.study_sets
  ADD CONSTRAINT study_sets_description_len
  CHECK (description IS NULL OR char_length(description) <= 280);

ALTER TABLE public.study_sets
  DROP CONSTRAINT IF EXISTS study_sets_mode_check;
ALTER TABLE public.study_sets
  ADD CONSTRAINT study_sets_mode_check
  CHECK (mode IN ('cram', 'standard', 'comprehensive'));

ALTER TABLE public.study_sets
  DROP CONSTRAINT IF EXISTS study_sets_visibility_check;
ALTER TABLE public.study_sets
  ADD CONSTRAINT study_sets_visibility_check
  CHECK (visibility IN ('private', 'public'));

CREATE TABLE IF NOT EXISTS public.study_set_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_set_folders_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 80)
);

CREATE INDEX IF NOT EXISTS study_set_folders_user_id_idx
  ON public.study_set_folders (user_id, created_at DESC);

ALTER TABLE public.study_sets
  DROP CONSTRAINT IF EXISTS study_sets_folder_id_fkey;
ALTER TABLE public.study_sets
  ADD CONSTRAINT study_sets_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES public.study_set_folders(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.study_set_units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id UUID NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_set_units_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 120)
);

CREATE INDEX IF NOT EXISTS study_set_units_set_idx
  ON public.study_set_units (study_set_id, position);

CREATE TABLE IF NOT EXISTS public.study_set_topics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id UUID NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  unit_id UUID NOT NULL REFERENCES public.study_set_units(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 10,
  status TEXT NOT NULL DEFAULT 'unseen',
  source_note_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT study_set_topics_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  CONSTRAINT study_set_topics_status_check CHECK (status IN ('unseen', 'covered', 'mastered'))
);

CREATE INDEX IF NOT EXISTS study_set_topics_set_idx
  ON public.study_set_topics (study_set_id, position);
CREATE INDEX IF NOT EXISTS study_set_topics_unit_idx
  ON public.study_set_topics (unit_id, position);

ALTER TABLE public.test_sessions
  ADD COLUMN IF NOT EXISTS study_set_id UUID REFERENCES public.study_sets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS test_sessions_study_set_id_idx
  ON public.test_sessions (study_set_id);

ALTER TABLE public.study_set_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_set_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_set_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS study_set_folders_select ON public.study_set_folders;
DROP POLICY IF EXISTS study_set_folders_insert ON public.study_set_folders;
DROP POLICY IF EXISTS study_set_folders_update ON public.study_set_folders;
DROP POLICY IF EXISTS study_set_folders_delete ON public.study_set_folders;
CREATE POLICY study_set_folders_select ON public.study_set_folders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY study_set_folders_insert ON public.study_set_folders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY study_set_folders_update ON public.study_set_folders
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY study_set_folders_delete ON public.study_set_folders
  FOR DELETE TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS study_set_units_all ON public.study_set_units;
CREATE POLICY study_set_units_all ON public.study_set_units
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS study_set_topics_all ON public.study_set_topics;
CREATE POLICY study_set_topics_all ON public.study_set_topics
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
