/**
 * The two Supabase BROADCAST channels a conversation opens: `typing:<chatId>`
 * and `chat-read:<chatId>`.
 *
 * Moved out of `components/ChatWindow.tsx` verbatim (lane M8b, step 4). These
 * are ephemeral presence signals, not data: nothing here is persisted, and a
 * dropped broadcast costs a typing dot, never a message.
 *
 * Touches: `supabase.channel` / `supabase.removeChannel` only. The read
 * watermark is handed straight back to the caller through `onPeerChatRead`;
 * this hook never applies it.
 *
 * Effect order: the hook is called at exactly the point in the shell where
 * `typingChannelRef` was declared, so both of its effects register in the same
 * position they occupied inline — after the chat-reset and scroll effects,
 * before the thread and marketplace effects. `typingUserIds` and its timeout
 * map were declared 110 lines earlier in the shell and now live here; a
 * `useState` moving later in the call order is safe because it moves on EVERY
 * render, and no effect between the two points reads it.
 *
 * Gotchas:
 *  - teardown must clear every per-user timer, empty the id list and remove the
 *    channel. Miss one and a stale "X is typing…" follows the reader into the
 *    next conversation.
 *  - the read channel is skipped entirely in low-data mode, and `lowDataMode`
 *    is a dep, so toggling the setting subscribes or unsubscribes.
 */
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';

interface UseChatRealtimeOptions {
  /** The open conversation's id, or undefined when none is open. */
  chatId?: string;
  currentUserId: string;
  lowDataMode: boolean;
  /** Apply a peer's read watermark to local own-message receipts. */
  onPeerChatRead?: (payload: { userId: string; lastReadAt: string }) => void;
}

export function useChatRealtime({
  chatId,
  currentUserId,
  lowDataMode,
  onPeerChatRead,
}: UseChatRealtimeOptions) {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const typingTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const typingChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Typing indicators via Supabase broadcast
  // Subscription setup/teardown, keyed on `chatId`: one broadcast channel per
  // conversation. Each peer's id is held for 3s by a per-user timer that a fresh
  // broadcast resets. TEARDOWN must clear every timer, empty the id list and
  // remove the channel — otherwise a stale "X is typing…" follows you into the
  // next conversation.
  useEffect(() => {
    if (!chatId) return;
    const channel = supabase.channel(`typing:${chatId}`);
    typingChannelRef.current = channel;
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        if (!userId || userId === currentUserId) return;
        setTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
        if (typingTimeoutsRef.current[userId]) clearTimeout(typingTimeoutsRef.current[userId]);
        typingTimeoutsRef.current[userId] = setTimeout(() => {
          setTypingUserIds((prev) => prev.filter((id) => id !== userId));
          delete typingTimeoutsRef.current[userId];
        }, 3000);
      })
      .subscribe();
    return () => {
      Object.values(typingTimeoutsRef.current).forEach(clearTimeout);
      typingTimeoutsRef.current = {};
      setTypingUserIds([]);
      typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [chatId, currentUserId]);

  const broadcastTyping = () => {
    void typingChannelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId },
    });
  };

  // Peer mark-read broadcasts → refresh blue ticks on own messages
  // A second channel per conversation, skipped entirely in low-data mode
  // (`lowDataMode` is a dep, so toggling it subscribes/unsubscribes). Own
  // broadcasts are ignored; the shell applies the watermark via `onPeerChatRead`.
  useEffect(() => {
    if (!chatId || lowDataMode) return;
    const channel = supabase.channel(`chat-read:${chatId}`);
    channel
      .on('broadcast', { event: 'read' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        const lastReadAt = payload?.lastReadAt as string | undefined;
        if (!userId || !lastReadAt || userId === currentUserId) return;
        onPeerChatRead?.({ userId, lastReadAt });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [chatId, currentUserId, lowDataMode, onPeerChatRead]);

  return { typingUserIds, broadcastTyping };
}
