import React from 'react';
import { ACCOUNT_DELETION_GRACE_DAYS } from '@lantern/shared';
import { Button } from './ui';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';

export interface AccountPausedBannerProps {
  deletionScheduledAt?: string | null;
  graceDaysRemaining?: number | null;
  onReactivate: () => void;
  onExport: () => void;
  loading?: boolean;
}

export const AccountPausedBanner: React.FC<AccountPausedBannerProps> = ({
  deletionScheduledAt,
  graceDaysRemaining,
  onReactivate,
  onExport,
  loading = false,
}) => {
  const scheduledLabel = deletionScheduledAt
    ? new Date(deletionScheduledAt).toLocaleDateString(undefined, {
        dateStyle: 'long',
      })
    : null;

  return (
    <div className="mx-4 mt-4 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex gap-3 flex-1">
        <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 shrink-0" />
        <div className="text-sm text-amber-950 dark:text-amber-100">
          <p className="font-semibold">Your account is paused</p>
          <p className="mt-1 text-amber-900/90 dark:text-amber-200/90">
            {scheduledLabel
              ? `Permanent deletion is scheduled for ${scheduledLabel}`
              : `Permanent deletion is scheduled in ${ACCOUNT_DELETION_GRACE_DAYS} days`}
            {graceDaysRemaining != null ? ` (${graceDaysRemaining} day${graceDaysRemaining === 1 ? '' : 's'} left).` : '.'}
            {' '}Reactivate to keep using Lantern Study, or export your data before it is removed.
          </p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <Button variant="secondary" size="sm" onClick={onExport} disabled={loading}>
          Export data
        </Button>
        <Button variant="primary" size="sm" onClick={onReactivate} disabled={loading}>
          {loading ? 'Reactivating…' : 'Reactivate account'}
        </Button>
      </div>
    </div>
  );
};

export default AccountPausedBanner;
