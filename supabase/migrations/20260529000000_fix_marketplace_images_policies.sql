-- Fix missing RLS policies for marketplace-images storage bucket

-- Allow authenticated users to upload files to marketplace-images bucket
CREATE POLICY "Allow authenticated uploads to marketplace-images"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'marketplace-images');

-- Allow authenticated users to update files in marketplace-images bucket
CREATE POLICY "Allow authenticated updates to marketplace-images"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'marketplace-images')
WITH CHECK (bucket_id = 'marketplace-images');

-- Allow anyone to read files from marketplace-images (public bucket)
CREATE POLICY "Allow public read access to marketplace-images"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'marketplace-images');

-- Allow authenticated users to delete their own files from marketplace-images
CREATE POLICY "Allow authenticated deletes from marketplace-images"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'marketplace-images');
