import { useCallback, useMemo, useRef, useState } from 'react';
import {
  communityShareUrl,
  type CommunityChannel,
  type CommunityDetail,
  type StudyRoomListItem,
} from '@lantern/shared/network';

/**
 * The one navigation contract the community surfaces speak (spec §5.1).
 * App.tsx implements it once (`handleCommunityNavigate`); the column and the
 * community page both call it, so a row means the same thing in either host.
 *
 * Screens: 'Dashboard' · 'Discover' · 'Home' {slug} · 'CloseCommunity' ·
 * 'GroupChat' {groupId, groupName, joined?, communityId, communitySlug, memberCount?} ·
 * 'JoinChannel' (same params) · 'OpenLounge' {communityId, communitySlug} ·
 * 'StudyRoom' {roomId} | {communityId, courseId, topic} · 'CreateLab' ·
 * 'CreateGroup' · 'Members' {slug}.
 */
export type CommunityNavigate = (
  screen: string,
  params?: Record<string, unknown>
) => void | Promise<void>;

export interface CommunityListActions {
  onOpenLounge: () => void;
  onOpenChannel: (channel: CommunityChannel) => void;
  onJoinChannel: (channel: CommunityChannel) => void;
  onOpenRoom: (room: StudyRoomListItem) => void;
  onCreateChannel: () => void;
  onStartRoom: () => void;
  onOpenMembers: () => void;
}

export const LOUNGE_PENDING_ID = 'lounge';

/**
 * Row handlers for a community, with a single in-flight guard so a double
 * click on `# lounge` cannot mint twice or a join cannot race its open.
 */
export function useCommunityListActions(
  detail: CommunityDetail | undefined,
  onNavigate: CommunityNavigate
): { actions: CommunityListActions | null; pendingId: string | null } {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  const run = useCallback(
    async (id: string, screen: string, params: Record<string, unknown>) => {
      if (pendingRef.current) return;
      pendingRef.current = id;
      setPendingId(id);
      try {
        await onNavigate(screen, params);
      } finally {
        pendingRef.current = null;
        setPendingId(null);
      }
    },
    [onNavigate]
  );

  const actions = useMemo<CommunityListActions | null>(() => {
    if (!detail) return null;
    const base = {
      communityId: detail.id,
      communitySlug: detail.slug,
      communityName: detail.name,
    };
    return {
      onOpenLounge: () => void run(LOUNGE_PENDING_ID, 'OpenLounge', base),
      onOpenChannel: (channel) =>
        void onNavigate('GroupChat', {
          ...base,
          groupId: channel.id,
          groupName: channel.name,
          memberCount: channel.memberCount,
          joined: true,
        }),
      onJoinChannel: (channel) =>
        void run(channel.id, 'JoinChannel', {
          ...base,
          groupId: channel.id,
          groupName: channel.name,
          memberCount: channel.memberCount,
        }),
      onOpenRoom: (room) => void onNavigate('StudyRoom', { roomId: room.id }),
      onCreateChannel: () => void onNavigate('CreateGroup', base),
      onStartRoom: () => void onNavigate('CreateLab', { ...base, courseId: detail.course_id }),
      onOpenMembers: () => void onNavigate('Members', { slug: detail.slug }),
    };
  }, [detail, onNavigate, run]);

  return { actions, pendingId };
}

/** Put the public invite URL on the clipboard; false when the browser refuses. */
export async function copyCommunityInvite(slug: string): Promise<boolean> {
  const url = communityShareUrl(slug);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const input = document.createElement('textarea');
    input.value = url;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(input);
    return ok;
  } catch {
    return false;
  }
}
