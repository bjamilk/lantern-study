import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { acquireBroadcastChannel } from '../services/sharedRealtimeChannel';

const TYPING_EXPIRY_MS = 3000;
const TYPING_THROTTLE_MS = 1500;

/**
 * Typing indicators over Supabase broadcast, wire-compatible with the web
 * client: channel `typing:${chatId}`, event `typing`, payload `{ userId }`.
 *
 * The channel is shared and refcounted (`acquireBroadcastChannel`): the same
 * group can be open on the Chat stack and inside a community at once, and a
 * plain `removeChannel` on one unmount used to leave the other silently deaf.
 */
export function useTypingIndicator(
  chatId: string | undefined,
  currentUserId: string | undefined
): { typingUserIds: string[]; broadcastTyping: () => void } {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!chatId) return;
    const { channel, release } = acquireBroadcastChannel(`typing:${chatId}`, 'typing', (payload) => {
      const userId = payload?.userId as string | undefined;
      if (!userId || userId === currentUserId) return;
      setTypingUserIds(prev => (prev.includes(userId) ? prev : [...prev, userId]));
      if (timeoutsRef.current[userId]) clearTimeout(timeoutsRef.current[userId]);
      timeoutsRef.current[userId] = setTimeout(() => {
        setTypingUserIds(prev => prev.filter(id => id !== userId));
        delete timeoutsRef.current[userId];
      }, TYPING_EXPIRY_MS);
    });
    channelRef.current = channel;

    return () => {
      Object.values(timeoutsRef.current).forEach(clearTimeout);
      timeoutsRef.current = {};
      setTypingUserIds([]);
      channelRef.current = null;
      release();
    };
  }, [chatId, currentUserId]);

  const broadcastTyping = useCallback(() => {
    if (!currentUserId) return;
    const now = Date.now();
    if (now - lastSentRef.current < TYPING_THROTTLE_MS) return;
    lastSentRef.current = now;
    void channelRef.current?.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: currentUserId },
    });
  }, [currentUserId]);

  return { typingUserIds, broadcastTyping };
}
