-- P2: Make image buckets private; reads go through signed URLs (service role on API).

UPDATE storage.buckets
SET public = false
WHERE id IN ('flashcard-images', 'marketplace-images', 'question-images');

DROP POLICY IF EXISTS "Allow public read access to flashcard-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to marketplace-images" ON storage.objects;
DROP POLICY IF EXISTS "Allow public read access to question-images" ON storage.objects;

-- Owner-scoped read for authenticated clients (upload confirmation, direct SDK reads).
CREATE POLICY "flashcard_images_owner_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'flashcard-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "marketplace_images_owner_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'marketplace-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "question_images_owner_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'question-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
