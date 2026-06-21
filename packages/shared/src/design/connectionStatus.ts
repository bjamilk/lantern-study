// ===========================================
// Connection / sync status copy & helpers
// ===========================================

export type ConnectionState =
  | 'online'
  | 'offline'
  | 'syncing'
  | 'lowData'
  | 'stale';

export interface ConnectionStatusInput {
  isOnline: boolean;
  lowDataMode: boolean;
  pendingSyncCount?: number;
  isSyncing?: boolean;
  lastSyncedAt?: Date | string | null;
}

export interface ConnectionStatusDisplay {
  state: ConnectionState;
  label: string;
  shortLabel: string;
  icon: 'wifi' | 'wifi-off' | 'sync' | 'signal' | 'clock';
}

export function getConnectionStatus(input: ConnectionStatusInput): ConnectionStatusDisplay {
  const { isOnline, lowDataMode, pendingSyncCount = 0, isSyncing, lastSyncedAt } = input;

  if (!isOnline) {
    const pending = pendingSyncCount > 0 ? ` · ${pendingSyncCount} pending` : '';
    return {
      state: 'offline',
      label: `Offline${pending}`,
      shortLabel: pendingSyncCount > 0 ? `Offline · ${pendingSyncCount}` : 'Offline',
      icon: 'wifi-off',
    };
  }

  if (isSyncing) {
    return {
      state: 'syncing',
      label: 'Syncing…',
      shortLabel: 'Syncing',
      icon: 'sync',
    };
  }

  if (lowDataMode) {
    const pending = pendingSyncCount > 0 ? ` · ${pendingSyncCount} to sync` : '';
    return {
      state: 'lowData',
      label: `Low data mode${pending}`,
      shortLabel: 'Low data',
      icon: 'signal',
    };
  }

  if (pendingSyncCount > 0) {
    return {
      state: 'syncing',
      label: `${pendingSyncCount} item${pendingSyncCount === 1 ? '' : 's'} pending sync`,
      shortLabel: `${pendingSyncCount} pending`,
      icon: 'sync',
    };
  }

  if (lastSyncedAt) {
    const date = typeof lastSyncedAt === 'string' ? new Date(lastSyncedAt) : lastSyncedAt;
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins > 60) {
      return {
        state: 'stale',
        label: `Last synced ${mins >= 1440 ? `${Math.floor(mins / 1440)}d` : `${Math.floor(mins / 60)}h`} ago`,
        shortLabel: 'Stale',
        icon: 'clock',
      };
    }
  }

  return {
    state: 'online',
    label: 'Synced',
    shortLabel: 'Synced',
    icon: 'wifi',
  };
}

export const syncCopy = {
  savedLocally: 'Saved on this device — will sync when online',
  pendingSync: (count: number) =>
    `${count} change${count === 1 ? '' : 's'} waiting to sync`,
  lastSynced: (date: Date) => {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'Synced just now';
    if (mins < 60) return `Synced ${mins}m ago`;
    if (mins < 1440) return `Synced ${Math.floor(mins / 60)}h ago`;
    return `Synced ${Math.floor(mins / 1440)}d ago`;
  },
  lowDataAiHint: 'Connect to Wi‑Fi or turn off low data mode to use AI',
  lowDataDefaultHint: 'Designed for slow connections. Change in Settings → Data & Sync.',
} as const;

/** Generate deterministic avatar background from a name or id */
export function avatarColorFromSeed(seed: string): string {
  const palette = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f59e0b', '#10b981', '#0ea5e9', '#14b8a6',
  ];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % palette.length;
  return palette[idx] ?? '#6366f1';
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  const first = parts[0]?.[0] ?? '';
  const last = parts[parts.length - 1]?.[0] ?? '';
  return (first + last).toUpperCase() || '?';
}
