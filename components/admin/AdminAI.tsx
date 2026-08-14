import React, { useState } from 'react';
import { AdminAIUserUsage } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';

interface AdminAIProps {
  analytics: {
    totalEvents: number;
    byEvent: Record<string, number>;
    byDay: Record<string, number>;
    periodDays: number;
  } | null;
  usageByUser: AdminAIUserUsage[];
  periodDays: number;
  onPeriodChange: (days: number) => void;
  onSelectUser: (userId: string) => void;
  onResetQuota: (userId: string) => void;
  actionLoading: Record<string, boolean>;
}

export const AdminAI: React.FC<AdminAIProps> = ({
  analytics,
  usageByUser,
  periodDays,
  onPeriodChange,
  onSelectUser,
  onResetQuota,
  actionLoading,
}) => {
  const [companionUserId, setCompanionUserId] = useState('');
  const dayEntries = Object.entries(analytics?.byDay || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, count]) => {
      const max = Math.max(1, ...Object.values(analytics?.byDay || {}));
      return { day, count, widthPct: (count / max) * 100 };
    });

  // Pills must sum event names that are actually written to ai_analytics.
  // Every writer emits companion_* names (see trackAIAnalyticsEvent callers in
  // AICompanionPanel) — the previous names (companion_message,
  // generate_flashcards, study_recommendations…) never existed in the table,
  // so three of the four pills were hardwired to zero.
  const byEvent = analytics?.byEvent || {};
  const messagesSent = byEvent.companion_message_sent || 0;
  const voiceDictations =
    (byEvent.companion_voice_dictation || 0) + (byEvent.companion_voice_dictation_start || 0);
  const noteAttachments = byEvent.companion_note_context_attached || 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center">
        <label className="text-sm text-lantern-text-muted">Period</label>
        <Select
          value={periodDays}
          onChange={(e) => onPeriodChange(Number(e.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </Select>
      </div>

      {analytics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill label="Total events" value={analytics.totalEvents} accent="primary" />
            <StatPill label="Messages sent" value={messagesSent} accent="neutral" />
            <StatPill label="Voice dictations" value={voiceDictations} accent="neutral" />
            <StatPill label="Notes attached" value={noteAttachments} accent="neutral" />
          </div>

          <Card>
            <h3 className="text-sm font-semibold mb-3">By feature</h3>
            <div className="space-y-1">
              {Object.entries(analytics.byEvent)
                .sort(([, a], [, b]) => b - a)
                .map(([event, count]) => (
                  <div key={event} className="flex justify-between text-sm">
                    <span className="text-lantern-text-muted">{event}</span>
                    <span className="font-medium">{count}</span>
                  </div>
                ))}
            </div>
          </Card>

          <Card>
            <h3 className="text-sm font-semibold mb-3">Daily volume</h3>
            <div className="space-y-2">
              {dayEntries.map(({ day, count, widthPct }) => (
                <div key={day} className="flex items-center gap-2 text-xs">
                  <span className="w-20 text-lantern-text-muted">{day}</span>
                  <div className="flex-1 h-2 bg-lantern-background-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-lantern-primary" style={{ width: `${widthPct}%` }} />
                  </div>
                  <span className="w-8 text-right">{count}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card>
        <h3 className="text-sm font-semibold mb-3">Top users</h3>
        <div className="space-y-2">
          {usageByUser.map((row) => (
            <div key={row.user_id} className="flex items-center justify-between gap-2 text-sm">
              <button type="button" className="text-lantern-primary hover:underline text-left" onClick={() => onSelectUser(row.user_id)}>
                {row.name || row.username || row.email || row.user_id.slice(0, 8)}
              </button>
              <span className="text-lantern-text-muted">{row.events} events</span>
              <Button size="sm" variant="ghost" loading={actionLoading[`quota:${row.user_id}`]} onClick={() => onResetQuota(row.user_id)}>
                Reset quota
              </Button>
            </div>
          ))}
        </div>
      </Card>

      <Card variant="outline" padding="sm" className="space-y-2">
        <p className="text-sm font-medium">Companion abuse review</p>
        <div className="flex gap-2">
          <Input
            value={companionUserId}
            onChange={(e) => setCompanionUserId(e.target.value)}
            placeholder="User ID"
            className="flex-1"
          />
          <Button size="sm" disabled={!companionUserId.trim()} onClick={() => onSelectUser(companionUserId.trim())}>
            Open user
          </Button>
        </div>
      </Card>
    </div>
  );
};
