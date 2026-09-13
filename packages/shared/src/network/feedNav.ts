import { parseNotificationLink } from '../notifications/presentation';

type FeedNavItem = {
  objectType: string | null;
  objectId: string | null;
  audienceType?: string | null;
  audienceId?: string | null;
  payload?: Record<string, unknown>;
};

export type FeedNavTarget =
  | { screen: 'MarketplaceListingDetail'; params: { listingId: string } }
  | { screen: 'GroupChat'; params: { groupId: string; messageId?: string } }
  | { screen: 'CreatorProfile'; params: { userId: string } }
  | { screen: 'NoteEditor'; params: { noteId: string } }
  | { screen: 'CommunityPost'; params: { slug: string; groupId: string; id: string } };

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | null {
  const value = payload?.[key];
  return typeof value === 'string' && value ? value : null;
}

/**
 * Where an academic-feed row should open.
 * Board posts go to the post; study groups stay on Chat.
 */
export function feedItemNavTarget(item: FeedNavItem): FeedNavTarget | null {
  const payload = item.payload || {};
  const link = payloadString(payload, 'link');
  if (link) {
    const parsed = parseNotificationLink(link);
    if (parsed?.type === 'community_post' && parsed.slug && parsed.groupId && parsed.id) {
      return {
        screen: 'CommunityPost',
        params: { slug: parsed.slug, groupId: parsed.groupId, id: parsed.id },
      };
    }
  }

  const slug = payloadString(payload, 'communitySlug') || payloadString(payload, 'slug');
  const groupId = payloadString(payload, 'groupId') || item.audienceId;
  const postId =
    payloadString(payload, 'postId') ||
    payloadString(payload, 'rootId') ||
    (item.objectType === 'community_post' ? item.objectId : null);

  if (item.objectType === 'community_post' || (slug && groupId && postId)) {
    if (slug && groupId && postId) {
      return { screen: 'CommunityPost', params: { slug, groupId, id: postId } };
    }
  }

  if (!item.objectId && !item.audienceId) return null;

  switch (item.objectType) {
    case 'listing':
      return item.objectId
        ? { screen: 'MarketplaceListingDetail', params: { listingId: item.objectId } }
        : null;
    case 'profile':
      return item.objectId
        ? { screen: 'CreatorProfile', params: { userId: item.objectId } }
        : null;
    case 'note':
      return item.objectId ? { screen: 'NoteEditor', params: { noteId: item.objectId } } : null;
    case 'group':
      return item.objectId ? { screen: 'GroupChat', params: { groupId: item.objectId } } : null;
    case 'question':
    case 'message':
      if (item.audienceId) {
        return {
          screen: 'GroupChat',
          params: { groupId: item.audienceId, messageId: item.objectId || undefined },
        };
      }
      return item.objectId ? { screen: 'GroupChat', params: { groupId: item.objectId } } : null;
    default:
      if (item.audienceType === 'group' && item.audienceId) {
        return {
          screen: 'GroupChat',
          params: { groupId: item.audienceId, messageId: item.objectId || undefined },
        };
      }
      return null;
  }
}

export function remapFeedTargetForBoard(
  target: FeedNavTarget,
  lookup: {
    isBoardGroup: (groupId: string) => boolean;
    communitySlugForGroup: (groupId: string) => string | null;
  },
): FeedNavTarget {
  if (target.screen !== 'GroupChat') return target;
  const groupId = target.params.groupId;
  if (!lookup.isBoardGroup(groupId)) return target;
  const slug = lookup.communitySlugForGroup(groupId);
  const postId = target.params.messageId;
  if (slug && postId) {
    return { screen: 'CommunityPost', params: { slug, groupId, id: postId } };
  }
  return target;
}
