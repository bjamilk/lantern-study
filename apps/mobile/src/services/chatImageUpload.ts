import * as FileSystem from 'expo-file-system';
import { assertAllowedImageUpload } from '@lantern/shared';
import { api } from './api';

export async function uploadChatImage(
  uri: string,
  mimeType?: string | null,
  chatId?: string
): Promise<{ url: string }> {
  const contentType =
    (mimeType || 'image/jpeg') === 'image/jpg' ? 'image/jpeg' : mimeType || 'image/jpeg';
  const info = await FileSystem.getInfoAsync(uri);
  const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  assertAllowedImageUpload({ contentType, byteLength: byteLength || undefined });

  const base64Data = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  const ext = contentType.split('/')[1] || 'jpg';
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const result = await api.uploadChatImage({
    fileName,
    base64Data,
    contentType,
    groupId: chatId,
  });
  return { url: result.url };
}
