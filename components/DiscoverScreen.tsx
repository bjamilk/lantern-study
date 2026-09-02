import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { defaultDiscoverSection, isDiscoverSectionEnabled } from '@lantern/shared/marketplace';
import {
  MagnifyingGlassIcon,
  ChatBubbleLeftRightIcon,
  CheckBadgeIcon,
  ArrowPathIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import {
  DISCOVER_SECTION_INTRO,
  canAccessDiscoverHub,
  communityKindLabel,
  communityMembershipAction,
  memberCountLabel,
  presenceLabel,
  shouldShowTrustChip,
  studyRoomTimeLeftLabel,
  trustLabel,
  type Community,
  type DiscoverGroup,
  type DiscoverPerson,
  type MyCommunity,
  type PresenceSnapshot,
  type StudyRoomListItem,
} from '@lantern/shared/network';
import {
  createCommunity,
  discoverCommunities,
  openCommunityLounge,
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
import DiscoverWorkspaceBar, { type DiscoverSection } from './discover/DiscoverWorkspaceBar';
import DiscoverComingSoon from './discover/DiscoverComingSoon';

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

const DiscoverHub: React.FC<DiscoverScreenProps> = ({
  onNavigate,
  initialSection,
}) => {
  // Same rule as mobile: never open on a section that is switched off.
  const [section, setSection] = useState<DiscoverSection>(() =>
    initialSection && isDiscoverSectionEnabled(initialSection)
      ? initialSection
      : (defaultDiscoverSection() as DiscoverSection),
  );
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const [mine, setMine] = useState<MyCommunity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [rooms, setRooms] = useState<StudyRoomListItem[]>([]);
  // "Closes in Xh" ticks once a minute while the Room tab is open.
  const [now, setNow] = useState(() => Date.now());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createBusy, setCreateBusy] = useState(false);

  const myById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine]);
  const myIds = useMemo(() => new Set(mine.map((c) => c.id)), [mine]);

  const load = useCallback(
    async (target: DiscoverSection, q: string) => {
      // The marketplace tab is a navigation, not a fetch.
      if (target === 'marketplace') return;
      setStatus('loading');
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
          // Open rooms only, capped server-side; the search box filters
          // locally instead of round-tripping (same as mobile).
          setRooms(await listStudyRooms());
        } else {
          setPeople(await discoverPeople({ q: q || undefined }));
        }
        setStatus('idle');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load Discover');
        setStatus('error');
      }
    },
    []
  );

  useEffect(() => {
    void load(section, query);
    // `query` is applied through the explicit search submit below, not on every
    // keystroke — re-running this on each character would hammer the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, load]);

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
      setError(err instanceof Error ? err.message : 'Could not update membership');
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
      setError(err instanceof Error ? err.message : 'Could not join this group');
    } finally {
      setPendingId(null);
    }
  };

  const submitCommunity = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name.length < 3) {
      setError('Name a community in at least 3 characters');
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
      setMine((prev) => [
        { ...created, role: 'admin', source: 'joined' } as MyCommunity,
        ...prev.filter((c) => c.id !== created.id),
      ]);
      setCommunities((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
      onNavigate('CommunityDetail', { slug: created.slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create this community');
    } finally {
      setCreateBusy(false);
    }
  };

  const presenceLine = presenceLabel(presence);
  // "Yours" comes from the MEMBERSHIP list itself — discover only returns
  // public, top-by-members rows, so filtering it hid real memberships and
  // (for a brand-new account) presented other campuses' communities as the
  // whole tab. `more` stays discover-sourced, deduped against memberships.
  const yours = mine;
  const more = communities.filter((c) => !myIds.has(c.id));

  const [loungePendingId, setLoungePendingId] = useState<string | null>(null);
  const openLounge = async (community: Community) => {
    if (loungePendingId) return;
    setLoungePendingId(community.id);
    try {
      const lounge = await openCommunityLounge(community.id);
      onNavigate('GroupChat', { groupId: lounge.groupId, groupName: lounge.name, joined: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the community chat');
    } finally {
      setLoungePendingId(null);
    }
  };

  const renderCommunityCard = (community: Community) => {
    const isMember = myIds.has(community.id);
    const membership = myById.get(community.id);
    const action = communityMembershipAction(isMember, membership?.source);
    return (
      <article key={community.id} className={card}>
        <div className="flex items-start gap-2">
          <button
            type="button"
            onClick={() => onNavigate('CommunityDetail', { slug: community.slug })}
            className="min-w-0 flex-1 text-left"
          >
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
              <span className="truncate">{community.name}</span>
              {community.is_official ? (
                <CheckBadgeIcon
                  className="h-4 w-4 shrink-0 text-lantern-primary"
                  aria-label="Official community"
                />
              ) : null}
            </h2>
            <p className="text-xs text-lantern-text-secondary">
              {communityKindLabel(community.kind)} · {memberCountLabel(community.member_count)}
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
        {isMember ? (
          <button
            type="button"
            onClick={() => void openLounge(community)}
            disabled={loungePendingId === community.id}
            className="self-start rounded-full bg-lantern-primary/10 px-2.5 py-1.5 text-[11px] font-semibold text-lantern-primary hover:bg-lantern-primary/20 disabled:opacity-60"
          >
            <ChatBubbleLeftRightIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            {loungePendingId === community.id ? 'Opening…' : 'Community chat'}
          </button>
        ) : null}
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
              <SparklesIcon className="h-4 w-4 text-lantern-primary" aria-hidden="true" />
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
            if (section !== 'rooms') void load(section, query);
          }}
          className="relative"
          role="search"
        >
          <MagnifyingGlassIcon
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-lantern-text-secondary"
            aria-hidden="true"
          />
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
      </header>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load(section, query)}
            className="inline-flex items-center gap-1 text-xs font-medium underline"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}

      {status === 'loading' && (
        <p className="text-sm text-lantern-text-secondary" role="status">
          Loading…
        </p>
      )}

      {status !== 'loading' && section === 'communities' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setCreatingCommunity((open) => !open)}
              className="text-xs font-semibold text-lantern-primary hover:underline"
            >
              {creatingCommunity ? 'Cancel' : 'Start an interest community'}
            </button>
          </div>
          {creatingCommunity ? (
            <form
              onSubmit={(event) => void submitCommunity(event)}
              className="rounded-xl border border-lantern-border bg-lantern-background p-3 space-y-2"
            >
              <p className="text-xs text-lantern-text-secondary">
                Interest communities are for topics anyone can join — campus rooms still come from
                your university and courses.
              </p>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="Name (e.g. Past questions)"
                aria-label="Community name"
                className="w-full rounded-md border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
                required
                minLength={3}
                maxLength={60}
              />
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Optional description"
                aria-label="Community description"
                rows={2}
                className="w-full rounded-md border border-lantern-border bg-lantern-surface px-3 py-2 text-sm text-lantern-text"
              />
              <button
                type="submit"
                disabled={createBusy}
                className="rounded-md bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
              >
                {createBusy ? 'Creating…' : 'Create community'}
              </button>
            </form>
          ) : null}

          <section className="grid gap-2 sm:grid-cols-2" aria-label="Communities">
            {communities.length === 0 && (
              <div className="sm:col-span-2">
                {query.trim() ? (
                  <EmptyState
                    title="No communities match that search"
                    hint="Try another name, or start an interest community for the topic you study."
                    actions={[
                      {
                        label: 'Start an interest community',
                        onClick: () => setCreatingCommunity(true),
                        primary: true,
                      },
                    ]}
                  />
                ) : (
                  <EmptyState
                    title="No communities yet"
                    hint="Add your university and courses so campus rooms can appear — or start an interest community for a topic you study."
                    actions={[
                      {
                        label: 'Set university & courses',
                        onClick: () => onNavigate('AcademicSetup'),
                        primary: true,
                      },
                      {
                        label: 'Start an interest community',
                        onClick: () => setCreatingCommunity(true),
                      },
                    ]}
                  />
                )}
              </div>
            )}
            {yours.length > 0 ? (
              <>
                <h2 className="sm:col-span-2 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
                  Yours
                </h2>
                {yours.map(renderCommunityCard)}
              </>
            ) : null}
            {more.length > 0 ? (
              <>
                <h2 className="sm:col-span-2 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
                  {yours.length > 0 ? 'More to join' : 'On Discover'}
                </h2>
                {more.map(renderCommunityCard)}
              </>
            ) : null}
          </section>
        </div>
      )}

      {status !== 'loading' && section === 'groups' && (
        <section className="grid gap-2 sm:grid-cols-2" aria-label="Groups">
          {groups.length === 0 && (
            <div className="sm:col-span-2">
              {query.trim() ? (
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

      {status !== 'loading' && section === 'people' && (
        <section className="grid gap-2 sm:grid-cols-2" aria-label="People">
          {people.length === 0 && (
            <div className="sm:col-span-2">
              {query.trim() ? (
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
                    <span className="rounded-full bg-lantern-primary/10 px-2 py-0.5 text-[10px] font-medium text-lantern-primary">
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

      {status !== 'loading' && section === 'rooms' && (
        <section className="grid gap-2 sm:grid-cols-2" aria-label="Rooms">
          {visibleRooms.length === 0 && !error && (
            <div className="sm:col-span-2">
              <EmptyState
                title={query.trim() ? 'No open rooms match that search' : 'No rooms are open right now'}
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
    </div>
  );
};

export const DiscoverScreen: React.FC<DiscoverScreenProps> = (props) => {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return <DiscoverComingSoon onBack={() => props.onNavigate('Dashboard')} />;
  }
  return <DiscoverHub {...props} />;
};

export default DiscoverScreen;
