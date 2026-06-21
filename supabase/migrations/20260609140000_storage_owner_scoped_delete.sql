-- Scope storage UPDATE/DELETE to the uploader's folder (auth.uid() as first path segment)

DROP POLICY IF EXISTS "Allow authenticated updates to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated updates to flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from flashcard-images" ON storage.objects;

CREATE POLICY "Allow authenticated updates to marketplace-images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Allow authenticated deletes from marketplace-images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Allow authenticated updates to flashcard-images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'flashcard-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'flashcard-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Allow authenticated deletes from flashcard-images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'flashcard-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- question-images bucket (from 20251127100000_fix_storage_policies.sql)
DROP POLICY IF EXISTS "Allow authenticated updates to question-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes from question-images" ON storage.objects;

CREATE POLICY "Allow authenticated updates to question-images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Allow authenticated deletes from question-images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
