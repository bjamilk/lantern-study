import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppIcon } from '../ui/AppIcon';
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
import { Avatar, Menu, MenuContent, MenuItem, MenuTrigger } from '../ui';
import ReportContentModal from '../moderation/ReportContentModal';

const EMPTY_IDS: ReadonlySet<string> = new Set<string>();

/** Owner = star (amber), Admin = shield-check (indigo), Moderator = shield (slate). Text label at lg+, title otherwise. */
export const RoleBadge: React.FC<{ role: CommunityRole }> = ({ role }) => {
  const label = communityRoleLabel(role);
  if (!label) return null;
  const iconName = role === 'owner' ? 'star' : 'shield-checkmark';
  const tone =
    role === 'owner'
      ? 'text-amber-600 dark:text-amber-400'
      : role === 'admin'
        ? 'text-lantern-primary-text'
        : 'text-slate-500 dark:text-slate-400';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${tone}`} title={label}>
      <AppIcon name={iconName} size={14} />
      <span className="hidden lg:inline">{label}</span>
      <span className="sr-only lg:hidden">{label}</span>
    </span>
  );
};

const MemberRow: React.FC<{
  member: CommunityMember;
  online: boolean;
  lowDataMode: boolean;
  onReport: (member: CommunityMember) => void;
  /** The viewer — you cannot report yourself, and the API refuses it anyway. */
  isSelf: boolean;
}> = ({ member, online, lowDataMode, onReport, isSelf }) => (
  <li className="flex min-h-[44px] items-center gap-3 px-3 py-1.5">
    <span className="relative shrink-0">
      <Avatar
        name={member.name}
        id={member.id}
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
    {/* Offered to EVERY member, not only moderators: the person being
        harassed is usually not one. Moderators additionally get roles and
        mutes in the Manage panel — this row stays the same for them, because
        reporting and muting are different acts. */}
    {isSelf ? null : (
      <Menu>
        <MenuTrigger
          aria-label={`Options for ${member.name}`}
          title={`Options for ${member.name}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lantern-text-tertiary hover:bg-lantern-background-secondary hover:text-lantern-text focus:outline-none focus:ring-2 focus:ring-lantern-primary"
        >
          <AppIcon name="ellipsis-horizontal" size={16} />
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            onSelect={() => onReport(member)}
            icon={<AppIcon name="flag" size={16} className="text-lantern-text-tertiary" />}
          >
            Report {member.name}
          </MenuItem>
        </MenuContent>
      </Menu>
    )}
  </li>
);

/**
 * The members-only roster (spec §5.6): paged through `nextCursor`, filtered
 * client-side by name, split into Online / Offline with `splitMembers` (the
 * live presence set only ever raises someone into Online; hidden members
 * never get a dot).
 */
export const CommunityMembersPanel: React.FC<{ communityId: string; viewerId?: string | null }> = ({
  communityId,
  viewerId,
}) => {
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const presence = useUIStore((s) => s.communityPresence);
  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /**
   * Reported as a `community_member`. The moderation service resolves that
   * target through `profiles` exactly as it resolves a `user`, so the report
   * reaches the same queue — but it arrives labelled as something that
   * happened INSIDE a community, which is the context a moderator needs and
   * which a bare `user` report threw away. (It was `user` while
   * `resolveTarget` had no case for `community_member`; Wave 8 added one.)
   */
  const [reportTarget, setReportTarget] = useState<CommunityMember | null>(null);

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
        <AppIcon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lantern-text-secondary"
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
              <MemberRow
                key={m.id}
                member={m}
                online
                lowDataMode={lowDataMode}
                isSelf={!!viewerId && m.id === viewerId}
                onReport={setReportTarget}
              />
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
                <MemberRow
                  key={m.id}
                  member={m}
                  online={false}
                  lowDataMode={lowDataMode}
                  isSelf={!!viewerId && m.id === viewerId}
                  onReport={setReportTarget}
                />
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

      <ReportContentModal
        isOpen={!!reportTarget}
        onClose={() => setReportTarget(null)}
        targetType="community_member"
        targetId={reportTarget?.id ?? ''}
        targetLabel={reportTarget?.name ?? null}
      />
    </div>
  );
};

export default CommunityMembersPanel;
