import { supabase } from './supabase';
import { assertAllowedImageUpload } from '@lantern/shared';

export async function uploadMarketplaceImage(
  localUri: string,
  mimeType: string | undefined,
  listingId?: string
): Promise<{ url: string; path: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Must be signed in to upload images');

  const response = await fetch(localUri);
  const blob = await response.blob();
  const contentType = mimeType || blob.type || 'image/jpeg';
  assertAllowedImageUpload({ contentType, byteLength: blob.size });

  const ext = contentType.split('/')[1] || localUri.split('.').pop()?.split('?')[0] || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = listingId
    ? `${user.id}/listings/${listingId}/${fileName}`
    : `${user.id}/temp/${fileName}`;

  const { error } = await supabase.storage
    .from('marketplace-images')
    .upload(filePath, blob, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data: { publicUrl } } = supabase.storage.from('marketplace-images').getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

export async function deleteMarketplaceImage(filePath: string): Promise<void> {
  const { error } = await supabase.storage.from('marketplace-images').remove([filePath]);
  if (error) throw new Error(error.message);
}
