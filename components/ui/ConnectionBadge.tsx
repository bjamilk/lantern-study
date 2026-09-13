import React from 'react';
import { AppIcon, type AppIconName } from './AppIcon';
import { getConnectionStatus, type ConnectionStatusInput } from '@lantern/shared/design';

interface ConnectionBadgeProps {
  isOnline: boolean;
  lowDataMode: boolean;
  pendingSyncCount?: number;
  isSyncing?: boolean;
  lastSyncedAt?: Date | string | null;
  compact?: boolean;
  /** Hide the word and keep the glyph — used when the nav rail is collapsed. */
  iconOnly?: boolean;
  className?: string;
}

const iconMap: Record<string, AppIconName> = {
  wifi: 'wifi',
  'wifi-off': 'cellular',
  sync: 'refresh',
  signal: 'cellular',
  clock: 'time',
};

const stateStyles: Record<string, string> = {
  online: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  offline: 'bg-amber-50 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  syncing: 'bg-lantern-primary-background text-lantern-primary-dark border-lantern-primary/30',
  lowData: 'bg-lantern-accent-background text-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800',
  stale: 'bg-lantern-background-secondary text-lantern-text dark:bg-lantern-surface dark:text-lantern-text-tertiary border-lantern-border',
};

export const ConnectionBadge: React.FC<ConnectionBadgeProps> = ({
  isOnline,
  lowDataMode,
  pendingSyncCount = 0,
  isSyncing = false,
  lastSyncedAt,
  compact = false,
  iconOnly = false,
  className = '',
}) => {
  const input: ConnectionStatusInput = {
    isOnline,
    lowDataMode,
    pendingSyncCount,
    isSyncing,
    lastSyncedAt,
  };
  const status = getConnectionStatus(input);
  const iconName = iconMap[status.icon];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={status.label}
      title={status.label}
      className={`inline-flex items-center ${iconOnly ? 'justify-center gap-0 px-1.5 py-1.5' : 'gap-1.5 px-2.5 py-1'} rounded-full text-xs font-medium border ${stateStyles[status.state]} ${className}`}
    >
      <AppIcon
        name={iconName}
        size={14}
        className={`shrink-0 ${status.state === 'syncing' ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      {iconOnly ? null : <span>{compact ? status.shortLabel : status.label}</span>}
    </div>
  );
};

export default ConnectionBadge;
