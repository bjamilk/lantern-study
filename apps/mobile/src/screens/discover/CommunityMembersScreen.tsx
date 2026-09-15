/**
 * Campus stack -> CommunityMembers (params: slug, optional communityId/name).
 * The roster: Online and Offline sections, cursor-paged with a "Load more"
 * footer and a client-side name filter. A row's sheet offers Message and
 * Report member.
 *
 * Exports: CommunityMembersScreen (named and default) -- the community-gate
 * wrapper around the internal list.
 * Touches: services/api fetchCommunityMembers; communityStore
 * detailBySlug/loadCommunity (a deep link carries only the slug);
 * useCommunityPresence for online ids; authStore for the viewer;
 * ReportContentSheet (target type community_member); ChromeContext.
 * Gotchas: no raw server phrase may reach a student -- Forbidden becomes "join
 * to see members" and everything else goes through requestFailureSentence.
 * Presence is gated by shouldSubscribeCommunityPresence (off in low-data mode
 * and for large communities). A row opens the sheet first, so one tap can
 * never file a report, and Report is never offered on the viewer's own row.
 * Message navigates by CommonActions into Main > ChatTab > DirectMessage with
 * the sorted-pair thread id.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CommonActions } from '@react-navigation/native';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  COMMUNITY_COPY,
  COMMUNITY_MEMBERS_PAGE,
  isMemberOnline,
  requestFailureSentence,
  shouldSubscribeCommunityPresence,
  splitMembers,
  type CommunityMember,
} from '@lantern/shared/network';
import { fetchCommunityMembers } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { isForbiddenError } from '../../services/accountSuspension';
import { useCommunityStore } from '../../stores/communityStore';
import { useCommunityPresence } from '../../hooks/useCommunityPresence';
import { useLowDataMode } from '../../hooks/useLowDataMode';
import { useCommunityAccess } from '../../hooks/useCommunityAccess';
import { useChrome } from '../../components/layout/ChromeContext';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { ActionSheet, BackButton } from '../../components/ui';
import { MemberRow } from '../../components/community';
import { ReportContentSheet } from '../../components/moderation/ReportContentSheet';
import { DiscoverComingSoon } from './DiscoverComingSoon';
import { AppIcon } from '../../components/ui/AppIcon';
import { brand } from '../../theme';

type NavigationProp = {
  goBack: () => void;
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  dispatch: (action: unknown) => void;
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
  // The "Load more members" footer is the last row in this list and the bottom
  // tab bar is an absolute overlay over this route, so paging was impossible
  // until the bar happened to slide away. 32 was never enough.
  const listBottomPadding = useScreenBottomPadding();
  const { lowDataMode } = useLowDataMode();
  const { onScroll: chromeOnScroll } = useChrome();
  const viewerId = useAuthStore((s) => s.user?.id);
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
  /**
   * Reporting a member is `community_member` — the shared target type, with
   * the shared reason list. It is deliberately open to every member (a report
   * is not moderation), and never offered on the reader's own row: a report
   * against yourself only costs a moderator a queue item.
   */
  const [reportTarget, setReportTarget] = useState<CommunityMember | null>(null);
  /**
   * Tapping a row opens the sheet rather than the report form itself: a
   * single tap that files a report is a report filed by accident.
   */
  const [menuTarget, setMenuTarget] = useState<CommunityMember | null>(null);

  // A deep link only carries the slug: resolve the community first (also
  // gives us isMember / member_count for the presence gate below).
  useEffect(() => {
    if (detail) return;
    void loadCommunity(slug).catch((err: unknown) => {
      // Same rule as the roster catch below: no raw server phrase reaches a
      // student. A 404 still reads as "we couldn't find this" — the shared
      // vocabulary classifies it — so nothing is lost by dropping err.message.
      setError(requestFailureSentence(err));
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
        // A raw server phrase (e.g. PostgREST's "Invalid reference or
        // relationship") must never reach a student. Forbidden stays bespoke
        // ("join to see members"); every other failure speaks the shared
        // request-failure vocabulary instead of echoing err.message.
        setError(
          isForbiddenError(err)
            ? COMMUNITY_COPY.joinToSeeMembers
            : requestFailureSentence(err)
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
    <Screen bottom="none">
      <View className="border-b border-lantern-border">
        <View className="flex-row items-center h-[56px] pr-4">
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: 4 }} />
          <Text className="flex-1 text-lg font-semibold text-lantern-text" numberOfLines={1}>
            {name}
          </Text>
        </View>
        <View className="mx-4 mb-2 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
          <AppIcon name="search" size={16} color="#64748b" />
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
          <ActivityIndicator color={brand.text} />
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          stickySectionHeadersEnabled={false}
          // The search box above keeps the keyboard open; without this the
          // first tap on a member row (or on "Load more") is swallowed
          // dismissing it.
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          renderSectionHeader={({ section }) => (
            <Text className="px-4 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) =>
            item.id === viewerId ? (
              <MemberRow
                member={item}
                online={isMemberOnline(item, onlineIds)}
                lowDataMode={lowDataMode}
              />
            ) : (
              <Pressable
                onPress={() => setMenuTarget(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.name}. More actions`}
              >
                <MemberRow
                  member={item}
                  online={isMemberOnline(item, onlineIds)}
                  lowDataMode={lowDataMode}
                />
              </Pressable>
            )
          }
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
                  <ActivityIndicator color={brand.text} />
                ) : (
                  <Text className="text-sm font-semibold text-lantern-primary-text">Load more</Text>
                )}
              </Pressable>
            ) : null
          }
        />
      )}

      <ActionSheet
        visible={!!menuTarget}
        title={menuTarget?.name}
        items={[
          {
            label: 'Message',
            icon: 'chatbubbles' as const,
            onPress: () => {
              const member = menuTarget;
              setMenuTarget(null);
              if (!member || !viewerId) return;
              const threadId = [viewerId, member.id].sort().join('-');
              navigation.dispatch(
                CommonActions.navigate({
                  name: 'Main',
                  params: {
                    screen: 'ChatTab',
                    params: {
                      screen: 'DirectMessage',
                      params: {
                        recipientId: member.id,
                        recipientName: member.name,
                        threadId,
                      },
                      initial: false,
                    },
                  },
                }),
              );
            },
          },
          {
            label: 'Report member',
            icon: 'flag' as const,
            onPress: () => {
              const member = menuTarget;
              setMenuTarget(null);
              setReportTarget(member);
            },
          },
        ]}
        onClose={() => setMenuTarget(null)}
      />

      <ReportContentSheet
        visible={!!reportTarget}
        targetType="community_member"
        targetId={reportTarget?.id ?? ''}
        targetLabel={reportTarget?.name}
        onClose={() => setReportTarget(null)}
      />
    </Screen>
  );
}

export function CommunityMembersScreen({
  navigation,
  route,
}: {
  navigation: NavigationProp;
  route: { params: Params };
}) {
  // The OBJECT form of the gate, via the hook: Communities are open to every
  // signed-in student with an institution and a programme (founder decision,
  // 2026-09-07). The boolean form this used to pass means "platform admin?"
  // and nothing else, which kept every student out.
  const { canSee } = useCommunityAccess();
  if (!canSee) {
    return <DiscoverComingSoon onBack={() => navigation.goBack()} />;
  }
  return <CommunityMembersList navigation={navigation} route={route} />;
}

export default CommunityMembersScreen;
