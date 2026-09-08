import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { scrubEmailFromDisplayName } from '@lantern/shared/utils/displayNames';
import { communityPresenceChannel, type CommunityPresencePayload } from '@lantern/shared/network';
import { userShowsOnlineStatus } from '@lantern/shared/settings';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';

const EMPTY: ReadonlySet<string> = new Set();
const DISCONNECTED: CommunityPresenceSnapshot = { onlineIds: EMPTY, connected: false };

export interface CommunityPresenceSnapshot {
  onlineIds: ReadonlySet<string>;
  connected: boolean;
}

interface PresenceEntry {
  channel: RealtimeChannel;
  userId: string;
  refs: number;
  snapshot: CommunityPresenceSnapshot;
  listeners: Set<(snapshot: CommunityPresenceSnapshot) => void>;
  teardown: ReturnType<typeof setTimeout> | null;
  wantsTrack: boolean;
  payload: CommunityPresencePayload | null;
  tracked: boolean;
}

/**
 * ONE channel per community topic, refcounted.
 *
 * supabase-js dedupes `channel(topic)` by topic and `subscribe()` is a no-op
 * on an already-joined channel, so two screens opening `community:{id}` at
 * once (CommunityDetail pushing CommunityMembers: the new screen's focus
 * effect runs BEFORE the navigator emits blur on the old one) used to share
 * one instance while each believed it owned it — the second never got a
 * SUBSCRIBED callback, and the first screen's `removeChannel` then killed the
 * channel for both, leaving a zombie re-joining forever. Holding the channel
 * above the screens and only tearing it down when the last holder leaves is
 * what the web side already does by mounting its hook once in App.tsx.
 */
const entries = new Map<string, PresenceEntry>();

function maybeTrack(entry: PresenceEntry): void {
  if (!entry.wantsTrack || !entry.payload || entry.tracked || !entry.snapshot.connected) return;
  entry.tracked = true;
  void Promise.resolve(entry.channel.track(entry.payload)).catch(() => {
    // Presence is best-effort; the stored `last_seen_at` layer still counts us.
    entry.tracked = false;
  });
}

function acquireCommunityPresence(
  communityId: string,
  userId: string,
  listener: (snapshot: CommunityPresenceSnapshot) => void,
  track: { enabled: boolean; payload: CommunityPresencePayload }
): () => void {
  const topic = communityPresenceChannel(communityId);
  let entry = entries.get(topic);

  // An account switch keeps the topic but changes the presence key: the old
  // channel can never speak for the new user, so drop it outright.
  if (entry && entry.userId !== userId) {
    if (entry.teardown) clearTimeout(entry.teardown);
    entries.delete(topic);
    void supabase.removeChannel(entry.channel);
    entry = undefined;
  }
  if (entry?.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = null;
  }

  if (!entry) {
    const channel = supabase.channel(topic, { config: { presence: { key: userId } } });
    const created: PresenceEntry = {
      channel,
      userId,
      refs: 0,
      snapshot: DISCONNECTED,
      listeners: new Set(),
      teardown: null,
      wantsTrack: false,
      payload: null,
      tracked: false,
    };
    const publish = (snapshot: CommunityPresenceSnapshot) => {
      created.snapshot = snapshot;
      created.listeners.forEach((notify) => notify(snapshot));
    };
    channel
      .on('presence', { event: 'sync' }, () => {
        publish({ onlineIds: new Set(Object.keys(channel.presenceState())), connected: true });
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          publish({ onlineIds: created.snapshot.onlineIds, connected: true });
          maybeTrack(created);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          created.tracked = false;
          publish(DISCONNECTED);
        }
      });
    entries.set(topic, created);
    entry = created;
  }

  const held = entry;
  held.refs += 1;
  held.listeners.add(listener);
  held.wantsTrack = track.enabled;
  held.payload = track.payload;
  maybeTrack(held);
  // A screen joining an already-synced channel must not wait for the next
  // sync to see who is online.
  if (held.snapshot !== DISCONNECTED) listener(held.snapshot);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    held.listeners.delete(listener);
    held.refs -= 1;
    if (held.refs > 0) return;
    // Deferred: on a pop the leaving screen's cleanup and the revealed
    // screen's focus effect run in the same flush, and the channel should
    // survive that handover rather than churn.
    held.teardown = setTimeout(() => {
      held.teardown = null;
      if (held.refs > 0) return;
      if (entries.get(topic) === held) entries.delete(topic);
      void supabase.removeChannel(held.channel);
    }, 0);
  };
}

/**
 * Live "who is here" for ONE community: Supabase Presence on
 * `community:{id}` (spec §3). Mounted through `useFocusEffect`, so it exists
 * only while a community screen is focused — never in lists, never on the hub
 * — and blur/background releases it. It lives outside
 * `useRealtimeSubscriptions` on purpose, so the lean-background logic there
 * is untouched.
 *
 * Several screens may hold the same community at once (CommunityDetail is
 * still mounted while CommunityMembers pushes over it), so the channel itself
 * is shared and refcounted above the screens; only the last release tears it
 * down.
 *
 * Presence key = the viewer's user id, so two devices count once. Hidden
 * users (`showOnlineStatus` off) subscribe — they see others — but never
 * `track`. Any error state means "not connected": ids cleared, nothing
 * surfaced; the stored `last_seen_at` layer carries the counts.
 */
export function useCommunityPresence(
  communityId: string | null,
  opts: { enabled: boolean }
): CommunityPresenceSnapshot {
  const userId = useAuthStore((s) => s.user?.id);
  const userName = useAuthStore(
    (s) =>
      // Never the address: this name is tracked on the presence channel that
      // every member of the community reads.
      s.profileName ||
      scrubEmailFromDisplayName(s.user?.user_metadata?.name as string | undefined) ||
      scrubEmailFromDisplayName(s.user?.email) ||
      ''
  );
  const avatarUrl = useAuthStore(
    (s) => (s.user?.user_metadata?.avatar_url as string | undefined) ?? null
  );
  const showOnlineStatus = useSettingsStore((s) => s.settings.privacy.showOnlineStatus);
  const [snapshot, setSnapshot] = useState<CommunityPresenceSnapshot>(DISCONNECTED);
  const { enabled } = opts;

  // Name / avatar changes must not tear the shared channel down and back up.
  const payloadRef = useRef<CommunityPresencePayload>({ userId: userId ?? '', name: userName, avatarUrl });
  payloadRef.current = { userId: userId ?? '', name: userName, avatarUrl };

  useFocusEffect(
    useCallback(() => {
      if (!communityId || !enabled || !userId) {
        setSnapshot(DISCONNECTED);
        return undefined;
      }
      let cancelled = false;
      const release = acquireCommunityPresence(
        communityId,
        userId,
        (next) => {
          if (!cancelled) setSnapshot(next);
        },
        {
          enabled: userShowsOnlineStatus({ showOnlineStatus }),
          payload: { ...payloadRef.current, userId },
        }
      );
      return () => {
        cancelled = true;
        setSnapshot(DISCONNECTED);
        release();
      };
      // `payloadRef` keeps name/avatar out of the deps on purpose: they must
      // not resubscribe, and the tracked payload is refreshed on every
      // acquire anyway.
    }, [communityId, enabled, userId, showOnlineStatus])
  );

  return snapshot;
}

export default useCommunityPresence;
