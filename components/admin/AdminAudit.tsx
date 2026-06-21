import React from 'react';
import { AdminAuditEntry } from '../../services/admin';
import { Card } from '../ui/Card';
import { formatDateTime } from './types';

interface AdminAuditProps {
  entries: AdminAuditEntry[];
}

export const AdminAudit: React.FC<AdminAuditProps> = ({ entries }) => (
  <Card>
    <h3 className="text-sm font-semibold text-lantern-text mb-3">Recent admin actions</h3>
    {!entries.length ? <p className="text-sm text-lantern-text-muted">No audit entries yet.</p> : null}
    <ul className="space-y-2">
      {entries.map((entry) => (
        <li key={entry.id} className="text-sm border-b border-lantern-border pb-2">
          <div className="flex justify-between gap-2">
            <span className="font-medium text-lantern-text">{entry.action}</span>
            <span className="text-xs text-lantern-text-muted shrink-0">{formatDateTime(entry.created_at)}</span>
          </div>
          <p className="text-lantern-text-muted">
            {entry.actor?.name || entry.actor?.username || entry.actor_id || 'System'} → {entry.target_type}
            {entry.target_id ? `: ${entry.target_id}` : ''}
          </p>
          {entry.reason ? <p className="text-xs text-lantern-text-secondary">Reason: {entry.reason}</p> : null}
        </li>
      ))}
    </ul>
  </Card>
);
