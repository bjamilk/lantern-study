import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { defaultDiscoverSection, isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import { studyRoomTimeLeftLabel, type StudyRoomListItem } from '@lantern/shared/network';
import {
  DISCOVER_SECTION_INTRO,
  canAccessDiscoverHub,
  communityKindLabel,
  communityMembershipAction,
  communityUnreadTotal,
  memberCountLabel,
  presenceLabel,
  shouldShowTrustChip,
  trustLabel,
  type Community,
  type DiscoverGroup,
  type DiscoverPerson,
  type MyCommunity,
  type PresenceSnapshot,
} from '@lantern/shared/network';
import {
  createCommunity,
  discoverCommunities,
  discoverGroups,
  discoverPeople,
  fetchMyCommunities,
  fetchStudyPresence,
  joinCommunity,
  joinDiscoverableGroup,
  leaveCommunity,
  listStudyRooms,
} from '../../services/api';
import { useGroupStore } from '../../stores/groupStore';
import { useAuthStore } from '../../stores';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { DiscoverComingSoon } from './DiscoverComingSoon';

import { DiscoverWorkspaceBar, type DiscoverSection } from './DiscoverWorkspaceBar';
import { useChrome } from '../../components/layout/ChromeContext';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { BackButton } from '../../components/ui';
import { UnreadPill } from '../../components/community';
import { toChannelOverlayGroups } from '../../utils/communityOverlay';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  getParent?: () => { navigate: (screen: string, params?: Record<string, unknown>) => void; getParent?: () => { navigate: (screen: string) => void } } | undefined;
};

type Section = DiscoverSection;

/**
 * The Discover hub (Phase 3 · L) — mobile parity with the web hub.
 *
 * Decision D12: the marketplace is a TAB here, not a sibling destination, so
 * selecting it navigates within the same stack rather than leaving Discover.
 */
