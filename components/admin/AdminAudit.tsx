import React from 'react';
import { AdminAuditEntry } from '../../services/admin';
import { Card } from '../ui/Card';
import { Body, Caption, Heading } from '../ui/Text';
import { formatRelativeTime } from './types';

interface AdminAuditProps {
  entries: AdminAuditEntry[];
  title?: string;
  limit?: number;
  onOpenAll?: () => void;
}

export const AdminAudit: React.FC<AdminAuditProps> = ({
  entries,
  title = 'Recent admin actions',
  limit,
  onOpenAll,
}) => {
  const shown = limit ? entries.slice(0, limit) : entries;

  return (
    <Card padding="md">
      <div className="flex items-center justify-between gap-3 mb-4">
        <Heading className="text-lantern-text">{title}</Heading>
        {onOpenAll ? (
          <button
            type="button"
            onClick={onOpenAll}
            className="text-caption font-semibold text-lantern-text-secondary hover:text-lantern-text min-h-[44px]"
          >
            Full log
          </button>
        ) : null}
      </div>
      {!shown.length ? <Caption className="text-lantern-text-muted">No audit entries yet.</Caption> : null}
      <ul className="space-y-1">
        {shown.map((entry) => (
          <li
            key={entry.id}
            className="rounded-lantern px-2 py-2 -mx-2 hover:bg-lantern-background-secondary transition-colors"
          >
            <div className="flex justify-between gap-2">
              <Body className="font-semibold text-lantern-text">{entry.action}</Body>
              <Caption className="text-lantern-text-muted shrink-0">{formatRelativeTime(entry.created_at)}</Caption>
            </div>
            <Caption className="text-lantern-text-muted">
              {entry.actor?.name || entry.actor?.username || entry.actor_id || 'System'} → {entry.target_type}
              {entry.target_id ? `: ${entry.target_id}` : ''}
            </Caption>
            {entry.reason ? <Caption className="text-lantern-text-secondary">Reason: {entry.reason}</Caption> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
};
