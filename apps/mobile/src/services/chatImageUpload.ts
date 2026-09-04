// Subpath, not the bare package: mobile jest maps `@lantern/shared/<sub>` only.
import { assertAllowedImageUpload } from '@lantern/shared/utils/uploadValidation';
import { api } from './api';
import { prepareImageBase64ForUpload } from '../utils/prepareImage';
import { BOARD_GIF_MAX_BYTES, isGifUpload } from '../utils/boardAttachments';

export async function uploadChatImage(
  uri: string,
  mimeType?: string | null,
  chatId?: string
): Promise<{ url: string }> {
  // The extension matters: `prepareImageForUpload` reads it (alongside the
  // mime type) to decide whether this is an animated GIF that must NOT be
  // re-encoded, and a name ending `.jpg` would defeat that on a `content://`
  // uri whose own path carries no extension.
  const gif = isGifUpload({ uri, mimeType });
  const prepared = await prepareImageBase64ForUpload(uri, 'chat', {
    mimeType,
    fileName: `chat-${Date.now()}${gif ? '.gif' : '.jpg'}`,
  });

  assertAllowedImageUpload({
    contentType: prepared.contentType,
    fileName: prepared.fileName,
    byteLength: prepared.byteLength,
    // A GIF is uploaded whole — never resized, and its first-frame thumb is no
    // substitute — so every reader pays the full file. It gets the tighter cap
    // (`prepareImageBase64ForUpload` has already refused an oversized one with
    // wording that names the limit; this is the belt to that's braces).
    ...(prepared.passthrough ? { maxBytes: BOARD_GIF_MAX_BYTES } : {}),
  });

  const result = await api.uploadChatImage({
    fileName: prepared.fileName,
    base64Data: prepared.base64Data,
    contentType: prepared.contentType,
    groupId: chatId,
  });
  return { url: result.url };
}
