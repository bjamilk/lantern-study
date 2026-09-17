import React, { useState } from 'react';
import { AdminPagination, AdminReport, AdminReportAction } from '../../services/admin';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Select } from '../ui/Select';
import { Textarea } from '../ui/Textarea';
import { Body, Caption } from '../ui/Text';
import { PaginationBar } from './PaginationBar';
import {
  AdminActionDivider,
  AdminEmpty,
  AdminPageHeader,
  AdminStatusBadge,
  AdminToolbar,
} from './AdminChrome';
import { exportCsv, formatRelativeTime, reportAgeInfo } from './types';
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
  loading?: boolean;
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

function ageTone(tone: ReturnType<typeof reportAgeInfo>['tone']) {
  if (tone === 'success') return 'success' as const;
  if (tone === 'warning') return 'warning' as const;
  return 'danger' as const;
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
  loading = false,
}) => {
  const [severityByReport, setSeverityByReport] = useState<Record<string, 1 | 2 | 3>>({});
  const isOpenQueue = statusFilter === 'open' || statusFilter === 'pending' || statusFilter === 'under_review';

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="Queue"
        title="Reports"
        description="Review flagged content, warn or strike owners, and remove what should not stay up."
      />

      <AdminToolbar
        actions={
          <>
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
          </>
        }
      >
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
      </AdminToolbar>

      <div className="space-y-3">
        {reports.map((report) => {
          const age = reportAgeInfo(report.created_at);
          const warned = report.admin_note?.includes('[warned');
          const target = describeTarget(report);
          const typeLabel = CONTENT_REPORT_TARGET_LABELS[target.type as ContentReportTargetType] ?? target.type;
          const canRemove =
            (REMOVE_CONTENT_SUPPORTED_TARGETS as readonly string[]).includes(target.type) && target.exists;
          const severity = severityByReport[report.id] ?? 1;
          const rowOpen = report.status === 'pending' || report.status === 'under_review';
          return (
            <Card key={report.id} padding="md" className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdminStatusBadge tone="accent">{typeLabel}</AdminStatusBadge>
                    <Body className="font-semibold text-lantern-text">{target.title}</Body>
                    {!target.exists ? (
                      <Caption className="text-lantern-text-muted">(no longer exists)</Caption>
                    ) : null}
                    {target.status ? (
                      <Caption className="text-lantern-text-muted">· {target.status}</Caption>
                    ) : null}
                  </div>
                  <Caption className="text-lantern-text-muted">
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
                            className="font-semibold text-lantern-text hover:underline"
                          >
                            {target.ownerName || target.ownerId.slice(0, 8)}
                          </button>
                        ) : (
                          target.ownerName || target.ownerId.slice(0, 8)
                        )}
                      </>
                    ) : null}
                  </Caption>
                  {report.details ? (
                    <Body className="text-lantern-text-secondary whitespace-pre-wrap">{report.details}</Body>
                  ) : null}
                  {report.admin_note ? (
                    <Caption className="text-lantern-text-muted">Note: {report.admin_note}</Caption>
                  ) : null}
                  {warned ? <Caption className="text-lantern-accent">Owner was warned</Caption> : null}
                  <Caption className="text-lantern-text-muted">
                    {formatRelativeTime(report.created_at)}
                    {report.legacy_source ? ` · migrated from ${report.legacy_source}` : ''}
                  </Caption>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <AdminStatusBadge tone={rowOpen ? 'warning' : 'neutral'}>
                    {STATUS_LABELS[report.status] ?? report.status}
                  </AdminStatusBadge>
                  <AdminStatusBadge tone={ageTone(age.tone)}>{age.label}</AdminStatusBadge>
                </div>
              </div>
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
                    <AdminActionDivider />
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
                    <AdminActionDivider />
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
        {!reports.length ? (
          <AdminEmpty>{loading ? 'Loading reports…' : 'No reports in this queue.'}</AdminEmpty>
        ) : null}
      </div>
      <PaginationBar pagination={pagination} onPrev={onPrev} onNext={onNext} />
    </div>
  );
};
