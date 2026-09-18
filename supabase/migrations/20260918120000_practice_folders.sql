-- Practice folders — filing quizzes and tests inside a study set.
--
-- WHY. PR #130 built one Practice hub over the quiz and test libraries and
-- found the reference's folder cards had nothing behind them: NOTHING in
-- Lantern files a quiz or a test into a folder. The only "folders" in reach
-- were `study_set_folders`, which group SETS — the old quiz library drew one
-- beside the quizzes reading "<name> · Folder" and clicking it LEFT the room
-- for the set picker. A founder read that as a quiz folder, which is exactly
-- the misreading it invites. A real Practice folder needs a table and a
-- column, which is this file.
--
-- WHAT. Quizzes and tests are ONE table: `test_sessions`. There is no `tests`
-- table (see 20260911130000, line 2), and the quiz/test split is derived on
-- the client by `studyTestDoor` off `config.studyDoor` — not stored. So ONE
-- nullable column on `test_sessions` files both doors, and one folder can
-- hold a mix, which is what the reference does.
--
-- Shape is copied from `study_set_folders` (20260911130000) deliberately: same
-- title CHECK, same per-owner index, same four RLS policies. The one addition
-- is `study_set_id`, because a Practice folder lives INSIDE a set room — it is
-- the set's folder, not the account's, so the room can list its own without
-- filtering client-side.
--
-- ON DELETE. The folder's rows CASCADE with the set and with the owner, but
-- `test_sessions.practice_folder_id` is SET NULL: deleting a folder must never
-- delete a student's quizzes. "Delete folder" in the UI keeps the contents and
-- unfiles them, and this constraint is what makes that true even if a future
-- caller forgets to unfile first.
--
-- APPLIED BY HAND. Nothing replays migrations here. Until this file is applied
-- against the linked project the API's `practiceFolders` schema capability
-- probes false and every folder path degrades to "no folders" — the hub renders
-- exactly as it does today. See apps/api-server/src/services/schemaCapabilities.ts.

CREATE TABLE IF NOT EXISTS public.practice_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  study_set_id UUID NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT practice_folders_title_len CHECK (char_length(btrim(title)) BETWEEN 1 AND 80)
);

-- The room's own list: every read is "this owner, this set, newest first".
CREATE INDEX IF NOT EXISTS practice_folders_set_idx
  ON public.practice_folders (study_set_id, created_at DESC);
CREATE INDEX IF NOT EXISTS practice_folders_user_id_idx
  ON public.practice_folders (user_id, created_at DESC);

ALTER TABLE public.test_sessions
  ADD COLUMN IF NOT EXISTS practice_folder_id UUID;

-- Added as a NAMED constraint separately from the column so re-running the
-- file is safe: ADD COLUMN IF NOT EXISTS carrying an inline REFERENCES would
-- be skipped wholesale on the second run if the column already existed
-- without it.
ALTER TABLE public.test_sessions
  DROP CONSTRAINT IF EXISTS test_sessions_practice_folder_id_fkey;
ALTER TABLE public.test_sessions
  ADD CONSTRAINT test_sessions_practice_folder_id_fkey
  FOREIGN KEY (practice_folder_id) REFERENCES public.practice_folders(id) ON DELETE SET NULL;

-- Partial: the overwhelming majority of rows are unfiled, and the only query
-- that uses this index asks for one folder's contents.
CREATE INDEX IF NOT EXISTS test_sessions_practice_folder_id_idx
  ON public.test_sessions (practice_folder_id) WHERE practice_folder_id IS NOT NULL;

ALTER TABLE public.practice_folders ENABLE ROW LEVEL SECURITY;

-- Four policies rather than one FOR ALL, matching `study_set_folders`: the
-- API's service-role client bypasses RLS entirely and scopes by `user_id` in
-- every WHERE clause, so these exist for any anon/authenticated client that
-- reaches the table directly.
DROP POLICY IF EXISTS practice_folders_select ON public.practice_folders;
DROP POLICY IF EXISTS practice_folders_insert ON public.practice_folders;
DROP POLICY IF EXISTS practice_folders_update ON public.practice_folders;
DROP POLICY IF EXISTS practice_folders_delete ON public.practice_folders;
CREATE POLICY practice_folders_select ON public.practice_folders
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY practice_folders_insert ON public.practice_folders
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY practice_folders_update ON public.practice_folders
  FOR UPDATE TO authenticated USING (user_id = auth.uid());
CREATE POLICY practice_folders_delete ON public.practice_folders
  FOR DELETE TO authenticated USING (user_id = auth.uid());

GRANT ALL ON public.practice_folders TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.practice_folders TO authenticated;
