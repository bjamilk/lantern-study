import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppIcon } from './ui/AppIcon';
import {
  COMMUNITY_COPY,
  COMMUNITY_HOME_COPY,
  buildCommunityHomeActivity,
  communityHeaderMeta,
  communityMembershipAction,
  communityOnlineCount,
  presenceLabel,
  type PresenceSnapshot,
} from '@lantern/shared/network';
import { fetchStudyPresence, joinCommunity, leaveCommunity } from '../services/supabase';
import { usePlatformAdmin } from '../hooks/usePlatformAdmin';
import { useAuthStore } from '../stores/authStore';
import { useCommunityStore } from '../stores/communityStore';
import { useGroupStore } from '../stores/groupStore';
import { useToastStore } from '../stores/toastStore';
import { useUIStore } from '../stores/uiStore';
import DiscoverComingSoon from './discover/DiscoverComingSoon';
import RequestError from './RequestError';
import CommunityChannelList from './community/CommunityChannelList';
import ManageCommunityPanel from './community/ManageCommunityPanel';
import CommunityMembersPanel from './community/CommunityMembersPanel';
import CommunityTile from './community/CommunityTile';
import { canOpenCommunities } from './community/communityAccess';
import {
  copyCommunityInvite,
  useCommunityListActions,
  type CommunityNavigate,
} from './community/communityNavigation';
import {
  communityManageCapabilities,
  hasCommunityManagePowers,
} from './community/manageCommunity';
import { Menu, MenuContent, MenuItem, MenuTrigger } from './ui';

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
  const currentUserId = useAuthStore((s) => s.currentUser?.id ?? null);

  const [loading, setLoading] = useState(!detail);
  // `loadError` is "this community did not arrive" — with nothing on screen
  // it becomes the full failure surface instead of one line of red text over a
  // blank page. `actionFailure` is "the thing you tapped did not happen".
  const [loadError, setLoadError] = useState<unknown>(null);
  const [actionFailure, setActionFailure] = useState<{ error: unknown; detail: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [studyPresence, setStudyPresence] = useState<PresenceSnapshot | null>(null);
  const isPlatformAdmin = usePlatformAdmin();

  // Bumped on unmount and on every new run, so a slow response from a
  // community the user has already left writes nothing.
  const loadRunRef = useRef(0);

  const load = useCallback(async () => {
    const run = ++loadRunRef.current;
    const stale = () => loadRunRef.current !== run;
    setLoadError(null);
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
      // Kept raw: RequestError classifies it, so a 404 reads as "we couldn't
      // find this" while a dropped connection reads as a connection problem.
      // The two used to collapse into one "Community not found", which blamed
      // the link for what was usually a network failure.
      setLoadError(err);
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
    if (!detail || payload || loadError) return;
    void loadChannels(detail.id).catch(() => {});
  }, [detail, payload, loadError, loadChannels]);

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
  const activity = useMemo(
    () => (payload ? buildCommunityHomeActivity(payload) : []),
    [payload],
  );
  const canManage = !!(
    detail &&
    currentUserId &&
    hasCommunityManagePowers(
      communityManageCapabilities({
        viewer: {
          userId: currentUserId,
          role: detail.viewerRole,
          isPlatformAdmin,
        },
        isMember: detail.isMember,
        visibility: detail.visibility,
      }),
    )
  );
  const toggleMembership = async () => {
    if (!detail || pending) return;
    setPending(true);
    try {
      if (detail.isMember) await leaveCommunity(detail.id);
      else await joinCommunity(detail.id);
      invalidate(detail.id);
      await load();
    } catch (err) {
      setActionFailure({
        error: err,
        detail: 'Your membership wasn’t changed. Check your connection and try again.',
      });
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
  const headerMeta = communityHeaderMeta(
    detail ?? { kind: 'general', tags: [] },
    memberCount,
    onlineShown,
  );
  const eventWhen = detail?.starts_at ? new Date(detail.starts_at).toLocaleString() : null;
  const eventWhere = detail?.location?.trim() || null;

  if (loading && !detail) {
    return (
      <div className="mx-auto max-w-3xl px-4 md:px-6 py-10 text-caption text-lantern-text-secondary" role="status">
        Loading…
      </div>
    );
  }

  const description = detail?.description ?? '';
  const clampable = description.length > DESCRIPTION_CLAMP_CHARS;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 md:px-6 lg:px-8 py-6 space-y-6 overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] text-caption text-lantern-text-secondary hover:text-lantern-text sm:min-h-0"
      >
        ← Campus
      </button>

      {/* Nothing arrived: say so once, in the shared vocabulary, with a real
          retry — not a red line over an otherwise blank page. */}
      {loadError && !detail && (
        <RequestError variant="full" error={loadError} onRetry={() => void load()} onBack={onBack} />
      )}

      {/* The header is already on screen, so the failure banners over it. */}
      {loadError && detail && (
        <RequestError variant="banner" error={loadError} onRetry={() => void load()} />
      )}

      {actionFailure && (
        <RequestError
          variant="banner"
          error={actionFailure.error}
          detail={actionFailure.detail}
          onRetry={() => setActionFailure(null)}
        />
      )}

      {detail && (
        <>
          <header className="flex items-start gap-4">
            <CommunityTile name={detail.name} size="lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-start gap-2">
                <h1 className="text-title text-lantern-text" style={{ textWrap: 'balance' }}>
                  {detail.name}
                </h1>
                {detail.is_official && (
                  <AppIcon
                    name="badge-check"
                    size={20}
                    className="mt-1.5 shrink-0 text-lantern-primary"
                    aria-label="Official community"
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* The kind badge: a hostel, a fellowship and a rag week all
                    say "Topic" without it. */}
                <span className="rounded-full bg-lantern-feature-campus-tint px-2 py-0.5 text-label font-semibold text-lantern-feature-campus-ink">
                  {headerMeta.label}
                </span>
                <p className="text-caption text-lantern-text-tertiary">{headerMeta.line}</p>
                {detail.isMember && (canManage || detail.visibility === 'public') ? (
                  <Menu>
                    <MenuTrigger
                      aria-label="More actions"
                      className="inline-flex h-9 min-h-[44px] items-center rounded-lg px-2 text-lantern-text-secondary hover:bg-lantern-background-secondary sm:min-h-[36px]"
                    >
                      <AppIcon name="ellipsis-horizontal" size={18} />
                    </MenuTrigger>
                    <MenuContent>
                      {detail.visibility === 'public' ? (
                        <MenuItem onSelect={() => void copyInvite()}>
                          {COMMUNITY_COPY.invite}
                        </MenuItem>
                      ) : null}
                      {canManage ? (
                        <MenuItem onSelect={() => setManageOpen((open) => !open)}>
                          {manageOpen ? 'Hide manage' : 'Manage'}
                        </MenuItem>
                      ) : null}
                    </MenuContent>
                  </Menu>
                ) : null}
              </div>
              {description ? (
                <div>
                  <p
                    className={`max-w-[60ch] text-body text-lantern-text-secondary ${
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
                      className="mt-1 min-h-[44px] text-caption font-semibold text-lantern-primary-text hover:underline sm:min-h-0"
                    >
                      {descriptionOpen ? 'Less' : 'More'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {eventWhen || eventWhere ? (
                <p className="text-caption text-lantern-text-secondary">
                  {[eventWhen, eventWhere].filter(Boolean).join(' · ')}
                </p>
              ) : null}
              {studyLine ? (
                <p className="inline-flex items-center gap-1.5 text-caption text-lantern-text-secondary">
                  <AppIcon name="sparkles" size={16} className="text-lantern-ink" />
                  {studyLine}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void toggleMembership()}
                  disabled={pending}
                  className={`h-9 min-h-[44px] rounded-lg px-4 text-body font-medium sm:min-h-[36px] ${
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
                    className="inline-flex h-9 min-h-[44px] items-center gap-1.5 rounded-lg bg-lantern-primary/10 px-4 text-body font-semibold text-lantern-primary-text hover:bg-lantern-primary/20 sm:min-h-[36px]"
                  >
                    <AppIcon name="link" size={16} />
                    {COMMUNITY_COPY.invite}
                  </button>
                ) : null}
              </div>
              {!detail.isMember ? (
                <p className="text-caption text-lantern-text-secondary">{COMMUNITY_COPY.joinToSeeMembers}</p>
              ) : null}
            </div>
          </header>

          {activity.length > 0 && actions ? (
            <section aria-label={COMMUNITY_HOME_COPY.sectionActivity} className="space-y-3">
              <h2 className="text-title font-semibold text-lantern-text">
                {COMMUNITY_HOME_COPY.sectionActivity}
              </h2>
              {activity.map((item) => (
                <button
                  key={`${item.kind}-${item.id}`}
                  type="button"
                  onClick={() => {
                    if (item.kind === 'lounge') actions.onOpenLounge();
                    if (item.kind === 'board') {
                      const board = payload?.boards.find((row) => row.id === item.id);
                      if (board) actions.onOpenBoard(board);
                    }
                    if (item.kind === 'room') {
                      const room = payload?.rooms.find((row) => row.id === item.id);
                      if (room) actions.onOpenRoom(room);
                    }
                  }}
                  className="flex w-full min-h-[44px] items-center gap-3 rounded-lantern px-3 py-2 text-left hover:bg-lantern-background-secondary"
                >
                  <AppIcon
                    name={item.kind === 'room' ? 'time' : item.kind === 'lounge' ? 'chatbubbles' : 'list'}
                    size={16}
                    className="shrink-0 text-lantern-text-tertiary"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-semibold text-lantern-text">
                      {item.title}
                    </span>
                    <span className="mt-1 block truncate text-caption text-lantern-text-secondary">
                      {item.subtitle}
                    </span>
                  </span>
                  {item.unread > 0 ? (
                    <span className="bg-lantern-error-strong text-white text-label font-bold min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full">
                      {item.unread > 99 ? '99+' : item.unread}
                    </span>
                  ) : null}
                </button>
              ))}
            </section>
          ) : null}

          {/* Below md there is no column: the channel list lives on the page. */}
          <section className="md:hidden" aria-label="Boards">
            {payload && actions ? (
              <CommunityChannelList
                payload={payload}
                groups={groups}
                pendingId={pendingId}
                onOpenLounge={actions.onOpenLounge}
                onOpenBoard={actions.onOpenBoard}
                onJoinBoard={actions.onJoinBoard}
                onOpenStudyGroup={actions.onOpenStudyGroup}
                onOpenRoom={actions.onOpenRoom}
                onCreateBoard={actions.onCreateBoard}
                onStartStudyGroup={actions.onStartStudyGroup}
                onStartRoom={actions.onStartRoom}
                onOpenMembers={actions.onOpenMembers}
              />
            ) : (
              <p className="text-caption text-lantern-text-secondary" role="status">
                Loading…
              </p>
            )}
          </section>

          {manageOpen ? (
            <ManageCommunityPanel detail={detail} onChanged={() => invalidate(detail.id)} />
          ) : null}

          <section id="community-members" aria-label="Members" className="scroll-mt-4 space-y-4">
            <h2 className="text-title font-semibold text-lantern-text">
              Members · {memberCount.toLocaleString()}
            </h2>
            {detail.isMember ? (
              <CommunityMembersPanel
                communityId={detail.id}
                viewerId={currentUserId}
                onMessageMember={(member) => void navigate('DirectMessages', { userId: member.id })}
              />
            ) : (
              <p className="text-caption text-lantern-text-secondary">{COMMUNITY_COPY.joinToSeeMembers}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export const CommunityDetailScreen: React.FC<CommunityDetailScreenProps> = (props) => {
  const isPlatformAdmin = usePlatformAdmin();
  const currentUser = useAuthStore((s) => s.currentUser);
  if (!canOpenCommunities({ isPlatformAdmin, user: currentUser })) {
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
