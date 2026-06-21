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
      } catch (err: any) {
        if (!cancelled) setError(err.message || 'Failed to load user');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!userId) return null;

  const reload = async () => {
    const data = await fetchAdminUserDetail(userId);
    setDetail(data);
    onUpdated?.();
  };

  const loadCompanion = async () => {
    const messages = await fetchAdminCompanionMessages(userId, 15);
    setCompanionPreview(messages);
    setShowCompanion(true);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/40">
      <Card className="h-full w-full max-w-lg overflow-y-auto rounded-none border-l border-lantern-border p-0">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-lantern-border bg-lantern-surface p-4">
          <div>
            <h2 className="text-lg font-semibold text-lantern-text">User detail</h2>
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
                  />
                  <Input
                    value={pointsReason}
                    onChange={(e) => setPointsReason(e.target.value)}
                    placeholder="Reason"
                    className="flex-1 px-2 py-1"
                  />
                  <Button
                    size="sm"
                    onClick={async () => {
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
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={async () => {
                      if (!badgeId.trim()) return;
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
                  <Button size="sm" variant="ghost" onClick={async () => { await resetAdminAIQuota(userId); await reload(); }}>
                    Reset all
                  </Button>
                </div>
                {(detail.aiQuota || []).slice(0, 6).map((q) => (
                  <div key={q.feature} className="flex justify-between text-xs text-lantern-text-muted">
                    <span>{q.feature}</span>
                    <span>{q.used}/{q.limit}</span>
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={loadCompanion}>
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
      </Card>
    </div>
  );
};
