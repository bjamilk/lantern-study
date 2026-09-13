import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as Clipboard from 'expo-clipboard';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Share,
  Text,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import {
  COMMUNITY_COPY,
  COMMUNITY_LOUNGE_CHANNEL_NAME,
  boardDisplayName,
  boardSubtitle,
  buildCommunityChannelRows,
  communityMembershipAction,
  communityOnlineCount,
  presenceLabel,
  requestFailureSentence,
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
import { useToastStore } from '../../stores/toastStore';
import { RequestError } from '../../components/RequestError';
import { useCommunityStore } from '../../stores/communityStore';
import { useCommunityPresence } from '../../hooks/useCommunityPresence';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useCommunityAccess } from '../../hooks/useCommunityAccess';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useChrome } from '../../components/layout/ChromeContext';
import { Screen, useScreenActions, useScreenBottomPadding } from '../../components/layout';
import { ActionSheet, BackButton, FeatureDisc, type ActionSheetItem } from '../../components/ui';
import { ChannelRow, RoomRow, StudyGroupRow } from '../../components/community';
import { toChannelOverlayGroups } from '../../utils/communityOverlay';
import { DiscoverComingSoon } from './DiscoverComingSoon';
import { communityHeaderMeta } from '../campus/communityHubModel';
import {
  INVITE_LINK_UNAVAILABLE,
  INVITE_SHARE_LABEL,
  communityInviteLink,
  inviteCopyOutcome,
} from './communityInviteModel';
import { MANAGE_COPY, resolveManageAccess } from './communityManageModel';
import { AppIcon } from '../../components/ui/AppIcon';

