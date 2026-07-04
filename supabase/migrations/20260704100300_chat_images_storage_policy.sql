-- Allow group members to read chat images uploaded under {ownerId}/chat/{groupId}/...

DROP POLICY IF EXISTS note_files_chat_group_select ON storage.objects;
CREATE POLICY note_files_chat_group_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'note-files'
    AND (storage.foldername(name))[2] = 'chat'
    AND (storage.foldername(name))[3] IS NOT NULL
    AND public.is_group_member(((storage.foldername(name))[3])::uuid)
  );
