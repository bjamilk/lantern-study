-- RLS ownership and visibility hardening (hotfix lane H3).
--
-- The repo is public and the mobile app ships the anon key, so every policy
-- below is reachable by an attacker holding nothing but that key plus (where
-- the policy says `authenticated`) a free signup. Each section names the
-- finding it closes and, where it is an exploit rather than a leak, spells out
-- the statement that used to succeed and now fails.
--
-- Idempotent: DROP POLICY IF EXISTS / CREATE POLICY, CREATE OR REPLACE
-- FUNCTION, DROP TRIGGER IF EXISTS. Safe to re-run.

-- ===========================================================================
-- Finding 1 — notes_update / decks_update: USING with a collaborator branch
-- and NO WITH CHECK, so an editor collaborator could steal ownership.
--
--   20260608120000_notes_system.sql:96      notes_update
--   20260520000000_enable_rls_on_all_tables.sql:154  decks_update
--
-- Postgres applies USING to the OLD row and WITH CHECK to the NEW row. With
-- no WITH CHECK, the NEW row is unchecked, so this succeeded for any editor
-- collaborator straight through PostgREST with the shipped anon key:
--
--   PATCH /rest/v1/notes?id=eq.<someone-elses-note>
--   { "user_id": "<attacker uuid>" }
--
-- A WITH CHECK alone cannot fix it: the correct predicate is "user_id did not
-- change", and a policy cannot see OLD. Pinning `user_id = auth.uid()` in
-- WITH CHECK would instead break collaborator editing, which is the whole
-- point of the collaborator branch. So ownership is frozen by a BEFORE UPDATE
-- trigger (the shape `profiles.created_at` already uses in
-- 20260830150000), and WITH CHECK mirrors USING so a row also cannot be
-- edited out of the editor's own reach.
--
-- The trigger exempts a NULL auth.uid(): that is the service role, i.e. the
-- API server, which is the only path allowed to transfer a note or a deck.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.freeze_note_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Service role (no JWT subject) may still transfer a note deliberately.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'ownership of a note cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.freeze_deck_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'ownership of a deck cannot be changed'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.freeze_note_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.freeze_deck_owner() FROM PUBLIC;

DROP TRIGGER IF EXISTS notes_freeze_owner ON public.notes;
CREATE TRIGGER notes_freeze_owner
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.freeze_note_owner();

DROP TRIGGER IF EXISTS decks_freeze_owner ON public.decks;
CREATE TRIGGER decks_freeze_owner
  BEFORE UPDATE ON public.decks
  FOR EACH ROW EXECUTE FUNCTION public.freeze_deck_owner();

-- Mirror USING into WITH CHECK so the NEW row must still be one the caller
-- may reach. Collaborator editing is preserved: the collaborator branch is
-- present on both sides.
DROP POLICY IF EXISTS notes_update ON public.notes;
CREATE POLICY notes_update ON public.notes FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.note_collaborators nc
      WHERE nc.note_id = notes.id AND nc.user_id = auth.uid()
        AND nc.role IN ('editor', 'owner')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.note_collaborators nc
      WHERE nc.note_id = notes.id AND nc.user_id = auth.uid()
        AND nc.role IN ('editor', 'owner')
    )
  );

DROP POLICY IF EXISTS decks_update ON public.decks;
CREATE POLICY decks_update ON public.decks FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.deck_collaborators dc
      WHERE dc.deck_id = decks.id AND dc.user_id = auth.uid()
        AND dc.role IN ('editor', 'owner')
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.deck_collaborators dc
      WHERE dc.deck_id = decks.id AND dc.user_id = auth.uid()
        AND dc.role IN ('editor', 'owner')
    )
  );

COMMENT ON FUNCTION public.freeze_note_owner() IS
  'H3 finding 1: an editor collaborator could PATCH notes.user_id and steal the note.';
COMMENT ON FUNCTION public.freeze_deck_owner() IS
  'H3 finding 1: an editor collaborator could PATCH decks.user_id/created_by and steal the deck.';

-- ===========================================================================
-- Finding 2 — marketplace_seller_preferences readable by anon.
--   20260616140000:35-37  "Anyone can read seller pickup preferences"
--     FOR SELECT USING (true), no TO clause -> TO PUBLIC -> includes anon.
--
-- With the shipped anon key that is a one-request dump of every seller UUID
-- and their pickup settings:
--   GET /rest/v1/marketplace_seller_preferences?select=*
-- The shop reads this through the API on the service role, so no client
-- needs direct anon access. The "manage own" policy also defaulted to PUBLIC
-- and is re-scoped on the way past.
-- ===========================================================================

