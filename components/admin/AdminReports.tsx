import React from 'react';
import { AdminPagination, AdminReport } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';
import { Textarea } from '../ui/Textarea';
import { PaginationBar } from './PaginationBar';
import { exportCsv, formatDateTime, reportAgeInfo } from './types';

interface AdminReportsProps {
  reports: AdminReport[];
  pagination: AdminPagination | null;
  statusFilter: 'open' | 'resolved' | 'dismissed';
  reportNotes: Record<string, string>;
  actionLoading: Record<string, boolean>;
  onStatusFilterChange: (value: 'open' | 'resolved' | 'dismissed') => void;
  onNoteChange: (reportId: string, note: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onResolve: (reportId: string, action: 'dismiss' | 'remove_listing' | 'warn_seller') => void;
  onBulkDismiss: () => void;
}

export const AdminReports: React.FC<AdminReportsProps> = ({
  reports,
  pagination,
  statusFilter,
  reportNotes,
  actionLoading,
  onStatusFilterChange,
  onNoteChange,
  onPrev,
  onNext,
  onResolve,
  onBulkDismiss,
}) => (
  <Card className="space-y-3">
    <div className="flex flex-wrap gap-2 justify-between">
      <Select
        value={statusFilter}
        onChange={(e) => onStatusFilterChange(e.target.value as 'open' | 'resolved' | 'dismissed')}
      >
        <option value="open">Open queue</option>
        <option value="resolved">Resolved</option>
        <option value="dismissed">Dismissed</option>
      </Select>
      <div className="flex gap-2">
        {statusFilter === 'open' && reports.length > 0 ? (
          <Button variant="secondary" size="sm" onClick={onBulkDismiss}>
            Bulk dismiss visible
          </Button>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          disabled={!reports.length}
          onClick={() =>
            exportCsv(
              'admin-reports.csv',
              reports.map((r) => ({
                id: r.id,
                reason: r.reason,
                status: r.status,
                listing: r.listing?.title || r.listing_id,
                reporter: r.reporter?.name || r.reporter_id,
                created: r.created_at,
                admin_note: r.admin_note || '',
              }))
            )
          }
        >
          Export CSV
        </Button>
      </div>
    </div>
    <div className="space-y-3">
      {reports.map((report) => {
        const age = reportAgeInfo(report.created_at);
        const accent = age.tone === 'success' ? 'success' : age.tone === 'warning' ? 'warning' : 'primary';
        const warned = report.admin_note?.includes('[warned');
        return (
          <Card key={report.id} variant="outline" padding="sm" className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-lantern-text">{report.listing?.title || report.listing_id}</p>
                <p className="text-sm text-lantern-text-muted">{report.reason} · {report.reporter?.name || 'Unknown reporter'}</p>
                {report.details ? <p className="text-sm text-lantern-text-secondary mt-1">{report.details}</p> : null}
                {report.admin_note ? <p className="text-xs text-lantern-text-muted mt-1">Note: {report.admin_note}</p> : null}
                {warned ? <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Seller was warned</p> : null}
              </div>
              <StatPill label="Age" value={age.label} accent={accent as 'success' | 'warning' | 'primary'} />
            </div>
            <p className="text-xs text-lantern-text-muted">{formatDateTime(report.created_at)}</p>
            {statusFilter === 'open' ? (
              <>
                <Textarea
                  value={reportNotes[report.id] || ''}
                  onChange={(e) => onNoteChange(report.id, e.target.value)}
                  placeholder="Admin note (optional)"
                  rows={2}
                />
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" loading={actionLoading[`report:${report.id}:dismiss`]} onClick={() => onResolve(report.id, 'dismiss')}>
                    Dismiss
                  </Button>
                  <Button size="sm" variant="secondary" loading={actionLoading[`report:${report.id}:warn_seller`]} onClick={() => onResolve(report.id, 'warn_seller')}>
                    Warn seller
                  </Button>
                  <Button size="sm" variant="danger" loading={actionLoading[`report:${report.id}:remove_listing`]} onClick={() => onResolve(report.id, 'remove_listing')}>
                    Remove listing
                  </Button>
                </div>
              </>
            ) : null}
          </Card>
        );
      })}
      {!reports.length ? <p className="text-sm text-lantern-text-muted">No reports in this queue.</p> : null}
    </div>
    <PaginationBar pagination={pagination} onPrev={onPrev} onNext={onNext} />
  </Card>
);
