-- Deny-by-default storage writes: clients must upload via API (service_role).
-- Keep owner SELECT where signed-URL ACL still relies on Storage policies.
-- Also revoke public EXECUTE on marketplace_search_listings (API-only).

-- ---------------------------------------------------------------------------
-- Drop authenticated write policies on private buckets
-- ---------------------------------------------------------------------------

-- flashcard-images
DROP POLICY IF EXISTS "Owner uploads flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner deletes flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner updates flashcard-images" ON storage.objects;

-- marketplace-images
DROP POLICY IF EXISTS "Owner uploads marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner deletes marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner updates marketplace-images" ON storage.objects;

-- question-images
DROP POLICY IF EXISTS "Owner uploads question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from question-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner deletes question-images" ON storage.objects;
DROP POLICY IF EXISTS "Owner updates question-images" ON storage.objects;

-- note-files
DROP POLICY IF EXISTS note_files_insert ON storage.objects;
DROP POLICY IF EXISTS note_files_delete ON storage.objects;
DROP POLICY IF EXISTS note_files_update ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads to note-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to note-files" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from note-files" ON storage.objects;

-- profile-avatars (was FOR ALL — replace with SELECT-only for owners)
DROP POLICY IF EXISTS "profile_avatars_owner_manage" ON storage.objects;
DROP POLICY IF EXISTS profile_avatars_owner_manage ON storage.objects;

CREATE POLICY "profile_avatars_owner_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'profile-avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- marketplace_search_listings: API / service_role only
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.marketplace_search_listings(
  text, integer, integer, text, numeric, numeric, text, text, text
) TO service_role;
