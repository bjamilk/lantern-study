-- Create the flashcard-images bucket with public access
INSERT INTO storage.buckets (id, name, public)
VALUES ('flashcard-images', 'flashcard-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload files to flashcard-images bucket
CREATE POLICY "Allow authenticated uploads to flashcard-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'flashcard-images');

-- Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated updates to flashcard-images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'flashcard-images')
WITH CHECK (bucket_id = 'flashcard-images');

-- Allow anyone to read files from flashcard-images (public bucket)
CREATE POLICY "Allow public read access to flashcard-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'flashcard-images');

-- Allow authenticated users to delete files from flashcard-images
CREATE POLICY "Allow authenticated deletes from flashcard-images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'flashcard-images');