import { toTab } from '../../navigation/nestedTab';
import { brand } from '../../theme';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (screen: string, params?: Record<string, unknown>) => void } | undefined;
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
  const isPlatformAdmin = usePlatformAdmin();
  const { lowDataMode } = useLowDataMode();
  const { onScroll: chromeOnScroll } = useChrome();
  // CommunityDetail is not immersive, so the absolute bottom tab bar overlays
  // the channel list. A community with only a few channels never scrolls, so
  // the bar never slides away and the old 32 left the last row under it.
  const listBottomPadding = useScreenBottomPadding();
  const groups = useGroupStore((s) => s.groups);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);

  const community = useCommunityStore((s) => s.detailBySlug[slug]);
  const payload = useCommunityStore((s) => (community ? s.channelsById[community.id] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadChannels = useCommunityStore((s) => s.loadChannels);
  const invalidate = useCommunityStore((s) => s.invalidate);

  const [loading, setLoading] = useState(!community);
  const [refreshing, setRefreshing] = useState(false);
  // `loadError` is "this community did not arrive" — with nothing on screen it
  // becomes the full failure surface (with a way back), instead of the bare red
  // line that used to leave the student on a blank page. `actionFailure` is
  // "the thing you tapped did not happen" and only ever banners.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionFailure, setActionFailure] = useState<{ error: unknown; detail: string } | null>(
    null,
  );
  const [loungeError, setLoungeError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [loungeBusy, setLoungeBusy] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** For the contextual row's Boards / Rooms jumps; see `useScreenActions`. */
  const listRef = useRef<FlatList<CommunityChannelRow>>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    let detail;
    try {
      detail = await loadCommunity(slug);
    } catch (err) {
      // Kept raw: RequestError classifies it, so a 404 reads as "we couldn't
      // find this" and a dropped connection reads as a connection problem —
      // the two used to collapse into one "Community not found".
      setLoadError(err);
      return;
    }
    // The server view is secondary — if it fails the header still renders.
    try {
      await loadChannels(detail.id);
    } catch (err) {
      setLoadError(err);
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
      setActionFailure({
        error: err,
        detail: 'Your membership wasn’t changed. Check your connection and try again.',
      });
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
      // 503 is the one product-specific case (the lounge has not been minted
      // yet); everything else speaks the shared failure vocabulary rather than
      // leaking a raw "Network request failed" under the row.
      const status = (err as { status?: number } | null)?.status;
      setLoungeError(
        status === 503 ? COMMUNITY_COPY.loungeUnavailable : requestFailureSentence(err)
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
      setActionFailure({
        error: err,
        detail: 'You haven’t joined this board. Check your connection and try again.',
      });
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
      appAlert(boardDisplayName(channel), COMMUNITY_COPY.joinToOpen);
      return;
    }
    appAlert(`Join ${boardDisplayName(channel)}?`, boardSubtitle(channel, now), [
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
    navigation.getParent?.()?.navigate('ChatTab', toTab('GroupChat', {
      groupId: group.id,
      groupName: group.name,
      communitySlug: community.slug,
      communityName: community.name,
    }));
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
      setActionFailure({
        error: err,
        detail: 'You haven’t joined this study group. Check your connection and try again.',
      });
    } finally {
      setJoiningId(null);
    }
  };

  const showToast = (message: string, tone: 'success' | 'error' = 'success') =>
    useToastStore.getState().showToast(message, tone);

  const startRoom = () => {
    if (!community) return;
    navigation.navigate('StudyRoom', {
      communityId: community.id,
      courseId: community.course_id ?? undefined,
      communityName: community.name,
    });
  };

  /**
   * "Copy invite link" now COPIES. It used to open the share sheet, so a
   * student who dismissed the chooser was left with an empty clipboard and no
   * message. The write is awaited, its result decides the toast, and a failed
   * write puts the link itself in that toast so the link is never lost.
   */
  const copyInvite = async () => {
    const link = communityInviteLink(community?.slug);
    if (!link) {
      showToast(INVITE_LINK_UNAVAILABLE, 'error');
      return;
    }
    let copied = false;
    try {
      // expo-clipboard resolves `false` when the platform refused the write;
      // a throw is the same outcome for the student.
      copied = (await Clipboard.setStringAsync(link)) !== false;
    } catch {
      copied = false;
    }
    const outcome = inviteCopyOutcome(copied, link);
    showToast(outcome.message, outcome.tone);
  };

  const shareInvite = async () => {
    const link = communityInviteLink(community?.slug);
    if (!link) {
      showToast(INVITE_LINK_UNAVAILABLE, 'error');
      return;
    }
    try {
      await Share.share({ message: link });
    } catch {
      // The share sheet was dismissed or is unavailable; nothing to surface.
    }
  };

  /**
   * Who manages this room. Decided by the SHARED rules
   * (`canAssignCommunityRole` / `canModerateCommunityMember` via
   * `resolveManageAccess`) from the viewer's own role — never from a locally
   * computed one — and re-decided by the API on every request the screen it
   * opens can make.
   */
  const manageAccess = useMemo(
    () =>
      resolveManageAccess({
        id: userId ?? '',
        role: community?.viewerRole ?? null,
        isPlatformAdmin,
      }),
    [userId, community?.viewerRole, isPlatformAdmin]
  );

  const openManage = () => {
    if (!community) return;
    navigation.navigate('CommunityManage', {
      slug: community.slug,
      communityId: community.id,
      name: community.name,
    });
  };

  const menuItems: ActionSheetItem[] = useMemo(() => {
    if (!community?.isMember) return [];
    const items: ActionSheetItem[] = [];
    // Private communities have no public link to share; an invite CODE for one
    // is minted on the manage screen, which is where the permission for it is.
    if (community.visibility === 'public') {
      items.push(
        { label: COMMUNITY_COPY.invite, icon: 'link', onPress: () => void copyInvite() },
        { label: INVITE_SHARE_LABEL, icon: 'share-social', onPress: () => void shareInvite() }
      );
    }
    items.push(
      { label: COMMUNITY_COPY.createBoard, icon: 'add-circle', onPress: createBoard },
      { label: COMMUNITY_COPY.startStudyGroup, icon: 'people', onPress: startStudyGroup },
      { label: COMMUNITY_COPY.startRoom, icon: 'volume-medium', onPress: startRoom }
    );
    if (manageAccess.canManage) {
      items.push({
        label: MANAGE_COPY.title,
        icon: 'shield-checkmark',
        onPress: openManage,
      });
    }
    return items;
    // Handlers close over `community` and `navigation`, both stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    community?.isMember,
    community?.id,
    community?.slug,
    community?.visibility,
    manageAccess.canManage,
  ]);

  /**
   * Label, glyph, ink and the counted line — one resolver, shared with the
   * Campus list card. Before a community arrives there is nothing to describe,
   * so the neutral `general` meta stands in rather than a hard-coded hue.
   */
  const headerMeta = communityHeaderMeta(
    community ?? { kind: 'general', tags: [] },
    community?.member_count ?? 0,
    onlineCount
  );

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
                <AppIcon name="add" size={20} color="#64748b" />
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
            <AppIcon name="chevron-forward" size={16} color="#94a3b8" />
          </Pressable>
        );
      default:
        return null;
    }
  };

  /**
   * The contextual row's three screen actions (navigation/contextualBars.ts,
   * COMMUNITY_BAR). Boards and Rooms are SECTIONS of this list rather than
   * screens, so the row asks this screen to move to them; Chat opens the one
   * live lounge, whose group id is minted on first use and therefore cannot be
   * a route param.
   *
   * `sectionIndex` searches the SHARED row model, so a section that is absent
   * for this viewer (a guest sees no rooms) yields no handler at all and the
   * row's press is a no-op instead of a scroll to the wrong place.
   */
  const sectionIndex = useCallback(
    (title: string) => rows.findIndex((row) => row.kind === 'section' && row.title === title),
    [rows]
  );

  const scrollToSection = useCallback((index: number) => {
    if (index < 0) return;
    // `viewPosition: 0` puts the heading at the top; the failure handler is
    // required because the list is windowed and the target may be unmeasured.
    listRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  }, []);

  const boardsIndex = sectionIndex(COMMUNITY_COPY.sectionBoards);
  const roomsIndex = sectionIndex(COMMUNITY_COPY.sectionRooms);

  useScreenActions('CommunityDetail', {
    // Named by what they DO, not by the row item's id.
    communityChat: community ? () => void openLounge() : undefined,
    communityBoards: boardsIndex >= 0 ? () => scrollToSection(boardsIndex) : undefined,
    communityRooms: roomsIndex >= 0 ? () => scrollToSection(roomsIndex) : undefined,
  });

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
      <Screen bottom="none">
        {/* A spinner with no way out was one of the failure modes the audit
            found: if this load never resolves, the student was trapped. */}
        <View className="flex-row items-center h-[56px] pr-2">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        </View>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={brand.text} accessibilityLabel="Loading this community" />
        </View>
      </Screen>
    );
  }

  return (
    <Screen bottom="none">
      <View className="flex-row items-center h-[56px] pr-2 border-b border-lantern-border">
        <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
        {/* The glyph and its ink come from the SAME resolver the Campus list
            card uses (`communityHeaderMeta` → `communityCardMeta`), so a
            tag-derived hostel room shows the house here too. */}
        <FeatureDisc feature={headerMeta.ink} icon={headerMeta.icon} size={40} />
        <View className="flex-1 min-w-0 ml-2 flex-row items-center">
          <Text className="text-lg font-semibold text-lantern-text shrink" numberOfLines={1}>
            {community?.name ?? 'Community'}
          </Text>
          {community?.is_official ? (
            <AppIcon
              name="checkmark-circle"
              size={16}
              color={brand.text}
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
              <AppIcon name="people" size={22} color="#64748b" />
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
              <AppIcon name="ellipsis-vertical" size={20} color="#64748b" />
            </Pressable>
          </>
        ) : null}
      </View>

      {/* Nothing arrived: the whole surface says so, and offers both a real
          retry and a way back — this used to be one line of red text over a
          blank screen. */}
      {loadError && !community ? (
        <RequestError
          error={loadError}
          onRetry={() => void load()}
          onBack={() => navigation.goBack()}
        />
      ) : loadError ? (
        <RequestError variant="banner" error={loadError} onRetry={() => void load()} />
      ) : null}

      {actionFailure ? (
        <RequestError
          variant="banner"
          error={actionFailure.error}
          detail={actionFailure.detail}
          onRetry={() => setActionFailure(null)}
        />
      ) : null}

      {community ? (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={keyExtractor}
          // A windowed list cannot scroll to a row it has not measured; land
          // on the nearest measured offset rather than throwing.
          onScrollToIndexFailed={({ averageItemLength, index }) =>
            listRef.current?.scrollToOffset({
              offset: averageItemLength * index,
              animated: true,
            })
          }
          renderItem={renderRow}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          ListHeaderComponent={
            <View className="px-4 pt-4 pb-1 border-b border-lantern-border">
              <Text className="text-xs text-lantern-text-tertiary">
                {headerMeta.line}
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
                <Text className="mt-2 text-[11px] text-lantern-primary-text">{presenceLine}</Text>
              ) : null}

              <View className="flex-row items-center mt-3 mb-3">
                <Pressable
                  onPress={() => void toggleMembership()}
                  disabled={pending}
                  className={`min-h-[40px] justify-center rounded-lg px-4 ${
                    community.isMember ? 'bg-lantern-background-secondary' : 'bg-lantern-primary-fill'
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
                <ActivityIndicator color={brand.text} />
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
    </Screen>
  );
}

export function CommunityDetailScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: { slug: string } };
}) {
  // The OBJECT form of the gate, via the hook: Communities are open to every
  // signed-in student with an institution and a programme (founder decision,
  // 2026-09-07). The boolean form this used to pass means "platform admin?"
  // and nothing else, which kept every student out.
  const { canSee } = useCommunityAccess();
  if (!canSee) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <CommunityServer navigation={navigation} route={route} />;
}

export default CommunityDetailScreen;
