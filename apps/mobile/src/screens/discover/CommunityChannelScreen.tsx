import React, { useCallback, useEffect, useMemo } from 'react';
import { COMMUNITY_COPY, canAccessDiscoverHub } from '@lantern/shared/network';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useCommunityStore } from '../../stores/communityStore';
import { GroupChatView, type GroupChatNavigation } from '../groups/GroupChatScreen';
import { DiscoverComingSoon } from './DiscoverComingSoon';

type Params = {
  groupId: string;
  groupName?: string;
  /** Present when opened from inside the community; a deep link carries only the slug. */
  communitySlug?: string;
  communityName?: string;
  communityId?: string;
};

/**
 * A community text channel, on the community's OWN stack (founder rule §0a):
 * the same GroupChatView the Chat tab renders, with the `in <Community> ›`
 * subtitle that pops back to CommunityDetail. Back is a plain goBack(), so
 * hardware back lands on the community, never on the Chat tab.
 *
 * A deep link (`discover/c/:communitySlug/ch/:groupId`) carries the slug but
 * no name, so the community is resolved from the store the way
 * CommunityMembers does; until it resolves there is no context link at all,
 * rather than one reading "in undefined" that navigates to an undefined slug.
 */
export function CommunityChannelScreen({
  navigation,
  route,
}: {
  navigation: GroupChatNavigation;
  route: { params: Params };
}) {
  const isPlatformAdmin = usePlatformAdmin();
  const { groupId, groupName, communitySlug } = route.params;

  const detail = useCommunityStore((s) => (communitySlug ? s.detailBySlug[communitySlug] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const communityName = route.params.communityName ?? detail?.name ?? null;

  useEffect(() => {
    if (!canAccessDiscoverHub(isPlatformAdmin)) return;
    if (!communitySlug || detail || route.params.communityName) return;
    void loadCommunity(communitySlug).catch(() => undefined);
  }, [isPlatformAdmin, communitySlug, detail, route.params.communityName, loadCommunity]);

  const onContextPress = useCallback(() => {
    if (!communitySlug) return;
    // CommunityDetail already sits below us on the Market stack, so navigate
    // pops back to it rather than pushing a second copy.
    navigation.navigate('CommunityDetail', { slug: communitySlug });
  }, [navigation, communitySlug]);

  const communityContext = useMemo(
    () =>
      communitySlug && communityName
        ? { label: COMMUNITY_COPY.inCommunity(communityName), onPress: onContextPress }
        : null,
    [communitySlug, communityName, onContextPress]
  );

  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }

  return (
    <GroupChatView
      groupId={groupId}
      groupName={groupName}
      navigation={navigation}
      host="community"
      communityContext={communityContext}
    />
  );
}

export default CommunityChannelScreen;
