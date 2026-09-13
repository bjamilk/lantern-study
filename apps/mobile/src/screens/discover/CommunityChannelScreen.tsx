import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
// react-native's own SafeAreaView is iOS-only and applies nothing on Android.
// This route is in IMMERSIVE_SCREENS, so the shell renders no TopBar above it
// and the screen owns both insets itself.
import { SafeAreaView } from 'react-native-safe-area-context';
import { COMMUNITY_COPY } from '@lantern/shared/network';
import { collectKnownLounges, useCommunityStore } from '../../stores/communityStore';
import { GroupChatView, type GroupChatNavigation } from '../groups/GroupChatScreen';
import { CommunityBoardScreen } from './CommunityBoardScreen';
import { BackButton } from '../../components/ui';
import { brand } from '../../theme';

type Params = {
  groupId: string;
  groupName?: string;
  /** Present when opened from inside the community; a deep link carries only the slug. */
  communitySlug?: string;
  communityName?: string;
  communityId?: string;
  /** Set by the community page when it opens the lounge, so the router does
   *  not have to wait for the community detail to resolve. */
  isLounge?: boolean;
};

/**
 * One community room on the community's OWN stack — the router between the
 * community's two surfaces (founder decision 1, 2026-09-02):
 *
 *  - the LOUNGE stays a live chat. It keeps `GroupChatView` with
 *    `host="community"`, which now strips the study/test apparatus.
 *  - every other community group is a BOARD: a top-down list of post cards.
 *
 * The route name and the file name are unchanged so the deep link
 * `discover/c/:communitySlug/ch/:groupId` and every existing navigation param
 * keep working. There is no `canAccessDiscoverHub` gate here: the gate stays on
 * `DiscoverScreen` and `CommunityDetailScreen`, and refusing a room to a member
 * of the group is what would force the chat fallback (§4.1).
 */
export function CommunityChannelScreen({
  navigation,
  route,
}: {
  navigation: GroupChatNavigation;
  route: { params: Params };
}) {
  const { groupId, groupName, communitySlug } = route.params;

  const detailBySlug = useCommunityStore((s) => s.detailBySlug);
  const channelsById = useCommunityStore((s) => s.channelsById);
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadMine = useCommunityStore((s) => s.loadMine);
  const detail = communitySlug ? detailBySlug[communitySlug] : undefined;
  const communityName = route.params.communityName ?? detail?.name ?? null;
  const communityId = route.params.communityId ?? detail?.id ?? null;

  // A fresh Set from a zustand selector never settles (see GroupChatScreen's
  // `selectMyCommunity` note); memoise on the store records instead.
  const knownLounges = useMemo(
    () => collectKnownLounges(detailBySlug, channelsById, myCommunities),
    [detailBySlug, channelsById, myCommunities]
  );
  // Deciding the surface needs the community's `lounge_group_id`. Knowing its
  // NAME is not enough, and guessing "board" is the one unrecoverable mistake
  // here: it would render the community's single live chat as a board
  // (founder decision 1). A MISSING slug is not an answer either — a
  // notification or a Chat-tab redirect arrives with only a group id — so
  // resolve through whatever pointer we do have and show a spinner until the
  // answer is real.
  const [resolveAttempted, setResolveAttempted] = useState(false);
  const toldLounge = route.params.isLounge === true;
  const toldBoard = route.params.isLounge === false;
  const knownLounge = toldLounge || knownLounges.loungeGroupIds.has(groupId);
  const isLounge = knownLounge;
  const communityResolved =
    !!detail || (!!communityId && knownLounges.resolvedCommunityIds.has(communityId));
  const canDecide =
    toldLounge || toldBoard || knownLounge || communityResolved || resolveAttempted;

  useEffect(() => {
    if (canDecide) return;
    let cancelled = false;
    // The slug is the direct route; without one, the membership list carries
    // every community's lounge pointer. Either way, an answer we cannot get
    // falls back to the CHAT surface below, never to the board.
    const attempt = communitySlug ? loadCommunity(communitySlug) : loadMine();
    void attempt
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setResolveAttempted(true);
      });
    return () => {
      cancelled = true;
    };
  }, [canDecide, communitySlug, loadCommunity, loadMine]);

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

  if (!canDecide) {
    return (
      // This wait is short but it is not guaranteed to end (the resolve can sit
      // on a dead connection until it times out), and this route is immersive,
      // so the shell renders no chrome above it. A blank spinner with no back
      // arrow was exactly the trap the audit found: give it one.
      <SafeAreaView edges={['top', 'bottom']} className="flex-1 bg-lantern-background">
        <View className="flex-row items-center h-[56px] pr-2">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={brand.text} accessibilityLabel="Opening this room" />
        </View>
      </SafeAreaView>
    );
  }

  if (!isLounge && (toldBoard || communityResolved)) {
    return <CommunityBoardScreen navigation={navigation} route={route} />;
  }

  // A community we tried and failed to resolve lands here too: it falls back to
  // the CHAT surface, never to the board — the same call web's
  // CommunityChannelPane makes. `host="community"` keeps the study apparatus
  // stripped either way, so the failure mode is safe in both directions.
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
