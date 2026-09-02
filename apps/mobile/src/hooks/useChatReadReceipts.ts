import { useEffect } from 'react';
import { acquireBroadcastChannel } from '../services/sharedRealtimeChannel';

/**
 * Peer mark-read broadcasts over Supabase, wire-compatible with web:
 * channel `chat-read:{chatId}`, event `read`, payload `{ userId, lastReadAt }`.
 *
 * The channel is shared and refcounted, so a community channel and the Chat
 * tab holding the same group at once do not tear each other's receipts down.
 */
export function useChatReadReceipts(
  chatId: string | undefined,
  currentUserId: string | undefined,
  onPeerRead: (payload: { userId: string; lastReadAt: string }) => void
): void {
  useEffect(() => {
    if (!chatId || !currentUserId) return;
    const { release } = acquireBroadcastChannel(`chat-read:${chatId}`, 'read', (payload) => {
      const userId = payload?.userId as string | undefined;
      const lastReadAt = payload?.lastReadAt as string | undefined;
      if (!userId || !lastReadAt || userId === currentUserId) return;
      onPeerRead({ userId, lastReadAt });
    });
    return () => {
      release();
    };
  }, [chatId, currentUserId, onPeerRead]);
}
