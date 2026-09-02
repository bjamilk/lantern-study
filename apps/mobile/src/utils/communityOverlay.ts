import type { Group as SharedGroup } from '@lantern/shared/types';
import type { MyCommunity } from '@lantern/shared/network';

/**
 * The slice of a mobile `groupStore` group that the shared community helpers
 * (`decorateChannels`, `communityUnreadTotal`) read. Kept structural so this
 * file stays free of store imports and testable under plain jest.
 */
export interface OverlayGroupSource {
  id: string;
  unreadCount?: number;
  isArchived?: boolean;
  communityId?: string | null;
  adminIds?: string[];
  lastMessage?: { text?: string; questionStem?: string; createdAt?: string } | string | null;
}

/**
 * Mobile groups carry `lastMessage` as a message OBJECT; the shared `Group`
 * (which `decorateChannels` overlays onto channel rows) carries it as the
 * preview string. Passing the store's groups straight through would render
 * "[object Object]" as a channel subtitle, so map the four fields the
 * overlay reads and nothing else.
 */
export function toChannelOverlayGroups(groups: readonly OverlayGroupSource[]): SharedGroup[] {
  return groups.map((g) => {
    const last = g.lastMessage;
    const preview =
      typeof last === 'string'
        ? last
        : last
          ? (last.questionStem || last.text || '').trim() || undefined
          : undefined;
    const time = typeof last === 'object' && last ? last.createdAt : undefined;
    return {
      id: g.id,
      name: '',
      members: [],
      adminIds: g.adminIds ?? [],
      unreadCount: g.unreadCount ?? 0,
      isArchived: g.isArchived ?? false,
      communityId: g.communityId ?? null,
      lastMessage: preview,
      lastMessageTime: time,
    };
  });
}

/** `communityId → { slug, name }` for the `in <Community> ›` link. */
export function findMyCommunity(
  mine: readonly Pick<MyCommunity, 'id' | 'slug' | 'name'>[],
  communityId: string | null | undefined
): { slug: string; name: string } | null {
  if (!communityId) return null;
  const hit = mine.find((c) => c.id === communityId);
  return hit ? { slug: hit.slug, name: hit.name } : null;
}
