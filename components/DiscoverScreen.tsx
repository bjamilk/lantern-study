import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultDiscoverSection, isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import {
  COMMUNITY_CHIPS,
  DISCOVER_SECTION_INTRO,
  buildCommunityHub,
  communityCardMeta,
  communityChipLabel,
  communityDisplayName,
  communityMembershipAction,
  communityUnreadTotal,
  formatCommunityUnread,
  memberCountLabel,
  normalizeCommunitySearch,
  planCommunityDiscovery,
  presenceLabel,
  resolveListState,
  shouldShowTrustChip,
  studyRoomTimeLeftLabel,
  trustLabel,
  type Community,
  type CommunityChip,
  type DiscoverGroup,
  type DiscoverPerson,
  type MyCommunity,
  type PresenceSnapshot,
  type StudyRoomListItem,
} from '@lantern/shared/network';
import {
  discoverCommunities,
  discoverGroups,
  discoverPeople,
  fetchMyCommunities,
  fetchStudyPresence,
  joinCommunity,
  joinDiscoverableGroup,
  leaveCommunity,
  listStudyRooms,
} from '../services/supabase';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useAuthStore } from '../stores/authStore';
import { FeatureDisc, Illustration } from './ui';
import AcademicFeedPanel from './AcademicFeedPanel';
import { useGroupStore } from '../stores/groupStore';
import DiscoverWorkspaceBar, { type DiscoverSection } from './discover/DiscoverWorkspaceBar';
import DiscoverComingSoon from './discover/DiscoverComingSoon';
import RequestError from './RequestError';
import { AppIcon, type AppIconName } from './ui/AppIcon';
import CreateCommunityModal from './community/CreateCommunityModal';
import JoinByCodeModal from './community/JoinByCodeModal';
import { canOpenCommunities } from './community/communityAccess';

/**
 * The Discover hub (Phase 3 · L).
 *
 * Decision D12: this replaces "Explore" as the sidebar destination, with the
 * marketplace nested as one of its tabs. Communities / Groups / People are
 * served by /discover/*, which is deliberately separate from GET /groups
 * (memberships-only, cached per user).
 *
 * Until campus rooms ship, the hub is platform-admin only. Ordinary users (and
 * guests after login) still see Discover in the sidebar, but the screen is a
 * coming-soon empty state and does not load communities, groups, or people.
 *
 * Chrome is kept to a single underline tab row plus search so the cards — not
 * buttons around the cards — are the screen.
 */
export interface DiscoverScreenProps {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  initialSection?: DiscoverSection;
  /** `/discover/new` and `/discover/join/:code` open a modal over the hub. */
  initialAction?: 'create' | 'join';
  initialCode?: string | null;
}

type Status = 'idle' | 'loading' | 'error';

const card =
  'rounded-2xl border border-lantern-border bg-lantern-surface p-4 flex flex-col gap-1 transition-colors hover:border-lantern-ink/20';

const LIST_ROW =
  'flex w-full items-start gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left';

