import { HEIC_IMAGE_UPLOAD_ERROR, isHeicImageUpload } from '@lantern/shared';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';

function normalizeMime(mimeType?: string | null): string {
  const raw = (mimeType || 'image/jpeg').toLowerCase();
  if (raw === 'image/jpg') return 'image/jpeg';
  return raw;
}

/**
 * Upload a marketplace listing photo.
 * Client shrinks first; server validates magic bytes and re-normalizes.
 */
export async function uploadMarketplaceImage(
  localUri: string,
  mimeType: string | undefined,
  listingId?: string,
  _base64Override?: string | null
): Promise<{ url: string; path: string; storageUrl?: string }> {
  const contentType = normalizeMime(mimeType);
  if (isHeicImageUpload({ contentType, fileName: localUri })) {
    throw new Error(HEIC_IMAGE_UPLOAD_ERROR);
  }

  // Always resize/compress locally (ignore picker base64 override — it may be full-res).
  const prepared = await prepareImageBase64ForUpload(localUri, 'marketplace', {
    mimeType: contentType,
    fileName: `listing-${Date.now()}.jpg`,
  });

  return api.uploadMarketplaceImage({
    fileName: prepared.fileName,
    base64Data: prepared.base64Data,
    contentType: prepared.contentType,
    listingId,
  });
}

export async function deleteMarketplaceImage(filePath: string): Promise<void> {
  // Deletion still goes through storage with the user JWT (owner-scoped RLS).
  const { supabase } = await import('./supabase');
  const { error } = await supabase.storage.from('marketplace-images').remove([filePath]);
  if (error) throw new Error(error.message);
}
