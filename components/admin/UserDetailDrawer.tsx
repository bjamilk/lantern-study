import React, { useEffect, useState } from 'react';
import {
  AdminUserDetail,
  awardAdminBadge,
  awardAdminPoints,
  fetchAdminCompanionMessages,
  fetchAdminUserDetail,
  resetAdminAIQuota,
} from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { StatPill } from '../ui/StatPill';
import Drawer from '../ui/Drawer';
import { formatDate, formatDateTime } from './types';

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
  const [companionPreview, setCompanionPreview] = useState<Array<{ id: string; role: string; content: string; created_at: string }>>([]);
  const [showCompanion, setShowCompanion] = useState(false);

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
                  {detail.is_banned ? <StatPill label="Status" value="Banned" accent="warning" /> : <StatPill label="Status" value="Active" accent="success" />}
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
                  <Input
                    value={badgeId}
                    onChange={(e) => setBadgeId(e.target.value)}
                    placeholder="Badge ID"
                    className="flex-1 px-2 py-1"
                    aria-label="Badge ID"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!userId || !badgeId.trim()) return;
                      await awardAdminBadge(userId, badgeId.trim());
                      await reload();
                    }}
                  >
                    Grant badge
                  </Button>
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
