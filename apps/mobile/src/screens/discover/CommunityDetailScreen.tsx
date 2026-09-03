import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COMMUNITY_COPY,
  COMMUNITY_LOUNGE_CHANNEL_NAME,
  boardDisplayName,
  boardSubtitle,
  buildCommunityChannelRows,
  canAccessDiscoverHub,
  communityHeaderLine,
  communityMembershipAction,
  communityOnlineCount,
  communityShareUrl,
  presenceLabel,
  shouldSubscribeCommunityPresence,
  type CommunityChannel,
  type CommunityChannelRow,
  type CommunityStudyGroup,
  type PresenceSnapshot,
} from '@lantern/shared/network';
import {
  fetchStudyPresence,
  joinCommunity,
  joinDiscoverableGroup,
  leaveCommunity,
  openCommunityLounge,
} from '../../services/api';
import { useGroupStore } from '../../stores/groupStore';
import { useAuthStore } from '../../stores';
import { useCommunityStore } from '../../stores/communityStore';
import { useCommunityPresence } from '../../hooks/useCommunityPresence';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useChrome } from '../../components/layout/ChromeContext';
import { ActionSheet, BackButton, type ActionSheetItem } from '../../components/ui';
import { ResolvedAvatar } from '../../components/ResolvedAvatar';
import { ChannelRow, RoomRow, StudyGroupRow } from '../../components/community';
import { toChannelOverlayGroups } from '../../utils/communityOverlay';
import { DiscoverComingSoon } from './DiscoverComingSoon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (screen: string, params?: Record<string, unknown>) => void } | undefined;
};

/** Tile ring per community kind — the one visual cue that a course room is not a campus room. */
const KIND_RING: Record<string, string> = {
  institution: '#0ea5e9',
  programme: '#8b5cf6',
  level: '#f59e0b',
  course: '#6366f1',
  topic: '#ec4899',
};

const ROOM_TICK_MS = 60_000;

/**
 * One community as a SERVER: the `General` chat, BOARDS, STUDY GROUPS, STUDY
 * ROOMS and MEMBERS, in the one order `buildCommunityChannelRows` emits (§8
 * parity rule 2 — this screen never sorts, filters or inserts a row of its
 * own).
 *
 * Everything opens on THIS stack (founder rule §0a) — a board pushes
 * CommunityChannel, a room pushes StudyRoom, the roster pushes
 * CommunityMembers, and back always returns here. The ONE exception is a study
 * group, which lives in Chat by design (§7) and therefore changes tab: the
 * move is shown, not inferred.
 */