function DiscoverHub({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { section?: Section; at?: number } };
}) {
  const { onScroll: chromeOnScroll } = useChrome();
  // Every section list is overlaid by the absolute bottom tab bar (Discover is
  // not immersive); the old hard-coded 32 left ~70px of the last card under it,
  // and the People/Rooms sections are often too short to scroll the bar away.
  const listBottomPadding = useScreenBottomPadding();
  // Open on a section that is actually switched on. Defaulting to communities
  // now lands on a hidden section with no tab bar to leave it, because the bar
  // hides itself when fewer than two sections are enabled.
  const [section, setSection] = useState<Section>(() => {
    const requested = route?.params?.section;
    return requested && isDiscoverSectionEnabled(requested)
      ? requested
      : (defaultDiscoverSection() as Section);
  });
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mine, setMine] = useState<MyCommunity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [rooms, setRooms] = useState<StudyRoomListItem[]>([]);
  const [roomsRefreshing, setRoomsRefreshing] = useState(false);
  // "Closes in Xh" ticks once a minute while the Room tab is open.
  const [now, setNow] = useState(() => Date.now());
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);
  const storeGroups = useGroupStore((s) => s.groups);
  const userId = useAuthStore((s) => s.user?.id);
  // Unread rollup per community card = joined, non-archived channels in it.
  const overlayGroups = useMemo(() => toChannelOverlayGroups(storeGroups), [storeGroups]);

  const myById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine]);
  const myIds = useMemo(() => new Set(mine.map((c) => c.id)), [mine]);

  const load = useCallback(async (target: Section, q: string, options?: { silent?: boolean }) => {
    if (target === 'marketplace') {
      // Discover has no marketplace list of its own — the section is a pointer
      // to the Shop. Returning without clearing `loading` (which starts true)
      // left the screen spinning forever the moment marketplace became the
      // default section.
      setLoading(false);
      return;
    }
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      if (target === 'communities') {
        const [discovered, own] = await Promise.all([
          discoverCommunities({ q: q || undefined }),
          fetchMyCommunities(),
        ]);
        setCommunities(discovered);
        setMine(own);
      } else if (target === 'groups') {
        setGroups(await discoverGroups({ q: q || undefined }));
      } else if (target === 'rooms') {
        // The list is small (open rooms only, capped server-side), so the
        // search box filters it locally instead of round-tripping.
        setRooms(await listStudyRooms());
      } else {
        setPeople(await discoverPeople({ q: q || undefined }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Discover');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const next = route?.params?.section;
    if (!next || next === 'marketplace') return;
    if (!isDiscoverSectionEnabled(next)) return;
    setSection(next);
    // `at` changes on every drawer tap, so tapping Community while this screen
    // sits on the Room tab still brings Communities back.
  }, [route?.params?.section, route?.params?.at]);

  // With Community, Groups and People switched off, the only section left is a
  // pointer to the Shop, and this screen would render a search box labelled
  // "Search communities" over an empty list. Send the viewer where they were
  // actually going instead.
  useEffect(() => {
    if (section === 'marketplace') {
      navigation.navigate('MarketplaceHome');
    }
  }, [section, navigation]);

  useEffect(() => {
    // Rooms load from the focus effect below so a return from a room refetches.
    if (section === 'rooms') return;
    void load(section, query);
    // Search is applied on submit, not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, load]);

  // The Room tab is "what is open right now": refetch whenever it gains focus
  // (including coming back from a room after Join/Leave) and tick the clock.
  useFocusEffect(
    useCallback(() => {
      if (section !== 'rooms') return undefined;
      setNow(Date.now());
      void load('rooms', '');
      const tick = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(tick);
    }, [section, load]),
  );
  const refreshRooms = useCallback(async () => {
    setRoomsRefreshing(true);
    try {
      setNow(Date.now());
      await load('rooms', '', { silent: true });
    } finally {
      setRoomsRefreshing(false);
    }
  }, [load]);

  useEffect(() => {
    void fetchStudyPresence({})
      .then(setPresence)
      .catch(() => setPresence(null));
  }, []);

  const tabNav = navigation.getParent?.();
  const rootNav = tabNav?.getParent?.();

  const handleSection = (next: Section) => {
    if (next === 'marketplace') {
      navigation.navigate('MarketplaceHome');
      return;
    }
    setQuery('');
    setSection(next);
  };

  const toggleMembership = async (community: Community, isMember: boolean) => {
    setPendingId(community.id);
    setMine((prev) =>
      isMember
        ? prev.filter((c) => c.id !== community.id)
        : [...prev, { ...community, role: 'member', source: 'joined' } as MyCommunity]
    );
    try {
      if (isMember) await leaveCommunity(community.id);
      else await joinCommunity(community.id);
    } catch (err) {
      setMine((prev) =>
        isMember
          ? [...prev, { ...community, role: 'member', source: 'joined' } as MyCommunity]
          : prev.filter((c) => c.id !== community.id)
      );
      setError(err instanceof Error ? err.message : 'Could not update membership');
    } finally {
      setPendingId(null);
    }
  };

  const openOrJoinGroup = async (group: DiscoverGroup) => {
    if (group.isMember) {
      tabNav?.navigate('ChatTab', { screen: 'GroupChat', params: { groupId: group.id, groupName: group.name } });
      return;
    }
    setPendingId(group.id);
    try {
      await joinDiscoverableGroup(group.id);
      if (userId) await fetchGroups(userId).catch(() => undefined);
      setGroups((prev) =>
        prev.map((item) =>
          item.id === group.id
            ? { ...item, isMember: true, memberCount: item.memberCount + 1 }
            : item
        )
      );
      tabNav?.navigate('ChatTab', { screen: 'GroupChat', params: { groupId: group.id, groupName: group.name } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this group');
    } finally {
      setPendingId(null);
    }
  };

  const submitCommunity = async () => {
    const name = newName.trim();
    if (name.length < 3) {
      Alert.alert('Name needed', 'Use at least 3 characters.');
      return;
    }
    setCreateBusy(true);
    setError(null);
    try {
      const created = await createCommunity({
        name,
        description: newDescription.trim() || undefined,
      });
      setNewName('');
      setNewDescription('');
      setCreatingCommunity(false);
      navigation.navigate('CommunityDetail', { slug: created.slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this community');
    } finally {
      setCreateBusy(false);
    }
  };

  const presenceLine = presenceLabel(presence);

  // Honest sectioning: "Your communities" comes from the MEMBERSHIP list
  // (which includes the private/auto rooms discover never returns), never
  // from partitioning the global discover page — a brand-new account used to
  // see other campuses' communities styled exactly like its own, which read
  // as "I was put in the wrong university".
  type CommunityListItem =
    | { kind: 'header'; key: string; title: string }
    | { kind: 'community'; key: string; community: Community };
  const communityList = useMemo<CommunityListItem[]>(() => {
    const more = communities.filter((c) => !myIds.has(c.id));
    const items: CommunityListItem[] = [];
    if (mine.length > 0) {
      items.push({ kind: 'header', key: 'h-yours', title: 'Your communities' });
      for (const c of mine) items.push({ kind: 'community', key: c.id, community: c });
      if (more.length > 0) items.push({ kind: 'header', key: 'h-more', title: 'More to join' });
    } else if (more.length > 0) {
      items.push({ kind: 'header', key: 'h-more', title: 'On Discover' });
    }
    for (const c of more) items.push({ kind: 'community', key: c.id, community: c });
    return items;
  }, [mine, communities, myIds]);

  const renderCommunityCard = (item: Community) => {
    const isMember = myIds.has(item.id);
    const action = communityMembershipAction(isMember, myById.get(item.id)?.source);
    const unread = isMember ? communityUnreadTotal(overlayGroups, item.id) : 0;
    return (
      <View className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3">
        <View className="flex-row items-start">
          <Pressable
            className="flex-1 pr-2"
            onPress={() => navigation.navigate('CommunityDetail', { slug: item.slug })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}${unread > 0 ? `, ${unread} unread` : ''}`}
          >
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Text className="shrink text-sm font-semibold text-lantern-text" numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_official ? (
                <Ionicons name="checkmark-circle" size={16} color="#6366f1" />
              ) : null}
              <UnreadPill unread={unread} />
              <View className="flex-1" />
            </View>
            <Text className="text-xs text-lantern-text-tertiary mt-0.5">
              {communityKindLabel(item.kind)} · {memberCountLabel(item.member_count)}
              {isMember ? ' · Yours' : ''}
            </Text>
            {item.description ? (
              <Text className="text-xs text-lantern-text-tertiary mt-1" numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
          </Pressable>
          <Pressable
            onPress={() => void toggleMembership(item, isMember)}
            disabled={pendingId === item.id}
            className="px-2 py-1.5"
            style={{ opacity: pendingId === item.id ? 0.5 : 1 }}
            accessibilityRole="button"
            accessibilityLabel={`${action} ${item.name}`}
          >
            <Text
              className={`text-xs font-semibold ${
                isMember ? 'text-lantern-text-secondary' : 'text-lantern-primary'
              }`}
            >
              {pendingId === item.id ? '…' : action}
            </Text>
          </Pressable>
        </View>
        {/* The lounge lives inside the community now (spec §4.8) — no chip here. */}
      </View>
    );
  };

  const renderCommunityItem = ({ item }: { item: CommunityListItem }) => {
    if (item.kind === 'header') {
      return (
        <Text className="mx-4 mb-1.5 mt-2 text-[11px] font-semibold uppercase tracking-wider text-lantern-text-tertiary">
          {item.title}
        </Text>
      );
    }
    return renderCommunityCard(item.community);
  };

  const renderGroup = ({ item }: { item: DiscoverGroup }) => (
    <View className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3">
      <View className="flex-row items-start">
        <Pressable
          className="flex-1 pr-2"
          onPress={() => void openOrJoinGroup(item)}
          accessibilityRole="button"
          accessibilityLabel={`${item.isMember ? 'Open' : 'Join'} ${item.name}`}
        >
          <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
            {item.name}
          </Text>
          <Text className="text-xs text-lantern-text-tertiary mt-0.5">
            {memberCountLabel(item.memberCount)}
            {item.questionCount > 0 ? ` · ${item.questionCount} questions` : ''}
            {item.isMember ? ' · Member' : ''}
          </Text>
          {item.description ? (
            <Text className="text-xs text-lantern-text-tertiary mt-1.5" numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </Pressable>
        <Pressable
          onPress={() => void openOrJoinGroup(item)}
          disabled={pendingId === item.id}
          className="px-2 py-1.5"
          style={{ opacity: pendingId === item.id ? 0.5 : 1 }}
        >
          <Text
            className={`text-xs font-semibold ${
              item.isMember ? 'text-lantern-text-secondary' : 'text-lantern-primary'
            }`}
          >
            {pendingId === item.id ? '…' : item.isMember ? 'Open' : 'Join'}
          </Text>
        </Pressable>
      </View>
    </View>
  );

  const renderPerson = ({ item }: { item: DiscoverPerson }) => {
    const chip = shouldShowTrustChip(item.trustLevel) ? trustLabel(item.trustLevel) : null;
    return (
      <Pressable
        className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3"
        onPress={() => navigation.navigate('CreatorProfile', { userId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.name}'s profile`}
      >
        <View className="flex-row items-center" style={{ gap: 6 }}>
          <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
            {item.name}
          </Text>
          {chip ? (
            <View className="rounded-full bg-lantern-primary/15 px-2 py-0.5">
              <Text className="text-[11px] font-semibold text-lantern-primary">{chip}</Text>
            </View>
          ) : null}
        </View>
        <Text className="text-xs text-lantern-text-tertiary mt-0.5" numberOfLines={1}>
          {item.programme ? `${item.programme} · ` : ''}
          {item.activePacks} {item.activePacks === 1 ? 'pack' : 'packs'} · {item.learnersHelped} helped
        </Text>
      </Pressable>
    );
  };

  const emptyActions =
    section === 'communities' ? (
      <View className="mx-4 mt-3" style={{ gap: 8 }}>
        <Pressable
          onPress={() => rootNav?.navigate('AcademicSettings')}
          className="rounded-lg bg-lantern-primary px-3 py-2"
        >
          <Text className="text-center text-xs font-semibold text-white">Set university & courses</Text>
        </Pressable>
        <Pressable onPress={() => setCreatingCommunity(true)} className="px-3 py-2">
          <Text className="text-center text-xs font-semibold text-lantern-primary">
            Start an interest community
          </Text>
        </Pressable>
      </View>
    ) : section === 'groups' ? (
      <Pressable
        onPress={() => tabNav?.navigate('ChatTab', { screen: 'CreateGroup' })}
        className="mx-4 mt-3 rounded-lg bg-lantern-primary px-3 py-2"
      >
        <Text className="text-center text-xs font-semibold text-white">Create a study group</Text>
      </Pressable>
    ) : section === 'rooms' ? null : (
      <Pressable
        onPress={() => navigation.navigate('MarketplaceHome')}
        className="mx-4 mt-3 rounded-lg bg-lantern-primary px-3 py-2"
      >
        <Text className="text-center text-xs font-semibold text-white">Browse marketplace</Text>
      </Pressable>
    );

  const emptyText = query.trim()
    ? section === 'communities'
      ? 'No communities match that search.'
      : section === 'groups'
        ? 'No groups match that search.'
        : section === 'rooms'
          ? 'No open rooms match that search.'
          : 'No people match that search.'
    : section === 'communities'
      ? 'Add your university and courses so campus rooms can appear — or start an interest community.'
      : section === 'groups'
        ? 'Groups stay private until an owner lists them on Discover. Create one and turn on Show in Discover.'
        : section === 'rooms'
          ? 'No rooms are open right now. Start one above — it stays open for 24 hours, then disappears.'
          : 'People appear here once they publish a study pack or question bank.';

  // Rooms are filtered locally: the search box narrows by title or topic.
  const visibleRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) =>
      [room.title, room.topic ?? ''].some((field) => field.toLowerCase().includes(q)),
    );
  }, [rooms, query]);

  const renderRoom = ({ item }: { item: StudyRoomListItem }) => {
    const timeLeft = studyRoomTimeLeftLabel(item.startedAt, now);
    return (
      <Pressable
        onPress={() => navigation.navigate('StudyRoom', { roomId: item.id })}
        accessibilityRole="button"
        accessibilityLabel={`${item.joined ? 'Open' : 'Join'} ${item.title}, ${item.participantCount} joined, ${timeLeft}`}
        className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3"
      >
        <View className="flex-row items-start">
          <View className="flex-1 pr-2">
            <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
              {item.title}
            </Text>
            <Text className="text-xs text-lantern-text-tertiary mt-0.5">
              {/* Joined = on the roster (has not tapped Leave). Live presence
                  is only known inside the room, so this never claims "here". */}
              {item.participantCount === 1 ? '1 joined' : `${item.participantCount} joined`}
              {' · '}
              {timeLeft}
              {item.joined ? ' · You are in' : ''}
            </Text>
            {item.topic ? (
              <Text className="text-xs text-lantern-text-tertiary mt-1.5" numberOfLines={2}>
                {item.topic}
              </Text>
            ) : null}
          </View>
          <Text
            className={`text-xs font-semibold px-2 py-1.5 ${
              item.joined ? 'text-lantern-text-secondary' : 'text-lantern-primary'
            }`}
          >
            {item.joined ? 'Open' : 'Join'}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    // `keyboard` wraps the header + list in the shared KeyboardAvoidingView:
    // the search box and the inline "Start an interest community" form (two
    // fields plus a Create button, in the communities list header) had no
    // keyboard handling at all, and on Android 15+ the window does not resize
    // itself, so nothing could be scrolled clear of the keyboard.
    <Screen bottom="none" keyboard>
      <View className="border-b border-lantern-border">
        <View className="flex-row items-center">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
          <View className="flex-1">
            <DiscoverWorkspaceBar active={section} onSelect={handleSection} />
          </View>
        </View>
        {section === 'communities' || section === 'groups' || section === 'people' || section === 'rooms' ? (
          <Text className="px-4 pt-1.5 text-[11px] text-lantern-text-tertiary">
            {DISCOVER_SECTION_INTRO[section]}
          </Text>
        ) : null}
        {/* "Start a room" and the who-is-studying line belong to the Room tab
            now, not under every section's intro (founder ask 2026-09-02). */}
        {section === 'rooms' ? (
          <View className="flex-row flex-wrap items-center gap-2 px-4 pt-1">
            {presenceLine ? (
              <Pressable
                onPress={() =>
                  navigation.navigate('StudyRoom', {
                    courseId: presence?.joinCourseId,
                    topic: presence?.joinTopic,
                  })
                }
                disabled={!presence?.joinCourseId}
                accessibilityRole="button"
                accessibilityLabel={`${presenceLine}${presence?.joinCourseId ? ' · Join room' : ''}`}
              >
                <Text className="text-[11px] text-lantern-primary">
                  {presenceLine}
                  {presence?.joinCourseId ? ' · Join room' : ''}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => navigation.navigate('StudyRoom')}
              accessibilityRole="button"
              accessibilityLabel="Start a room"
              hitSlop={6}
              className="self-start min-h-[32px] justify-center rounded-lg bg-lantern-primary px-3"
            >
              <Text className="text-[11px] font-semibold text-white">Start a room</Text>
            </Pressable>
          </View>
        ) : null}
        <View className="mx-4 mt-2 mb-2 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
          <Ionicons name="search-outline" size={16} color="#64748b" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            // Rooms filter locally as you type; a submit there has nothing to fetch.
            onSubmitEditing={() => {
              if (section !== 'rooms') void load(section, query);
            }}
            returnKeyType="search"
            placeholder={
              section === 'groups'
                ? 'Search groups'
                : section === 'people'
                  ? 'Search people'
                  : section === 'rooms'
                    ? 'Search open rooms'
                    : section === 'marketplace'
                      ? 'Search the marketplace'
                      : 'Search communities'
            }
            placeholderTextColor="#94a3b8"
            className="flex-1 py-2 px-2 text-sm text-lantern-text"
          />
        </View>
      </View>

      {error ? (
        <Pressable
          onPress={() => void load(section, query)}
          className="mx-4 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2"
          accessibilityRole="button"
          accessibilityLabel="Retry loading Discover"
        >
          <Text className="text-xs text-red-500">{error} — tap to retry</Text>
        </Pressable>
      ) : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : section === 'communities' ? (
        <FlatList
          data={communityList}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.key}
          renderItem={renderCommunityItem}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listBottomPadding }}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View className="mx-4 mb-2">
              <Pressable onPress={() => setCreatingCommunity((open) => !open)}>
                <Text className="text-xs font-semibold text-lantern-primary">
                  {creatingCommunity ? 'Cancel' : 'Start an interest community'}
                </Text>
              </Pressable>
              {creatingCommunity ? (
                <View className="mt-2 rounded-xl border border-lantern-border bg-lantern-surface p-3">
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    placeholder="Name (e.g. Past questions)"
                    placeholderTextColor="#94a3b8"
                    className="text-sm text-lantern-text border-b border-lantern-border py-1"
                  />
                  <TextInput
                    value={newDescription}
                    onChangeText={setNewDescription}
                    placeholder="Optional description"
                    placeholderTextColor="#94a3b8"
                    className="text-sm text-lantern-text mt-2"
                  />
                  <Pressable
                    onPress={() => void submitCommunity()}
                    disabled={createBusy}
                    className="mt-2 self-start rounded-md bg-lantern-primary px-3 py-1.5"
                  >
                    <Text className="text-xs font-semibold text-white">
                      {createBusy ? 'Creating…' : 'Create community'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View>
              <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
              {emptyActions}
            </View>
          }
        />
      ) : section === 'rooms' ? (
        <FlatList
          data={visibleRooms}
          keyExtractor={(item) => item.id}
          renderItem={renderRoom}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listBottomPadding }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={roomsRefreshing} onRefresh={() => void refreshRooms()} />}
          // After a failed fetch the error banner above already says so; an
          // "open rooms" claim under it would be a guess.
          ListEmptyComponent={
            error ? null : <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
          }
        />
      ) : section === 'groups' ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listBottomPadding }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View>
              <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
              {emptyActions}
            </View>
          }
        />
      ) : (
        <FlatList
          data={people}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          keyExtractor={(item) => item.id}
          renderItem={renderPerson}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: listBottomPadding }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View>
              <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
              {emptyActions}
            </View>
          }
        />
      )}
    </Screen>
  );
}

export function DiscoverScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { section?: Section; at?: number } };
}) {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <DiscoverHub navigation={navigation} route={route} />;
}

export default DiscoverScreen;
