import React, { useState } from 'react';
import { AdminPagination, AdminReport, AdminReportAction } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { StatPill } from '../ui/StatPill';
import { Textarea } from '../ui/Textarea';
import { PaginationBar } from './PaginationBar';
import { exportCsv, formatDateTime, reportAgeInfo } from './types';
import {
  CONTENT_REPORT_TARGET_LABELS,
  CONTENT_REPORT_TARGET_TYPES,
  REMOVE_CONTENT_SUPPORTED_TARGETS,
  REPORT_REASON_LABELS,
  type ContentReportReason,
  type ContentReportTargetType,
} from '@lantern/shared';

/** 'open' = pending + under_review (API default). */
export type AdminReportStatusFilter = 'open' | 'pending' | 'under_review' | 'resolved' | 'dismissed';
export type AdminReportTargetFilter = 'all' | ContentReportTargetType;

export const ADMIN_REPORT_STATUS_OPTIONS: Array<{ value: AdminReportStatusFilter; label: string }> = [
  { value: 'open', label: 'Open queue' },
  { value: 'pending', label: 'Pending only' },
  { value: 'under_review', label: 'Under review' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

interface AdminReportsProps {
  reports: AdminReport[];
  pagination: AdminPagination | null;
  statusFilter: AdminReportStatusFilter;
  targetTypeFilter: AdminReportTargetFilter;
  reportNotes: Record<string, string>;
  actionLoading: Record<string, boolean>;
  onStatusFilterChange: (value: AdminReportStatusFilter) => void;
  onTargetTypeFilterChange: (value: AdminReportTargetFilter) => void;
  onNoteChange: (reportId: string, note: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onResolve: (reportId: string, action: AdminReportAction, severity?: 1 | 2 | 3) => void;
  onBulkDismiss: () => void;
  /** Opens the user drawer for the target's owner (strikes, suspension). */
  onSelectUser?: (userId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  under_review: 'Under review',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

function reasonLabel(reason: string): string {
  return REPORT_REASON_LABELS[reason as ContentReportReason] ?? reason;
}

/** Title / status / owner for the reported thing, falling back to the legacy listing alias. */
function describeTarget(report: AdminReport): {
  type: ContentReportTargetType | 'listing';
  title: string;
  status: string | null;
  ownerId: string | null;
  ownerName: string | null;
  exists: boolean;
} {
  const target = report.target;
  if (target) {
    return {
      type: target.type,
      title: target.title || `${CONTENT_REPORT_TARGET_LABELS[target.type] ?? target.type} ${target.id.slice(0, 8)}`,
      status: target.status ?? null,
      ownerId: target.ownerId ?? null,
      ownerName: target.ownerName ?? null,
      exists: target.exists,
    };
  }
  // Legacy listing rows (pre-E console) carry listing / listing_id only.
  return {
    type: (report.target_type as ContentReportTargetType | undefined) ?? 'listing',
    title: report.listing?.title || report.listing_id || report.target_id || 'Unknown target',
    status: report.listing?.status ?? null,
    ownerId: report.listing?.user_id ?? null,
    ownerName: null,
    exists: Boolean(report.listing) || Boolean(report.target_id),
  };
}

export const AdminReports: React.FC<AdminReportsProps> = ({
  reports,
  pagination,
  statusFilter,
  targetTypeFilter,
  reportNotes,
  actionLoading,
  onStatusFilterChange,
  onTargetTypeFilterChange,
  onNoteChange,
  onPrev,
  onNext,
  onResolve,
  onBulkDismiss,
  onSelectUser,
}) => {
  const [severityByReport, setSeverityByReport] = useState<Record<string, 1 | 2 | 3>>({});
  const isOpenQueue = statusFilter === 'open' || statusFilter === 'pending' || statusFilter === 'under_review';

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap gap-2 justify-between">
        <div className="flex flex-wrap gap-2">
          <Select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value as AdminReportStatusFilter)}
            aria-label="Report status"
          >
            {ADMIN_REPORT_STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <Select
            value={targetTypeFilter}
            onChange={(e) => onTargetTypeFilterChange(e.target.value as AdminReportTargetFilter)}
            aria-label="Reported content type"
          >
            <option value="all">All content types</option>
            {CONTENT_REPORT_TARGET_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONTENT_REPORT_TARGET_LABELS[type]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          {isOpenQueue && reports.length > 0 ? (
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
                reports.map((r) => {
                  const target = describeTarget(r);
                  return {
                    id: r.id,
                    target_type: target.type,
                    target_id: r.target_id || r.listing_id || '',
                    target: target.title,
                    owner: target.ownerName || target.ownerId || '',
                    reason: r.reason,
                    status: r.status,
                    reporter: r.reporter?.name || r.reporter?.username || r.reporter_id,
                    created: r.created_at,
                    admin_note: r.admin_note || '',
                  };
                })
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
          const target = describeTarget(report);
          const typeLabel = CONTENT_REPORT_TARGET_LABELS[target.type as ContentReportTargetType] ?? target.type;
          const canRemove =
            (REMOVE_CONTENT_SUPPORTED_TARGETS as readonly string[]).includes(target.type) && target.exists;
          const severity = severityByReport[report.id] ?? 1;
          const rowOpen = report.status === 'pending' || report.status === 'under_review';
          return (
            <Card key={report.id} variant="outline" padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-block rounded px-1.5 py-0.5 text-label font-semibold uppercase tracking-wide bg-lantern-primary-background text-lantern-primary">
                      {typeLabel}
                    </span>
                    <p className="font-medium text-lantern-text truncate">{target.title}</p>
                    {!target.exists ? (
                      <span className="text-label tracking-normal font-semibold text-lantern-text-muted">(no longer exists)</span>
                    ) : null}
                    {target.status ? (
                      <span className="text-label tracking-normal text-lantern-text-muted">· {target.status}</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-lantern-text-muted">
                    {reasonLabel(report.reason)} · reported by{' '}
                    {report.reporter?.name || report.reporter?.username || 'Unknown reporter'}
                    {target.ownerId ? (
                      <>
                        {' '}
                        · owner{' '}
                        {onSelectUser ? (
                          <button
                            type="button"
                            onClick={() => onSelectUser(target.ownerId as string)}
                            className="text-lantern-primary hover:underline"
                          >
                            {target.ownerName || target.ownerId.slice(0, 8)}
                          </button>
                        ) : (
                          target.ownerName || target.ownerId.slice(0, 8)
                        )}
                      </>
                    ) : null}
                  </p>
                  {report.details ? (
                    <p className="text-sm text-lantern-text-secondary mt-1 whitespace-pre-wrap">{report.details}</p>
                  ) : null}
                  {report.admin_note ? (
                    <p className="text-xs text-lantern-text-muted mt-1">Note: {report.admin_note}</p>
                  ) : null}
                  {warned ? <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">Owner was warned</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5 items-center">
                  <StatPill label="Status" value={STATUS_LABELS[report.status] ?? report.status} accent={rowOpen ? 'warning' : 'primary'} />
                  <StatPill label="Age" value={age.label} accent={accent as 'success' | 'warning' | 'primary'} />
                </div>
              </div>
              <p className="text-xs text-lantern-text-muted">
                {formatDateTime(report.created_at)}
                {report.legacy_source ? ` · migrated from ${report.legacy_source}` : ''}
              </p>
              {rowOpen ? (
                <>
                  <Textarea
                    value={reportNotes[report.id] || ''}
                    onChange={(e) => onNoteChange(report.id, e.target.value)}
                    placeholder="Admin note (optional — sent to the owner on warn / remove; stored on the report)"
                    rows={2}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={actionLoading[`report:${report.id}:dismiss`]}
                      onClick={() => onResolve(report.id, 'dismiss')}
                    >
                      Dismiss
                    </Button>
                    {report.status !== 'under_review' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={actionLoading[`report:${report.id}:under_review`]}
                        onClick={() => onResolve(report.id, 'under_review')}
                      >
                        Mark under review
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={actionLoading[`report:${report.id}:warn`]}
                      onClick={() => onResolve(report.id, 'warn')}
                      disabled={!target.ownerId}
                      title={target.ownerId ? undefined : 'No owner to warn'}
                    >
                      Warn owner
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      loading={actionLoading[`report:${report.id}:remove_content`]}
                      onClick={() => onResolve(report.id, 'remove_content')}
                      disabled={!canRemove}
                      title={
                        canRemove
                          ? undefined
                          : 'Messages, DMs, users and job postings are handled with their dedicated tools'
                      }
                    >
                      Remove content
                    </Button>
                    <span className="inline-flex items-center gap-1">
                      <Select
                        value={String(severity)}
                        onChange={(e) =>
                          setSeverityByReport((prev) => ({
                            ...prev,
                            [report.id]: Number(e.target.value) as 1 | 2 | 3,
                          }))
                        }
                        aria-label="Strike severity"
                        className="px-2 py-1 text-xs"
                      >
                        <option value="1">Severity 1</option>
                        <option value="2">Severity 2</option>
                        <option value="3">Severity 3</option>
                      </Select>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={actionLoading[`report:${report.id}:strike`]}
                        onClick={() => onResolve(report.id, 'strike', severity)}
                        disabled={!target.ownerId}
                        title={target.ownerId ? '3 active strikes suspend the account for 14 days' : 'No owner to strike'}
                      >
                        Strike owner
                      </Button>
                    </span>
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
};
