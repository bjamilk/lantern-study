import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckBadgeIcon, LinkIcon, SparklesIcon } from '@heroicons/react/24/outline';
import {
  COMMUNITY_COPY,
  canAccessDiscoverHub,
  communityHeaderLine,
  communityMembershipAction,
  communityOnlineCount,
  presenceLabel,
  type PresenceSnapshot,
} from '@lantern/shared/network';
import { fetchStudyPresence, joinCommunity, leaveCommunity } from '../services/supabase';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useCommunityStore } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import DiscoverComingSoon from './discover/DiscoverComingSoon';
import CommunityChannelList from './community/CommunityChannelList';
import CommunityMembersPanel from './community/CommunityMembersPanel';
import CommunityTile from './community/CommunityTile';
import {
  copyCommunityInvite,
  useCommunityListActions,
  type CommunityNavigate,
} from './community/communityNavigation';

/**
 * The community home (spec §5.5; `AppMode.COMMUNITY_DETAIL` without a
 * channel). A community is a server: this page is its header, its channel
 * list (inline below md — the column carries it at md+) and its roster.
 * Every action goes through the same `onNavigate` contract the column uses,
 * so nothing here ever leaves the community surface (founder rule §0a).
 */
export interface CommunityDetailScreenProps {
  slug: string;
  onBack: () => void;
  onNavigate?: CommunityNavigate;
}

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();
const DESCRIPTION_CLAMP_CHARS = 160;

