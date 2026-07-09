import { AdminPagination, AdminStats, AdminUser } from '../services/admin';

export type AdminTab =
  | 'overview'
  | 'analytics'
  | 'users'
  | 'marketplace'
  | 'reports'
  | 'ai'
  | 'communications'
  | 'moderation'
  | 'audit';

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

export const ADMIN_TABS: { id: AdminTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'users', label: 'Users' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'reports', label: 'Reports' },
  { id: 'ai', label: 'AI Ops' },
  { id: 'communications', label: 'Communications' },
  { id: 'moderation', label: 'Content' },
  { id: 'audit', label: 'Audit' },
];

export const emptyTabLoading = (): TabLoadingState => ({
  overview: false,
  analytics: false,
  users: false,
  marketplace: false,
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
    { metric: 'estimatedAiCost7d', value: stats.estimatedAiCost7d },
  ];
}

export type PaginationProps = {
  pagination: AdminPagination | null;
  onPrev: () => void;
  onNext: () => void;
};
