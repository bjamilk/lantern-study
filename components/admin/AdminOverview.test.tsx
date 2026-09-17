import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminActivityItem, AdminAuditEntry, AdminStats } from '../../services/admin';
import { AdminOverview } from './AdminOverview';
import { ADMIN_TAB_GROUPS, ADMIN_TABS, formatRelativeTime } from './types';

const stats: AdminStats = {
  totalUsers: 1280,
  totalListings: 44,
  activeListings: 31,
  openReports: 3,
  openDisputes: 1,
  aiEventsLast24h: 90,
  newUsersToday: 12,
  aiEventsLast7d: 400,
  reportsResolved7d: 8,
  estimatedAiCost7d: 12.4,
  aiTokens7d: 88000,
  aiEventEstimatedCostUsd: 0.01,
  activeGroups: 22,
  messagesLast24h: 310,
  totalDecks: 540,
  offlineBundles: 18,
  activeUsers7d: 210,
};

const activity: AdminActivityItem[] = [
  {
    id: 'a1',
    type: 'report_created',
    title: 'New report',
    description: 'Spam listing flagged',
    created_at: new Date().toISOString(),
  },
];

const audit: AdminAuditEntry[] = [
  {
    id: 'u1',
    actor_id: 'admin-1',
    action: 'ban_user',
    target_type: 'user',
    target_id: 'u-9',
    created_at: new Date().toISOString(),
    actor: { id: 'admin-1', name: 'Jamin' },
  },
];

describe('admin tab groups', () => {
  it('covers every tab exactly once', () => {
    const ids = ADMIN_TAB_GROUPS.flatMap((group) => group.tabs.map((tab) => tab.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(11);
    expect(ADMIN_TABS.map((tab) => tab.id).sort()).toEqual(ids.slice().sort());
  });
});

describe('formatRelativeTime', () => {
  it('renders just now and minute-scale labels', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('Just now');
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000).toISOString())).toBe('5m ago');
    expect(formatRelativeTime()).toBe('—');
  });
});

describe('AdminOverview', () => {
  it('leads with queues and platform KPIs, not a flat pill dump', () => {
    const html = renderToStaticMarkup(
      <AdminOverview stats={stats} activity={activity} audit={audit} onExportStats={() => undefined} />,
    );
    expect(html).toContain('4 items need attention');
    expect(html).toContain('Open reports');
    expect(html).toContain('Open disputes');
    expect(html).toContain('$12.40');
    expect(html).toContain('1,280');
    expect(html).toContain('Active (7d)');
    expect(html).toContain('New report');
    expect(html).toContain('ban_user');
    expect(html).toContain('Recently shipped');
    expect(html).toContain('Export stats CSV');
  });

  it('routes queue cards to the matching section', () => {
    const onOpenTab = vi.fn();
    const html = renderToStaticMarkup(
      <AdminOverview
        stats={stats}
        activity={activity}
        audit={audit}
        onExportStats={() => undefined}
        onOpenTab={onOpenTab}
      />,
    );
    expect(html).toContain('Review the queue');
    expect(html).toContain('View all features');
    expect(html).toContain('Full log');
  });

  it('says queues are clear when nothing is waiting', () => {
    const html = renderToStaticMarkup(
      <AdminOverview
        stats={{ ...stats, openReports: 0, openDisputes: 0 }}
        activity={[]}
        audit={[]}
        onExportStats={() => undefined}
      />,
    );
    expect(html).toContain('Queues are clear');
    expect(html).toContain('Nothing waiting');
    expect(html).toContain('No recent activity');
  });

  it('shows a skeleton while stats are loading', () => {
    const html = renderToStaticMarkup(
      <AdminOverview stats={null} activity={[]} loading onExportStats={() => undefined} />,
    );
    expect(html).toContain('Loading admin overview');
  });
});
