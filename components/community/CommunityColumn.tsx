import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  CheckBadgeIcon,
  EllipsisHorizontalIcon,
  HomeIcon,
  LinkIcon,
  PlusIcon,
  SpeakerWaveIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  COMMUNITY_COPY,
  communityHeaderLine,
  communityOnlineCount,
} from '@lantern/shared/network';
import { AppMode } from '../../types';
import { useCommunityStore } from '../../stores/communityStore';
import { useGroupStore } from '../../stores/groupStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import { parseAppRoute } from '../../utils/appRoutes';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../ui';
import CommunityChannelList from './CommunityChannelList';
import CommunityTile from './CommunityTile';
import {
  copyCommunityInvite,
  useCommunityListActions,
  type CommunityNavigate,
} from './communityNavigation';

export type { CommunityNavigate } from './communityNavigation';

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/**
 * The community's channel column (spec §5.3) — rendered inside the Sidebar
 * aside whenever `resolveSideColumn(...) === 'community'`. Resolves the
 * active community by slug (so a cold load of `/discover/c/:slug/ch/:id`
 * fills in the placeholder App seeded), loads the channel payload the page
 * shares, and reads presence from the store — it never opens a channel.
 */
export const CommunityColumn: React.FC<{ onNavigate: CommunityNavigate }> = ({ onNavigate }) => {
  const activeCommunity = useUIStore((s) => s.activeCommunity);
  const setActiveCommunity = useUIStore((s) => s.setActiveCommunity);
  const appMode = useUIStore((s) => s.appMode);
  const presence = useUIStore((s) => s.communityPresence);
  const groups = useGroupStore((s) => s.groups);
  const showToast = useToastStore((s) => s.showToast);
  const location = useLocation();

  const slug = activeCommunity?.slug ?? null;
  const detail = useCommunityStore((s) => (slug ? s.detailBySlug[slug] : undefined));
  const payload = useCommunityStore((s) => (detail ? s.channelsById[detail.id] : undefined));
  const loadCommunity = useCommunityStore((s) => s.loadCommunity);
  const loadChannels = useCommunityStore((s) => s.loadChannels);
  const [error, setError] = useState<string | null>(null);

  // Resolve slug → detail → channels. Re-runs when `invalidate` drops the
  // cached payload (join/leave, new channel, lounge mint).
  useEffect(() => {
    if (!slug || error) return;
    let cancelled = false;
    (async () => {
      try {
        const d = detail ?? (await loadCommunity(slug));
        if (cancelled) return;
        const current = useUIStore.getState().activeCommunity;
        if (
          current?.slug === slug &&
          (current.id !== d.id || current.name !== d.name || current.loungeGroupId !== d.lounge_group_id)
        ) {
          setActiveCommunity({ id: d.id, slug, name: d.name, loungeGroupId: d.lounge_group_id });
        }
        if (!payload) await loadChannels(d.id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this community');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, detail, payload, error, loadCommunity, loadChannels, setActiveCommunity]);

  useEffect(() => {
    setError(null);
  }, [slug]);

  const { actions, pendingId } = useCommunityListActions(detail, onNavigate);

  const route = useMemo(() => parseAppRoute(location.pathname), [location.pathname]);
  const selectedGroupId =
    appMode === AppMode.COMMUNITY_DETAIL && route.params.slug === slug ? route.params.groupId ?? null : null;
  const homeSelected = appMode === AppMode.COMMUNITY_DETAIL && !selectedGroupId;

  const onlineIds = useMemo<ReadonlySet<string>>(
    () =>
      detail && presence && presence.communityId === detail.id ? new Set(presence.onlineIds) : EMPTY_IDS,
    [presence, detail]
  );
  const connected = !!detail && presence?.communityId === detail.id && presence.connected;
  const headerLine = detail
    ? communityHeaderLine(
        detail.kind,
        payload?.memberCount ?? detail.member_count,
        detail.isMember
          ? communityOnlineCount(payload?.onlineCount ?? detail.onlineCount ?? 0, onlineIds, connected)
          : 0
      )
    : '';
  const memberCount = payload?.memberCount ?? detail?.member_count ?? 0;
  const name = detail?.name || activeCommunity?.name || 'Community';

  const copyInvite = async () => {
    if (!detail) return;
    const ok = await copyCommunityInvite(detail.slug);
    showToast(ok ? COMMUNITY_COPY.inviteCopied : 'Could not copy the link', ok ? 'success' : 'error');
  };

  const rowClass =
    'w-full flex items-center gap-2 rounded-lantern px-3 min-h-[44px] md:min-h-[40px] text-left text-sm font-medium text-lantern-text transition-colors hover:bg-lantern-background-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary';

  return (
    <div className="w-80 h-full flex flex-col">
      <div className="flex items-center gap-2 h-16 px-3 border-b border-lantern-border flex-shrink-0">
        <CommunityTile name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1 text-sm font-bold text-lantern-text">
            <span className="truncate">{name}</span>
            {detail?.is_official ? (
              <CheckBadgeIcon className="h-4 w-4 shrink-0 text-lantern-primary" aria-label="Official community" />
            ) : null}
          </h2>
          {headerLine ? (
            <p className="truncate text-[11px] text-lantern-text-tertiary">{headerLine}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center">
          {detail?.isMember ? (
            <Menu>
              <MenuTrigger
                aria-label="Community options"
                title="Community options"
                className="flex h-9 w-9 items-center justify-center rounded-md text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
              >
                <EllipsisHorizontalIcon className="w-5 h-5" aria-hidden="true" />
              </MenuTrigger>
              <MenuContent>
                {detail.visibility === 'public' ? (
                  <MenuItem
                    onSelect={() => void copyInvite()}
                    icon={<LinkIcon className="w-4 h-4 text-lantern-text-tertiary" aria-hidden="true" />}
                  >
                    {COMMUNITY_COPY.invite}
                  </MenuItem>
                ) : null}
                <MenuItem
                  onSelect={() => actions?.onCreateChannel()}
                  icon={<PlusIcon className="w-4 h-4 text-lantern-text-tertiary" aria-hidden="true" />}
                >
                  {COMMUNITY_COPY.createChannel}
                </MenuItem>
                <MenuItem
                  onSelect={() => actions?.onStartRoom()}
                  icon={<SpeakerWaveIcon className="w-4 h-4 text-lantern-text-tertiary" aria-hidden="true" />}
                >
                  {COMMUNITY_COPY.startRoom}
                </MenuItem>
              </MenuContent>
            </Menu>
          ) : null}
          <button
            type="button"
            onClick={() => void onNavigate('CloseCommunity')}
            className="flex h-9 w-9 items-center justify-center rounded-md text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
            title="Close community"
            aria-label="Close community"
          >
            <XMarkIcon className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        <div className="px-1">
          <button
            type="button"
            onClick={() => void onNavigate('Home', { slug })}
            aria-current={homeSelected ? 'page' : undefined}
            className={`${rowClass} ${homeSelected ? 'bg-lantern-primary-background text-lantern-primary' : ''}`}
          >
            <HomeIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
            Home
          </button>
        </div>
        {error ? (
          <p className="px-3 py-2 text-xs text-lantern-error" role="alert">
            {error}{' '}
            <button type="button" className="font-semibold underline" onClick={() => setError(null)}>
              Retry
            </button>
          </p>
        ) : payload && actions ? (
          <CommunityChannelList
            payload={payload}
            groups={groups}
            selectedGroupId={selectedGroupId}
            pendingId={pendingId}
            onOpenLounge={actions.onOpenLounge}
            onOpenChannel={actions.onOpenChannel}
            onJoinChannel={actions.onJoinChannel}
            onOpenRoom={actions.onOpenRoom}
            onCreateChannel={actions.onCreateChannel}
            onStartRoom={actions.onStartRoom}
          />
        ) : (
          <p className="px-3 py-2 text-xs text-lantern-text-secondary" role="status">
            Loading…
          </p>
        )}
      </div>

      {detail ? (
        <div className="border-t border-lantern-border p-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => actions?.onOpenMembers()}
            className={rowClass}
          >
            <UsersIcon className="w-4 h-4 shrink-0 text-lantern-text-tertiary" aria-hidden="true" />
            <span className="truncate">Members · {memberCount.toLocaleString()}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default CommunityColumn;
