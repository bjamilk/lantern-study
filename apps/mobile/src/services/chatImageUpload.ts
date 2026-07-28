import { assertAllowedImageUpload } from '@lantern/shared';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';

export async function uploadChatImage(
  uri: string,
  mimeType?: string | null,
  chatId?: string
): Promise<{ url: string }> {
  const prepared = await prepareImageBase64ForUpload(uri, 'chat', {
    mimeType,
    fileName: `chat-${Date.now()}.jpg`,
  });
  assertAllowedImageUpload({
    contentType: prepared.contentType,
    byteLength: Math.ceil((prepared.base64Data.length * 3) / 4),
  });

  const result = await api.uploadChatImage({
    fileName: prepared.fileName,
    base64Data: prepared.base64Data,
    contentType: prepared.contentType,
    groupId: chatId,
  });
  return { url: result.url };
}
