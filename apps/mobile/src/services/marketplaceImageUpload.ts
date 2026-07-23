import * as FileSystem from 'expo-file-system';
import { api } from './api';

function normalizeMime(mimeType?: string | null): string {
  const raw = (mimeType || 'image/jpeg').toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  return raw;
}

/**
 * Upload a marketplace listing photo.
 * Server validates magic bytes (so wrong client MIME / HEIC→JPEG mismatches don't fail).
 */
export async function uploadMarketplaceImage(
  localUri: string,
  mimeType: string | undefined,
  listingId?: string,
  base64Override?: string | null
): Promise<{ url: string; path: string; storageUrl?: string }> {
  const contentType = normalizeMime(mimeType);
  if (contentType.includes('heic') || contentType.includes('heif')) {
    throw new Error(
      'This photo format (HEIC) is not supported. Please retake or export the photo as JPEG/PNG.'
    );
  }

  let base64Data = base64Override || null;
  if (!base64Data) {
    base64Data = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  }
  if (!base64Data) {
    throw new Error('Could not read image data');
  }

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
