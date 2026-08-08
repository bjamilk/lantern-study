import { useCallback } from 'react';
import { uploadChatImage } from '../services/chatImageUpload';
import { useToastStore } from '../stores/toastStore';

interface UseChatImageAttachOptions {
  /**
   * Group id or DM thread id — scopes the upload on the server. Omit only when
   * neither is known yet; the hook returns undefined in that case so the
   * composer hides the attach button rather than offering a broken one.
   */
  chatId?: string;
  /** Post the finished `![image](url)` markdown as a message. */
  onSendMarkdown: (markdown: string) => Promise<void>;
  /** Whether the caller is in a state where attaching makes sense. */
  enabled?: boolean;
}

/**
 * Upload-then-send for chat image attachments.
 *
 * Extracted from GroupChatScreen, which was the only surface that ever passed
 * `onAttachImage` — so the composer's attach button silently did not render in
 * DMs or threads even though the upload endpoint was chat-agnostic.
 *
 * Returns `undefined` when disabled so callers can spread it straight into
 * `ChatComposer` and get the button's visibility for free.
 */
export function useChatImageAttach({
  chatId,
  onSendMarkdown,
  enabled = true,
}: UseChatImageAttachOptions) {
  const attach = useCallback(
    async (uri: string, mimeType?: string | null) => {
      try {
        const { url } = await uploadChatImage(uri, mimeType, chatId);
        await onSendMarkdown(`![image](${url})`);
      } catch {
        useToastStore.getState().showToast('Failed to send image.', 'error');
      }
    },
    [chatId, onSendMarkdown]
  );

  return enabled ? attach : undefined;
}
