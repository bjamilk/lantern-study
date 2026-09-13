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
  communityMembershipAction,
  communityDisplayName,
  memberCountLabel,
  resolveListState,
  type Community,
  type MyCommunity,
} from '@lantern/shared/network';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { RequestError } from '../../components/RequestError';
import { useTheme } from '../../theme';
import { useCommunityAccess } from '../../hooks/useCommunityAccess';
import { useAuthStore } from '../../stores/authStore';
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
import {
  COMMUNITY_CHIPS,
  buildCommunityHub,
  communityCardMeta,
  communityChipLabel,
  type CommunityChip,
} from './communityHubModel';
import { JoinByCodeSheet } from '../discover/JoinByCodeSheet';
import { JOIN_BY_CODE_TITLE } from '../discover/joinByCodeModel';
import { planCommunityDiscovery } from './communityDiscoveryPlan';
import { AcademicFeedPanel } from '../../components/AcademicFeedPanel';

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
  route?: { params?: { segment?: CampusSegment; at?: number; joinCode?: string } };
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
              className={`text-caption ${
                selected
                  ? 'font-medium text-lantern-primary-text'
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
function CommunitiesPanel({
  navigation,
  joinCode,
}: {
  navigation: NavigationProp;
  /** From `discover/join/<code>` when the code did not resolve on its own. */
  joinCode?: string;
}) {
  const { colors, isDark } = useTheme();
  // Violet is the Campus family. Social rooms carry the `groups` ink instead,
  // which is what `communityCardMeta` returns — one hue per KIND OF ROOM, not
  // one hue per row.
  const campusAccent = useFeatureAccent('campus');
  const listBottomPadding = useScreenBottomPadding();
  const myCommunities = useCommunityStore((s) => s.myCommunities);
  const loadMine = useCommunityStore((s) => s.loadMine);
  const academicProfile = useAuthStore((s) => s.academicProfile);
  const { canCreate } = useCommunityAccess();

  const [query, setQuery] = useState('');
  const [chip, setChip] = useState<CommunityChip>('all');
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
  // A deep link that arrives while Campus is already open must still raise the
  // sheet, so the request is adopted rather than read once at mount.
  const [joinSheetOpen, setJoinSheetOpen] = useState(joinCode !== undefined);
  useEffect(() => {
    if (joinCode !== undefined) setJoinSheetOpen(true);
  }, [joinCode]);

  /**
   * One search. The CHIP is part of the request now (`planCommunityDiscovery`)
   * rather than a filter applied to whatever 30 rows the server happened to
   * send: "Hostel" used to show an empty list while the campus had twenty
   * hostel rooms past the page.
   *
   * A kind-scoped query that answers ZERO rows is retried once without the
   * kind — on a database without the kinds migration every student-made room
   * is still filed as `topic`, and the tag-reading `matchesChip` in
   * `communityHubModel` is what narrows it then. That is a floor, not the
   * default: once rows carry a real kind the first query answers.
   */
  const load = useCallback(
    async (q: string, forChip: CommunityChip, options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      setError(null);
      const plan = planCommunityDiscovery({ chip: forChip, query: q });
      try {
        const [, first] = await Promise.all([loadMine(true), discoverCommunities(plan.params)]);
        const discovered =
          first.length === 0 && plan.fallback
            ? await discoverCommunities(plan.fallback)
            : first;
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

  // First paint, and every chip change: the chip is a QUERY, so changing it
  // has to ask the server again rather than re-filter a stale page.
  useEffect(() => {
    void load(query, chip, { silent: true });
    // `query` is deliberately absent: the search box re-runs on submit, and
    // re-querying per keystroke is not what this list is for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, chip]);

  /**
   * The shared rule decides what this panel shows: a failure with rows already
   * in hand keeps the rows and banners the failure; a failure with nothing
   * cached is a full RequestError with Try again; only a load that actually
   * succeeded may say the list is empty or that a search found no match.
   */
  const listState = resolveListState({
    loading,
    error,
    itemCount: myCommunities.length + results.length,
    query: loadedQuery,
  });

  /**
   * A load that failed tells us nothing about the data, so neither "nothing to
   * join yet" nor "no match" may be rendered on the back of one.
   */
  const listUnknown = listState === 'failed' || listState === 'stale';

  // Sections, chips and ranking are decided in one pure place so mobile jest
  // can hold them — this render never sorts or filters a community itself.
  const hub = useMemo(
    () =>
      buildCommunityHub({
        mine: myCommunities,
        discovered: results,
        chip,
        loadedQuery,
        institutionId: academicProfile?.institutionId ?? null,
        unknown: listUnknown,
      }),
    [myCommunities, results, chip, loadedQuery, academicProfile, listUnknown]
  );

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
    const meta = communityCardMeta(community);
    const busy = pendingId === community.id;
    return (
      <Pressable
        key={community.id}
        onPress={() => (joined ? open(community.slug) : void join(community))}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`${communityDisplayName(community.name)}, ${meta.label}, ${memberCountLabel(
          community.member_count
        )}. ${joined ? 'Open' : 'Join'}`}
        style={{ minHeight: 56 }}
        className="flex-row items-start gap-3 mx-4 mb-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
      >
        {/* The GLYPH and its ink say which kind of room this is — a course, a
            hostel, a fellowship — and both come from the shared kind meta, so
            a room reads the same here, on web and in the API. */}
        <FeatureDisc feature={meta.ink} icon={meta.icon} size={40} />
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-lantern-text" numberOfLines={1}>
            {/* A derived course room is named `code — title`, which reads
                "PHARM 212 — PHARM 212" whenever the title IS the code. */}
            {communityDisplayName(community.name)}
          </Text>
          <Text className="mt-1 text-caption text-lantern-text-secondary" numberOfLines={1}>
            {meta.label} · {memberCountLabel(community.member_count)}
          </Text>
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primaryText} />
        ) : (
          <Text
            className={`text-caption font-semibold px-2 py-1.5 ${
              joined ? 'text-lantern-text-secondary' : 'text-lantern-primary-text'
            }`}
          >
            {joined ? 'Open' : action}
          </Text>
        )}
      </Pressable>
    );
  };

  /** The two doors: start a room, or join a private one with a link. */
  const doors = (
    <View className="flex-row gap-3 px-4 pt-4">
      {canCreate ? (
        <Pressable
          onPress={() => navigation.navigate('CreateCommunity')}
          accessibilityRole="button"
          accessibilityLabel="Start a community"
          className="flex-1 flex-row items-start gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
        >
          <FeatureDisc feature="campus" icon="add" size={32} />
          <View className="flex-1 min-w-0">
            <Text className="text-body font-semibold text-lantern-text">Start a community</Text>
            <Text className="mt-1 text-caption text-lantern-text-secondary">
              Name a room for a class, club, or hall.
            </Text>
          </View>
        </Pressable>
      ) : null}
      <Pressable
        onPress={() => setJoinSheetOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={JOIN_BY_CODE_TITLE}
        className="flex-1 flex-row items-start gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4"
      >
        <FeatureDisc feature="groups" icon="link" size={32} />
        <View className="flex-1 min-w-0">
          <Text className="text-body font-semibold text-lantern-text">{JOIN_BY_CODE_TITLE}</Text>
          <Text className="mt-1 text-caption text-lantern-text-secondary">
            Use an invite code for a private room.
          </Text>
        </View>
      </Pressable>
    </View>
  );

  const chips = (
    <View className="flex-row flex-wrap gap-2 px-4 pt-4">
      {COMMUNITY_CHIPS.map((value) => {
        const selected = value === chip;
        return (
          <Pressable
            key={value}
            onPress={() => setChip(value)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${communityChipLabel(value)} communities`}
            // A FILTER PILL IS A CONTROL (2026-09-12). It used to be the
            // campus violet on the campus pastel — #6d28d9 on #ede9fe — which
            // build 198's device pass read as the one coloured object on an
            // otherwise ink-and-cream screen, saying "campus" on a screen that
            // is already nothing but campus. Selected is now the theme ink
            // under its inverse, the same pill every other selected control in
            // the app draws; resting is the page hairline. The campus pastel
            // stays where it answers a real question — the hero panel below
            // and the room discs.
            style={{
              minHeight: 36,
              backgroundColor: selected ? colors.primaryFill : 'transparent',
              borderColor: selected ? colors.primaryFill : colors.border,
            }}
            className="rounded-full border px-3 justify-center"
          >
            <Text
              style={{ color: selected ? colors.textInverse : colors.textSecondary }}
              className="text-caption"
            >
              {communityChipLabel(value)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <Screen bottom="none" keyboard>
      <View className="mx-4 mt-4 mb-1 flex-row items-center rounded-xl border border-lantern-border bg-lantern-surface px-3">
        <AppIcon name="search" size={16} color={colors.textSecondary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => void load(query, chip)}
          returnKeyType="search"
          placeholder="Search communities"
          placeholderTextColor={colors.inputPlaceholder}
          accessibilityLabel="Search communities"
          style={{ minHeight: 44 }}
          className="flex-1 ml-2 text-body text-lantern-text"
        />
      </View>

      {joinError ? (
        <Text className="px-4 py-2 text-caption text-lantern-error" accessibilityLiveRegion="polite">
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
        <RequestError error={error} onRetry={() => void load(query, chip)} />
      ) : (
        <FlatList
          data={hub.find}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => renderRow(item, false)}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: listBottomPadding }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(query, chip, { silent: true });
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
                  onRetry={() => void load(query, chip)}
                  detail="Showing the communities saved on this device."
                />
              ) : null}
              {doors}
              {chips}
              <AcademicFeedPanel
                limit={6}
                heading="Happening now"
                hideWhenEmpty
                className="mx-4 mt-6 mb-2"
                onNavigate={(screen, params) => navigation.navigate(screen, params)}
              />
              {/* Nothing joined yet and nothing filtered away: ONE violet
                  coaching card (spec v3 §5.7) that says what a room is FOR
                  rather than that the list is empty. `showEmptyIllustration`
                  is the only thing that may draw the campus-hall picture, so
                  it can never appear over a "no hostels here" chip or on the
                  back of a failed load. */}
              {hub.showEmptyIllustration ? (
                <View
                  style={{ backgroundColor: campusAccent.tint }}
                  className="mx-4 mt-3 mb-1 rounded-2xl p-4"
                  accessibilityRole="summary"
                >
                  <View className="flex-row items-center gap-3 mb-2">
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
                    tests. Clubs, hostels, events and teams live here too — start one
                    if it does not exist yet.
                  </Text>
                </View>
              ) : null}

              {hub.mine.length > 0 ? (
                <>
                  <View className="px-4 pt-6 pb-3">
                    <Text className="text-title font-semibold text-lantern-text">Your communities</Text>
                    <Text className="mt-1 text-caption text-lantern-text-secondary">
                      Campus room first, then the ones you joined.
                    </Text>
                  </View>
                  {hub.mine.map((community) => renderRow(community, true))}
                </>
              ) : null}
              {hub.find.length > 0 ? (
                <View className="px-4 pt-6 pb-3">
                  <Text className="text-title font-semibold text-lantern-text">Find a community</Text>
                  <Text className="mt-1 text-caption text-lantern-text-secondary">
                    Open rooms you can join from here.
                  </Text>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            // Never claim "nothing to join" on the back of a request that
            // failed — the banner above has already said what really happened.
            hub.empty === 'unknown' || hub.mine.length > 0 ? null : hub.empty === 'noMatch' ? (
              <Text className="mx-4 mt-3 text-caption text-lantern-text-tertiary">
                {loadedQuery.trim()
                  ? `No communities match “${loadedQuery.trim()}” under ${communityChipLabel(chip)}. Try a different word, or tap All.`
                  : `No ${communityChipLabel(chip)} communities yet. Start one, or tap All to see everything open to you.`}
              </Text>
            ) : (
              <Text className="mx-4 mt-3 text-caption text-lantern-text-tertiary">
                No other communities to join yet. Yours are made from your university,
                programme and courses — add them in Me → Academic details.
              </Text>
            )
          }
        />
      )}

      <JoinByCodeSheet
        visible={joinSheetOpen}
        initialCode={joinCode}
        onClose={() => setJoinSheetOpen(false)}
        onResolved={(slug, joined) => {
          setJoinSheetOpen(false);
          // A redeemed CODE has already joined the room, so the membership
          // list is stale the moment the sheet closes; a resolved LINK joined
          // nothing and needs no refetch.
          if (joined) void loadMine(true).catch(() => undefined);
          open(slug);
        }}
      />
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
        <Text className="text-title font-bold text-lantern-text text-center mb-2">
          Campus is opening university by university
        </Text>
        <Text className="text-body text-lantern-text-secondary text-center">
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
  const { canSee: canSeeCommunities } = useCommunityAccess();
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
        // The OBJECT form of the shared gate (via useCommunityAccess): every
        // signed-in student with an institution and a programme sees
        // Communities, not platform admins alone.
        canSeeCommunities: canSeeCommunities && isDiscoverSectionEnabled('communities'),
        marketplaceAccess,
      }),
    [canSeeCommunities, marketplaceAccess]
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
      <CommunitiesPanel navigation={navigation} joinCode={route?.params?.joinCode} />
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
