-- Private group avatars bucket (upload via API, read via signed URLs).

INSERT INTO storage.buckets (id, name, public)
VALUES ('group-avatars', 'group-avatars', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- No authenticated INSERT/UPDATE/DELETE — API uploads with service role.
DROP POLICY IF EXISTS group_avatars_select ON storage.objects;
CREATE POLICY group_avatars_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'group-avatars'
  AND public.is_group_member(((storage.foldername(name))[1])::uuid)
);
