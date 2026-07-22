import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

const TYPING_EXPIRY_MS = 3000;
const TYPING_THROTTLE_MS = 1500;

/**
 * Typing indicators over Supabase broadcast, wire-compatible with the web
 * client: channel `typing:${chatId}`, event `typing`, payload `{ userId }`.
 */
export function useTypingIndicator(
  chatId: string | undefined,
  currentUserId: string | undefined
): { typingUserIds: string[]; broadcastTyping: () => void } {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const timeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const lastSentRef = useRef(0);

  useEffect(() => {
    if (!chatId) return;
    const channel = supabase.channel(`typing:${chatId}`);
    channelRef.current = channel;
    channel
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const userId = payload?.userId as string | undefined;
        if (!userId || userId === currentUserId) return;
        setTypingUserIds(prev => (prev.includes(userId) ? prev : [...prev, userId]));
        if (timeoutsRef.current[userId]) clearTimeout(timeoutsRef.current[userId]);
        timeoutsRef.current[userId] = setTimeout(() => {
          setTypingUserIds(prev => prev.filter(id => id !== userId));
          delete timeoutsRef.current[userId];
        }, TYPING_EXPIRY_MS);
      })
      .subscribe();

    return () => {
      Object.values(timeoutsRef.current).forEach(clearTimeout);
      timeoutsRef.current = {};
      setTypingUserIds([]);
      channelRef.current = null;
      void supabase.removeChannel(channel);
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
