import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import {
  canAccessDiscoverHub,
  communityKindLabel,
  communityMembershipAction,
  memberCountLabel,
  resolveListState,
  type Community,
  type MyCommunity,
} from '@lantern/shared/network';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { RequestError } from '../../components/RequestError';
import { useTheme } from '../../theme';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useCommunityStore } from '../../stores/communityStore';
import { useMarketplaceStore } from '../../stores/marketplaceStore';
import { discoverCommunities, joinCommunity } from '../../services/api';
import { MarketplaceScreen } from '../marketplace/MarketplaceScreen';
import { JobsHomeScreen } from '../marketplace/JobsHomeScreen';
import { withMarketplaceGate } from '../marketplace/MarketplaceGate';
import {
  CAMPUS_SEGMENT_LABELS,
  resolveCampusSegment,
  shouldPublishCampusSegment,
  resolveCampusSegments,
  shouldShowSegmentBar,
  type CampusSegment,
} from './campusSegments';
import { AppIcon } from '../../components/ui/AppIcon';
import { FeatureDisc, Illustration, useFeatureAccent } from '../../components/ui';
import { communityRowIcon } from './communityRowIcon';

interface NavigationProp {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  /**
   * Optional because the panels below are also rendered under test doubles
   * that only ever navigate. React Navigation always supplies it.
   */
  setParams?: (params: Record<string, unknown>) => void;
}

interface Props {
  navigation: NavigationProp;
  route?: { params?: { segment?: CampusSegment; at?: number } };
}

/** 44px minimum touch target — NativeWind inlines rem at 14, so px literals. */
const SEGMENT_HEIGHT = 44;

/**
 * Module scope, so each wrapped component keeps a stable identity across
 * renders. Hiding the segment is the real gate — a definite refusal removes it
 * from the bar entirely — but the wrapper still matters for the window between
 * "not answered yet" and the answer: it holds the screen back rather than
 * letting it fire a wall of 403s.
 */
const GatedShop = withMarketplaceGate(MarketplaceScreen);
const GatedJobs = withMarketplaceGate(JobsHomeScreen, 'jobs');

