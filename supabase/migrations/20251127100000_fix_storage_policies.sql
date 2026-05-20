-- Fix storage policies for question-images bucket

-- Allow authenticated users to upload files to question-images bucket
CREATE POLICY "Allow authenticated uploads to question-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'question-images');

-- Allow authenticated users to update their own files
CREATE POLICY "Allow authenticated updates to question-images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'question-images')
WITH CHECK (bucket_id = 'question-images');

-- Allow anyone to read files from question-images (since bucket is public)
CREATE POLICY "Allow public read access to question-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'question-images');

-- Allow authenticated users to delete files from question-images
CREATE POLICY "Allow authenticated deletes from question-images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'question-images');
