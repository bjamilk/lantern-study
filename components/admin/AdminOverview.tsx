import React, { useMemo } from 'react';
import { AdminActivityItem, AdminAuditEntry, AdminStats } from '../../services/admin';
import { AppIcon, type AppIconName } from '../ui/AppIcon';
import { Card } from '../ui/Card';
import { Skeleton } from '../ui/Skeleton';
import { Body, Caption, Display, Heading, Label } from '../ui/Text';
import { AdminAudit } from './AdminAudit';
import { PRODUCT_FEATURES, sortProductFeatures } from './productFeatures';
import { AdminTab, formatRelativeTime } from './types';

interface AdminOverviewProps {
  stats: AdminStats | null;
  activity: AdminActivityItem[];
  audit?: AdminAuditEntry[];
  loading?: boolean;
  onExportStats: () => void;
  onOpenTab?: (tab: AdminTab) => void;
}

const ACTIVITY_TAB: Record<AdminActivityItem['type'], AdminTab> = {
  user_joined: 'users',
  report_created: 'reports',
  listing_created: 'marketplace',
  ai_event: 'ai',
};

const ACTIVITY_ICON: Record<AdminActivityItem['type'], AppIconName> = {
  user_joined: 'person-add',
  report_created: 'flag',
  listing_created: 'storefront',
  ai_event: 'sparkle',
};

