import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  DISCOVER_SECTION_INTRO,
  canAccessDiscoverHub,
  communityKindLabel,
  communityMembershipAction,
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
} from '../../services/api';
import { useGroupStore } from '../../stores/groupStore';
import { useAuthStore } from '../../stores';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { DiscoverComingSoon } from './DiscoverComingSoon';

import { DiscoverWorkspaceBar, type DiscoverSection } from './DiscoverWorkspaceBar';

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
  route?: { params?: { section?: Section } };
}) {
  const [section, setSection] = useState<Section>(route?.params?.section ?? 'communities');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mine, setMine] = useState<MyCommunity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const fetchGroups = useGroupStore((s) => s.fetchGroups);
  const userId = useAuthStore((s) => s.user?.id);

  const myById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine]);
  const myIds = useMemo(() => new Set(mine.map((c) => c.id)), [mine]);

  const load = useCallback(async (target: Section, q: string) => {
    if (target === 'marketplace') return;
    setLoading(true);
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
    setSection(next);
  }, [route?.params?.section]);

  useEffect(() => {
    void load(section, query);
    // Search is applied on submit, not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, load]);

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

  const renderCommunity = ({ item }: { item: Community }) => {
    const isMember = myIds.has(item.id);
    const action = communityMembershipAction(isMember, myById.get(item.id)?.source);
    return (
      <View className="mx-4 mb-2 rounded-xl border border-lantern-border bg-lantern-surface p-3">
        <View className="flex-row items-start">
          <Pressable
            className="flex-1 pr-2"
            onPress={() => navigation.navigate('CommunityDetail', { slug: item.slug })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
          >
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Text className="flex-1 text-sm font-semibold text-lantern-text" numberOfLines={1}>
                {item.name}
              </Text>
              {item.is_official ? (
                <Ionicons name="checkmark-circle" size={16} color="#6366f1" />
              ) : null}
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
      </View>
    );
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
    ) : (
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
        : 'No people match that search.'
    : section === 'communities'
      ? 'Add your university and courses so campus rooms can appear — or start an interest community.'
      : section === 'groups'
        ? 'Groups stay private until an owner lists them on Discover. Create one and turn on Show in Discover.'
        : 'People appear here once they publish a study pack or question bank.';

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="border-b border-lantern-border">
        <DiscoverWorkspaceBar active={section} onSelect={handleSection} />
        {section === 'communities' || section === 'groups' || section === 'people' ? (
          <Text className="px-4 pt-1.5 text-[11px] text-lantern-text-tertiary">
            {DISCOVER_SECTION_INTRO[section]}
          </Text>
        ) : null}
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
            >
              <Text className="text-[11px] text-lantern-primary">
                {presenceLine}
                {presence?.joinCourseId ? ' · Join room' : ''}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => navigation.navigate('StudyRoom')}
            className="self-start rounded-lg bg-lantern-background-secondary px-2 py-1"
          >
            <Text className="text-[11px] font-semibold text-lantern-primary">Start a room</Text>
          </Pressable>
        </View>
        <View className="mx-4 mt-2 mb-2 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
          <Ionicons name="search-outline" size={16} color="#64748b" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => void load(section, query)}
            returnKeyType="search"
            placeholder={
              section === 'groups'
                ? 'Search groups'
                : section === 'people'
                  ? 'Search people'
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
          data={communities}
          keyExtractor={(item) => item.id}
          renderItem={renderCommunity}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
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
      ) : section === 'groups' ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
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
          keyExtractor={(item) => item.id}
          renderItem={renderPerson}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
          ListEmptyComponent={
            <View>
              <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
              {emptyActions}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

export function DiscoverScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route?: { params?: { section?: Section } };
}) {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <DiscoverHub navigation={navigation} route={route} />;
}

export default DiscoverScreen;
