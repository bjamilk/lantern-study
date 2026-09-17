import { AdminPagination, AdminStats, AdminUser } from '../services/admin';
import type { AppIconName } from '../ui/appIconMap';

export type AdminTab =
  | 'overview'
  | 'features'
  | 'analytics'
  | 'users'
  | 'marketplace'
  | 'jobs'
  | 'reports'
  | 'ai'
  | 'communications'
  | 'moderation'
  | 'audit';

export interface AdminTabDef {
  id: AdminTab;
  label: string;
  icon: AppIconName;
}

export interface AdminTabGroup {
  id: string;
  label: string;
  tabs: AdminTabDef[];
}

/** Grouped so the rail reads as an ops console, not a flat strip of 11 pills. */
export const ADMIN_TAB_GROUPS: AdminTabGroup[] = [
  {
    id: 'ops',
    label: 'Operations',
    tabs: [
      { id: 'overview', label: 'Overview', icon: 'grid' },
      { id: 'reports', label: 'Reports', icon: 'flag' },
      { id: 'marketplace', label: 'Marketplace', icon: 'storefront' },
      { id: 'jobs', label: 'Jobs', icon: 'briefcase' },
      { id: 'moderation', label: 'Content', icon: 'shield-warning' },
      { id: 'communications', label: 'Communications', icon: 'megaphone' },
    ],
  },
  {
    id: 'insight',
    label: 'Insight',
    tabs: [
      { id: 'users', label: 'Users', icon: 'people' },
      { id: 'analytics', label: 'Analytics', icon: 'analytics' },
      { id: 'ai', label: 'AI Ops', icon: 'sparkle' },
    ],
  },
  {
    id: 'product',
    label: 'Product',
    tabs: [
      { id: 'features', label: 'Features', icon: 'layers' },
      { id: 'audit', label: 'Audit', icon: 'clipboard' },
    ],
  },
];

export interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  requiredText?: string;
  reasonField?: boolean;
  action?: (reason?: string) => Promise<void>;
}

export interface AdminShellProps {
  onBackToDashboard: () => void;
}

export type TabLoadingState = Record<AdminTab, boolean>;

export const ADMIN_TABS: { id: AdminTab; label: string }[] = ADMIN_TAB_GROUPS.flatMap((group) =>
  group.tabs.map(({ id, label }) => ({ id, label })),
);

export const emptyTabLoading = (): TabLoadingState => ({
  overview: false,
  features: false,
  analytics: false,
  users: false,
  marketplace: false,
  jobs: false,
  reports: false,
  ai: false,
  communications: false,
  moderation: false,
  audit: false,
});

export interface AdminUserDetail extends AdminUser {
  badges?: unknown[];
  stats?: Record<string, unknown>;
  counts?: {
    groups: number;
    listings: number;
    decks: number;
    aiEvents7d: number;
  };
  aiQuota?: Array<{ feature: string; used: number; limit: number; resetsAt: string }>;
}

export function exportCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [headers.join(','), ...rows.map((row) => headers.map((h) => escape(row[h])).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const formatDate = (iso?: string) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString();
};

export const formatDateTime = (iso?: string) => {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
};

export const formatRelativeTime = (iso?: string) => {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const deltaMs = Date.now() - then;
  const mins = Math.floor(deltaMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
};

export const reportAgeInfo = (createdAt: string) => {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  if (ageDays <= 1) {
    return { label: `${ageDays}d`, tone: 'success' as const };
  }
  if (ageDays <= 3) {
    return { label: `${ageDays}d`, tone: 'warning' as const };
  }
  return { label: `${ageDays}d`, tone: 'danger' as const };
};

export function usersToCsvRows(users: AdminUser[]) {
  return users.map((u) => ({
    id: u.id,
    name: u.name || '',
    username: u.username || '',
    email: u.email || '',
    points: u.points ?? 0,
    banned: u.is_banned ? 'yes' : 'no',
    admin: u.is_platform_admin ? 'yes' : 'no',
    joined: u.created_at,
  }));
}

export function statsSummary(stats: AdminStats) {
  return [
    { metric: 'totalUsers', value: stats.totalUsers },
    { metric: 'activeGroups', value: stats.activeGroups ?? 0 },
    { metric: 'messagesLast24h', value: stats.messagesLast24h ?? 0 },
    { metric: 'openReports', value: stats.openReports },
    { metric: 'openDisputes', value: stats.openDisputes ?? 0 },
    { metric: 'aiTokens7d', value: stats.aiTokens7d ?? 0 },
    { metric: 'estimatedAiCost7d', value: stats.estimatedAiCost7d },
  ];
}

export type PaginationProps = {
  pagination: AdminPagination | null;
  onPrev: () => void;
  onNext: () => void;
};