const EmptyState: React.FC<{
  title: string;
  hint: string;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>;
}> = ({ title, hint, actions }) => (
  <div className="rounded-2xl border border-dashed border-lantern-border px-6 py-8 text-center">
    <p className="text-heading text-lantern-text">{title}</p>
    <p className="mt-1 text-body text-lantern-text-secondary">{hint}</p>
    {actions && actions.length > 0 ? (
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={
              action.primary
                ? 'min-h-[36px] rounded-full bg-lantern-primary px-3 text-caption font-semibold text-white hover:bg-lantern-primary-dark'
                : 'min-h-[36px] rounded-full px-3 text-caption font-semibold text-lantern-primary-text hover:bg-lantern-primary/10'
            }
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null}
  </div>
);

/** One chip in the shared Campus row. Selected is theme ink, like Chat All/Unread. */
const KindChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-[36px] rounded-full border px-3 text-caption ${
      active
        ? 'border-lantern-ink bg-lantern-ink text-lantern-surface'
        : 'border-lantern-border bg-transparent text-lantern-text-secondary hover:text-lantern-text'
    }`}
  >
    {children}
  </button>
);

const DiscoverHub: React.FC<DiscoverScreenProps> = ({
  onNavigate,
  initialSection,
  initialAction,
  initialCode,
}) => {
  // Same rule as mobile: never open on a section that is switched off.
  const [section, setSection] = useState<DiscoverSection>(() =>
    initialSection && isDiscoverSectionEnabled(initialSection)
      ? initialSection
      : (defaultDiscoverSection() as DiscoverSection),
  );
  const [query, setQuery] = useState('');
  /**
   * The Find filter: one community kind, or every kind. It is a SERVER filter
   * (`GET /discover/communities?kind=`), not a client one — filtering the page
   * we happened to be handed would quietly hide rooms that exist, and the
   * ranking the server applies is per-query.
   */
  const [chip, setChip] = useState<CommunityChip>('all');
  const [status, setStatus] = useState<Status>('idle');
  // Two different things used to share one `error` string: a list that did not
  // arrive and an action that did not happen. They are separated — only the
  // first may decide whether the list below is a list, an empty state or a
  // failure state. Form validation lives inside the modals that own the forms.
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionFailure, setActionFailure] = useState<{ error: unknown; detail: string } | null>(
    null,
  );

  const [mine, setMine] = useState<MyCommunity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [rooms, setRooms] = useState<StudyRoomListItem[]>([]);
  // "Closes in Xh" ticks once a minute while the Room tab is open.
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Both modals open from the URL ON MOUNT only (`/discover/new`,
  // `/discover/join/:code`). Reading the prop on every render instead would
  // slam the modal shut the moment the path normalised back to /campus.
  const [creatingCommunity, setCreatingCommunity] = useState(initialAction === 'create');
  const [joiningByCode, setJoiningByCode] = useState(initialAction === 'join');
  const [loadedQuery, setLoadedQuery] = useState('');

  const myById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine]);
  const institutionId = useAuthStore((s) => s.currentUser?.institutionId ?? null);

  const load = useCallback(
    async (target: DiscoverSection, q: string, forChip: CommunityChip = 'all') => {
      // The marketplace tab is a navigation, not a fetch.
      if (target === 'marketplace') return;
      setStatus('loading');
      setLoadError(null);
      try {
        if (target === 'communities') {
          const plan = planCommunityDiscovery({
            chip: forChip,
            query: normalizeCommunitySearch(q) ?? q,
          });
          const [first, own] = await Promise.all([
            discoverCommunities(plan.params),
            fetchMyCommunities(),
          ]);
          const discovered =
            first.length === 0 && plan.fallback
              ? await discoverCommunities(plan.fallback)
              : first;
          setCommunities(discovered);
          setMine(own);
          setLoadedQuery(q);
        } else if (target === 'groups') {
          setGroups(await discoverGroups({ q: q || undefined }));
        } else if (target === 'rooms') {
          // Open rooms only, capped server-side; the search box filters
          // locally instead of round-tripping (same as mobile).
          setRooms(await listStudyRooms());
        } else {
          setPeople(await discoverPeople({ q: q || undefined }));
        }
        setStatus('idle');
      } catch (err) {
        // Kept raw so RequestError can classify it: web and mobile then say
        // the same sentence for the same failure.
        setLoadError(err);
        setStatus('error');
      }
    },
    []
  );

  useEffect(() => {
    void load(section, query, chip);
    // `query` is applied through the explicit search submit below, not on every
    // keystroke — re-running this on each character would hammer the API. The
    // kind chips DO refetch on click: one tap is the whole interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, chip, load]);

  // The Room tab is "what is open right now": refetch when the tab regains
  // visibility (coming back from a room) and tick the countdown once a minute.
  useEffect(() => {
    if (section !== 'rooms') return undefined;
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        setNow(Date.now());
        void load('rooms', '');
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [section, load]);

  const visibleRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((room) =>
      [room.title, room.topic ?? ''].some((field) => field.toLowerCase().includes(q))
    );
  }, [rooms, query]);

  const listUnknown = status === 'error';
  const hub = useMemo(
    () =>
      buildCommunityHub({
        mine,
        discovered: communities,
        chip,
        loadedQuery,
        institutionId,
        unknown: listUnknown,
        now,
      }),
    [mine, communities, chip, loadedQuery, institutionId, listUnknown, now],
  );

  // The shared rule, applied once for the whole hub: a failed load is
  // 'failed', never 'empty' and never 'noMatch'. Searching over a list that
  // never arrived says "we couldn't load it" — "no groups match that search"
  // would be a claim about data we never received.
  const listState = resolveListState({
    loading: status === 'loading',
    error: loadError,
    itemCount:
      section === 'communities'
        ? hub.mine.length + hub.find.length
        : section === 'groups'
          ? groups.length
          : section === 'rooms'
            ? visibleRooms.length
            : people.length,
    query:
      loadedQuery ||
      (section === 'communities' && hub.filtered ? communityChipLabel(chip) : ''),
  });

  useEffect(() => {
    // Presence is a nicety; a failure here must not blank the hub.
    void fetchStudyPresence({})
      .then(setPresence)
      .catch(() => setPresence(null));
  }, []);

  const handleSection = (next: DiscoverSection) => {
    if (next === 'marketplace') {
      onNavigate('Marketplace');
      return;
    }
    setQuery('');
    setSection(next);
  };

  // Selecting the marketplace tab has always been a navigation, not a section
  // to render. Now that it can also be the STARTING section — Community,
  // Groups and People are switched off — that navigation has to happen on
  // mount too, or the hub renders an empty community list with a "Search
  // communities" box over it.
  useEffect(() => {
    if (section === 'marketplace') {
      onNavigate('Marketplace');
    }
  }, [section, onNavigate]);

  const toggleMembership = async (community: Community, isMember: boolean) => {
    setPendingId(community.id);
    // Optimistic: the row flips immediately and reverts on failure, so the hub
    // never feels like it swallowed the tap.
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
      setActionFailure({
        error: err,
        detail: 'Your membership wasn’t changed. Check your connection and try again.',
      });
    } finally {
      setPendingId(null);
    }
  };

  const openOrJoinGroup = async (group: DiscoverGroup) => {
    if (group.isMember) {
      onNavigate('GroupChat', { groupId: group.id, groupName: group.name });
      return;
    }
    setPendingId(group.id);
    try {
      await joinDiscoverableGroup(group.id);
      setGroups((prev) =>
        prev.map((item) =>
          item.id === group.id
            ? { ...item, isMember: true, memberCount: item.memberCount + 1 }
            : item
        )
      );
      onNavigate('GroupChat', { groupId: group.id, groupName: group.name, joined: true });
    } catch (err) {
      setActionFailure({
        error: err,
        detail: 'You haven’t joined this group. Check your connection and try again.',
      });
    } finally {
      setPendingId(null);
    }
  };

  /** Started from the modal — list it, own it, and open it. */
  const handleCommunityCreated = (created: Community) => {
    setMine((prev) => [
      { ...created, role: 'admin', source: 'joined' } as MyCommunity,
      ...prev.filter((c) => c.id !== created.id),
    ]);
    setCommunities((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
    onNavigate('CommunityDetail', { slug: created.slug });
  };

  const presenceLine = presenceLabel(presence);
  const myGroups = useGroupStore((s) => s.groups);

  const renderCommunityRow = (community: Community | MyCommunity, joined: boolean) => {
    const membership = myById.get(community.id);
    const action = communityMembershipAction(joined, membership?.source ?? (community as MyCommunity).source);
    const unread = communityUnreadTotal(myGroups, community.id);
    const meta = communityCardMeta(community);
    const busy = pendingId === community.id;
    return (
      <article key={community.id} className={LIST_ROW}>
        <button
          type="button"
          onClick={() =>
            joined
              ? onNavigate('CommunityDetail', { slug: community.slug })
              : void toggleMembership(community, false)
          }
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-label={`${communityDisplayName(community.name)}, ${meta.label}, ${memberCountLabel(
            community.member_count,
          )}. ${joined ? 'Open' : action}`}
        >
          <FeatureDisc
            feature={meta.ink}
            icon={<AppIcon name={meta.icon as AppIconName} size={20} />}
            size={40}
          />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-body font-semibold text-lantern-text">
              <span className="truncate">{communityDisplayName(community.name)}</span>
              {community.is_official ? (
                <AppIcon
                  name="badge-check"
                  size={16}
                  className="shrink-0 text-lantern-ink"
                  aria-label="Official community"
                />
              ) : null}
              {unread > 0 ? (
                <span
                  className="bg-lantern-error-strong text-white text-label tracking-normal font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full shrink-0"
                  aria-hidden="true"
                >
                  {formatCommunityUnread(unread)}
                </span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-caption text-lantern-text-secondary">
              {meta.label} · {memberCountLabel(community.member_count)}
            </span>
          </span>
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            joined
              ? onNavigate('CommunityDetail', { slug: community.slug })
              : void toggleMembership(community, false)
          }
          className={`shrink-0 rounded-md px-2 py-1.5 text-caption font-semibold disabled:opacity-60 ${
            joined ? 'text-lantern-text-secondary hover:text-lantern-text' : 'text-lantern-ink'
          }`}
        >
          {busy ? '…' : joined ? 'Open' : action}
        </button>
      </article>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 md:px-6 lg:px-8 py-6 space-y-6">
      <header className="space-y-4">
        <h1 className="sr-only">Communities</h1>
        <DiscoverWorkspaceBar active={section} onSelect={handleSection} />
        {section === 'communities' ? (
          <p className="text-caption text-lantern-text-secondary">
            Search, join, or start a room for your campus.
          </p>
        ) : null}
        {section !== 'communities' &&
        (section === 'groups' || section === 'people' || section === 'rooms') ? (
          <p className="text-caption text-lantern-text-secondary">{DISCOVER_SECTION_INTRO[section]}</p>
        ) : null}

        {/* "Start a room" and the who-is-studying line belong to the Room tab,
            not under every section (parity with mobile, founder ask 2026-09-02). */}
        {section === 'rooms' ? (
        <div className="flex flex-wrap items-center gap-2">
          {presenceLine ? (
            <button
              type="button"
              onClick={() =>
                onNavigate('StudyRoom', {
                  courseId: presence?.joinCourseId,
                  topic: presence?.joinTopic,
                })
              }
              disabled={!presence?.joinCourseId}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full bg-lantern-background-secondary px-3 text-caption text-lantern-text-secondary disabled:opacity-60"
            >
              <AppIcon name="sparkles" size={16} className="text-lantern-primary" aria-hidden="true" />
              {presenceLine}
              {presence?.joinCourseId ? ' · Join room' : ''}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onNavigate('CreateLab')}
            className="inline-flex min-h-[36px] items-center rounded-full bg-lantern-primary px-3 text-caption font-semibold text-white hover:bg-lantern-primary-dark"
          >
            Start a room
          </button>
        </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Rooms filter locally as you type; a submit there has nothing to fetch.
            if (section !== 'rooms') void load(section, query, chip);
          }}
          className="relative"
          role="search"
        >
          <AppIcon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-secondary"
            aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={
              section === 'groups'
                ? 'Search groups'
                : section === 'people'
                  ? 'Search people'
                  : section === 'rooms'
                    ? 'Search open rooms'
                    : 'Search communities'
            }
            aria-label={
              section === 'groups'
                ? 'Search groups'
                : section === 'people'
                  ? 'Search people'
                  : section === 'rooms'
                    ? 'Search open rooms'
                    : 'Search communities'
            }
            className="w-full min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 pl-9 text-body text-lantern-text placeholder:text-lantern-text-tertiary focus:border-lantern-ink focus:outline-none"
          />
        </form>

        {section === 'communities' ? (
          <div role="group" aria-label="Filter communities by kind" className="flex flex-wrap gap-2">
            {COMMUNITY_CHIPS.map((value) => (
              <KindChip key={value} active={value === chip} onClick={() => setChip(value)}>
                {communityChipLabel(value)}
              </KindChip>
            ))}
          </div>
        ) : null}
      </header>

      {/* The thing you just tapped did not happen. Never blanks the lists. */}
      {actionFailure && (
        <RequestError
          variant="banner"
          error={actionFailure.error}
          detail={actionFailure.detail}
          onRetry={() => setActionFailure(null)}
        />
      )}

      {/* A refresh failed on top of rows we already have: keep the rows. */}
      {listState === 'stale' && (
        <RequestError
          variant="banner"
          error={loadError}
          onRetry={() => void load(section, query, chip)}
        />
      )}

      {listState === 'loading' && (
        <p className="text-caption text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {/* Nothing arrived. This is the one thing that must never render as an
          empty state, so it replaces the section below entirely. */}
      {listState === 'failed' && (
        <RequestError
          variant="full"
          error={loadError}
          onRetry={() => void load(section, query, chip)}
        />
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'communities' && (
        <div className="space-y-8">
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setCreatingCommunity(true)}
              className="flex items-start gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary/70"
            >
              <FeatureDisc feature="campus" icon={<AppIcon name="add" size={16} />} size={32} />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-lantern-text">Start a community</span>
                <span className="mt-1 block text-caption text-lantern-text-secondary">
                  Name a room for a class, club, or hall.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setJoiningByCode(true)}
              className="flex items-start gap-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4 text-left hover:bg-lantern-background-secondary/70"
            >
              <FeatureDisc feature="groups" icon={<AppIcon name="link" size={16} />} size={32} />
              <span className="min-w-0">
                <span className="block text-body font-semibold text-lantern-text">Join with a link</span>
                <span className="mt-1 block text-caption text-lantern-text-secondary">
                  Use an invite code for a private room.
                </span>
              </span>
            </button>
          </div>

          <AcademicFeedPanel limit={6} heading="Happening now" hideWhenEmpty onNavigate={onNavigate} />

          {hub.showEmptyIllustration ? (
            <div className="flex items-center gap-4 rounded-2xl bg-lantern-feature-campus-tint p-4">
              <Illustration name="campus-hall" feature="campus" size={64} />
              <div className="min-w-0">
                <p className="text-body font-semibold text-lantern-feature-campus-ink">
                  Your course room is where past questions get verified
                </p>
                <p className="mt-0.5 text-caption text-lantern-text">
                  Join the room for a course you take: members mark which past questions are real,
                  and what they verify is what shows up in your tests.
                </p>
              </div>
            </div>
          ) : null}

          <section aria-label="Communities" className="space-y-8">
            {hub.empty === 'noMatch' ? (
              <EmptyState
                title={
                  loadedQuery.trim()
                    ? `No communities match “${loadedQuery.trim()}” under ${communityChipLabel(chip)}`
                    : `No ${communityChipLabel(chip)} communities yet`
                }
                hint="Try a different word, tap All, or start one."
                actions={[
                  {
                    label: 'Start a community',
                    onClick: () => setCreatingCommunity(true),
                    primary: true,
                  },
                ]}
              />
            ) : hub.empty === 'empty' ? (
              <EmptyState
                title="No other communities to join yet"
                hint="Yours are made from your university, programme and courses — add them in Profile → Academic details."
                actions={[
                  {
                    label: 'Set university & courses',
                    onClick: () => onNavigate('AcademicSetup'),
                    primary: true,
                  },
                  {
                    label: 'Start a community',
                    onClick: () => setCreatingCommunity(true),
                  },
                ]}
              />
            ) : null}
            {hub.mine.length > 0 ? (
              <>
                <div className="mb-4">
                  <h2 className="text-title font-semibold text-lantern-text">Your communities</h2>
                  <p className="mt-1 text-caption text-lantern-text-secondary">
                    Campus room first, then the ones you joined.
                  </p>
                </div>
                <div className="space-y-3">
                {hub.mine.map((row) => renderCommunityRow(row, true))}
                </div>
              </>
            ) : null}
            {hub.find.length > 0 ? (
              <>
                <div className="mb-4">
                  <h2 className="text-title font-semibold text-lantern-text">Find a community</h2>
                  <p className="mt-1 text-caption text-lantern-text-secondary">
                    Open rooms you can join from here.
                  </p>
                </div>
                <div className="space-y-3">
                {hub.find.map((row) => renderCommunityRow(row, false))}
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'groups' && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Groups">
          {groups.length === 0 && (
            <div className="sm:col-span-2">
              {listState === 'noMatch' ? (
                <EmptyState
                  title="No groups match that search"
                  hint="Groups stay private until an owner lists them. Create one and turn on Show in Discover."
                  actions={[
                    {
                      label: 'Create a study group',
                      onClick: () => onNavigate('CreateGroup'),
                      primary: true,
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No groups to discover yet"
                  hint="Groups stay private until an owner lists them on Discover. Create one and turn on Show in Discover."
                  actions={[
                    {
                      label: 'Create a study group',
                      onClick: () => onNavigate('CreateGroup'),
                      primary: true,
                    },
                  ]}
                />
              )}
            </div>
          )}
          {groups.map((group) => (
            <article key={group.id} className={card}>
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => void openOrJoinGroup(group)}
                  className="min-w-0 flex-1 text-left"
                >
                  <h2 className="text-body font-semibold text-lantern-text">{group.name}</h2>
                  <p className="mt-1 text-caption text-lantern-text-secondary">
                    {memberCountLabel(group.memberCount)}
                    {group.questionCount > 0 ? ` · ${group.questionCount} questions` : ''}
                    {group.isMember ? ' · Member' : ''}
                  </p>
                  {group.description ? (
                    <p className="mt-1 text-caption text-lantern-text-secondary line-clamp-2">{group.description}</p>
                  ) : null}
                </button>
                <button
                  type="button"
                  disabled={pendingId === group.id}
                  onClick={() => void openOrJoinGroup(group)}
                  className={`shrink-0 self-start rounded-md px-2 py-1.5 text-caption font-semibold disabled:opacity-60 ${
                    group.isMember
                      ? 'text-lantern-text-secondary hover:text-lantern-text'
                      : 'text-lantern-primary hover:bg-lantern-primary/10'
                  }`}
                >
                  {pendingId === group.id ? '…' : group.isMember ? 'Open' : 'Join'}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'people' && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="People">
          {people.length === 0 && (
            <div className="sm:col-span-2">
              {listState === 'noMatch' ? (
                <EmptyState
                  title="No people match that search"
                  hint="People appear here once they publish a study pack or question bank. Marketplace listings sit in the Market tab."
                  actions={[
                    {
                      label: 'Browse marketplace',
                      onClick: () => onNavigate('Marketplace'),
                      primary: true,
                    },
                  ]}
                />
              ) : (
                <EmptyState
                  title="No creators to show yet"
                  hint="People appear here once they publish a study pack or question bank. Marketplace listings from the same campus sit in the Market tab."
                  actions={[
                    {
                      label: 'Browse marketplace',
                      onClick: () => onNavigate('Marketplace'),
                      primary: true,
                    },
                    {
                      label: 'Go to Library',
                      onClick: () => onNavigate('Library'),
                    },
                  ]}
                />
              )}
            </div>
          )}
          {people.map((person) => {
            const chip = shouldShowTrustChip(person.trustLevel) ? trustLabel(person.trustLevel) : null;
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => onNavigate('CreatorProfile', { userId: person.id })}
                className={`${card} w-full text-left`}
              >
                <h2 className="flex items-center gap-1.5 text-body font-semibold text-lantern-text">
                  {person.name}
                  {chip ? (
                    <span className="rounded-full bg-lantern-primary/10 px-2 py-0.5 text-label tracking-normal font-medium text-lantern-primary">
                      {chip}
                    </span>
                  ) : null}
                </h2>
                <p className="mt-1 text-caption text-lantern-text-secondary">
                  {person.programme ? `${person.programme} · ` : ''}
                  {person.activePacks} {person.activePacks === 1 ? 'pack' : 'packs'} ·{' '}
                  {person.learnersHelped} helped
                </p>
              </button>
            );
          })}
        </section>
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'rooms' && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Rooms">
          {/* A failed fetch never reaches here — resolveListState routes it to
              RequestError above, because "no rooms are open" would be a guess. */}
          {visibleRooms.length === 0 && (
            <div className="sm:col-span-2">
              <EmptyState
                title={
                  listState === 'noMatch'
                    ? 'No open rooms match that search'
                    : 'No rooms are open right now'
                }
                hint="Start one above — it stays open for 24 hours, then disappears."
              />
            </div>
          )}
          {visibleRooms.map((room) => {
            const timeLeft = studyRoomTimeLeftLabel(room.startedAt, now);
            return (
              <button
                key={room.id}
                type="button"
                onClick={() => onNavigate('StudyRoom', { roomId: room.id })}
                className={`${card} w-full text-left`}
                aria-label={`${room.joined ? 'Open' : 'Join'} ${room.title}, ${room.participantCount} joined, ${timeLeft}`}
              >
                <h2 className="flex items-center justify-between gap-2 text-body font-semibold text-lantern-text">
                  <span className="truncate">{room.title}</span>
                  <span className={`text-caption font-semibold ${room.joined ? 'text-lantern-text-secondary' : 'text-lantern-primary'}`}>
                    {room.joined ? 'Open' : 'Join'}
                  </span>
                </h2>
                <p className="mt-1 text-caption text-lantern-text-secondary">
                  {/* Joined = on the roster (has not left); live presence is only
                      known inside the room, so this never claims "here". */}
                  {room.participantCount} joined · {timeLeft}
                  {room.joined ? ' · You are in' : ''}
                </p>
                {room.topic ? <p className="mt-1 text-caption text-lantern-text-tertiary">{room.topic}</p> : null}
              </button>
            );
          })}
        </section>
      )}

      <CreateCommunityModal
        isOpen={creatingCommunity}
        onClose={() => setCreatingCommunity(false)}
        onCreated={handleCommunityCreated}
      />
      <JoinByCodeModal
        isOpen={joiningByCode}
        onClose={() => setJoiningByCode(false)}
        initialCode={initialCode ?? null}
        onJoined={(community) => onNavigate('CommunityDetail', { slug: community.slug })}
      />
    </div>
  );
};

export const DiscoverScreen: React.FC<DiscoverScreenProps> = (props) => {
  const isPlatformAdmin = usePlatformAdmin();
  const currentUser = useAuthStore((s) => s.currentUser);
  if (!canOpenCommunities({ isPlatformAdmin, user: currentUser })) {
    return <DiscoverComingSoon onBack={() => props.onNavigate('Dashboard')} />;
  }
  return <DiscoverHub {...props} />;
};

export default DiscoverScreen;