function SegmentBar({
  segments,
  active,
  onSelect,
}: {
  segments: readonly CampusSegment[];
  active: CampusSegment;
  onSelect: (segment: CampusSegment) => void;
}) {
  const { colors } = useTheme();
  return (
    <View className="flex-row px-2" accessibilityRole="tablist">
      {segments.map((segment) => {
        const selected = segment === active;
        return (
          <Pressable
            key={segment}
            onPress={() => onSelect(segment)}
            accessibilityRole="tab"
            accessibilityLabel={CAMPUS_SEGMENT_LABELS[segment]}
            accessibilityState={{ selected }}
            style={{ minHeight: SEGMENT_HEIGHT }}
            className="flex-1 items-center justify-center"
          >
            <Text
              numberOfLines={1}
              className={`text-sm ${
                selected
                  ? 'font-bold text-lantern-primary-text'
                  : 'font-medium text-lantern-text-secondary'
              }`}
            >
              {CAMPUS_SEGMENT_LABELS[segment]}
            </Text>
            {/* A second, non-colour signal for the current segment. */}
            <View
              style={{
                height: 2,
                width: '60%',
                marginTop: 4,
                borderRadius: 1,
                backgroundColor: selected ? colors.primaryFill : 'transparent',
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * The Communities segment.
 *
 * Deliberately its own lean list rather than the Discover hub embedded whole:
 * that screen carries its own back arrow and its own section bar, and two
 * stacked segment rows with a back arrow that leaves the tab is exactly the
 * "one feature, two doors" problem this wave is closing. Community DETAIL,
 * boards, posts and the roster are unchanged — they live on CampusStack now,
 * so the Campus tab stays lit all the way down.
 */
function CommunitiesPanel({ navigation }: { navigation: NavigationProp }) {
  const { colors } = useTheme();
  // Violet is the Campus family. It appears exactly twice on this panel: on
  // the row discs, and on the one coaching card below.
  const campusAccent = useFeatureAccent('campus');
  const listBottomPadding = useScreenBottomPadding();
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const loadMine = useCommunityStore((s) => s.loadMine);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The thrown value, not a message: RequestError classifies it and says the
  // same sentence web says. Printing `e.message` is how this screen came to
  // show a bare red "Network request failed" over a blank page.
  const [error, setError] = useState<unknown>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // A failed JOIN is about one row, not about the list — keeping it out of
  // `error` is what stops one refused tap from banner-ing the whole panel as
  // unreachable.
  const [joinError, setJoinError] = useState<string | null>(null);
  // Whatever the search box held when `results` were last filled. Used so a
  // stale list is never labelled as the answer to a newer query.
  const [loadedQuery, setLoadedQuery] = useState('');

  const load = useCallback(
    async (q: string, options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      setError(null);
      try {
        const [, discovered] = await Promise.all([
          loadMine(true),
          discoverCommunities(q ? { q, limit: 30 } : { limit: 30 }),
        ]);
        setResults(discovered);
        setLoadedQuery(q);
      } catch (e) {
        // The list already on screen (and the store's joined communities) stay
        // exactly where they are — a failed request tells us nothing about them.
        setError(e);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadMine]
  );

  useEffect(() => {
    void load('');
  }, [load]);

  const mineIds = useMemo(
    () => new Set(myCommunities.map((community) => community.id)),
    [myCommunities]
  );

  // Anything already joined is shown in "Your communities"; repeating it under
  // Discover would be the same room behind two rows.
  const discoverable = useMemo(
    () => results.filter((community) => !mineIds.has(community.id)),
    [results, mineIds]
  );

  /**
   * The shared rule decides what this panel shows: a failure with rows already
   * in hand keeps the rows and banners the failure; a failure with nothing
   * cached is a full RequestError with Try again; only a load that actually
   * succeeded may say the list is empty or that a search found no match.
   */
  const listState = resolveListState({
    loading,
    error,
    itemCount: myCommunities.length + discoverable.length,
    query: loadedQuery,
  });

  /**
   * A load that failed tells us nothing about the data, so neither "nothing to
   * join yet" nor "no match" may be rendered on the back of one. Kept as a
   * boolean so it reads the same wherever it is used.
   */
  const listUnknown = listState === 'failed' || listState === 'stale';

  const open = useCallback(
    (slug: string) => navigation.navigate('CommunityDetail', { slug }),
    [navigation]
  );

  const join = useCallback(
    async (community: Community) => {
      setPendingId(community.id);
      setJoinError(null);
      try {
        await joinCommunity(community.id);
        await loadMine(true);
        open(community.slug);
      } catch (e) {
        setJoinError(e instanceof Error ? e.message : 'Could not join that community');
      } finally {
        setPendingId(null);
      }
    },
    [loadMine, open]
  );

  const renderRow = (community: Community | MyCommunity, joined: boolean) => {
    const action = communityMembershipAction(
      joined,
      (community as MyCommunity).source ?? null
    );
    const busy = pendingId === community.id;
    return (
      <Pressable
        key={community.id}
        onPress={() => (joined ? open(community.slug) : void join(community))}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`${community.name}, ${communityKindLabel(community.kind)}, ${memberCountLabel(
          community.member_count
        )}. ${joined ? 'Open' : 'Join'}`}
        style={{ minHeight: 56 }}
        className="flex-row items-center gap-3 px-4 py-3 border-b border-lantern-border"
      >
        {/* Violet is the Campus family, and the GLYPH is what says which kind
            of room this is — a course, a campus, an interest. The indigo
            square this replaced was the app's primary colour used as
            decoration, identical on every row. */}
        <FeatureDisc feature="campus" icon={communityRowIcon(community.kind)} size={40} />
        <View className="flex-1 min-w-0">
          <Text className="text-base font-semibold text-lantern-text" numberOfLines={1}>
            {community.name}
          </Text>
          <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>
            {communityKindLabel(community.kind)} · {memberCountLabel(community.member_count)}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primaryText} />
        ) : (
          <Text
            className={`text-xs font-semibold px-2 py-1.5 ${
              joined ? 'text-lantern-text-secondary' : 'text-lantern-primary-text'
            }`}
          >
            {joined ? 'Open' : action}
          </Text>
        )}
      </Pressable>
    );
  };

  return (
    <Screen bottom="none" keyboard>
      <View className="mx-4 mt-2 mb-1 flex-row items-center rounded-lg bg-lantern-background-secondary px-3">
        <AppIcon name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(query)}
          returnKeyType="search"
          placeholder="Search communities"
          placeholderTextColor={colors.inputPlaceholder}
          accessibilityLabel="Search communities"
          className="flex-1 ml-2 py-2 text-sm text-lantern-text"
        />
      </View>

      {joinError ? (
        <Text className="px-4 py-2 text-xs text-lantern-error" accessibilityLiveRegion="polite">
          {joinError}
        </Text>
      ) : null}

      {listState === 'loading' ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.primaryText} />
        </View>
      ) : listState === 'failed' ? (
        // Nothing cached to fall back on: the whole panel says what happened
        // and offers the one action that can help.
        <RequestError error={error} onRetry={() => void load(query)} />
      ) : (
        <FlatList
          data={discoverable}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderRow(item, false)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(query, { silent: true });
              }}
              tintColor={colors.primaryText}
            />
          }
          ListHeaderComponent={
            <View>
              {/* Rows we already hold, flagged rather than blanked. */}
              {listState === 'stale' ? (
                <RequestError
                  error={error}
                  variant="banner"
                  onRetry={() => void load(query)}
                  detail="Showing the communities saved on this device."
                />
              ) : null}
              {/* Nothing joined yet: ONE violet coaching card (spec v3 §5.7),
                  which says what a room is FOR rather than that the list is
                  empty. Never drawn on the back of a failed load — the banner
                  above has already said what really happened, and "you have
                  joined nothing" would be a claim we cannot make.
                  So it is CORRECTLY absent for a student who has joined
                  anything — the build 166 pass did not find it because that
                  account is in six communities (shots24/23-campus.png). */}
              {!listUnknown && myCommunities.length === 0 ? (
                <View
                  style={{ backgroundColor: campusAccent.tint }}
                  className="mx-4 mt-3 mb-1 rounded-2xl p-4"
                  accessibilityRole="summary"
                >
                  <View className="flex-row items-center gap-3 mb-2">
                    {/* The picture REPLACES the disc rather than joining it:
                        this card is a door into rooms, and a 32 dp disc plus a
                        56 dp illustration is two marks saying the same thing.
                        `variant="surface"` because the card is a full campus
                        tint panel — the asset's authored tint ground would be
                        invisible on it. It adds no tint of its own either way,
                        so the card's chromatic cost is unchanged. */}
                    <Illustration
                      name="campus-hall"
                      feature="campus"
                      size={56}
                      variant="surface"
                    />
                    <Text
                      style={{ color: campusAccent.ink }}
                      className="flex-1 text-heading font-bold"
                    >
                      Your course room is where past questions get verified
                    </Text>
                  </View>
                  <Text className="text-caption text-lantern-text">
                    Join the room for a course you are taking: members mark which past
                    questions are real, and what they verify is what shows up in your
                    tests.
                  </Text>
                </View>
              ) : null}

              {myCommunities.length > 0 ? (
                <>
                  <Text className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-lantern-text-tertiary">
                    Your communities
                  </Text>
                  {myCommunities.map((community) => renderRow(community, true))}
                  <Text className="px-4 pt-4 pb-1 text-xs font-semibold uppercase text-lantern-text-tertiary">
                    Discover
                  </Text>
                </>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            // Never claim "nothing to join" on the back of a request that
            // failed — the banner above has already said what really happened.
            listUnknown ? null : listState === 'noMatch' ? (
              <Text className="mx-4 mt-3 text-xs text-lantern-text-tertiary">
                No communities match “{loadedQuery.trim()}”. Try a different word, or clear the
                search to see everything open to you.
              </Text>
            ) : (
              <Text className="mx-4 mt-3 text-xs text-lantern-text-tertiary">
                No other communities to join yet. Yours are made from your university,
                programme and courses — add them in Me → Academic details.
              </Text>
            )
          }
        />
      )}
    </Screen>
  );
}

/** Campus with every gate closed: honest, and never an empty segment bar. */
function CampusEmpty() {
  const { colors } = useTheme();
  return (
    <Screen>
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 rounded-2xl bg-lantern-background-secondary dark:bg-lantern-surface-secondary items-center justify-center mb-5">
          <AppIcon name="business" size={30} color={colors.textSecondary} />
        </View>
        <Text className="text-lg font-bold text-lantern-text text-center mb-2">
          Campus is opening university by university
        </Text>
        <Text className="text-sm text-lantern-text-secondary text-center">
          Communities, the Shop and Jobs land here the moment they reach your account.
          Everything else in Lantern is yours to use in the meantime.
        </Text>
      </View>
    </Screen>
  );
}

/**
 * Campus — one destination, three segments: Communities · Shop · Jobs.
 *
 * Before this wave those three were a bottom tab (Shop), a top-bar icon
 * (Shop again), a drawer row (Jobs), a second drawer row (Community) and a
 * Discover hub that also listed the marketplace: five doors to three places.
 * They are one place now, and a segment whose gate is closed is not drawn at
 * all — Campus never shows a segment with nothing behind it.
 */
export function CampusScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const isPlatformAdmin = usePlatformAdmin();
  const marketplaceAccess = useMarketplaceStore((s) => s.marketplaceAccess);
  const checkMarketplaceAccess = useMarketplaceStore((s) => s.checkMarketplaceAccess);

  // Warm the pilot answer so the bar settles before the first tap rather than
  // re-flowing under the reader's thumb.
  useEffect(() => {
    void checkMarketplaceAccess();
  }, [checkMarketplaceAccess]);

  const segments = useMemo(
    () =>
      resolveCampusSegments({
        canSeeCommunities:
          canAccessDiscoverHub(isPlatformAdmin) && isDiscoverSectionEnabled('communities'),
        marketplaceAccess,
      }),
    [isPlatformAdmin, marketplaceAccess]
  );

  const [picked, setPicked] = useState<CampusSegment | null>(null);
  const requestedSegment = route?.params?.segment;
  // `at` changes on every legacy navigate('MarketTab'/'JobsTab'), so the same
  // request re-applies even when Campus is already the focused screen.
  const requestedAt = route?.params?.at;
  useEffect(() => {
    if (requestedSegment) setPicked(requestedSegment);
  }, [requestedSegment, requestedAt]);

  const active = resolveCampusSegment(picked ?? requestedSegment, segments);

  /**
   * Publish the visible segment back into this route's own params.
   *
   * Campus is one route with three destinations inside it, and the app chrome
   * can only see route names and params (RootNavigator's CustomTabBar). Until
   * this ran, tapping Shop changed a `useState` and nothing outside the screen
   * could tell — which is why the Shop contextual row never appeared in build
   * 166: the chrome saw `Campus`, not `ShopBrowse`. Writing the segment into
   * the params keeps the row a pure function of the FOCUSED ROUTE
   * (navigation/contextualBars.ts, CONTEXTUAL_BAR_SEGMENTS) instead of adding
   * a second, screen-owned publisher of chrome state.
   *
   * ONE writer per event. A tap writes the param itself (`selectSegment`
   * below), and the effect above adopts every `navigate('Campus', { segment })`
   * from a redirect or a deep link into `picked`. This effect only fills the
   * gap those two leave — no request at all (first mount, a cleared root
   * reset), or an adopted request for a segment whose gate is closed — and it
   * NEVER overwrites a request the screen has not adopted yet. Re-publishing
   * `active` unconditionally would race the adoption effect: one copies the
   * new request in while the other writes the old pick back out, forever.
   * `shouldPublishCampusSegment` holds that rule and its test holds the race.
   */
  useEffect(() => {
    if (!shouldPublishCampusSegment({ requested: requestedSegment, picked, active })) return;
    navigation.setParams?.({ segment: active });
  }, [active, picked, requestedSegment, navigation]);

  /** The reader's tap: the screen's own state AND the param the chrome reads. */
  const selectSegment = useCallback(
    (segment: CampusSegment) => {
      setPicked(segment);
      navigation.setParams?.({ segment });
    },
    [navigation]
  );

  if (!active) return <CampusEmpty />;

  const panel =
    active === 'communities' ? (
      <CommunitiesPanel navigation={navigation} />
    ) : active === 'shop' ? (
      <GatedShop navigation={navigation} />
    ) : (
      <GatedJobs />
    );

  return (
    <View className="flex-1 bg-lantern-background">
      {/* The tab navigator is pulled up by insets.top (MainTabsShell) and every
          screen pays it back, so the bar pays it here and the panel below —
          which pays it too — is pulled back up by the same amount. zIndex keeps
          the bar drawn above the panel's own opaque background. */}
      {shouldShowSegmentBar(segments) ? (
        <View
          style={{
            paddingTop: insets.top,
            backgroundColor: colors.background,
            zIndex: 10,
            elevation: 2,
          }}
        >
          <SegmentBar segments={segments} active={active} onSelect={selectSegment} />
        </View>
      ) : null}
      <View
        className="flex-1"
        style={{ marginTop: shouldShowSegmentBar(segments) ? -insets.top : 0 }}
      >
        {panel}
      </View>
    </View>
  );
}

export default CampusScreen;
