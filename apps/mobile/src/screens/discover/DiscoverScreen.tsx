import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  communityKindLabel,
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
  discoverCommunities,
  discoverGroups,
  discoverPeople,
  fetchMyCommunities,
  fetchStudyPresence,
  joinCommunity,
  leaveCommunity,
} from '../../services/api';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Section = 'communities' | 'groups' | 'people' | 'marketplace';

const TABS: Array<{ id: Section; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'communities', label: 'Communities', icon: 'people-outline' },
  { id: 'groups', label: 'Groups', icon: 'chatbubbles-outline' },
  { id: 'people', label: 'People', icon: 'person-outline' },
  { id: 'marketplace', label: 'Market', icon: 'bag-outline' },
];

/**
 * The Discover hub (Phase 3 · L) — mobile parity with the web hub.
 *
 * Decision D12: the marketplace is a TAB here, not a sibling destination, so
 * selecting it navigates within the same stack rather than leaving Discover.
 */
export function DiscoverScreen({
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
        setPeople(await discoverPeople({}));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Discover');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(section, query);
    // Search is applied on submit, not per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, load]);

  useEffect(() => {
    // Presence is a nicety; its failure must not blank the hub.
    void fetchStudyPresence({})
      .then(setPresence)
      .catch(() => setPresence(null));
  }, []);

  const handleSection = (next: Section) => {
    if (next === 'marketplace') {
      navigation.navigate('MarketplaceHome');
      return;
    }
    setSection(next);
  };

  const toggleMembership = async (community: Community, isMember: boolean) => {
    setPendingId(community.id);
    // Optimistic, reverted on failure — the tap must never feel swallowed.
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

  const presenceLine = presenceLabel(presence);

  const renderCommunity = ({ item }: { item: Community }) => {
    const isMember = myIds.has(item.id);
    return (
      <View className="mx-4 mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-4">
        <View className="flex-row items-start justify-between">
          <Pressable
            className="flex-1 pr-2"
            onPress={() => navigation.navigate('CommunityDetail', { slug: item.slug })}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.name}`}
          >
            <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
              {item.name}
            </Text>
            <Text className="text-xs text-lantern-text-tertiary mt-0.5">
              {communityKindLabel(item.kind)} · {memberCountLabel(item.member_count)}
            </Text>
          </Pressable>
          {item.is_official ? (
            <Ionicons name="checkmark-circle" size={16} color="#6366f1" />
          ) : null}
        </View>
        {item.description ? (
          <Text className="text-xs text-lantern-text-tertiary mt-1.5" numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        <Pressable
          onPress={() => void toggleMembership(item, isMember)}
          disabled={pendingId === item.id}
          className={`mt-3 self-start rounded-lg px-3 py-1.5 ${
            isMember ? 'bg-lantern-background-secondary' : 'bg-lantern-primary'
          }`}
          style={{ opacity: pendingId === item.id ? 0.5 : 1 }}
          accessibilityRole="button"
          accessibilityLabel={isMember ? `Leave ${item.name}` : `Join ${item.name}`}
        >
          <Text
            className={`text-xs font-semibold ${
              isMember ? 'text-lantern-text-secondary' : 'text-white'
            }`}
          >
            {pendingId === item.id ? 'Working…' : isMember ? 'Leave' : 'Join'}
          </Text>
        </Pressable>
      </View>
    );
  };

  const renderGroup = ({ item }: { item: DiscoverGroup }) => (
    <Pressable
      className="mx-4 mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-4"
      onPress={() => navigation.navigate('GroupChat', { groupId: item.id })}
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}`}
    >
      <Text className="text-sm font-semibold text-lantern-text" numberOfLines={1}>
        {item.name}
      </Text>
      <Text className="text-xs text-lantern-text-tertiary mt-0.5">
        {memberCountLabel(item.memberCount)}
        {item.questionCount > 0 ? ` · ${item.questionCount} questions` : ''}
      </Text>
      {item.description ? (
        <Text className="text-xs text-lantern-text-tertiary mt-1.5" numberOfLines={2}>
          {item.description}
        </Text>
      ) : null}
    </Pressable>
  );

  const renderPerson = ({ item }: { item: DiscoverPerson }) => {
    const chip = shouldShowTrustChip(item.trustLevel) ? trustLabel(item.trustLevel) : null;
    return (
      <Pressable
        className="mx-4 mb-3 rounded-xl border border-lantern-border bg-lantern-surface p-4"
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

  const emptyText =
    section === 'communities'
      ? 'Set your university, programme and courses in your profile — your campus communities come from them.'
      : section === 'groups'
        ? 'Groups are private by default. An owner can make one discoverable to their community.'
        : 'People appear here once they publish a study pack or question bank.';

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 py-3 border-b border-lantern-border">
        <Text className="text-xl font-bold text-lantern-text">Discover</Text>
        {presenceLine ? (
          <Text className="text-xs text-lantern-primary mt-0.5">{presenceLine}</Text>
        ) : (
          <Text className="text-xs text-lantern-text-tertiary mt-0.5">
            Your campus, your courses, and the people studying them.
          </Text>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3"
          contentContainerStyle={{ gap: 6 }}
        >
          {TABS.map((tab) => {
            const active = section === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => handleSection(tab.id)}
                className={`flex-row items-center rounded-lg px-3 py-1.5 ${
                  active ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
                }`}
                style={{ gap: 5 }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={tab.label}
              >
                <Ionicons name={tab.icon} size={14} color={active ? '#fff' : '#64748b'} />
                <Text
                  className={`text-xs font-semibold ${
                    active ? 'text-white' : 'text-lantern-text-secondary'
                  }`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {section !== 'people' ? (
          <View className="mt-3 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
            <Ionicons name="search-outline" size={16} color="#64748b" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => void load(section, query)}
              returnKeyType="search"
              placeholder={section === 'groups' ? 'Search groups' : 'Search communities'}
              placeholderTextColor="#94a3b8"
              accessibilityLabel={section === 'groups' ? 'Search groups' : 'Search communities'}
              className="flex-1 py-2 px-2 text-sm text-lantern-text"
            />
          </View>
        ) : null}
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
          ListEmptyComponent={
            <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
          }
        />
      ) : section === 'groups' ? (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          renderItem={renderGroup}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
          ListEmptyComponent={
            <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
          }
        />
      ) : (
        <FlatList
          data={people}
          keyExtractor={(item) => item.id}
          renderItem={renderPerson}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: 32 }}
          ListEmptyComponent={
            <Text className="mx-4 text-xs text-lantern-text-tertiary">{emptyText}</Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

export default DiscoverScreen;
