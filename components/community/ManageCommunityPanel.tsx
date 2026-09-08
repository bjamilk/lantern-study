import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMMUNITY_MEMBERS_PAGE,
  type CommunityDetail,
  type CommunityMember,
} from '@lantern/shared/network';
import type { CommunityInviteSummary } from '@lantern/shared/api';
import type { AssignableCommunityRole } from '@lantern/shared/network';
import { seedMuteState } from '@lantern/shared/network';
import { fetchCommunityMembers } from '../../services/supabase';
import {
  createCommunityInvite,
  listCommunityInvites,
  muteCommunityMember,
  revokeCommunityInvite,
  setCommunityMemberRole,
  unmuteCommunityMember,
} from '../../services/apiEndpoints';
import { usePlatformAdmin } from '../../hooks/usePlatformAdmin';
import { useAuthStore } from '../../stores/authStore';
import { useToastStore } from '../../stores/toastStore';
import { useUIStore } from '../../stores/uiStore';
import { resolveAvatarSrc } from '../../utils/avatar';
import { AppIcon } from '../ui/AppIcon';
import { Avatar, Button, Input, Modal, Select } from '../ui';
import {
  COMMUNITY_MANAGE_COPY,
  COMMUNITY_MANAGE_INTRO,
  COMMUNITY_MANAGE_NOT_ENABLED,
  COMMUNITY_MANAGE_TITLE,
  INVITE_EXPIRY_OPTIONS,
  INVITE_USES_DEFAULT,
  MUTE_DURATION_OPTIONS,
  MUTE_REASON_MAX,
  canMintInvite,
  communityManageCapabilities,
  describeInvite,
  hasCommunityManagePowers,
  isManageFeatureOff,
  manageCommunityErrorCopy,
  memberActionPlan,
  type MuteDurationId,
} from './manageCommunity';
import { RoleBadge } from './CommunityMembersPanel';

/**
 * Manage a community — roles, mutes and invite links, on the community home.
 *
 * It mounts only for somebody who can actually do something (the shared rules
 * decide that, not this file), and it renders the powers that EXIST: promote /
 * demote through `setCommunityMemberRole`, mute and unmute through
 * `muteCommunityMember`, and invite links through the invite endpoints. The
 * predecessor listed those three as "not available yet" because they had no
 * endpoints; they have them now.
 *
 * Mutes and invites 503 until 20260908120000 is applied on a deployment. That
 * one status arrives as a typed NOT_ENABLED failure and the section says
 * "Not switched on for this campus yet" in place of its controls — a
 * moderator is told the truth once, rather than being handed a raw error every
 * time they press a button that cannot work here yet.
 */
export interface ManageCommunityPanelProps {
  detail: CommunityDetail;
  /** Fired after a role change, so the caller can re-read the community. */
  onChanged?: () => void;
}

type MuteTarget = { member: CommunityMember };

