-- Follow-up: replace recursive notes/collaborator EXISTS policies with
-- SECURITY DEFINER helpers (idempotent; safe if already applied).

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
