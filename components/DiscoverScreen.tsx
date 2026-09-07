import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultDiscoverSection, isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import {
  DISCOVER_SECTION_INTRO,
  SOCIAL_COMMUNITY_KINDS,
  communityKindLabel,
  communityKindMeta,
  normalizeCommunitySearch,
  communityMembershipAction,
  communityUnreadTotal,
  formatCommunityUnread,
  memberCountLabel,
  presenceLabel,
  resolveListState,
  shouldShowTrustChip,
  studyRoomTimeLeftLabel,
  trustLabel,
  type Community,
  type CommunityKind,
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
import { Illustration } from './ui';
import { useGroupStore } from '../stores/groupStore';
import DiscoverWorkspaceBar, { type DiscoverSection } from './discover/DiscoverWorkspaceBar';
import DiscoverComingSoon from './discover/DiscoverComingSoon';
import RequestError from './RequestError';
import { AppIcon } from './ui/AppIcon';
import CreateCommunityModal from './community/CreateCommunityModal';
import JoinByCodeModal from './community/JoinByCodeModal';
import { canOpenCommunities } from './community/communityAccess';
import { communityBadgeLabel } from './community/createCommunityPlan';

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
  'rounded-xl border border-lantern-border bg-lantern-background p-3 flex flex-col gap-1.5 transition-colors hover:border-lantern-primary/40';

const EmptyState: React.FC<{
  title: string;
  hint: string;
  actions?: Array<{ label: string; onClick: () => void; primary?: boolean }>;
}> = ({ title, hint, actions }) => (
  <div className="rounded-xl border border-dashed border-lantern-border p-8 text-center">
    <p className="text-sm font-medium text-lantern-text">{title}</p>
    <p className="mt-1 text-xs text-lantern-text-secondary">{hint}</p>
    {actions && actions.length > 0 ? (
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={
              action.primary
                ? 'rounded-md bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-lantern-primary-dark'
                : 'rounded-md px-3 py-1.5 text-xs font-semibold text-lantern-primary hover:bg-lantern-primary/10'
            }
          >
            {action.label}
          </button>
        ))}
      </div>
    ) : null}
  </div>
);

