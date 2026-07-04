-- Require pending membership on self-insert; non-pending joins go through service-role API invite flow.

DROP POLICY IF EXISTS group_members_insert ON public.group_members;
CREATE POLICY group_members_insert ON public.group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_admin(group_id)
    OR (auth.uid() = user_id AND COALESCE(pending, false) = true)
  );
