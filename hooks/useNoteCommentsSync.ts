import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';

const COMMENT_REFRESH_FALLBACK_MS = 30_000;

/**
 * Keep an open note discussion current. Realtime provides the fast path;
 * focus/visibility events and a low-frequency poll recover dropped channels.
 */
export function useNoteCommentsSync(noteId: string, onRefresh: () => Promise<void>) {
  const refreshRef = useRef(onRefresh);
  const inFlightRef = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await refreshRef.current();
    } catch {
      // Background sync is best-effort; the existing discussion remains usable.
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, [noteId]);

  useEffect(() => {
    inFlightRef.current = false;
    void refresh();

    const channel = supabase
      .channel(`note-comments:${noteId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'note_comments',
          filter: `note_id=eq.${noteId}`,
        },
        () => {
          void refresh();
        }
      )
      .subscribe();

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const refreshOnFocus = () => void refresh();
    const fallbackTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, COMMENT_REFRESH_FALLBACK_MS);

    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshOnFocus);

    return () => {
      window.clearInterval(fallbackTimer);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [noteId, refresh]);

  return { refresh, isRefreshing };
}
