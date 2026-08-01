import * as FileSystem from 'expo-file-system/legacy';
import { api } from './api';

export async function uploadChatAudioBase64(
  base64Data: string,
  options?: {
    fileName?: string;
    contentType?: string;
    groupId?: string;
    threadId?: string;
  }
): Promise<{ url: string }> {
  if (!base64Data || base64Data.length < 64) {
    throw new Error('Recording was empty. Hold a bit longer, then stop again.');
  }
  const estimatedBytes = Math.ceil((base64Data.length * 3) / 4);
  if (estimatedBytes < 256) {
    throw new Error('Recording was empty. Hold a bit longer, then stop again.');
  }
  if (estimatedBytes > 8 * 1024 * 1024) {
    throw new Error('Audio exceeds 8 MB limit');
  }

  const contentType = options?.contentType || 'audio/mp4';
  const fileName = options?.fileName || `voice-${Date.now()}.m4a`;
  const result = await api.uploadChatAudio({
    fileName,
    base64Data,
    contentType,
    groupId: options?.groupId,
    threadId: options?.threadId,
  });
  if (!result?.url) {
    throw new Error('Upload succeeded but no audio URL was returned');
  }
  return { url: result.url };
}

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

  const lowerUri = uri.toLowerCase();
  const ext = lowerUri.endsWith('.webm')
    ? 'webm'
    : lowerUri.endsWith('.wav')
      ? 'wav'
      : lowerUri.endsWith('.ogg')
        ? 'ogg'
        : 'm4a';

  return uploadChatAudioBase64(base64Data, {
    fileName: `voice-${Date.now()}.${ext}`,
    contentType,
    groupId: options?.groupId,
    threadId: options?.threadId,
  });
}
