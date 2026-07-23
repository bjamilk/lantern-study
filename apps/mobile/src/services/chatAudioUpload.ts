import * as FileSystem from 'expo-file-system';
import { api } from './api';

export async function uploadChatAudio(
  uri: string,
  mimeType?: string | null,
  options?: { groupId?: string; threadId?: string }
): Promise<{ url: string }> {
  const contentType = mimeType || 'audio/mp4';
  const info = await FileSystem.getInfoAsync(uri);
  const byteLength = info.exists && 'size' in info ? Number(info.size) || 0 : 0;
  if (byteLength > 0 && byteLength < 256) {
    throw new Error('Recording was empty. Hold a bit longer, then stop again.');
  }
  if (byteLength > 8 * 1024 * 1024) {
    throw new Error('Audio exceeds 8 MB limit');
  }

  const base64Data = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType?.Base64 ?? 'base64',
  });
  if (!base64Data || base64Data.length < 64) {
    throw new Error('Recording was empty. Hold a bit longer, then stop again.');
  }

  const lowerUri = uri.toLowerCase();
  const ext = lowerUri.endsWith('.webm')
    ? 'webm'
    : lowerUri.endsWith('.wav')
      ? 'wav'
      : lowerUri.endsWith('.ogg')
        ? 'ogg'
        : 'm4a';
  const fileName = `voice-${Date.now()}.${ext}`;

  const result = await api.uploadChatAudio({
    fileName,
    base64Data,
    contentType,
    groupId: options?.groupId,
    threadId: options?.threadId,
  });
  return { url: result.url };
}
