import { useEffect } from 'react';
import { supabase } from '../services/supabase';

/**
 * Peer mark-read broadcasts over Supabase, wire-compatible with web:
 * channel `chat-read:{chatId}`, event `read`, payload `{ userId, lastReadAt }`.
 */
export function useChatReadReceipts(
  chatId: string | undefined,
  currentUserId: string | undefined,
  onPeerRead: (payload: { userId: string; lastReadAt: string }) => void
): void {
  useEffect(() => {
    if (!chatId || !currentUserId) return;
    const channel = supabase.channel(`chat-read:${chatId}`);
    channel
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        const lastReadAt = payload?.lastReadAt as string | undefined;
        if (!userId || !lastReadAt || userId === currentUserId) return;
        onPeerRead({ userId, lastReadAt });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId, currentUserId, onPeerRead]);
}
