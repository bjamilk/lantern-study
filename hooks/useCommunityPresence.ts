import { useEffect, useRef } from 'react';
import {
  communityPresenceChannel,
  shouldSubscribeCommunityPresence,
  type CommunityPresencePayload,
} from '@lantern/shared/network';
import { normalizeUserSettings, userShowsOnlineStatus } from '@lantern/shared/settings';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useCommunityStore } from '../stores/communityStore';
import { useUIStore } from '../stores/uiStore';

/**
 * The ONE live-presence subscription for the active community (spec §3).
 *
 * Mounted once in App.tsx. Subscribes to `community:{id}` while a community
 * is on screen and the gate passes (member, not low-data, not an
 * institution-sized room); writes `uiStore.communityPresence`, which the
 * column, the page header and the members panel all read — none of them
 * open a second channel. Hidden users (showOnlineStatus off) subscribe so
 * they see others, but never `track`. Any channel failure clears the live
 * set silently; the stored `last_seen_at` layer carries on.
 */
export function useCommunityPresence(): void {
  const activeCommunity = useUIStore((s) => s.activeCommunity);
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const setCommunityPresence = useUIStore((s) => s.setCommunityPresence);
  const currentUser = useAuthStore((s) => s.currentUser);
  const detail = useCommunityStore((s) =>
    activeCommunity ? s.detailBySlug[activeCommunity.slug] : undefined
  );

  const communityId = activeCommunity?.id || null;
  const userId = currentUser?.id || null;
  const isMember = detail?.isMember === true;
  const memberCount = detail?.member_count ?? 0;
  const enabled =
    !!communityId &&
    !!userId &&
    shouldSubscribeCommunityPresence({ isMember, lowDataMode, memberCount });
  const showsOnline = currentUser
    ? userShowsOnlineStatus(normalizeUserSettings(currentUser.settings).privacy)
    : false;

  // Name / avatar changes must not tear the channel down and back up.
  const payloadRef = useRef<CommunityPresencePayload | null>(null);
  payloadRef.current = currentUser
    ? { userId: currentUser.id, name: currentUser.name || 'Student', avatarUrl: currentUser.avatarUrl || null }
    : null;

  useEffect(() => {
    if (!enabled || !communityId || !userId) {
      if (useUIStore.getState().communityPresence) setCommunityPresence(null);
      return;
    }
    let disposed = false;
    const channel = supabase.channel(communityPresenceChannel(communityId), {
      config: { presence: { key: userId } },
    });
    const publish = (connected: boolean) => {
      if (disposed) return;
      setCommunityPresence({
        communityId,
        onlineIds: connected ? Object.keys(channel.presenceState()) : [],
        connected,
      });
    };
    channel
      .on('presence', { event: 'sync' }, () => publish(true))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          publish(true);
          if (showsOnline && payloadRef.current) {
            void channel.track(payloadRef.current);
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          publish(false);
        }
      });
    return () => {
      disposed = true;
      void supabase.removeChannel(channel);
      setCommunityPresence(null);
    };
  }, [enabled, communityId, userId, showsOnline, setCommunityPresence]);
}

export default useCommunityPresence;
