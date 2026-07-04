import { supabase } from './supabase';

export async function uploadChatImage(
  uri: string,
  mimeType?: string | null,
  chatId?: string
): Promise<{ url: string }> {
  const response = await fetch(uri);
  const blob = await response.blob();
  const ext = (mimeType || blob.type || 'image/jpeg').split('/')[1] || 'jpg';
  const filePath = `chat/${chatId || 'general'}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const { error } = await supabase.storage.from('note-files').upload(filePath, blob, {
    contentType: mimeType || blob.type || 'image/jpeg',
    upsert: false,
  });
  if (error) throw error;

  const {
    data: { publicUrl },
  } = supabase.storage.from('note-files').getPublicUrl(filePath);

  return { url: publicUrl };
}
