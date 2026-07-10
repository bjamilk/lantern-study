import React from 'react';
import { AdminActivityItem, AdminStats } from '../../services/admin';
import { Card } from '../ui/Card';
import { StatPill } from '../ui/StatPill';
import { StatChip } from '../ui/StatChip';
import { formatDateTime } from './types';

interface AdminOverviewProps {
  stats: AdminStats | null;
  activity: AdminActivityItem[];
  onExportStats: () => void;
}

export const AdminOverview: React.FC<AdminOverviewProps> = ({ stats, activity, onExportStats }) => {
  if (!stats) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {stats.openReports > 0 ? (
            <StatChip label={`${stats.openReports} open reports`} variant="accent" />
          ) : null}
          {(stats.openDisputes ?? 0) > 0 ? (
            <StatChip label={`${stats.openDisputes} open disputes`} variant="accent" />
          ) : null}
        </div>
        <button type="button" onClick={onExportStats} className="text-sm text-lantern-primary hover:underline">
          Export stats CSV
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        <StatPill label="Users" value={stats.totalUsers} accent="primary" />
        <StatPill label="Active groups" value={stats.activeGroups ?? 0} accent="neutral" />
        <StatPill label="Messages (24h)" value={stats.messagesLast24h ?? 0} accent="neutral" />
        <StatPill label="Open reports" value={stats.openReports} accent="warning" />
        <StatPill label="Open disputes" value={stats.openDisputes ?? 0} accent="warning" />
        <StatPill label="Decks" value={stats.totalDecks ?? 0} accent="neutral" />
        <StatPill label="Offline bundles" value={stats.offlineBundles ?? 0} accent="neutral" />
        <StatPill label="Active users (7d)" value={stats.activeUsers7d ?? 0} accent="success" />
        <StatPill label="AI cost (7d)" value={`$${stats.estimatedAiCost7d.toFixed(2)}`} accent="accent" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card padding="sm">
          <p className="text-xs uppercase text-lantern-text-muted">New users today</p>
          <p className="text-2xl font-bold text-lantern-text">{stats.newUsersToday}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs uppercase text-lantern-text-muted">Reports resolved (7d)</p>
          <p className="text-2xl font-bold text-lantern-text">{stats.reportsResolved7d}</p>
        </Card>
        <Card padding="sm">
          <p className="text-xs uppercase text-lantern-text-muted">AI events (24h)</p>
          <p className="text-2xl font-bold text-lantern-text">{stats.aiEventsLast24h}</p>
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-semibold text-lantern-text mb-3">Recent activity</h3>
        <ul className="space-y-2">
          {activity.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-sm border-b border-lantern-border pb-2 hover:bg-lantern-background-secondary rounded-lantern px-1 -mx-1 transition-colors">
              <div>
                <p className="font-medium text-lantern-text">{item.title}</p>
                <p className="text-lantern-text-muted">{item.description}</p>
              </div>
              <span className="text-xs text-lantern-text-muted shrink-0">{formatDateTime(item.created_at)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};
