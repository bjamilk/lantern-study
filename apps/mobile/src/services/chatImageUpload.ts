import { supabase } from './supabase';
import { assertAllowedImageUpload } from '@lantern/shared';

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

export async function uploadChatImage(
  uri: string,
  mimeType?: string | null,
  chatId?: string
): Promise<{ url: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) throw new Error('Must be signed in to upload images');

  const response = await fetch(uri);
  const blob = await response.blob();
  const resolvedMime = mimeType || blob.type || 'image/jpeg';
  assertAllowedImageUpload({ contentType: resolvedMime, byteLength: blob.size });

  const ext = resolvedMime.split('/')[1] || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const filePath = `${user.id}/chat/${chatId || 'general'}/${fileName}`;

  const { error } = await supabase.storage.from('note-files').upload(filePath, blob, {
    contentType: resolvedMime,
    upsert: false,
  });
  if (error) throw error;

  const { data: signed, error: signError } = await supabase.storage
    .from('note-files')
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    throw signError ?? new Error('Failed to create signed URL for chat image');
  }

  return { url: signed.signedUrl };
}
