-- Break RLS infinite recursion on group_members (self-referential SELECT policy).
-- Use SECURITY DEFINER membership helper; reuse is_group_admin for admin checks.

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.group_members gm
    WHERE gm.group_id = p_group_id
      AND gm.user_id = auth.uid()
      AND COALESCE(gm.pending, false) = false
  );
$$;

COMMENT ON FUNCTION public.is_group_member(uuid) IS
  'Membership check for RLS; SECURITY DEFINER avoids group_members policy recursion.';

GRANT EXECUTE ON FUNCTION public.is_group_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS group_members_select ON public.group_members;
CREATE POLICY group_members_select ON public.group_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_group_member(group_id));

DROP POLICY IF EXISTS group_members_insert ON public.group_members;
CREATE POLICY group_members_insert ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_members_update ON public.group_members;
CREATE POLICY group_members_update ON public.group_members
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.is_group_admin(group_id))
  WITH CHECK (auth.uid() = user_id OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS group_members_delete ON public.group_members;
CREATE POLICY group_members_delete ON public.group_members
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS groups_select ON public.groups;
CREATE POLICY groups_select ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_group_member(id));

DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND public.is_group_member(group_id)
  );

DROP POLICY IF EXISTS messages_update ON public.messages;
CREATE POLICY messages_update ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS messages_delete ON public.messages;
CREATE POLICY messages_delete ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.is_group_admin(group_id));

DROP POLICY IF EXISTS groups_update ON public.groups;
CREATE POLICY groups_update ON public.groups
  FOR UPDATE TO authenticated
  USING (public.is_group_admin(id))
  WITH CHECK (public.is_group_admin(id));

DROP POLICY IF EXISTS groups_delete ON public.groups;
CREATE POLICY groups_delete ON public.groups
  FOR DELETE TO authenticated
  USING (public.is_group_admin(id));
