import React, { useCallback, useEffect, useState } from 'react';
import { AdminAppeal, decideListingAppeal, fetchAdminAppeals } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { StatPill } from '../ui/StatPill';
import { Textarea } from '../ui/Textarea';
import { formatDateTime } from './types';
import { LISTING_APPEAL_STATUS_LABELS } from '@lantern/shared';

interface AdminAppealsProps {
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

/**
 * Seller appeals of moderation takedowns (GET /admin/appeals). Uphold keeps
 * the takedown and tells the seller; Reverse restores the listing (status
 * active, rights cleared) and clears the takedown fields.
 */
export const AdminAppeals: React.FC<AdminAppealsProps> = ({ onSuccess, onError }) => {
  const [appeals, setAppeals] = useState<AdminAppeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchAdminAppeals();
      setAppeals(rows);
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to load appeals');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (listingId: string, decision: 'upheld' | 'reversed') => {
    const key = `${listingId}:${decision}`;
    setBusy((prev) => ({ ...prev, [key]: true }));
    try {
      await decideListingAppeal(listingId, decision, notes[listingId]?.trim() || undefined);
      setAppeals((prev) => prev.filter((a) => a.id !== listingId));
      onSuccess(decision === 'reversed' ? 'Appeal reversed — listing restored.' : 'Appeal upheld — takedown stands.');
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to decide appeal');
    } finally {
      setBusy((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-lantern-text-muted">
          Sellers may appeal a takedown once. Reversing restores the listing and clears its rights state;
          upholding keeps it down. The seller is notified either way.
        </p>
        <Button size="sm" variant="secondary" onClick={() => void load()} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
      <div className="space-y-3">
        {appeals.map((appeal) => {
          const sellerName = appeal.seller?.name || appeal.seller?.username || appeal.user_id.slice(0, 8);
          return (
            <Card key={appeal.id} variant="outline" padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-lantern-text">{appeal.title}</p>
                  <p className="text-sm text-lantern-text-muted">
                    Seller: {sellerName} · Listing status: {appeal.status}
                    {appeal.rights_status ? ` · Rights: ${appeal.rights_status}` : ''}
                  </p>
                  {appeal.takedown_reason ? (
                    <p className="text-xs text-lantern-text-muted mt-1">
                      Takedown reason: {appeal.takedown_reason}
                      {appeal.takedown_at ? ` (${formatDateTime(appeal.takedown_at)})` : ''}
                    </p>
                  ) : null}
                  {appeal.appeal_note ? (
                    <p className="text-sm text-lantern-text-secondary mt-1 whitespace-pre-wrap">
                      Seller says: {appeal.appeal_note}
                    </p>
                  ) : null}
                </div>
                <StatPill
                  label="Appeal"
                  value={LISTING_APPEAL_STATUS_LABELS[appeal.appeal_status] ?? appeal.appeal_status}
                  accent="warning"
                />
              </div>
              {appeal.appealed_at ? (
                <p className="text-xs text-lantern-text-muted">Appealed {formatDateTime(appeal.appealed_at)}</p>
              ) : null}
              <Textarea
                value={notes[appeal.id] || ''}
                onChange={(e) => setNotes((prev) => ({ ...prev, [appeal.id]: e.target.value }))}
                placeholder="Decision note (optional — sent to the seller)"
                rows={2}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  loading={busy[`${appeal.id}:reversed`]}
                  onClick={() => void decide(appeal.id, 'reversed')}
                >
                  Reverse — restore listing
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy[`${appeal.id}:upheld`]}
                  onClick={() => void decide(appeal.id, 'upheld')}
                >
                  Uphold takedown
                </Button>
              </div>
            </Card>
          );
        })}
        {!appeals.length && !loading ? (
          <p className="text-sm text-lantern-text-muted">No open appeals.</p>
        ) : null}
      </div>
    </Card>
  );
};

export default AdminAppeals;