export const ManageCommunityPanel: React.FC<ManageCommunityPanelProps> = ({
  detail,
  onChanged,
}) => {
  const isPlatformAdmin = usePlatformAdmin();
  const currentUser = useAuthStore((s) => s.currentUser);
  const lowDataMode = useUIStore((s) => s.lowDataMode);
  const showToast = useToastStore((s) => s.showToast);

  const viewer = useMemo(
    () => ({
      userId: currentUser?.id ?? '',
      role: detail.viewerRole,
      isPlatformAdmin,
    }),
    [currentUser?.id, detail.viewerRole, isPlatformAdmin],
  );

  const caps = useMemo(
    () =>
      communityManageCapabilities({
        viewer,
        isMember: detail.isMember,
        visibility: detail.visibility,
      }),
    [viewer, detail.isMember, detail.visibility],
  );

  const [members, setMembers] = useState<CommunityMember[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  /**
   * Mutes this session has set or lifted. The members page does not carry
   * `muted_until`, so a row shows a live mute only from the moment this
   * moderator applied it — which is the moment it matters for the undo.
   */
  const [mutes, setMutes] = useState<Record<string, string | null>>({});
  // (Seeded from the roster's `mutedUntil` on every page load — see loadMembers.)
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [muteTarget, setMuteTarget] = useState<MuteTarget | null>(null);

  const [invites, setInvites] = useState<CommunityInviteSummary[] | null>(null);
  const [invitesError, setInvitesError] = useState<string | null>(null);
  const [invitesOff, setInvitesOff] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteExpiry, setInviteExpiry] = useState(INVITE_EXPIRY_OPTIONS[1].id);
  const [inviteUses, setInviteUses] = useState(String(INVITE_USES_DEFAULT));

  const canModerate = caps.canModerate;
  const canManageRoles = caps.canManageRoles;
  const canInvite = caps.canInvite;
  const communityId = detail.id;

  const loadMembers = useCallback(
    async (next?: string) => {
      setLoadingMembers(true);
      setMembersError(null);
      try {
        const page = await fetchCommunityMembers(communityId, {
          limit: COMMUNITY_MEMBERS_PAGE,
          cursor: next,
        });
        setMembers((prev) => {
          if (!next) return page.members;
          const seen = new Set(prev.map((m) => m.id));
          return [...prev, ...page.members.filter((m) => !seen.has(m.id))];
        });
        // The roster carries `mutedUntil` for a moderator (absent for
        // everyone else), so a mute applied in an earlier session shows its
        // Unmute here instead of only from the moment this session set one.
        setMutes((prev) => seedMuteState(prev, page.members));
        setCursor(page.nextCursor);
      } catch (err) {
        setMembersError(manageCommunityErrorCopy(err, 'Could not load members'));
      } finally {
        setLoadingMembers(false);
      }
    },
    [communityId],
  );

  useEffect(() => {
    if (!canModerate && !canManageRoles) return;
    setMembers([]);
    setCursor(null);
    setMutes({});
    void loadMembers();
  }, [canModerate, canManageRoles, loadMembers]);

  const loadInvites = useCallback(async () => {
    setInvitesError(null);
    try {
      const rows = await listCommunityInvites(communityId);
      setInvites(rows);
      setInvitesOff(false);
    } catch (err) {
      if (isManageFeatureOff(err)) {
        setInvitesOff(true);
        setInvites([]);
        return;
      }
      setInvites([]);
      setInvitesError(manageCommunityErrorCopy(err, 'Could not load invite links'));
    }
  }, [communityId]);

  useEffect(() => {
    if (!canInvite) return;
    void loadInvites();
  }, [canInvite, loadInvites]);

  if (!hasCommunityManagePowers(caps)) return null;

  const changeRole = async (member: CommunityMember, role: AssignableCommunityRole) => {
    if (role === member.role) return;
    setBusyMemberId(member.id);
    try {
      const result = await setCommunityMemberRole(communityId, member.id, role);
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, role: result.role } : m)),
      );
      showToast(COMMUNITY_MANAGE_COPY.roleChanged, 'success');
      onChanged?.();
    } catch (err) {
      showToast(manageCommunityErrorCopy(err, 'Could not change that role'), 'error');
    } finally {
      setBusyMemberId(null);
    }
  };

  const applyMute = async (member: CommunityMember, duration: MuteDurationId, reason: string) => {
    setBusyMemberId(member.id);
    try {
      const result = await muteCommunityMember(communityId, member.id, {
        duration,
        ...(reason.trim() ? { reason: reason.trim().slice(0, MUTE_REASON_MAX) } : {}),
      });
      setMutes((prev) => ({ ...prev, [member.id]: result.mutedUntil }));
      setMuteTarget(null);
    } catch (err) {
      showToast(manageCommunityErrorCopy(err, 'Could not mute this member'), 'error');
    } finally {
      setBusyMemberId(null);
    }
  };

  const liftMute = async (member: CommunityMember) => {
    setBusyMemberId(member.id);
    try {
      await unmuteCommunityMember(communityId, member.id);
      setMutes((prev) => ({ ...prev, [member.id]: null }));
    } catch (err) {
      showToast(manageCommunityErrorCopy(err, 'Could not lift that mute'), 'error');
    } finally {
      setBusyMemberId(null);
    }
  };

  const mintInvite = async () => {
    setInviteBusy(true);
    setInvitesError(null);
    try {
      const hours = INVITE_EXPIRY_OPTIONS.find((o) => o.id === inviteExpiry)?.hours;
      const uses = Number(inviteUses);
      const created = await createCommunityInvite(communityId, {
        ...(hours ? { expiresInHours: hours } : {}),
        ...(Number.isFinite(uses) && uses > 0 ? { maxUses: Math.floor(uses) } : {}),
      });
      setInvites((prev) => [
        {
          code: created.code,
          expiresAt: created.expiresAt,
          maxUses: created.maxUses,
          uses: created.uses,
          createdAt: new Date().toISOString(),
          createdBy: viewer.userId || null,
        },
        ...(prev ?? []),
      ]);
    } catch (err) {
      if (isManageFeatureOff(err)) setInvitesOff(true);
      else setInvitesError(manageCommunityErrorCopy(err, 'Could not create an invite link'));
    } finally {
      setInviteBusy(false);
    }
  };

  const revoke = async (code: string) => {
    setInviteBusy(true);
    try {
      await revokeCommunityInvite(communityId, code);
      setInvites((prev) => (prev ?? []).filter((row) => row.code !== code));
    } catch (err) {
      showToast(manageCommunityErrorCopy(err, 'Could not revoke that link'), 'error');
    } finally {
      setInviteBusy(false);
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      showToast(COMMUNITY_MANAGE_COPY.inviteCopied, 'success');
    } catch {
      // A blocked clipboard is not a failure the moderator can fix; the code
      // is on screen and selectable, so say what to do instead of "error".
      showToast('Copy the link from the row — your browser blocked the clipboard', 'info');
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const inviteRows = (invites ?? []).map((row) => describeInvite(row, { origin }));

  return (
    <section
      aria-label={COMMUNITY_MANAGE_TITLE}
      className="space-y-4 rounded-xl border border-lantern-border bg-lantern-background p-3"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-lantern-feature-campus-tint text-lantern-feature-campus-ink">
          <AppIcon name="shield" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-body font-semibold text-lantern-text">{COMMUNITY_MANAGE_TITLE}</h2>
          <p className="text-caption text-lantern-text-secondary">{COMMUNITY_MANAGE_INTRO}</p>
        </div>
      </div>

      {canModerate || canManageRoles ? (
        <div className="space-y-2">
          <h3 className="text-label font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            {COMMUNITY_MANAGE_COPY.membersTab}
          </h3>
          {membersError ? (
            <p role="alert" className="text-caption text-lantern-error">
              {membersError}
            </p>
          ) : null}
          <ul className="divide-y divide-lantern-border/60 rounded-lg border border-lantern-border bg-lantern-surface">
            {members.map((member) => {
              const plan = memberActionPlan({
                viewer,
                member: { id: member.id, role: member.role },
                mutedUntil: mutes[member.id] ?? null,
              });
              const busy = busyMemberId === member.id;
              return (
                <li key={member.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <Avatar
                    name={member.name}
                    id={member.id}
                    src={resolveAvatarSrc(member.avatarUrl ?? undefined, lowDataMode)}
                    size="sm"
                    localOnly={lowDataMode}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-body text-lantern-text">{member.name}</span>
                      <RoleBadge role={member.role} />
                    </span>
                    {plan.muteLabel ? (
                      <span className="block text-label text-lantern-text-tertiary">
                        {plan.muteLabel}
                      </span>
                    ) : plan.refusal ? (
                      <span className="block text-label text-lantern-text-tertiary">
                        {plan.refusal}
                      </span>
                    ) : null}
                  </span>

                  {plan.canChangeRole ? (
                    <>
                      <label className="sr-only" htmlFor={`role-${member.id}`}>
                        {COMMUNITY_MANAGE_COPY.roleLabel} · {member.name}
                      </label>
                      <Select
                        id={`role-${member.id}`}
                        value={member.role === 'owner' ? 'member' : member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void changeRole(member, event.target.value as AssignableCommunityRole)
                        }
                      >
                        {plan.roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role === 'member' ? 'Member' : role === 'admin' ? 'Admin' : 'Moderator'}
                          </option>
                        ))}
                      </Select>
                    </>
                  ) : null}

                  {plan.canUnmute ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void liftMute(member)}
                    >
                      {COMMUNITY_MANAGE_COPY.unmute}
                    </Button>
                  ) : plan.canMute ? (
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setMuteTarget({ member })}
                    >
                      {COMMUNITY_MANAGE_COPY.mute}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {loadingMembers ? (
            <p role="status" className="text-caption text-lantern-text-secondary">
              Loading…
            </p>
          ) : cursor ? (
            <button
              type="button"
              onClick={() => void loadMembers(cursor)}
              className="min-h-[44px] rounded-lg px-3 text-caption font-semibold text-lantern-primary hover:bg-lantern-primary/10 sm:min-h-[36px]"
            >
              Load more
            </button>
          ) : null}
        </div>
      ) : null}

      {canInvite ? (
        <div className="space-y-2">
          <h3 className="text-label font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            {COMMUNITY_MANAGE_COPY.invitesTab}
          </h3>
          {invitesOff ? (
            <p className="text-caption text-lantern-text-secondary">
              {COMMUNITY_MANAGE_NOT_ENABLED}
            </p>
          ) : (
            <>
              {invitesError ? (
                <p role="alert" className="text-caption text-lantern-error">
                  {invitesError}
                </p>
              ) : null}

              {inviteRows.length === 0 ? (
                <p className="text-caption text-lantern-text-secondary">
                  {COMMUNITY_MANAGE_COPY.inviteEmpty}
                </p>
              ) : (
                <ul className="divide-y divide-lantern-border/60 rounded-lg border border-lantern-border bg-lantern-surface">
                  {inviteRows.map((row) => (
                    <li key={row.code} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block font-mono text-body ${
                            row.dead ? 'text-lantern-text-tertiary' : 'text-lantern-text'
                          }`}
                        >
                          {row.code}
                        </span>
                        <span className="block text-label text-lantern-text-tertiary">
                          {row.usesLabel} · {row.expiryLabel}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={row.dead}
                        onClick={() => void copyLink(row.url)}
                      >
                        {COMMUNITY_MANAGE_COPY.inviteCopy}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={inviteBusy}
                        onClick={() => void revoke(row.code)}
                      >
                        {COMMUNITY_MANAGE_COPY.inviteRevoke}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}

              {canMintInvite(inviteRows.length) ? (
                <div className="flex flex-wrap items-end gap-2">
                  <span>
                    <label
                      htmlFor="invite-expiry"
                      className="block text-label text-lantern-text-secondary"
                    >
                      {COMMUNITY_MANAGE_COPY.inviteExpiry}
                    </label>
                    <Select
                      id="invite-expiry"
                      value={inviteExpiry}
                      onChange={(event) => setInviteExpiry(event.target.value)}
                    >
                      {INVITE_EXPIRY_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </span>
                  <span>
                    <label
                      htmlFor="invite-uses"
                      className="block text-label text-lantern-text-secondary"
                    >
                      {COMMUNITY_MANAGE_COPY.inviteUses}
                    </label>
                    <Input
                      id="invite-uses"
                      type="number"
                      min={1}
                      value={inviteUses}
                      onChange={(event) => setInviteUses(event.target.value)}
                      className="w-24"
                    />
                  </span>
                  <Button type="button" loading={inviteBusy} onClick={() => void mintInvite()}>
                    {COMMUNITY_MANAGE_COPY.inviteCreate}
                  </Button>
                </div>
              ) : (
                <p className="text-caption text-lantern-text-secondary">
                  {COMMUNITY_MANAGE_COPY.inviteFull}
                </p>
              )}
            </>
          )}
        </div>
      ) : null}

      {canModerate ? (
        <div className="space-y-1">
          <h3 className="text-label font-semibold uppercase tracking-wide text-lantern-text-tertiary">
            {COMMUNITY_MANAGE_COPY.moderationTab}
          </h3>
          <p className="text-caption text-lantern-text-secondary">
            {COMMUNITY_MANAGE_COPY.removedExplain}
          </p>
        </div>
      ) : null}

      <MuteDialog
        target={muteTarget}
        busy={!!muteTarget && busyMemberId === muteTarget.member.id}
        onCancel={() => setMuteTarget(null)}
        onConfirm={(duration, reason) =>
          muteTarget ? void applyMute(muteTarget.member, duration, reason) : undefined
        }
      />
    </section>
  );
};

const MuteDialog: React.FC<{
  target: MuteTarget | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (duration: MuteDurationId, reason: string) => void;
}> = ({ target, busy, onCancel, onConfirm }) => {
  const [duration, setDuration] = useState<MuteDurationId>(MUTE_DURATION_OPTIONS[1].id);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!target) return;
    setDuration(MUTE_DURATION_OPTIONS[1].id);
    setReason('');
  }, [target]);

  if (!target) return null;

  return (
    <Modal isOpen onClose={onCancel} maxWidthClass="max-w-sm" ariaLabelledBy="mute-member-title">
      <div className="space-y-3 p-4">
        <h2 id="mute-member-title" className="text-heading font-semibold text-lantern-text">
          {COMMUNITY_MANAGE_COPY.muteHeading(target.member.name)}
        </h2>
        <p className="text-caption text-lantern-text-secondary">
          {COMMUNITY_MANAGE_COPY.muteExplain}
        </p>
        <div>
          <label htmlFor="mute-duration" className="block text-label text-lantern-text-secondary">
            For how long
          </label>
          <Select
            id="mute-duration"
            value={duration}
            onChange={(event) => setDuration(event.target.value as MuteDurationId)}
          >
            {MUTE_DURATION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="mute-reason" className="block text-label text-lantern-text-secondary">
            Reason (optional)
          </label>
          <Input
            id="mute-reason"
            value={reason}
            maxLength={MUTE_REASON_MAX}
            placeholder={COMMUNITY_MANAGE_COPY.muteReason}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" loading={busy} onClick={() => onConfirm(duration, reason)}>
            {COMMUNITY_MANAGE_COPY.mute}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default ManageCommunityPanel;
