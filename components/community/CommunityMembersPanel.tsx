import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MagnifyingGlassIcon, ShieldCheckIcon, StarIcon } from '@heroicons/react/24/outline';
import {
  COMMUNITY_COPY,
  COMMUNITY_MEMBERS_PAGE,
  communityRoleLabel,
  splitMembers,
  type CommunityMember,
  type CommunityRole,
} from '@lantern/shared/network';
import { fetchCommunityMembers } from '../../services/supabase';
import { useUIStore } from '../../stores/uiStore';
import { resolveAvatarSrc } from '../../utils/avatar';
import { Avatar } from '../ui';

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/** Owner = star (amber), Admin = shield-check (indigo), Moderator = shield (slate). Text label at lg+, title otherwise. */
export const RoleBadge: React.FC<{ role: CommunityRole }> = ({ role }) => {
  const label = communityRoleLabel(role);
  if (!label) return null;
  const Icon = role === 'owner' ? StarIcon : ShieldCheckIcon;
  const tone =
    role === 'owner'
      ? 'text-amber-600 dark:text-amber-400'
      : role === 'admin'
        ? 'text-indigo-600 dark:text-indigo-400'
        : 'text-slate-500 dark:text-slate-400';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${tone}`} title={label}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" />
      <span className="hidden lg:inline">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
    </span>
  );
};

const MemberRow: React.FC<{ member: CommunityMember; online: boolean; lowDataMode: boolean }> = ({
  member,
  online,
  lowDataMode,
}) => (
  <li className="flex min-h-[44px] items-center gap-3 px-3 py-1.5">
    <span className="relative shrink-0">
      <Avatar
        name={member.name}
        src={resolveAvatarSrc(member.avatarUrl ?? undefined, lowDataMode)}
        size="sm"
        localOnly={lowDataMode}
      />
      {member.onlineStatus !== 'hidden' ? (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-lantern-background ${
            online ? 'bg-emerald-500' : 'bg-slate-400'
          }`}
        >
          <span className="sr-only">{online ? 'Online' : 'Offline'}</span>
        </span>
      ) : null}
    </span>
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-sm font-medium text-lantern-text">{member.name}</span>
        <RoleBadge role={member.role} />
      </span>
      {member.programme ? (
        <span className="block truncate text-[11px] text-lantern-text-tertiary">{member.programme}</span>
      ) : null}
    </span>
  </li>
);

/**
 * The members-only roster (spec §5.6): paged through `nextCursor`, filtered
 * client-side by name, split into Online / Offline with `splitMembers` (the
 * live presence set only ever raises someone into Online; hidden members
 * never get a dot).
 */
export const CommunityMembersPanel: React.FC<{ communityId: string }> = ({ communityId }) => {
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const presence = useUIStore((s) => s.communityPresence);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const loadPage = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchCommunityMembers(communityId, {
          limit: COMMUNITY_MEMBERS_PAGE,
          cursor,
        });
        setMembers((prev) => {
          if (!cursor) return page.members;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.members.filter((m) => !seen.has(m.id))];
        });
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : COMMUNITY_COPY.joinToSeeMembers);
      } finally {
        setLoading(false);
      }
    },
    [communityId]
  );

  useEffect(() => {
    setMembers([]);
    setNextCursor(null);
    setQuery('');
    void loadPage();
  }, [loadPage]);

  const onlineIds = useMemo<ReadonlySet<string>>(
    () =>
      presence && presence.communityId === communityId && presence.connected
        ? new Set(presence.onlineIds)
        : EMPTY_IDS,
    [presence, communityId]
  );

  const { online, offline } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q ? members.filter((m) => (m.name || '').toLowerCase().includes(q)) : members;
    return splitMembers(visible, onlineIds);
  }, [members, query, onlineIds]);

  return (
    <div className="space-y-3">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative">
        <MagnifyingGlassIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-lantern-text-secondary"
          aria-hidden="true"
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members"
          aria-label="Search members"
          className="w-full rounded-lg border border-lantern-border bg-lantern-background py-2 pl-9 pr-3 text-sm text-lantern-text placeholder:text-lantern-text-secondary focus:border-lantern-primary focus:outline-none"
        />
      </form>

      {error ? (
        <p className="text-sm text-lantern-text-secondary" role="alert">
          {error}
        </p>
      ) : null}

      {online.length > 0 ? (
        <div>
          <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            {COMMUNITY_COPY.online(online.length)}
          </h3>
          <ul className="divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
            {online.map((m) => (
              <MemberRow key={m.id} member={m} online lowDataMode={lowDataMode} />
            ))}
          </ul>
        </div>
      ) : null}

      {offline.length > 0 || (!loading && members.length === 0 && !error) ? (
        <div>
          <h3 className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            {COMMUNITY_COPY.offline(offline.length)}
          </h3>
          {offline.length > 0 ? (
            <ul className="divide-y divide-lantern-border/60 rounded-xl border border-lantern-border bg-lantern-background">
              {offline.map((m) => (
                <MemberRow key={m.id} member={m} online={false} lowDataMode={lowDataMode} />
              ))}
            </ul>
          ) : (
            <p className="px-3 text-xs text-lantern-text-tertiary">
              {query.trim() ? 'No members match that search.' : 'Nobody here yet.'}
            </p>
          )}
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-lantern-text-secondary" role="status">
          Loading…
        </p>
      ) : nextCursor ? (
        <button
          type="button"
          onClick={() => void loadPage(nextCursor)}
          className="min-h-[44px] rounded-lg px-3 text-sm font-semibold text-lantern-primary hover:bg-lantern-primary/10 sm:min-h-[36px]"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
};

export default CommunityMembersPanel;
