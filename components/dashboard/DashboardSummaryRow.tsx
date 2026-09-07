import React from 'react';
import { AppIcon } from '../ui/AppIcon';

interface DashboardSummaryRowProps {
  dueCardsCount: number;
  pendingSyncCount: number;
  unreadNotificationCount: number;
}

const summaryCardBase =
  'flex items-center gap-3 p-3 rounded-lantern border border-lantern-border bg-lantern-background-secondary';

export const DashboardSummaryRow: React.FC<DashboardSummaryRowProps> = ({
  dueCardsCount,
  pendingSyncCount,
  unreadNotificationCount,
}) => (
  <div className="bg-lantern-surface/95 rounded-lantern-xl shadow-lantern border border-lantern-border p-4 md:p-5">
    <h2 className="text-heading text-lantern-text flex items-center mb-4">
      <AppIcon name="rocket" size={20} className="mr-2 text-lantern-primary-text" />
      Today&apos;s Summary
    </h2>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div className={summaryCardBase}>
        <div className="w-10 h-10 rounded-lg bg-lantern-success/15 flex items-center justify-center flex-shrink-0">
          <AppIcon name="albums" size={24} className="text-lantern-success" />
        </div>
        <div>
          <p className="text-display tabular-nums text-lantern-text">{dueCardsCount}</p>
          <p className="text-caption text-lantern-text-secondary">Flashcards Due</p>
        </div>
      </div>
      <div className={summaryCardBase}>
        <div className="w-10 h-10 rounded-lg bg-lantern-accent-background flex items-center justify-center flex-shrink-0">
          <AppIcon name="time" size={24} className="text-lantern-accent" />
        </div>
        <div>
          <p className="text-display tabular-nums text-lantern-text">{pendingSyncCount}</p>
          <p className="text-caption text-lantern-text-secondary">Pending Syncs</p>
        </div>
      </div>
      <div className={summaryCardBase}>
        <div className="w-10 h-10 rounded-lg bg-lantern-info/15 flex items-center justify-center flex-shrink-0">
          <AppIcon name="notifications" size={24} filled className="text-lantern-info" />
        </div>
        <div>
          <p className="text-display tabular-nums text-lantern-text">{unreadNotificationCount}</p>
          <p className="text-caption text-lantern-text-secondary">Unread Notifications</p>
        </div>
      </div>
    </div>
  </div>
);

export default DashboardSummaryRow;