function CommunityServer({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: { slug: string } };
}) {
  const { slug } = route.params;
  const userId = useAuthStore((s) => s.user?.id);
  const { lowDataMode } = useLowDataMode();
  const { onScroll: chromeOnScroll } = useChrome();
  const groups = useGroupStore((s) => s.groups);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);

  const community = useCommunityStore((s) => s.detailBySlug[slug]);
  const payload = useCommunityStore((s) => (community ? s.channelsById[community.id] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadChannels = useCommunityStore((s) => s.loadChannels);
  const invalidate = useCommunityStore((s) => s.invalidate);

  const [loading, setLoading] = useState(!community);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loungeError, setLoungeError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loungeBusy, setLoungeBusy] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setError(null);
    let detail;
    try {
      detail = await loadCommunity(slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Community not found');
      return;
    }
    // The server view is secondary — if it fails the header still renders.
    try {
      await loadChannels(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load this community');
    }
  }, [slug, loadCommunity, loadChannels]);

  // Refetch on every focus: unread resets after returning from a channel and
  // a room started from here shows up under STUDY ROOMS.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setNow(Date.now());
      void load().finally(() => {
        if (!cancelled) setLoading(false);
      });
      return () => {
        cancelled = true;
      };
    }, [load])
  );

  // "Closes in Xh" ticks once a minute while focused — never in low-data mode.
  useFocusEffect(
    useCallback(() => {
      if (lowDataMode) return undefined;
      const tick = setInterval(() => setNow(Date.now()), ROOM_TICK_MS);
      return () => clearInterval(tick);
    }, [lowDataMode])
  );

  const courseId = community?.course_id ?? null;
  useEffect(() => {
    if (!courseId || lowDataMode) {
      setPresence(null);
      return;
    }
    let cancelled = false;
    void fetchStudyPresence({ courseId })
      .then((snapshot) => {
        if (!cancelled) setPresence(snapshot);
      })
      .catch(() => {
        if (!cancelled) setPresence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, lowDataMode]);

  const presenceEnabled =
    !!community &&
    shouldSubscribeCommunityPresence({
      isMember: community.isMember,
      lowDataMode,
      memberCount: community.member_count,
    });
  const { onlineIds, connected } = useCommunityPresence(community?.id ?? null, {
    enabled: presenceEnabled,
  });

  const onlineCount = communityOnlineCount(
    payload?.onlineCount ?? community?.onlineCount ?? 0,
    onlineIds,
    connected
  );

  const overlayGroups = useMemo(() => toChannelOverlayGroups(groups), [groups]);
  const rows = useMemo<CommunityChannelRow[]>(
    () => (payload ? buildCommunityChannelRows(payload, overlayGroups, now) : []),
    [payload, overlayGroups, now]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setNow(Date.now());
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const toggleMembership = async () => {
    if (!community || pending) return;
    setPending(true);
    const wasMember = community.isMember;
    try {
      if (wasMember) await leaveCommunity(community.id);
      else await joinCommunity(community.id);
      invalidate(community.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update membership');
    } finally {
      setPending(false);
    }
  };

  const openChannel = useCallback(
    (groupId: string, groupName: string, isLounge = false) => {
      if (!community) return;
      // `isLounge` is what tells CommunityChannel to render the live chat
      // rather than a board, without waiting for the detail to resolve.
      navigation.navigate('CommunityChannel', {
        groupId,
        groupName,
        communitySlug: community.slug,
        communityName: community.name,
        communityId: community.id,
        isLounge,
      });
    },
    [community, navigation]
  );

  const openLounge = async () => {
    if (!community || loungeBusy) return;
    setLoungeError(null);
    const loungeId = payload?.loungeGroupId ?? community.lounge_group_id;
    if (loungeId && groups.some((g) => g.id === loungeId)) {
      openChannel(loungeId, payload?.lounge?.name ?? community.name, true);
      return;
    }
    setLoungeBusy(true);
    try {
      // Idempotent: mints on first use, joins the caller either way.
      const lounge = await openCommunityLounge(community.id);
      if (userId) await fetchGroups(userId).catch(() => undefined);
      invalidate(community.id);
      openChannel(lounge.groupId, lounge.name, true);
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      setLoungeError(
        status === 503
          ? COMMUNITY_COPY.loungeUnavailable
          : err instanceof Error
            ? err.message
            : COMMUNITY_COPY.loungeUnavailable
      );
    } finally {
      setLoungeBusy(false);
    }
  };

  const joinThenOpen = async (channel: CommunityChannel) => {
    if (!community || joiningId) return;
    setJoiningId(channel.id);
    try {
      await joinDiscoverableGroup(channel.id);
      if (userId) await fetchGroups(userId).catch(() => undefined);
      invalidate(community.id);
      openChannel(channel.id, channel.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this channel');
    } finally {
      setJoiningId(null);
    }
  };

  const onChannelPress = (channel: CommunityChannel) => {
    if (!community) return;
    if (channel.isMember || groups.some((g) => g.id === channel.id)) {
      openChannel(channel.id, channel.name);
      return;
    }
    if (!community.isMember) {
      Alert.alert(boardDisplayName(channel), COMMUNITY_COPY.joinToOpen);
      return;
    }
    Alert.alert(`Join ${boardDisplayName(channel)}?`, boardSubtitle(channel, now), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Join', onPress: () => void joinThenOpen(channel) },
    ]);
  };

  const openMembers = () => {
    if (!community) return;
    navigation.navigate('CommunityMembers', {
      slug: community.slug,
      communityId: community.id,
      name: community.name,
    });
  };

  const createBoard = () => {
    if (!community) return;
    navigation.navigate('CreateGroup', {
      communityId: community.id,
      communityName: community.name,
      communitySlug: community.slug,
      communitySurface: 'board',
    });
  };

  /**
   * §7 entry point 1. A study group is a `groups` row with
   * `community_surface = 'study_group'`: it keeps the full study surface, opens
   * in Chat, and stays listed here so members can find and join it.
   */
  const startStudyGroup = () => {
    if (!community) return;
    navigation.navigate('CreateGroup', {
      communityId: community.id,
      communityName: community.name,
      communitySlug: community.slug,
      communitySurface: 'study_group',
    });
  };

  /** A study group row taps into CHAT — never into a board. */
  const openStudyGroup = (group: CommunityStudyGroup) => {
    if (!community) return;
    navigation.getParent?.()?.navigate('ChatTab', {
      screen: 'GroupChat',
      params: {
        groupId: group.id,
        groupName: group.name,
        communitySlug: community.slug,
        communityName: community.name,
      },
    });
  };

  const joinThenOpenStudyGroup = async (group: CommunityStudyGroup) => {
    if (!community || joiningId) return;
    setJoiningId(group.id);
    try {
      await joinDiscoverableGroup(group.id);
      if (userId) await fetchGroups(userId).catch(() => undefined);
      invalidate(community.id);
      openStudyGroup(group);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this study group');
    } finally {
      setJoiningId(null);
    }
  };

  const startRoom = () => {
    if (!community) return;
    navigation.navigate('StudyRoom', {
      communityId: community.id,
      courseId: community.course_id ?? undefined,
      communityName: community.name,
    });
  };

  const shareInvite = async () => {
    if (!community) return;
    try {
      await Share.share({ message: communityShareUrl(community.slug) });
    } catch {
      // The share sheet was dismissed or is unavailable; nothing to surface.
    }
  };

  const menuItems: ActionSheetItem[] = useMemo(() => {
    if (!community?.isMember) return [];
    const items: ActionSheetItem[] = [];
    // Private communities have no invite in phase 1 (§6) — same rule as web.
    if (community.visibility === 'public') {
      items.push({ label: COMMUNITY_COPY.invite, icon: 'link-outline', onPress: () => void shareInvite() });
    }
    items.push(
      { label: COMMUNITY_COPY.createBoard, icon: 'add-circle-outline', onPress: createBoard },
      { label: COMMUNITY_COPY.startStudyGroup, icon: 'people-outline', onPress: startStudyGroup },
      { label: COMMUNITY_COPY.startRoom, icon: 'volume-medium-outline', onPress: startRoom }
    );
    return items;
    // Handlers close over `community` and `navigation`, both stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community?.isMember, community?.id, community?.visibility]);

  const presenceLine = presenceLabel(presence);
  const membershipLabel = community
    ? communityMembershipAction(community.isMember, community.source)
    : 'Join';

  const renderRow = ({ item }: { item: CommunityChannelRow }) => {
    switch (item.kind) {
      case 'lounge': {
        const lounge = item.channel;
        return (
          <View>
            <ChannelRow
              displayName={boardDisplayName({ isLounge: true, name: COMMUNITY_LOUNGE_CHANNEL_NAME })}
              subtitle={lounge ? boardSubtitle(lounge, now) : COMMUNITY_COPY.loungeSubtitle}
              unread={item.unread}
              joined
              chat
              busy={loungeBusy}
              onPress={() => void openLounge()}
            />
            {loungeError ? (
              <Text className="px-4 pb-2 text-xs text-red-500">{loungeError}</Text>
            ) : null}
          </View>
        );
      }
      case 'section':
        return (
          <View className="flex-row items-center px-4 pt-4 pb-1">
            <Text className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {item.title}
            </Text>
            {item.action ? (
              <Pressable
                onPress={
                  item.action === 'create-board'
                    ? createBoard
                    : item.action === 'start-study-group'
                      ? startStudyGroup
                      : startRoom
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel={
                  item.action === 'create-board'
                    ? COMMUNITY_COPY.createBoard
                    : item.action === 'start-study-group'
                      ? COMMUNITY_COPY.startStudyGroup
                      : COMMUNITY_COPY.startRoom
                }
                className="min-h-[44px] min-w-[44px] items-center justify-center -mr-3"
              >
                <Ionicons name="add" size={20} color="#64748b" />
              </Pressable>
            ) : null}
          </View>
        );
      case 'channel':
        return (
          <ChannelRow
            displayName={boardDisplayName(item.channel)}
            subtitle={boardSubtitle(item.channel, now)}
            unread={item.unread}
            visibility={item.channel.visibility}
            joined={item.channel.isMember}
            busy={joiningId === item.channel.id}
            onPress={() => onChannelPress(item.channel)}
          />
        );
      case 'study-group':
        return (
          <StudyGroupRow
            group={item.group}
            busy={joiningId === item.group.id}
            onPress={() =>
              item.group.isMember || groups.some((g) => g.id === item.group.id)
                ? openStudyGroup(item.group)
                : void joinThenOpenStudyGroup(item.group)
            }
          />
        );
      case 'room':
        return (
          <RoomRow
            room={item.room}
            now={now}
            onPress={() =>
              navigation.navigate('StudyRoom', {
                roomId: item.room.id,
                communityName: community?.name,
              })
            }
          />
        );
      case 'empty':
        return <Text className="px-4 py-3 text-sm text-lantern-text-tertiary">{item.text}</Text>;
      case 'members':
        return (
          <Pressable
            onPress={openMembers}
            accessibilityRole="button"
            accessibilityLabel={`${COMMUNITY_COPY.sectionMembers}, ${item.count}`}
            className="flex-row items-center px-4 pt-4 pb-3 min-h-[44px] active:bg-lantern-background-secondary"
          >
            <Text className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {COMMUNITY_COPY.sectionMembers} · {item.count.toLocaleString()}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#94a3b8" />
          </Pressable>
        );
      default:
        return null;
    }
  };

  const keyExtractor = (item: CommunityChannelRow, index: number) => {
    switch (item.kind) {
      case 'lounge':
        return 'lounge';
      case 'section':
        return `section-${item.title}`;
      case 'channel':
        return `channel-${item.channel.id}`;
      case 'study-group':
        return `study-group-${item.group.id}`;
      case 'room':
        return `room-${item.room.id}`;
      case 'members':
        return 'members';
      default:
        return `row-${index}`;
    }
  };

  if (loading && !community) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center">
        <ActivityIndicator color="#6366f1" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        <View
          className="rounded-full"
          style={{
            padding: 2,
            borderWidth: 2,
            borderColor: KIND_RING[community?.kind ?? ''] ?? '#6366f1',
          }}
        >
          <ResolvedAvatar name={community?.name ?? 'Community'} size={36} decorative />
        </View>
        <View className="flex-1 min-w-0 ml-2 flex-row items-center">
          <Text className="text-lg font-semibold text-lantern-text shrink" numberOfLines={1}>
            {community?.name ?? 'Community'}
          </Text>
          {community?.is_official ? (
            <Ionicons
              name="checkmark-circle"
              size={16}
              color="#6366f1"
              style={{ marginLeft: 4 }}
              accessibilityLabel="Official"
            />
          ) : null}
        </View>
        {community?.isMember ? (
          <>
            <Pressable
              onPress={openMembers}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Members${onlineCount > 0 ? `, ${onlineCount} online` : ''}`}
              className="flex-row items-center min-h-[44px] min-w-[44px] justify-center px-1.5"
            >
              <Ionicons name="people-outline" size={22} color="#64748b" />
              {onlineCount > 0 ? (
                <Text className="ml-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {onlineCount.toLocaleString()}
                </Text>
              ) : null}
            </Pressable>
            <Pressable
              onPress={() => setMenuOpen(true)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="More actions"
              className="min-h-[44px] min-w-[44px] items-center justify-center"
            >
              <Ionicons name="ellipsis-vertical" size={20} color="#64748b" />
            </Pressable>
          </>
        ) : null}
      </View>

      {error ? <Text className="mx-4 mt-3 text-xs text-red-500">{error}</Text> : null}

      {community ? (
        <FlatList
          data={rows}
          keyExtractor={keyExtractor}
          renderItem={renderRow}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListHeaderComponent={
            <View className="px-4 pt-4 pb-1 border-b border-lantern-border">
              <Text className="text-xs text-lantern-text-tertiary">
                {communityHeaderLine(community.kind, community.member_count, onlineCount)}
              </Text>
              {community.description ? (
                <Pressable
                  onPress={() => setDescriptionExpanded((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    descriptionExpanded ? 'Collapse description' : 'Expand description'
                  }
                >
                  <Text
                    className="text-sm text-lantern-text-secondary mt-2"
                    numberOfLines={descriptionExpanded ? undefined : 2}
                  >
                    {community.description}
                  </Text>
                </Pressable>
              ) : null}
              {presenceLine ? (
                <Text className="mt-2 text-[11px] text-lantern-primary">{presenceLine}</Text>
              ) : null}

              <View className="flex-row items-center mt-3 mb-3">
                <Pressable
                  onPress={() => void toggleMembership()}
                  disabled={pending}
                  className={`min-h-[40px] justify-center rounded-lg px-4 ${
                    community.isMember ? 'bg-lantern-background-secondary' : 'bg-lantern-primary'
                  }`}
                  style={{ opacity: pending ? 0.5 : 1 }}
                  accessibilityRole="button"
                  accessibilityLabel={membershipLabel}
                  accessibilityState={{ disabled: pending, busy: pending }}
                >
                  <Text
                    className={`text-xs font-semibold ${
                      community.isMember ? 'text-lantern-text-secondary' : 'text-white'
                    }`}
                  >
                    {pending ? 'Working…' : membershipLabel}
                  </Text>
                </Pressable>
                {!community.isMember ? (
                  <Text className="ml-3 flex-1 text-xs text-lantern-text-tertiary">
                    {COMMUNITY_COPY.joinToSeeMembers}
                  </Text>
                ) : null}
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View className="py-8 items-center">
                <ActivityIndicator color="#6366f1" />
              </View>
            ) : null
          }
        />
      ) : null}

      <ActionSheet
        visible={menuOpen}
        title={community?.name}
        items={menuItems.map((item) => ({
          ...item,
          onPress: () => {
            setMenuOpen(false);
            item.onPress();
          },
        }))}
        onClose={() => setMenuOpen(false)}
      />
    </SafeAreaView>
  );
}

export function CommunityDetailScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: { slug: string } };
}) {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <CommunityServer navigation={navigation} route={route} />;
}

export default CommunityDetailScreen;
