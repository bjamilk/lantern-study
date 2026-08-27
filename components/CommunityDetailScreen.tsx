import React, { useCallback, useEffect, useState } from 'react';
import { CheckBadgeIcon } from '@heroicons/react/24/outline';
import {
  communityKindLabel,
  communityMembershipAction,
  memberCountLabel,
  type CommunityDetail,
  type DiscoverGroup,
} from '@lantern/shared/network';
import {
  discoverGroups,
  fetchCommunity,
  fetchCommunityMembers,
  joinCommunity,
  joinDiscoverableGroup,
  leaveCommunity,
} from '../services/supabase';
import { HangoutChatPanel } from './HangoutChatPanel';

/**
 * One community (Phase 3 · L) — the web counterpart of the mobile screen.
 *
 * This existed on mobile and was routable on web (`/discover/c/:slug` mapped to
 * AppMode.COMMUNITY_DETAIL) but had no component behind it, so every community
 * card on web was an unclickable dead end.
 *
 * The member roster is members-only server-side: a non-member sees the
 * community and its groups but not who is in it.
 */
export interface CommunityDetailScreenProps {
  slug: string;
  onBack: () => void;
  onNavigate?: (screen: string, params?: Record<string, unknown>) => void;
}

type Member = { id: string; name: string; avatarUrl: string | null; programme: string | null };

export const CommunityDetailScreen: React.FC<CommunityDetailScreenProps> = ({
  slug,
  onBack,
  onNavigate,
}) => {
  const [community, setCommunity] = useState<CommunityDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<DiscoverGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const detail = await fetchCommunity(slug);
      setCommunity(detail);

      // Groups and members are secondary — either failing must still leave the
      // header rendered rather than blanking the screen.
      void discoverGroups({ communityId: detail.id })
        .then(setGroups)
        .catch(() => setGroups([]));
      if (detail.isMember) {
        void fetchCommunityMembers(detail.id, 30)
          .then(setMembers)
          .catch(() => setMembers([]));
      } else {
        setMembers([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Community not found');
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async () => {
    if (!community) return;
    setPending(true);
    const wasMember = community.isMember;
    setCommunity({ ...community, isMember: !wasMember });
    try {
      if (wasMember) await leaveCommunity(community.id);
      else await joinCommunity(community.id);
      await load();
    } catch (err) {
      setCommunity({ ...community, isMember: wasMember });
      setError(err instanceof Error ? err.message : 'Could not update membership');
    } finally {
      setPending(false);
    }
  };

  const openOrJoinGroup = async (group: DiscoverGroup) => {
    if (group.isMember) {
      onNavigate?.('GroupChat', { groupId: group.id, groupName: group.name });
      return;
    }
    setPendingGroupId(group.id);
    try {
      await joinDiscoverableGroup(group.id);
      setGroups((prev) =>
        prev.map((item) =>
          item.id === group.id
            ? { ...item, isMember: true, memberCount: item.memberCount + 1 }
            : item
        )
      );
      onNavigate?.('GroupChat', { groupId: group.id, groupName: group.name, joined: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this group');
    } finally {
      setPendingGroupId(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10 text-sm text-lantern-text-secondary" role="status">
        Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-lantern-text-secondary hover:text-lantern-text"
      >
        ← Discover
      </button>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      )}

      {community && (
        <>
          <header className="space-y-2">
            <div className="flex items-start gap-2">
              <h1 className="text-2xl font-semibold text-lantern-text" style={{ textWrap: 'balance' }}>
                {community.name}
              </h1>
              {community.is_official && (
                <CheckBadgeIcon
                  className="mt-1.5 h-5 w-5 shrink-0 text-lantern-primary"
                  aria-label="Official community"
                />
              )}
            </div>
            <p className="text-xs text-lantern-text-secondary">
              {communityKindLabel(community.kind)} · {memberCountLabel(community.member_count)}
            </p>
            {community.description && (
              <p className="max-w-[60ch] text-sm text-lantern-text-secondary">{community.description}</p>
            )}
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={pending}
              className={`mt-1 h-9 min-h-[44px] rounded-lg px-4 text-sm font-medium sm:min-h-[36px] ${
                community.isMember
                  ? 'bg-lantern-background-secondary text-lantern-text-secondary'
                  : 'bg-lantern-primary text-white'
              } disabled:opacity-60`}
            >
              {pending
                ? 'Working…'
                : communityMembershipAction(community.isMember, community.source)}
            </button>
          </header>

          {community.isMember && community.loungeGroupId ? (
            <HangoutChatPanel
              groupId={community.loungeGroupId}
              title="Lounge"
              onOpenInChats={
                onNavigate
                  ? () =>
                      onNavigate('GroupChat', {
                        groupId: community.loungeGroupId,
                        groupName: `${community.name} Lounge`,
                        joined: true,
                      })
                  : undefined
              }
            />
          ) : !community.isMember ? (
            <p className="rounded-xl border border-dashed border-lantern-border px-3 py-3 text-sm text-lantern-text-secondary">
              Join this community to chat in the hangout.
            </p>
          ) : null}

          {members.length > 0 && (
            <section aria-label="Members">
              <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
                Members
              </h2>
              <ul className="divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
                {members.slice(0, 12).map((m) => (
                  <li key={m.id} className="px-3 py-2 text-sm text-lantern-text">
                    {m.name}
                    {m.programme && (
                      <span className="ml-2 text-xs text-lantern-text-secondary">{m.programme}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Groups">
            <h2 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-lantern-text-secondary">
              Groups
            </h2>
            {groups.filter((g) => g.id !== community.loungeGroupId).length === 0 ? (
              <p className="text-xs text-lantern-text-secondary">
                {community.isMember
                  ? 'No groups in this community yet. Create a study group and list it here from Group info → Discover.'
                  : 'No public groups here yet. Join the community to see rooms listed just for members.'}
              </p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {groups
                  .filter((g) => g.id !== community.loungeGroupId)
                  .map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => void openOrJoinGroup(g)}
                      className="w-full rounded-xl border border-lantern-border bg-lantern-background p-3 text-left hover:border-lantern-primary/40"
                    >
                      <p className="text-sm font-semibold text-lantern-text">{g.name}</p>
                      <p className="text-xs text-lantern-text-secondary">
                        {memberCountLabel(g.memberCount)}
                        {g.isMember ? ' · Member · Open' : ' · Join'}
                        {pendingGroupId === g.id ? '…' : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default CommunityDetailScreen;
