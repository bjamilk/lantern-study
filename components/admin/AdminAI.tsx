import React, { useState } from 'react';
import { AdminAITokens, AdminAIUserUsage, AdminProviderProbe, probeAdminAiProvider } from '../../services/admin';
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
  tokens: AdminAITokens | null;
  usageByUser: AdminAIUserUsage[];
  periodDays: number;
  onPeriodChange: (days: number) => void;
  onSelectUser: (userId: string) => void;
  onResetQuota: (userId: string) => void;
  actionLoading: Record<string, boolean>;
}

export const AdminAI: React.FC<AdminAIProps> = ({
  analytics,
  tokens,
  usageByUser,
  periodDays,
  onPeriodChange,
  onSelectUser,
  onResetQuota,
  actionLoading,
}) => {
  const [companionUserId, setCompanionUserId] = useState('');
  const [probes, setProbes] = useState<Record<string, AdminProviderProbe | { error: string }>>({});
  const [probing, setProbing] = useState<string | null>(null);

  const runProbe = async (provider: string) => {
    setProbing(provider);
    try {
      const result = await probeAdminAiProvider(provider);
      setProbes((prev) => ({ ...prev, [provider]: result }));
    } catch (err) {
      setProbes((prev) => ({
        ...prev,
        [provider]: { error: err instanceof Error ? err.message : 'Probe failed' },
      }));
    } finally {
      setProbing(null);
    }
  };
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

  const featureTokenRows = Object.entries(tokens?.byFeature || {})
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .slice(0, 12);
  const maxFeatureTokens = Math.max(1, ...featureTokenRows.map(([, v]) => v.tokens));
  const totalCalls = (tokens?.paidCalls || 0) + (tokens?.cacheServed || 0);
  const cacheServedPct = totalCalls > 0 ? Math.round(((tokens?.cacheServed || 0) / totalCalls) * 100) : 0;
  const activeProviders = (tokens?.providersToday || []).filter((p) => p.calls > 0);
  const tokenDayRows = Object.entries(tokens?.byDay || {}).sort(([a], [b]) => a.localeCompare(b));
  const maxDayTokens = Math.max(1, ...tokenDayRows.map(([, v]) => v.tokens));
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

      {tokens && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill label={`Tokens (${tokens.periodDays}d)`} value={tokens.totalTokens.toLocaleString()} accent="primary" />
            <StatPill label="Paid AI calls" value={tokens.paidCalls} accent="neutral" />
            <StatPill label="Served from cache" value={`${cacheServedPct}%`} accent="neutral" />
            <StatPill
              label="Cached input today"
              value={activeProviders.reduce((sum, p) => sum + p.cachedTokens, 0).toLocaleString()}
              accent="neutral"
            />
          </div>

          <Card>
            <h3 className="text-sm font-semibold mb-1">Tokens by feature</h3>
            <p className="text-xs text-lantern-text-muted mb-3">
              Paid tokens per feature over the period. Cache-served calls cost nothing and are counted separately.
              {tokens.truncated ? ' Showing the most recent 10,000 calls only.' : ''}
            </p>
            <div className="space-y-2">
              {featureTokenRows.length === 0 && (
                <p className="text-sm text-lantern-text-muted">No AI calls recorded in this period.</p>
              )}
              {featureTokenRows.map(([feature, row]) => (
                <div key={feature} className="flex items-center gap-2 text-xs">
                  <span className="w-40 truncate text-lantern-text-muted" title={feature}>{feature}</span>
                  <div className="flex-1 h-2 bg-lantern-background-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-lantern-primary" style={{ width: `${(row.tokens / maxFeatureTokens) * 100}%` }} />
                  </div>
                  <span className="w-20 text-right font-medium">{row.tokens.toLocaleString()}</span>
                  <span className="w-24 text-right text-lantern-text-muted">
                    {row.calls} calls{row.cacheServed > 0 ? ` · ${row.cacheServed} cached` : ''}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <h3 className="text-sm font-semibold mb-3">Token spend by day</h3>
              <div className="space-y-2">
                {tokenDayRows.map(([day, row]) => (
                  <div key={day} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-lantern-text-muted">{day}</span>
                    <div className="flex-1 h-2 bg-lantern-background-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-lantern-primary" style={{ width: `${(row.tokens / maxDayTokens) * 100}%` }} />
                    </div>
                    <span className="w-20 text-right">{row.tokens.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h3 className="text-sm font-semibold mb-1">Providers today</h3>
              <p className="text-xs text-lantern-text-muted mb-3">
                Live gauge from the running instance. Cached = input served from the provider&apos;s prefix cache (billed at a discount).
              </p>
              <div className="space-y-2 text-xs">
                {activeProviders.length === 0 && (
                  <p className="text-sm text-lantern-text-muted">No paid calls yet today.</p>
                )}
                {activeProviders.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-2">
                    <span className="font-medium">{p.name}</span>
                    <span className="text-lantern-text-muted">
                      {p.calls} calls · in {p.promptTokens.toLocaleString()} ({p.cachedTokens.toLocaleString()} cached) · out{' '}
                      {p.completionTokens.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}

      {analytics && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatPill label="Companion events" value={analytics.totalEvents} accent="primary" />
            <StatPill label="Messages sent" value={messagesSent} accent="neutral" />
            <StatPill label="Voice dictations" value={voiceDictations} accent="neutral" />
            <StatPill label="Notes attached" value={noteAttachments} accent="neutral" />
          </div>

          <Card>
            <h3 className="text-sm font-semibold mb-3">Companion events by type</h3>
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
            <h3 className="text-sm font-semibold mb-3">Companion events by day</h3>
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
        <h3 className="text-sm font-semibold mb-3">Top AI users</h3>
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

      <Card variant="outline" padding="sm" className="space-y-3">
        <div>
          <p className="text-sm font-medium">Provider health check</p>
          <p className="text-xs text-lantern-text-muted">
            Sends one real request to a single provider. Fireworks is the standby behind Groq, so it never runs in
            normal traffic — this is the only way to confirm its key works before Groq fails. Costs one tiny completion.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {['groq', 'fireworks'].map((provider) => (
            <Button
              key={provider}
              size="sm"
              variant="secondary"
              loading={probing === provider}
              onClick={() => runProbe(provider)}
            >
              Probe {provider}
            </Button>
          ))}
        </div>
        <div className="space-y-1">
          {Object.entries(probes).map(([provider, result]) => (
            <div key={provider} className="text-xs">
              {'error' in result ? (
                <span className="text-lantern-error">{provider}: {result.error}</span>
              ) : (
                <span className={result.ok ? 'text-lantern-success' : 'text-lantern-error'}>
                  {provider}: {result.ok ? 'OK' : 'FAILED'}
                  {result.model ? ` · ${result.model}` : ''}
                  {result.ok ? ` · ${result.latencyMs}ms` : ''}
                  {result.usage ? ` · ${result.usage.promptTokens} in / ${result.usage.completionTokens} out` : ''}
                  {result.usage && result.usage.cachedTokens > 0 ? ` (${result.usage.cachedTokens} cached)` : ''}
                  {result.error ? ` · ${result.error}` : ''}
                </span>
              )}
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