const CommunityDetailHub: React.FC<CommunityDetailScreenProps> = ({ slug, onBack, onNavigate }) => {
  const navigate: CommunityNavigate = onNavigate ?? (() => undefined);
  const detail = useCommunityStore((s) => s.detailBySlug[slug]);
  const payload = useCommunityStore((s) => (detail ? s.channelsById[detail.id] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadChannels = useCommunityStore((s) => s.loadChannels);
  const invalidate = useCommunityStore((s) => s.invalidate);
  const setActiveCommunity = useUIStore((s) => s.setActiveCommunity);
  const presence = useUIStore((s) => s.communityPresence);
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const groups = useGroupStore((s) => s.groups);
  const showToast = useToastStore((s) => s.showToast);

  const [loading, setLoading] = useState(!detail);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [studyPresence, setStudyPresence] = useState<PresenceSnapshot | null>(null);

  // Bumped on unmount and on every new run, so a slow response from a
  // community the user has already left writes nothing.
  const loadRunRef = useRef(0);

  const load = useCallback(async () => {
    const run = ++loadRunRef.current;
    const stale = () => loadRunRef.current !== run;
    setError(null);
    try {
      const d = await loadCommunity(slug);
      if (stale()) return;
      const current = useUIStore.getState().activeCommunity;
      // Only ever refine THIS community's placeholder. If the store has moved
      // on to a different slug, a late response must be ignored — writing it
      // would leave the column, its label and the presence channel on one
      // community while the page and the URL are on another.
      if (
        current?.slug === slug &&
        (current.id !== d.id ||
          current.name !== d.name ||
          current.loungeGroupId !== d.lounge_group_id)
      ) {
        setActiveCommunity({ id: d.id, slug, name: d.name, loungeGroupId: d.lounge_group_id });
      }
      await loadChannels(d.id);
    } catch (err) {
      if (stale()) return;
      setError(err instanceof Error ? err.message : 'Community not found');
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [slug, loadCommunity, loadChannels, setActiveCommunity]);

  useEffect(() => {
    void load();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      loadRunRef.current += 1;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  // `invalidate` drops the cached payload (join/leave, new channel, lounge
  // mint) — fetch it again without blanking the header.
  useEffect(() => {
    if (!detail || payload || error) return;
    void loadChannels(detail.id).catch(() => {});
  }, [detail, payload, error, loadChannels]);

  // Course communities: the who-is-studying line the hub already shows.
  const courseId = detail?.course_id ?? null;
  useEffect(() => {
    if (!courseId || lowDataMode) {
      setStudyPresence(null);
      return;
    }
    let cancelled = false;
    void fetchStudyPresence({ courseId })
      .then((snapshot) => {
        if (!cancelled) setStudyPresence(snapshot);
      })
      .catch(() => {
        if (!cancelled) setStudyPresence(null);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, lowDataMode]);

  const { actions, pendingId } = useCommunityListActions(detail, navigate);

  const toggleMembership = async () => {
    if (!detail || pending) return;
    setPending(true);
    try {
      if (detail.isMember) await leaveCommunity(detail.id);
      else await joinCommunity(detail.id);
      invalidate(detail.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update membership');
    } finally {
      setPending(false);
    }
  };

  const copyInvite = async () => {
    if (!detail) return;
    const ok = await copyCommunityInvite(detail.slug);
    showToast(ok ? COMMUNITY_COPY.inviteCopied : 'Could not copy the link', ok ? 'success' : 'error');
  };

  const onlineIds = useMemo<ReadonlySet<string>>(
    () =>
      detail && presence && presence.communityId === detail.id ? new Set(presence.onlineIds) : EMPTY_IDS,
    [presence, detail]
  );
  const connected = !!detail && presence?.communityId === detail.id && presence.connected;
  const memberCount = payload?.memberCount ?? detail?.member_count ?? 0;
  const onlineShown = detail?.isMember
    ? communityOnlineCount(payload?.onlineCount ?? detail.onlineCount ?? 0, onlineIds, connected)
    : 0;
  const studyLine = presenceLabel(studyPresence);

  if (loading && !detail) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-lantern-text-secondary" role="status">
        Loading…
      </div>
    );
  }

  const description = detail?.description ?? '';
  const clampable = description.length > DESCRIPTION_CLAMP_CHARS;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5 overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] text-sm text-lantern-text-secondary hover:text-lantern-text sm:min-h-0"
      >
        ← Discover
      </button>

      {error && (
        <p
          className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      )}

      {detail && (
        <>
          <header className="flex items-start gap-4">
            <CommunityTile name={detail.name} size="lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start gap-2">
                <h1 className="text-2xl font-semibold text-lantern-text" style={{ textWrap: 'balance' }}>
                  {detail.name}
                </h1>
                {detail.is_official && (
                  <CheckBadgeIcon
                    className="mt-1.5 h-5 w-5 shrink-0 text-lantern-primary"
                    aria-label="Official community"
                  />
                )}
              </div>
              <p className="text-xs text-lantern-text-tertiary">
                {communityHeaderLine(detail.kind, memberCount, onlineShown)}
              </p>
              {description ? (
                <div>
                  <p
                    className={`max-w-[60ch] text-sm text-lantern-text-secondary ${
                      clampable && !descriptionOpen ? 'line-clamp-2' : ''
                    }`}
                  >
                    {description}
                  </p>
                  {clampable ? (
                    <button
                      type="button"
                      onClick={() => setDescriptionOpen((open) => !open)}
                      aria-expanded={descriptionOpen}
                      className="mt-0.5 min-h-[44px] text-xs font-semibold text-lantern-primary hover:underline sm:min-h-0"
                    >
                      {descriptionOpen ? 'Less' : 'More'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {studyLine ? (
                <p className="inline-flex items-center gap-1.5 text-xs text-lantern-text-secondary">
                  <SparklesIcon className="h-4 w-4 text-lantern-primary" aria-hidden="true" />
                  {studyLine}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMembership()}
                  disabled={pending}
                  className={`h-9 min-h-[44px] rounded-lg px-4 text-sm font-medium sm:min-h-[36px] ${
                    detail.isMember
                      ? 'bg-lantern-background-secondary text-lantern-text-secondary'
                      : 'bg-lantern-primary text-white'
                  } disabled:opacity-60`}
                >
                  {pending ? 'Working…' : communityMembershipAction(detail.isMember, detail.source)}
                </button>
                {detail.isMember && detail.visibility === 'public' ? (
                  <button
                    type="button"
                    onClick={() => void copyInvite()}
                    className="inline-flex h-9 min-h-[44px] items-center gap-1.5 rounded-lg bg-lantern-primary/10 px-4 text-sm font-semibold text-lantern-primary hover:bg-lantern-primary/20 sm:min-h-[36px]"
                  >
                    <LinkIcon className="h-4 w-4" aria-hidden="true" />
                    {COMMUNITY_COPY.invite}
                  </button>
                ) : null}
              </div>
              {!detail.isMember ? (
                <p className="text-xs text-lantern-text-secondary">{COMMUNITY_COPY.joinToSeeMembers}</p>
              ) : null}
            </div>
          </header>

          {/* Below md there is no column: the channel list lives on the page. */}
          <section className="md:hidden" aria-label="Channels">
            {payload && actions ? (
              <CommunityChannelList
                payload={payload}
                groups={groups}
                pendingId={pendingId}
                onOpenLounge={actions.onOpenLounge}
                onOpenChannel={actions.onOpenChannel}
                onJoinChannel={actions.onJoinChannel}
                onOpenRoom={actions.onOpenRoom}
                onCreateChannel={actions.onCreateChannel}
                onStartRoom={actions.onStartRoom}
                onOpenMembers={actions.onOpenMembers}
              />
            ) : (
              <p className="text-xs text-lantern-text-secondary" role="status">
                Loading…
              </p>
            )}
          </section>

          <section id="community-members" aria-label="Members" className="scroll-mt-4 space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
              {COMMUNITY_COPY.sectionMembers} · {memberCount.toLocaleString()}
            </h2>
            {detail.isMember ? (
              <CommunityMembersPanel communityId={detail.id} />
            ) : (
              <p className="text-xs text-lantern-text-secondary">{COMMUNITY_COPY.joinToSeeMembers}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export const CommunityDetailScreen: React.FC<CommunityDetailScreenProps> = (props) => {
  const isPlatformAdmin = usePlatformAdmin();
  if (!canAccessDiscoverHub(isPlatformAdmin)) {
    return (
      <DiscoverComingSoon
        onBack={() => {
          if (props.onNavigate) void props.onNavigate('Dashboard');
          else props.onBack();
        }}
      />
    );
  }
  return <CommunityDetailHub {...props} />;
};

export default CommunityDetailScreen;
