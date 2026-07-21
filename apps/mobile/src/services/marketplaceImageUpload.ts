import * as FileSystem from 'expo-file-system';
import { assertAllowedImageUpload } from '@lantern/shared';
import { api } from './api';

export async function uploadMarketplaceImage(
  localUri: string,
  mimeType: string | undefined,
  listingId?: string
): Promise<{ url: string; path: string }> {
  const contentType = (mimeType || 'image/jpeg') === 'image/jpg' ? 'image/jpeg' : mimeType || 'image/jpeg';
  const info = await FileSystem.getInfoAsync(localUri);
  const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  assertAllowedImageUpload({ contentType, byteLength: byteLength || undefined });

  const base64Data = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  const ext = contentType.split('/')[1] || localUri.split('.').pop()?.split('?')[0] || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  return api.uploadMarketplaceImage({
    fileName,
    base64Data,
    contentType,
    listingId,
  });
}

export async function deleteMarketplaceImage(filePath: string): Promise<void> {
  // Deletion still goes through storage with the user JWT (owner-scoped RLS).
  const { supabase } = await import('./supabase');
  const { error } = await supabase.storage.from('marketplace-images').remove([filePath]);
  if (error) throw new Error(error.message);
}
