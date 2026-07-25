-- Phase 0 RLS hardening (audit SEC-01 / SEC-02 / SEC-03)
-- 1) Block self-activation of pending group memberships via PostgREST.
-- 2) Require active (non-pending) membership for group-linked note access.
-- 3) Freeze dm_threads.participant_ids from authenticated client UPDATEs.
-- Invite accept / DM archive+hide continue via service-role API (bypasses RLS).

-- ---------------------------------------------------------------------------
-- SEC-01: group_members UPDATE — admins only (invite accept is service-role)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS group_members_update ON public.group_members;
CREATE POLICY group_members_update ON public.group_members
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(group_id))
  WITH CHECK (public.is_group_admin(group_id));

-- Defense in depth: even if a future policy re-opens self-UPDATE, block
-- pending → active flips unless the caller is a group admin or service role
-- (auth.uid() is null for service_role).
CREATE OR REPLACE FUNCTION public.prevent_self_pending_group_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND COALESCE(OLD.pending, false) = true
     AND COALESCE(NEW.pending, false) = false
     AND auth.uid() IS NOT NULL
     AND auth.uid() = NEW.user_id
     AND NOT public.is_group_admin(NEW.group_id)
  THEN
    RAISE EXCEPTION 'pending group membership can only be accepted via the invite API'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_self_pending_group_activation ON public.group_members;
CREATE TRIGGER trg_prevent_self_pending_group_activation
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_self_pending_group_activation();

COMMENT ON FUNCTION public.prevent_self_pending_group_activation() IS
  'Blocks authenticated users from self-activating pending memberships; service-role API accept remains allowed.';

-- ---------------------------------------------------------------------------
-- SEC-02 helpers: avoid notes <-> note_collaborators RLS recursion
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_note_collaborator(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.note_collaborators nc
    WHERE nc.note_id = p_note_id
      AND nc.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_note(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.notes n
    WHERE n.id = p_note_id
      AND (
        n.user_id = auth.uid()
        OR public.is_note_collaborator(n.id)
        OR (n.group_id IS NOT NULL AND public.is_group_member(n.group_id))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_note_collaborator(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_note(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS notes_select ON public.notes;
CREATE POLICY notes_select ON public.notes
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_note_collaborator(id)
    OR (group_id IS NOT NULL AND public.is_group_member(group_id))
  );

DROP POLICY IF EXISTS note_attachments_select ON public.note_attachments;
CREATE POLICY note_attachments_select ON public.note_attachments
  FOR SELECT TO authenticated
  USING (public.can_read_note(note_id));

DROP POLICY IF EXISTS note_comments_select ON public.note_comments;
CREATE POLICY note_comments_select ON public.note_comments
  FOR SELECT TO authenticated
  USING (public.can_read_note(note_id));

DROP POLICY IF EXISTS note_comments_insert ON public.note_comments;
CREATE POLICY note_comments_insert ON public.note_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.can_read_note(note_id)
  );

-- ---------------------------------------------------------------------------
-- SEC-03: dm_threads — no authenticated UPDATE (API uses service role).
-- Trigger also freezes participant_ids for any non-service-role session.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS dm_threads_update ON public.dm_threads;

CREATE OR REPLACE FUNCTION public.dm_threads_freeze_participant_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.participant_ids IS DISTINCT FROM OLD.participant_ids
     AND auth.uid() IS NOT NULL
  THEN
    RAISE EXCEPTION 'dm_threads.participant_ids cannot be changed by clients'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dm_threads_freeze_participant_ids ON public.dm_threads;
CREATE TRIGGER trg_dm_threads_freeze_participant_ids
  BEFORE UPDATE ON public.dm_threads
  FOR EACH ROW
  EXECUTE FUNCTION public.dm_threads_freeze_participant_ids();

COMMENT ON FUNCTION public.dm_threads_freeze_participant_ids() IS
  'Prevents authenticated clients from expanding/shrinking DM participant lists; service-role API may still update.';
