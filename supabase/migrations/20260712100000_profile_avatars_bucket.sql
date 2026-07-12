-- L-3: Private profile avatars bucket (upload via API, read via signed URLs).

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-avatars', 'profile-avatars', false)
ON CONFLICT (id) DO UPDATE SET public = false;

CREATE POLICY "profile_avatars_owner_manage"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
