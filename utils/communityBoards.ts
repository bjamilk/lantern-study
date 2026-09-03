/**
 * Which of the viewer's groups are community boards (spec §5.2).
 *
 * `isCommunityBoardGroup` in the shared package takes ONE lounge id, because a
 * screen inside a community knows exactly one. The chat list and the Chat-tab
 * redirect span every community the viewer belongs to, so they need the same
 * rule over a set — that is all these helpers do. The rule itself is never
 * re-implemented here (§8 parity rule 3).
 */
import { isCommunityBoardGroupIn } from '@lantern/shared/network';
import type {
  CommunityChannels,
  CommunityDetail,
  KnownCommunityLounges,
  MyCommunity,
} from '@lantern/shared/network';
import type { Group } from '../types';

/**
 * Every group we can positively identify as a community's ONE live chat,
 * together with the communities that answer was actually resolved for.
 *
 * Founder decision 1: the lounge is a chat, not a board, so it stays in Chat.
 * The membership list carries each community's `lounge_group_id`, so a cold
 * page load knows the answer without having opened a community page — and a
 * community that is still unresolved is reported as such rather than being
 * silently treated as "has no lounge", which used to drop the lounge out of
 * the chat list until the user visited that community.
 */
export function collectKnownLounges(
  detailBySlug: Record<string, CommunityDetail>,
  channelsById: Record<string, CommunityChannels>,
  activeLoungeGroupId?: string | null,
  myCommunities?: MyCommunity[]
): KnownCommunityLounges {
  const loungeGroupIds = new Set<string>();
  const resolvedCommunityIds = new Set<string>();
  for (const detail of Object.values(detailBySlug || {})) {
    if (detail?.id) resolvedCommunityIds.add(detail.id);
    if (detail?.lounge_group_id) loungeGroupIds.add(detail.lounge_group_id);
  }
  for (const payload of Object.values(channelsById || {})) {
    if (payload?.communityId) resolvedCommunityIds.add(payload.communityId);
    if (payload?.loungeGroupId) loungeGroupIds.add(payload.loungeGroupId);
  }
  for (const mine of myCommunities || []) {
    // `undefined` = a payload from before the membership list carried the
    // pointer: still unresolved, so that community's groups stay chats.
    if (mine?.lounge_group_id === undefined) continue;
    resolvedCommunityIds.add(mine.id);
    if (mine.lounge_group_id) loungeGroupIds.add(mine.lounge_group_id);
  }
  if (activeLoungeGroupId) loungeGroupIds.add(activeLoungeGroupId);
  return { loungeGroupIds, resolvedCommunityIds };
}

/** `isCommunityBoardGroup`, over the viewer's whole set of known lounges. */
export function isBoardGroup(
  group: Pick<Group, 'id' | 'communityId' | 'communitySurface'>,
  known: KnownCommunityLounges
): boolean {
  return isCommunityBoardGroupIn(group, known);
}
