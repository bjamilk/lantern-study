import React, { useEffect, useState } from 'react';
import {
  AdminUserDetail,
  addAdminStrike,
  awardAdminBadge,
  awardAdminPoints,
  fetchAdminCompanionMessages,
  fetchAdminUserDetail,
  resetAdminAIQuota,
  updateAdminUserStatus,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';
import Drawer from '../ui/Drawer';
import { formatDate, formatDateTime } from './types';
import { BADGE_DEFINITIONS } from '../../gamification';
import type { BadgeId } from '../../types';
import { useToastStore } from '../../stores/toastStore';
import { MAX_SUSPENSION_DAYS, STRIKE_SUSPENSION_THRESHOLD } from '@lantern/shared';
import { formatSuspensionDate, suspendUntilIso } from '../../utils/moderationForms';

/** The known badge ids, in catalogue order, for the grant picker. */
const BADGE_OPTIONS = Object.values(BADGE_DEFINITIONS);

/** Ids the user already holds; profiles.badges is a JSONB array of Badge objects. */
function ownedBadgeIdSet(badges: unknown[] | undefined): Set<string> {
  const ids = new Set<string>();
  for (const badge of badges ?? []) {
    const id = badge && typeof badge === 'object' ? (badge as { id?: unknown }).id : undefined;
    if (typeof id === 'string' && id) ids.add(id);
  }
  return ids;
}

interface UserDetailDrawerProps {
  userId: string | null;
  onClose: () => void;
  onUpdated?: () => void;
}

export const UserDetailDrawer: React.FC<UserDetailDrawerProps> = ({ userId, onClose, onUpdated }) => {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pointsDelta, setPointsDelta] = useState('50');
  const [pointsReason, setPointsReason] = useState('');
  const [badgeId, setBadgeId] = useState('');
  const [grantingBadge, setGrantingBadge] = useState(false);
  const [companionPreview, setCompanionPreview] = useState<Array<{ id: string; role: string; content: string; created_at: string }>>([]);
  const [showCompanion, setShowCompanion] = useState(false);
  const [strikeReason, setStrikeReason] = useState('');
  const [strikeSeverity, setStrikeSeverity] = useState<1 | 2 | 3>(1);
  const [suspendUntil, setSuspendUntil] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [moderationBusy, setModerationBusy] = useState<'strike' | 'suspend' | 'unsuspend' | null>(null);
  const showToast = useToastStore((s) => s.showToast);

  const issueStrike = async () => {
    if (!userId || !strikeReason.trim() || moderationBusy) return;
    setModerationBusy('strike');
    setError(null);
    try {
      const result = await addAdminStrike(userId, { reason: strikeReason.trim(), severity: strikeSeverity });
      showToast(
        result.suspendedUntil
          ? `Strike issued — account auto-suspended until ${formatSuspensionDate(result.suspendedUntil)}.`
          : `Strike issued (${result.activeStrikes} active).`,
        'success'
      );
      setStrikeReason('');
      setStrikeSeverity(1);
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add strike';
      setError(message);
      showToast(message, 'error');
    } finally {
      setModerationBusy(null);
    }
  };

  const suspendUntilDate = async () => {
    if (!userId || moderationBusy) return;
    const until = suspendUntilIso(suspendUntil);
    if (!until) {
      setError(`Pick a future date (at most ${MAX_SUSPENSION_DAYS} days ahead) for the suspension.`);
      return;
    }
    setModerationBusy('suspend');
    setError(null);
    try {
      await updateAdminUserStatus(userId, 'suspended', suspendReason.trim() || undefined, until);
      showToast(`Account suspended until ${formatSuspensionDate(until)}.`, 'success');
      setSuspendUntil('');
      setSuspendReason('');
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to suspend account';
      setError(message);
      showToast(message, 'error');
    } finally {
      setModerationBusy(null);
    }
  };

  const unsuspend = async () => {
    if (!userId || moderationBusy) return;
    setModerationBusy('unsuspend');
    setError(null);
    try {
      // 'active' clears both the suspension and any ban.
      await updateAdminUserStatus(userId, 'active');
      showToast('Suspension lifted.', 'success');
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to lift suspension';
      setError(message);
      showToast(message, 'error');
    } finally {
      setModerationBusy(null);
    }
  };

  const ownedBadgeIds = ownedBadgeIdSet(detail?.badges);
  const selectedBadgeOwned = badgeId !== '' && ownedBadgeIds.has(badgeId);

  const grantBadge = async () => {
    if (!userId || !badgeId || selectedBadgeOwned || grantingBadge) return;
    const label = BADGE_DEFINITIONS[badgeId as BadgeId]?.baseName ?? badgeId;
    const who = detail?.name || detail?.username || 'user';
    setGrantingBadge(true);
    setError(null);
    try {
      await awardAdminBadge(userId, badgeId);
      showToast(`Granted ${label} to ${who}`, 'success');
      setBadgeId('');
      await reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to grant badge';
      setError(message);
      showToast(message, 'error');
    } finally {
      setGrantingBadge(false);
    }
  };

  useEffect(() => {
    if (!userId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchAdminUserDetail(userId);
        if (!cancelled) setDetail(data);
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load user');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const reload = async () => {
    if (!userId) return;
    try {
      const data = await fetchAdminUserDetail(userId);
      setDetail(data);
      onUpdated?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh user');
    }
  };

  const loadCompanion = async () => {
    if (!userId) return;
    try {
      const messages = await fetchAdminCompanionMessages(userId, 15);
      setCompanionPreview(messages);
      setShowCompanion(true);
    } catch (err: unknown) {
      // Without this, a failed fetch was an unhandled rejection: no panel, no
      // message, button appears to do nothing.
      setError(err instanceof Error ? err.message : 'Failed to load companion messages');
    }
  };

  return (
    <Drawer
      isOpen={Boolean(userId)}
      onClose={onClose}
      ariaLabelledBy="admin-user-detail-title"
      maxWidthClass="max-w-lg"
      zIndexClass="z-40"
      backdropClassName="bg-black/40"
      panelClassName="!p-0 overflow-y-auto rounded-none border-l border-lantern-border bg-lantern-surface"
    >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-lantern-border bg-lantern-surface p-4">
          <div>
            <h2 id="admin-user-detail-title" className="text-lg font-semibold text-lantern-text">User detail</h2>
            <p className="text-xs text-lantern-text-muted font-mono">{userId}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {loading && <p className="text-sm text-lantern-text-muted">Loading…</p>}
          {error && <p className="text-sm text-lantern-error">{error}</p>}
          {detail && (
            <>
              <div>
                <p className="text-xl font-semibold text-lantern-text">{detail.name || detail.username || 'Unnamed'}</p>
                <p className="text-sm text-lantern-text-muted">{detail.email || 'No email'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatPill label="Points" value={String(detail.points ?? 0)} />
                  {detail.is_banned ? (
                    <StatPill label="Status" value="Banned" accent="warning" />
                  ) : detail.suspended_until ? (
                    <StatPill label="Status" value={`Suspended until ${formatSuspensionDate(detail.suspended_until)}`} accent="warning" />
                  ) : (
                    <StatPill label="Status" value="Active" accent="success" />
                  )}
                  <StatPill
                    label="Strikes"
                    value={String(detail.active_strikes ?? 0)}
                    accent={(detail.active_strikes ?? 0) >= STRIKE_SUSPENSION_THRESHOLD ? 'warning' : 'primary'}
                  />
                  {detail.is_platform_admin ? <StatPill label="Role" value="Admin" accent="primary" /> : null}
                </div>
                <p className="mt-2 text-xs text-lantern-text-muted">Joined {formatDate(detail.created_at)}</p>
              </div>

              {detail.counts && (
                <div className="grid grid-cols-2 gap-2">
                  <StatPill label="Groups" value={String(detail.counts.groups)} />
                  <StatPill label="Listings" value={String(detail.counts.listings)} />
                  <StatPill label="Decks" value={String(detail.counts.decks)} />
                  <StatPill label="AI (7d)" value={String(detail.counts.aiEvents7d)} />
                </div>
              )}

              <Card variant="outline" padding="sm" className="space-y-2">
                <p className="text-sm font-medium text-lantern-text">Adjust gamification</p>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    value={pointsDelta}
                    onChange={(e) => setPointsDelta(e.target.value)}
                    className="w-24 px-2 py-1"
                    aria-label="Points delta"
                  />
                  <Input
                    value={pointsReason}
                    onChange={(e) => setPointsReason(e.target.value)}
                    placeholder="Reason"
                    className="flex-1 px-2 py-1"
                    aria-label="Points reason"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!userId) return;
                      await awardAdminPoints(userId, Number(pointsDelta), pointsReason || undefined);
                      await reload();
                    }}
                  >
                    Award
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Select
                    value={badgeId}
                    onChange={(e) => setBadgeId(e.target.value)}
                    className="flex-1 px-2 py-1"
                    aria-label="Badge"
                    disabled={grantingBadge}
                  >
                    <option value="">Select a badge…</option>
                    {BADGE_OPTIONS.map((def) => {
                      const owned = ownedBadgeIds.has(def.id);
                      return (
                        <option key={def.id} value={def.id} disabled={owned}>
                          {def.icon} {def.baseName}
                          {owned ? ' — already granted' : ''}
                        </option>
                      );
                    })}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!badgeId || selectedBadgeOwned || grantingBadge}
                    onClick={() => void grantBadge()}
                  >
                    {grantingBadge ? 'Granting…' : 'Grant badge'}
                  </Button>
                </div>
                {ownedBadgeIds.size > 0 && (
                  <p className="text-xs text-lantern-text-muted">
                    Holds {ownedBadgeIds.size} of {BADGE_OPTIONS.length} badges. Granted badges start at level I; higher levels are earned automatically.
                  </p>
                )}
              </Card>

              <Card variant="outline" padding="sm" className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-lantern-text">Moderation</p>
                  <p className="text-xs text-lantern-text-muted">
                    {detail.active_strikes ?? 0} active strike{(detail.active_strikes ?? 0) === 1 ? '' : 's'} —{' '}
                    {STRIKE_SUSPENSION_THRESHOLD} active strikes suspend the account automatically for 14 days.
                    Strikes expire after 180 days.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-lantern-text">Add strike</p>
                  <div className="flex gap-2">
                    <Input
                      value={strikeReason}
                      onChange={(e) => setStrikeReason(e.target.value)}
                      placeholder="Reason (shown to the user)"
                      className="flex-1 px-2 py-1"
                      aria-label="Strike reason"
                      maxLength={500}
                    />
                    <Select
                      value={String(strikeSeverity)}
                      onChange={(e) => setStrikeSeverity(Number(e.target.value) as 1 | 2 | 3)}
                      className="w-28 px-2 py-1"
                      aria-label="Strike severity"
                    >
                      <option value="1">Severity 1</option>
                      <option value="2">Severity 2</option>
                      <option value="3">Severity 3</option>
                    </Select>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={!strikeReason.trim() || moderationBusy !== null}
                      loading={moderationBusy === 'strike'}
                      onClick={() => void issueStrike()}
                    >
                      Strike
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-lantern-text">
                    {detail.suspended_until
                      ? `Suspended until ${formatSuspensionDate(detail.suspended_until)}`
                      : 'Suspend until'}
                  </p>
                  {detail.suspended_until ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={moderationBusy !== null}
                      loading={moderationBusy === 'unsuspend'}
                      onClick={() => void unsuspend()}
                    >
                      Lift suspension now
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Input
                        type="date"
                        value={suspendUntil}
                        onChange={(e) => setSuspendUntil(e.target.value)}
                        className="px-2 py-1"
                        aria-label="Suspend until date"
                      />
                      <Input
                        value={suspendReason}
                        onChange={(e) => setSuspendReason(e.target.value)}
                        placeholder="Reason (optional, sent to the user)"
                        className="flex-1 min-w-[10rem] px-2 py-1"
                        aria-label="Suspension reason"
                        maxLength={500}
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={!suspendUntil || moderationBusy !== null}
                        loading={moderationBusy === 'suspend'}
                        onClick={() => void suspendUntilDate()}
                      >
                        Suspend
                      </Button>
                    </div>
                  )}
                  <p className="text-[11px] text-lantern-text-muted">
                    A suspended account keeps its session but every request is refused with the date until it passes.
                    Use Ban (Users tab) for permanent removal.
                  </p>
                </div>
              </Card>

              <Card variant="outline" padding="sm" className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-lantern-text">AI quotas</p>
                  <Button size="sm" variant="ghost" onClick={async () => { if (!userId) return; await resetAdminAIQuota(userId); await reload(); }}>
                    Reset all
                  </Button>
                </div>
                {(detail.aiQuota || []).slice(0, 6).map((q) => (
                  <div key={q.feature} className="flex justify-between text-xs text-lantern-text-muted">
                    <span>{q.feature}</span>
                    <span>{q.used}/{q.limit}</span>
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={() => void loadCompanion()}>
                  Review companion messages
                </Button>
              </Card>

              {showCompanion && (
                <Card variant="outline" padding="sm" className="max-h-64 overflow-y-auto space-y-2">
                  <p className="text-xs font-medium text-lantern-text-muted">Recent companion (read-only)</p>
                  {companionPreview.map((m) => (
                    <div key={m.id} className="text-xs border-b border-lantern-border pb-2">
                      <span className="font-semibold text-lantern-text">{m.role}</span>
                      <span className="ml-2 text-lantern-text-muted">{formatDateTime(m.created_at)}</span>
                      <p className="mt-1 text-lantern-text-secondary line-clamp-3">{m.content}</p>
                    </div>
                  ))}
                </Card>
              )}
            </>
          )}
        </div>
    </Drawer>
  );
};