export const AdminOverview: React.FC<AdminOverviewProps> = ({
  stats,
  activity,
  audit = [],
  loading = false,
  onExportStats,
  onOpenTab,
}) => {
  const recentFeatures = useMemo(() => sortProductFeatures(PRODUCT_FEATURES).slice(0, 4), []);

  if (!stats) {
    if (loading) return <OverviewSkeleton />;
    return null;
  }

  const openReports = stats.openReports ?? 0;
  const openDisputes = stats.openDisputes ?? 0;
  const queueCount = openReports + openDisputes;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Label className="uppercase text-lantern-text-muted">Today</Label>
          <Heading className="text-lantern-text mt-1">
            {queueCount > 0
              ? `${queueCount} item${queueCount === 1 ? '' : 's'} need attention`
              : 'Queues are clear'}
          </Heading>
        </div>
        <button
          type="button"
          onClick={onExportStats}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-caption font-semibold text-lantern-text-secondary hover:text-lantern-text"
        >
          <AppIcon name="download" size={16} />
          Export stats CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PulseCard
          label="Open reports"
          value={openReports}
          hint={openReports > 0 ? 'Review the queue' : 'Nothing waiting'}
          icon="flag"
          tone={openReports > 0 ? 'alert' : 'clear'}
          onClick={onOpenTab ? () => onOpenTab('reports') : undefined}
        />
        <PulseCard
          label="Open disputes"
          value={openDisputes}
          hint={openDisputes > 0 ? 'Marketplace holds' : 'No open holds'}
          icon="scale"
          tone={openDisputes > 0 ? 'alert' : 'clear'}
          onClick={onOpenTab ? () => onOpenTab('marketplace') : undefined}
        />
        <PulseCard
          label="AI cost (7d)"
          value={`$${(stats.estimatedAiCost7d ?? 0).toFixed(2)}`}
          hint={`${(stats.aiTokens7d ?? 0).toLocaleString()} tokens`}
          icon="sparkle"
          tone="ai"
          onClick={onOpenTab ? () => onOpenTab('ai') : undefined}
        />
      </div>

      <Section title="Platform">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Users" value={stats.totalUsers} icon="people" onClick={onOpenTab ? () => onOpenTab('users') : undefined} />
          <KpiTile label="Active (7d)" value={stats.activeUsers7d ?? 0} icon="trending-up" />
          <KpiTile label="New today" value={stats.newUsersToday} icon="person-add" />
          <KpiTile label="Active groups" value={stats.activeGroups ?? 0} icon="chatbubbles" />
          <KpiTile label="Messages (24h)" value={stats.messagesLast24h ?? 0} icon="chatbubble-ellipses" />
          <KpiTile label="Decks" value={stats.totalDecks ?? 0} icon="albums" />
          <KpiTile
            label="Active listings"
            value={stats.activeListings ?? 0}
            icon="storefront"
            onClick={onOpenTab ? () => onOpenTab('marketplace') : undefined}
          />
          <KpiTile label="Offline bundles" value={stats.offlineBundles ?? 0} icon="cloud-download" />
        </div>
      </Section>

      <Section title="AI & moderation">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="AI events (24h)" value={stats.aiEventsLast24h} icon="flash" />
          <KpiTile label="AI events (7d)" value={stats.aiEventsLast7d} icon="analytics" />
          <KpiTile label="Reports resolved (7d)" value={stats.reportsResolved7d} icon="checkmark-circle" />
          <KpiTile label="Listings" value={stats.totalListings} icon="pricetag" />
        </div>
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <Card padding="md">
          <div className="flex items-center justify-between gap-3 mb-4">
            <Heading className="text-lantern-text">Recent activity</Heading>
          </div>
          {activity.length === 0 ? (
            <Caption className="text-lantern-text-muted">No recent activity.</Caption>
          ) : (
            <ul className="space-y-1">
              {activity.map((item) => {
                const go = onOpenTab ? () => onOpenTab(ACTIVITY_TAB[item.type]) : undefined;
                const rowClass = `w-full flex items-start gap-3 rounded-lantern px-2 py-2 -mx-2 text-left transition-colors ${
                  go ? 'hover:bg-lantern-background-secondary' : ''
                }`;
                const content = (
                  <>
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-lantern-background-secondary text-lantern-text-secondary">
                      <AppIcon name={ACTIVITY_ICON[item.type]} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <Body className="font-semibold text-lantern-text">{item.title}</Body>
                      <Caption className="text-lantern-text-muted line-clamp-2">{item.description}</Caption>
                    </span>
                    <Caption className="shrink-0 text-lantern-text-muted">{formatRelativeTime(item.created_at)}</Caption>
                  </>
                );
                return (
                  <li key={item.id}>
                    {go ? (
                      <button type="button" onClick={go} className={rowClass}>
                        {content}
                      </button>
                    ) : (
                      <div className={rowClass}>{content}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <AdminAudit
          entries={audit}
          title="Recent admin actions"
          onOpenAll={onOpenTab ? () => onOpenTab('audit') : undefined}
          limit={8}
        />
      </div>

      <Card padding="md">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <Heading className="text-lantern-text">Recently shipped</Heading>
            <Caption className="text-lantern-text-muted mt-0.5">
              Latest product entries. Open Features for the full registry.
            </Caption>
          </div>
          {onOpenTab ? (
            <button
              type="button"
              onClick={() => onOpenTab('features')}
              className="text-caption font-semibold text-lantern-text-secondary hover:text-lantern-text min-h-[44px]"
            >
              View all features
            </button>
          ) : null}
        </div>
        <ul className="divide-y divide-lantern-border">
          {recentFeatures.map((feature) => (
            <li key={feature.id} className="flex justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Body className="font-semibold text-lantern-text line-clamp-1">{feature.title}</Body>
                <Caption className="text-lantern-text-muted line-clamp-2">{feature.summary}</Caption>
              </div>
              <Caption className="shrink-0 text-lantern-text-muted tabular-nums">{feature.shippedAt}</Caption>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <Label className="uppercase text-lantern-text-muted">{title}</Label>
      {children}
    </section>
  );
}

function PulseCard({
  label,
  value,
  hint,
  icon,
  tone,
  onClick,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: AppIconName;
  tone: 'alert' | 'clear' | 'ai';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'alert'
      ? 'bg-lantern-accent-background text-lantern-accent'
      : tone === 'ai'
        ? 'bg-lantern-feature-ai-tint text-lantern-feature-ai-ink'
        : 'bg-lantern-background-secondary text-lantern-text-secondary';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 text-left transition-all ${
        onClick ? 'hover:border-lantern-text-tertiary hover:shadow-lantern' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <Label className="uppercase text-lantern-text-muted">{label}</Label>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>
          <AppIcon name={icon} size={16} />
        </span>
      </div>
      <Display numeral className="text-lantern-text mt-3">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Display>
      <Caption className="text-lantern-text-muted mt-1 inline-flex items-center gap-1">
        {hint}
        {onClick ? <AppIcon name="chevron-forward" size={14} /> : null}
      </Caption>
    </Tag>
  );
}

function KpiTile({
  label,
  value,
  icon,
  onClick,
}: {
  label: string;
  value: number;
  icon: AppIconName;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`rounded-lantern border border-lantern-border bg-lantern-surface p-4 text-left ${
        onClick ? 'hover:border-lantern-text-tertiary hover:shadow-lantern transition-all' : ''
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-lantern-background-secondary text-lantern-text-secondary">
          <AppIcon name={icon} size={18} />
        </span>
        <div className="min-w-0">
          <Caption className="text-lantern-text-secondary truncate">{label}</Caption>
          <Heading as="p" numeral className="text-lantern-text">
            {value.toLocaleString()}
          </Heading>
        </div>
      </div>
    </Tag>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading admin overview">
      <Skeleton className="h-6 w-48" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

export default AdminOverview;