DROP POLICY IF EXISTS "Anyone can read seller pickup preferences"
  ON public.marketplace_seller_preferences;
-- This policy is RENAMED, so the new name has to be dropped as well or a
-- second run of this file collides on it. (Caught by re-running the migration
-- against PGlite — the old name's DROP is a no-op the second time.)
DROP POLICY IF EXISTS "Signed-in users read seller pickup preferences"
  ON public.marketplace_seller_preferences;
CREATE POLICY "Signed-in users read seller pickup preferences"
  ON public.marketplace_seller_preferences
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Sellers manage own marketplace preferences"
  ON public.marketplace_seller_preferences;
CREATE POLICY "Sellers manage own marketplace preferences"
  ON public.marketplace_seller_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = seller_id)
  WITH CHECK (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Sellers read own campaign log" ON public.marketplace_campaign_log;
CREATE POLICY "Sellers read own campaign log"
  ON public.marketplace_campaign_log
  FOR SELECT TO authenticated
  USING (auth.uid() = seller_id);

DROP POLICY IF EXISTS "Sellers insert own campaign log" ON public.marketplace_campaign_log;
CREATE POLICY "Sellers insert own campaign log"
  ON public.marketplace_campaign_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = seller_id);

-- ===========================================================================
-- Finding 3 — companion_image_attachments policies default to PUBLIC.
--   20260912100000:32-40 — both policies omit TO, so the role list is PUBLIC.
--
-- The predicate (auth.uid() = user_id) is false for anon, so nothing leaked,
-- but the grant surface should not include anon at all: this table holds the
-- text read out of students' photographed pages.
-- ===========================================================================

DROP POLICY IF EXISTS "Users read own companion image attachments"
  ON public.companion_image_attachments;
CREATE POLICY "Users read own companion image attachments"
  ON public.companion_image_attachments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own companion image attachments"
  ON public.companion_image_attachments;
CREATE POLICY "Users delete own companion image attachments"
  ON public.companion_image_attachments
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ===========================================================================
-- Finding 4 — study_set_units / study_set_topics never tie study_set_id to a
-- set the caller owns.
--   20260911130000:104-113 — USING/WITH CHECK check only user_id = auth.uid().
--
-- So this succeeded, hanging the attacker's unit off a stranger's set (and,
-- because the set page reads its units by study_set_id, injecting content
-- into someone else's outline):
--
--   POST /rest/v1/study_set_units
--   { "study_set_id": "<victim set>", "user_id": "<attacker uuid>", ... }
--
-- Topics additionally must hang off a unit of that same owned set.
-- ===========================================================================

DROP POLICY IF EXISTS study_set_units_all ON public.study_set_units;
CREATE POLICY study_set_units_all ON public.study_set_units
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_sets s
      WHERE s.id = study_set_units.study_set_id AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_sets s
      WHERE s.id = study_set_units.study_set_id AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS study_set_topics_all ON public.study_set_topics;
CREATE POLICY study_set_topics_all ON public.study_set_topics
  FOR ALL TO authenticated
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_sets s
      WHERE s.id = study_set_topics.study_set_id AND s.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.study_set_units u
      WHERE u.id = study_set_topics.unit_id
        AND u.study_set_id = study_set_topics.study_set_id
        AND u.user_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_sets s
      WHERE s.id = study_set_topics.study_set_id AND s.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.study_set_units u
      WHERE u.id = study_set_topics.unit_id
        AND u.study_set_id = study_set_topics.study_set_id
        AND u.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- Finding 5 — is_job_company_member EXECUTE granted to anon, and
-- job_company_members_select has no TO clause.
--   20260830150000:93-100
--
-- The helper is SECURITY DEFINER, so an anon caller could probe company
-- membership with it, and the roster policy's role list defaulted to PUBLIC.
-- Nothing legitimate calls either as anon: the jobs board reads through the
-- API on the service role.
-- ===========================================================================

REVOKE ALL ON FUNCTION public.is_job_company_member(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_job_company_member(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_job_company_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS job_company_members_select ON public.job_company_members;
CREATE POLICY job_company_members_select ON public.job_company_members
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_job_company_member(company_id)
  );