/** One kind filter. A pressed chip is the current filter; tapping it clears. */
const KindChip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({
  active,
  onClick,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-[36px] rounded-full px-3 text-xs font-semibold ${
      active
        ? 'bg-lantern-feature-campus-ink text-white'
        : 'bg-lantern-background-secondary text-lantern-text-secondary hover:text-lantern-text'
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
  const [kind, setKind] = useState<CommunityKind | null>(null);
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

  const myById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine]);
  const myIds = useMemo(() => new Set(mine.map((c) => c.id)), [mine]);

  const load = useCallback(
    async (target: DiscoverSection, q: string, communityKind: CommunityKind | null = null) => {
      // The marketplace tab is a navigation, not a fetch.
      if (target === 'marketplace') return;
      setStatus('loading');
      setLoadError(null);
      try {
        if (target === 'communities') {
          const [discovered, own] = await Promise.all([
            // `%` and `_` are PostgREST wildcards and `,` terminates a filter,
            // so the term goes through the shared cleaner before it is a query.
            discoverCommunities({
              q: normalizeCommunitySearch(q) ?? undefined,
              kind: communityKind ?? undefined,
            }),
            fetchMyCommunities(),
          ]);
          setCommunities(discovered);
          setMine(own);
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
    void load(section, query, kind);
    // `query` is applied through the explicit search submit below, not on every
    // keystroke — re-running this on each character would hammer the API. The
    // kind chips DO refetch on click: one tap is the whole interaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, kind, load]);

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

  // The shared rule, applied once for the whole hub: a failed load is
  // 'failed', never 'empty' and never 'noMatch'. Searching over a list that
  // never arrived says "we couldn't load it" — "no groups match that search"
  // would be a claim about data we never received.
  const listState = resolveListState({
    loading: status === 'loading',
    error: loadError,
    itemCount:
      section === 'communities'
        // Under a kind filter only the filtered list counts: "you belong to
        // three rooms" says nothing about whether any CLUB was found, and
        // counting them here is what turns an empty filter into a page that
        // silently claims everything is fine.
        ? kind
          ? communities.length
          : communities.length + mine.length
        : section === 'groups'
          ? groups.length
          : section === 'rooms'
            ? visibleRooms.length
            : people.length,
    // A kind filter is a search by another name: with no rooms of that kind
    // the honest answer is "nothing matches", never "there is nothing here".
    query: query || (section === 'communities' && kind ? communityKindMeta(kind).label : ''),
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
  // "Yours" comes from the MEMBERSHIP list itself — discover only returns
  // public, top-by-members rows, so filtering it hid real memberships and
  // (for a brand-new account) presented other campuses' communities as the
  // whole tab. `more` stays discover-sourced, deduped against memberships.
  const yours = mine;
  const more = communities.filter((c) => !myIds.has(c.id));

  // The lounge lives INSIDE the community now (founder rule §0a): the card
  // carries the unread rollup of its joined channels instead of a chat chip.
  const myGroups = useGroupStore((s) => s.groups);

  const renderCommunityCard = (community: Community) => {
    const isMember = myIds.has(community.id);
    const membership = myById.get(community.id);
    const action = communityMembershipAction(isMember, membership?.source);
    const unread = communityUnreadTotal(myGroups, community.id);
    return (
      <article key={community.id} className={card}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onNavigate('CommunityDetail', { slug: community.slug })}
            className="min-w-0 flex-1 text-left"
            aria-label={unread > 0 ? `${community.name}, ${unread} unread` : undefined}
          >
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
              <span className="truncate">{community.name}</span>
              {community.is_official ? (
                <AppIcon name="badge-check" size={16} className="shrink-0 text-lantern-primary"
                  aria-label="Official community" />
              ) : null}
              {unread > 0 ? (
                <span
                  className="bg-lantern-error-strong text-white text-label tracking-normal font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full shrink-0"
                  aria-hidden="true"
                >
                  {formatCommunityUnread(unread)}
                </span>
              ) : null}
            </h2>
            <p className="text-xs text-lantern-text-secondary">
              {/* The purpose, not "Topic" for every student-made room. */}
              {communityBadgeLabel(community.kind, community.tags, communityKindLabel)} ·{' '}
              {memberCountLabel(community.member_count)}
              {isMember ? ' · Yours' : ''}
            </p>
            {community.description ? (
              <p className="mt-1 text-xs text-lantern-text-secondary line-clamp-2">
                {community.description}
              </p>
            ) : null}
          </button>
          <button
            type="button"
            disabled={pendingId === community.id}
            onClick={() => void toggleMembership(community, isMember)}
            className={`shrink-0 self-start rounded-md px-2 py-1.5 text-xs font-semibold disabled:opacity-60 ${
              isMember
                ? 'text-lantern-text-secondary hover:text-lantern-text'
                : 'text-lantern-primary hover:bg-lantern-primary/10'
            }`}
          >
            {pendingId === community.id ? '…' : action}
          </button>
        </div>
      </article>
    );
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-3 space-y-3">
      <header className="space-y-2">
        <h1 className="sr-only">Discover</h1>
        <DiscoverWorkspaceBar active={section} onSelect={handleSection} />
        {section === 'communities' || section === 'groups' || section === 'people' || section === 'rooms' ? (
          <p className="text-[11px] text-lantern-text-tertiary">{DISCOVER_SECTION_INTRO[section]}</p>
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-lantern-background-secondary px-3 py-1.5 text-xs text-lantern-text-secondary disabled:opacity-60"
            >
              <AppIcon name="sparkles" size={16} className="text-lantern-primary" aria-hidden="true" />
              {presenceLine}
              {presence?.joinCourseId ? ' · Join room' : ''}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => onNavigate('CreateLab')}
            className="inline-flex items-center rounded-lg bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-lantern-primary-dark"
          >
            Start a room
          </button>
        </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Rooms filter locally as you type; a submit there has nothing to fetch.
            if (section !== 'rooms') void load(section, query, kind);
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
            className="w-full rounded-lg border border-lantern-border bg-lantern-background py-2 pl-9 pr-3 text-sm text-lantern-text placeholder:text-lantern-text-secondary focus:border-lantern-primary focus:outline-none"
          />
        </form>

        {/* Communities go beyond study: a club, a hostel, an event, a faith
            group. The chips are the only way a student finds those without
            already knowing the name. Academic kinds are NOT offered — they are
            derived from a profile and everyone is already in their own. */}
        {section === 'communities' ? (
          <div role="group" aria-label="Filter communities by kind" className="flex flex-wrap gap-1.5">
            <KindChip active={kind === null} onClick={() => setKind(null)}>
              All
            </KindChip>
            {SOCIAL_COMMUNITY_KINDS.filter((k) => k !== 'topic').map((k) => (
              <KindChip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                {communityKindMeta(k).label}
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
          onRetry={() => void load(section, query, kind)}
        />
      )}

      {listState === 'loading' && (
        <p className="text-sm text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {/* Nothing arrived. This is the one thing that must never render as an
          empty state, so it replaces the section below entirely. */}
      {listState === 'failed' && (
        <RequestError
          variant="full"
          error={loadError}
          onRetry={() => void load(section, query, kind)}
        />
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'communities' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setJoiningByCode(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-lantern-text-secondary hover:text-lantern-text"
            >
              <AppIcon name="link" size={16} aria-hidden="true" />
              Join with a link
            </button>
            <button
              type="button"
              onClick={() => setCreatingCommunity(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-lantern-primary hover:underline"
            >
              <AppIcon name="add" size={16} aria-hidden="true" />
              Start a community
            </button>
          </div>

          {/* Campus coaching card (§5.7 Campus): one violet panel, shown only
              while the student has joined nothing. It is not an empty state —
              the list below it may be full — so it says what a course room is
              FOR rather than that something is missing, and it disappears the
              moment they join one. */}
          {yours.length === 0 && listState !== 'noMatch' ? (
            <div className="flex items-center gap-4 rounded-xl bg-lantern-feature-campus-tint p-4">
              <Illustration name="campus-hall" feature="campus" size={64} />
              <div className="min-w-0">
                <p className="text-body font-semibold text-lantern-feature-campus-ink">
                  Your course room is where past questions get verified
                </p>
                <p className="mt-0.5 text-caption text-lantern-text">
                  Join the room for a course you take: the questions other students have sat, marked
                  up by the people who sat them.
                </p>
              </div>
            </div>
          ) : null}

          <section className="grid gap-2 sm:grid-cols-2" aria-label="Communities">
            {communities.length === 0 && (
              <div className="sm:col-span-2">
                {listState === 'noMatch' ? (
                  <EmptyState
                    title="No communities match that search"
                    hint="Try another name, or start a community — a course, a club, a hostel, a week of events."
                    actions={[
                      {
                        label: 'Start a community',
                        onClick: () => setCreatingCommunity(true),
                        primary: true,
                      },
                    ]}
                  />
                ) : (
                  <EmptyState
                    title="No communities yet"
                    hint="Add your university and courses so campus rooms can appear — or start one yourself: a course, a club, a hostel, a week of events."
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
                )}
              </div>
            )}
            {yours.length > 0 ? (
              <>
                <h2 className="sm:col-span-2 text-label font-semibold uppercase tracking-wide text-lantern-text-secondary">
                  Yours
                </h2>
                {yours.map(renderCommunityCard)}
              </>
            ) : null}
            {more.length > 0 ? (
              <>
                <h2 className="sm:col-span-2 text-label font-semibold uppercase tracking-wide text-lantern-text-secondary">
                  {yours.length > 0 ? 'More to join' : 'On Discover'}
                </h2>
                {more.map(renderCommunityCard)}
              </>
            ) : null}
          </section>
        </div>
      )}

      {listState !== 'loading' && listState !== 'failed' && section === 'groups' && (
        <section className="grid gap-2 sm:grid-cols-2" aria-label="Groups">
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
                  <h2 className="text-sm font-semibold text-lantern-text">{group.name}</h2>
                  <p className="text-xs text-lantern-text-secondary">
                    {memberCountLabel(group.memberCount)}
                    {group.questionCount > 0 ? ` · ${group.questionCount} questions` : ''}
                    {group.isMember ? ' · Member' : ''}
                  </p>
                  {group.description ? (
                    <p className="text-xs text-lantern-text-secondary line-clamp-2">{group.description}</p>
                  ) : null}
                </button>
                <button
                  type="button"
                  disabled={pendingId === group.id}
                  onClick={() => void openOrJoinGroup(group)}
                  className={`shrink-0 self-start rounded-md px-2 py-1.5 text-xs font-semibold disabled:opacity-60 ${
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
        <section className="grid gap-2 sm:grid-cols-2" aria-label="People">
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
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
                  {person.name}
                  {chip ? (
                    <span className="rounded-full bg-lantern-primary/10 px-2 py-0.5 text-label tracking-normal font-medium text-lantern-primary">
                      {chip}
                    </span>
                  ) : null}
                </h2>
                <p className="text-xs text-lantern-text-secondary">
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
        <section className="grid gap-2 sm:grid-cols-2" aria-label="Rooms">
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
                <h2 className="flex items-center justify-between gap-2 text-sm font-semibold text-lantern-text">
                  <span className="truncate">{room.title}</span>
                  <span className={`text-xs font-semibold ${room.joined ? 'text-lantern-text-secondary' : 'text-lantern-primary'}`}>
                    {room.joined ? 'Open' : 'Join'}
                  </span>
                </h2>
                <p className="text-xs text-lantern-text-secondary">
                  {/* Joined = on the roster (has not left); live presence is only
                      known inside the room, so this never claims "here". */}
                  {room.participantCount} joined · {timeLeft}
                  {room.joined ? ' · You are in' : ''}
                </p>
                {room.topic ? <p className="text-xs text-lantern-text-tertiary">{room.topic}</p> : null}
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
