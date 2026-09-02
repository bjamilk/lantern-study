import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  COMMUNITY_COPY,
  COMMUNITY_MEMBERS_PAGE,
  canAccessDiscoverHub,
  isMemberOnline,
  shouldSubscribeCommunityPresence,
  splitMembers,
  type CommunityMember,
} from '@lantern/shared/network';
import { fetchCommunityMembers } from '../../services/api';
import { isForbiddenError } from '../../services/accountSuspension';
import { useCommunityStore } from '../../stores/communityStore';
import { useCommunityPresence } from '../../hooks/useCommunityPresence';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useChrome } from '../../components/layout/ChromeContext';
import { BackButton } from '../../components/ui';
import { MemberRow } from '../../components/community';
import { DiscoverComingSoon } from './DiscoverComingSoon';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

type Params = { slug: string; communityId?: string; name?: string };

/**
 * The roster (spec §4.4): Online / Offline halves from `splitMembers`, paged
 * by cursor with a "Load more" footer, filtered client-side by name. Lives on
 * the Market stack next to CommunityDetail so back returns to the community.
 */
function CommunityMembersList({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: Params };
}) {
  const { slug } = route.params;
  const { lowDataMode } = useLowDataMode();
  const { onScroll: chromeOnScroll } = useChrome();
  const detail = useCommunityStore((s) => s.detailBySlug[slug]);
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);

  const communityId = route.params.communityId ?? detail?.id ?? null;
  const name = route.params.name ?? detail?.name ?? 'Members';

  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  // A deep link only carries the slug: resolve the community first (also
  // gives us isMember / member_count for the presence gate below).
  useEffect(() => {
    if (detail) return;
    void loadCommunity(slug).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Community not found');
      setLoading(false);
    });
  }, [detail, slug, loadCommunity]);

  const presenceEnabled =
    !!detail &&
    shouldSubscribeCommunityPresence({
      isMember: detail.isMember,
      lowDataMode,
      memberCount: detail.member_count,
    });
  const { onlineIds } = useCommunityPresence(communityId, { enabled: presenceEnabled });

  const loadPage = useCallback(
    async (cursor: string | null) => {
      if (!communityId) return;
      try {
        const page = await fetchCommunityMembers(communityId, {
          limit: COMMUNITY_MEMBERS_PAGE,
          cursor: cursor ?? undefined,
        });
        setMembers((prev) => {
          if (!cursor) return page.members;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.members.filter((m) => !seen.has(m.id))];
        });
        setNextCursor(page.nextCursor);
        setError(null);
      } catch (err) {
        setError(
          isForbiddenError(err)
            ? COMMUNITY_COPY.joinToSeeMembers
            : err instanceof Error
              ? err.message
              : 'Could not load members'
        );
      }
    },
    [communityId]
  );

  useEffect(() => {
    if (!communityId) return;
    let cancelled = false;
    setLoading(true);
    void loadPage(null).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [communityId, loadPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await loadPage(nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, loadPage]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q ? members.filter((m) => m.name.toLowerCase().includes(q)) : members;
    const { online, offline } = splitMembers(visible, onlineIds);
    return [
      { key: 'online', title: COMMUNITY_COPY.online(online.length), data: online },
      { key: 'offline', title: COMMUNITY_COPY.offline(offline.length), data: offline },
    ];
  }, [members, query, onlineIds]);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="border-b border-lantern-border">
        <View className="flex-row items-center h-[56px] pr-4">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
          <Text className="flex-1 text-lg font-semibold text-lantern-text" numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View className="mx-4 mb-2 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
          <Ionicons name="search-outline" size={16} color="#64748b" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search members"
            placeholderTextColor="#94a3b8"
            autoCorrect={false}
            className="flex-1 py-2 px-2 text-sm text-lantern-text"
            accessibilityLabel="Search members"
          />
        </View>
      </View>

      {error ? <Text className="mx-4 mt-3 text-xs text-red-500">{error}</Text> : null}

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#6366f1" />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 32 }}
          renderSectionHeader={({ section }) => (
            <Text className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              online={isMemberOnline(item, onlineIds)}
              lowDataMode={lowDataMode}
            />
          )}
          ListEmptyComponent={
            error ? null : (
              <Text className="mx-4 mt-3 text-sm text-lantern-text-tertiary">
                {query.trim() ? 'No members match that search.' : 'No members yet.'}
              </Text>
            )
          }
          ListFooterComponent={
            nextCursor ? (
              <Pressable
                onPress={() => void loadMore()}
                disabled={loadingMore}
                accessibilityRole="button"
                accessibilityLabel="Load more members"
                accessibilityState={{ disabled: loadingMore, busy: loadingMore }}
                className="mx-4 mt-3 min-h-[44px] items-center justify-center rounded-lg bg-lantern-background-secondary"
              >
                {loadingMore ? (
                  <ActivityIndicator color="#6366f1" />
                ) : (
                  <Text className="text-sm font-semibold text-lantern-primary">Load more</Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

export function CommunityMembersScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: Params };
}) {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <CommunityMembersList navigation={navigation} route={route} />;
}

export default CommunityMembersScreen;
