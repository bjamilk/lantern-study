import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  MagnifyingGlassIcon,
  CheckBadgeIcon,
  SparklesIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
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
} from '../services/supabase';
import DiscoverWorkspaceBar, { type DiscoverSection } from './discover/DiscoverWorkspaceBar';

/**
 * The Discover hub (Phase 3 · L).
 *
 * Decision D12: this replaces "Explore" as the sidebar destination, with the
 * marketplace nested as one of its tabs. Communities / Groups / People are
 * served by /discover/*, which is deliberately separate from GET /groups
 * (memberships-only, cached per user).
 */
export interface DiscoverScreenProps {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  initialSection?: DiscoverSection;
}

type Status = 'idle' | 'loading' | 'error';

const card =
  'rounded-xl border border-lantern-border bg-lantern-background p-4 flex flex-col gap-2 transition-colors hover:border-lantern-primary/40';

const EmptyState: React.FC<{ title: string; hint: string }> = ({ title, hint }) => (
  <div className="rounded-xl border border-dashed border-lantern-border p-8 text-center">
    <p className="text-sm font-medium text-lantern-text">{title}</p>
    <p className="mt-1 text-xs text-lantern-text-secondary">{hint}</p>
  </div>
);

export const DiscoverScreen: React.FC<DiscoverScreenProps> = ({
  onNavigate,
  initialSection = 'communities',
}) => {
  const [section, setSection] = useState<DiscoverSection>(initialSection);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);

  const [mine, setMine] = useState<MyCommunity[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [people, setPeople] = useState<DiscoverPerson[]>([]);
  const [presence, setPresence] = useState<PresenceSnapshot | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

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
        } else {
          setPeople(await discoverPeople({}));
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
    setSection(next);
  };

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

  const presenceLine = presenceLabel(presence);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 space-y-5">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold text-lantern-text">Discover</h1>
          <p className="text-sm text-lantern-text-secondary">
            Your campus, your courses, and the people studying them.
          </p>
        </div>

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
            className="inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-semibold text-lantern-primary hover:underline"
          >
            Start a room
          </button>
        </div>

        <DiscoverWorkspaceBar active={section} onSelect={handleSection} />

        {section !== 'people' && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void load(section, query);
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
              placeholder={section === 'groups' ? 'Search groups' : 'Search communities'}
              aria-label={section === 'groups' ? 'Search groups' : 'Search communities'}
              className="w-full rounded-lg border border-lantern-border bg-lantern-background py-2 pl-9 pr-3 text-sm text-lantern-text placeholder:text-lantern-text-secondary focus:border-lantern-primary focus:outline-none"
            />
          </form>
        )}
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
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Communities">
          {communities.length === 0 && (
            <div className="sm:col-span-2">
              <EmptyState
                title="No communities yet"
                hint="Set your university, programme and courses in your profile — your campus communities are created from them."
              />
            </div>
          )}
          {communities.map((community) => {
            const isMember = myIds.has(community.id);
            return (
              <article key={community.id} className={card}>
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onNavigate('CommunityDetail', { slug: community.slug })}
                    className="text-left"
                  >
                    <h2 className="text-sm font-semibold text-lantern-text">{community.name}</h2>
                    <p className="text-xs text-lantern-text-secondary">
                      {communityKindLabel(community.kind)} · {memberCountLabel(community.member_count)}
                    </p>
                  </button>
                  {community.is_official && (
                    <CheckBadgeIcon
                      className="h-4 w-4 shrink-0 text-lantern-primary"
                      aria-label="Official community"
                    />
                  )}
                </div>
                {community.description && (
                  <p className="text-xs text-lantern-text-secondary line-clamp-2">
                    {community.description}
                  </p>
                )}
                <button
                  type="button"
                  disabled={pendingId === community.id}
                  onClick={() => void toggleMembership(community, isMember)}
                  className={`mt-1 h-9 min-h-[44px] rounded-lg px-3 text-xs font-medium sm:min-h-[36px] ${
                    isMember
                      ? 'bg-lantern-background-secondary text-lantern-text-secondary'
                      : 'bg-lantern-primary text-white'
                  } disabled:opacity-60`}
                >
                  {pendingId === community.id ? 'Working…' : isMember ? 'Leave' : 'Join'}
                </button>
              </article>
            );
          })}
        </section>
      )}

      {status !== 'loading' && section === 'groups' && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="Groups">
          {groups.length === 0 && (
            <div className="sm:col-span-2">
              <EmptyState
                title="No groups to discover yet"
                hint="Groups are private by default. A group owner can make one discoverable to their community."
              />
            </div>
          )}
          {groups.map((group) => (
            <article key={group.id} className={card}>
              <h2 className="text-sm font-semibold text-lantern-text">{group.name}</h2>
              <p className="text-xs text-lantern-text-secondary">
                {memberCountLabel(group.memberCount)}
                {group.questionCount > 0 ? ` · ${group.questionCount} questions` : ''}
              </p>
              {group.description && (
                <p className="text-xs text-lantern-text-secondary line-clamp-2">{group.description}</p>
              )}
              <button
                type="button"
                onClick={() => onNavigate('GroupChat', { groupId: group.id })}
                className="mt-1 h-9 min-h-[44px] rounded-lg bg-lantern-background-secondary px-3 text-xs font-medium text-lantern-text sm:min-h-[36px]"
              >
                {group.isMember ? 'Open' : 'View'}
              </button>
            </article>
          ))}
        </section>
      )}

      {status !== 'loading' && section === 'people' && (
        <section className="grid gap-3 sm:grid-cols-2" aria-label="People">
          {people.length === 0 && (
            <div className="sm:col-span-2">
              <EmptyState
                title="No creators to show yet"
                hint="People appear here once they publish a study pack or question bank."
              />
            </div>
          )}
          {people.map((person) => {
            const chip = shouldShowTrustChip(person.trustLevel) ? trustLabel(person.trustLevel) : null;
            return (
              <article key={person.id} className={card}>
                <button
                  type="button"
                  onClick={() => onNavigate('CreatorProfile', { userId: person.id })}
                  className="text-left"
                >
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-lantern-text">
                    {person.name}
                    {chip && (
                      <span className="rounded-full bg-lantern-primary/10 px-2 py-0.5 text-[10px] font-medium text-lantern-primary">
                        {chip}
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-lantern-text-secondary">
                    {person.programme ? `${person.programme} · ` : ''}
                    {person.activePacks} {person.activePacks === 1 ? 'pack' : 'packs'} ·{' '}
                    {person.learnersHelped} helped
                  </p>
                </button>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
};

export default DiscoverScreen;
