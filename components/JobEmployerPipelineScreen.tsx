import React, { useEffect, useMemo, useState } from 'react';
import {
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplication,
  type JobApplicationStatus,
} from '@lantern/shared';
import { fetchJobApplicants, updateJobApplicationStatus } from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

const COLUMNS: JobApplicationStatus[] = [
  'interested',
  'new',
  'chatting',
  'reviewing',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
];
const EMPLOYER_STATUSES = COLUMNS.filter((status) => status !== 'withdrawn');

export default function JobEmployerPipelineScreen({
  jobId,
  onNavigate,
  onOpenDm,
}: {
  jobId: string;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}) {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchJobApplicants(jobId)
      .then((res) => setApps(res.data || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load applicants'));

  useEffect(() => {
    void load();
  }, [jobId]);

  const byStatus = useMemo(() => {
    const map: Record<string, JobApplication[]> = {};
    for (const col of COLUMNS) map[col] = [];
    for (const app of apps) {
      const key = COLUMNS.includes(app.status as JobApplicationStatus) ? app.status : 'new';
      map[key] = map[key] || [];
      map[key].push(app);
    }
    return map;
  }, [apps]);

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
    <div className="max-w-6xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
      <JobsWorkspaceNav active="employer" onNavigate={onNavigate} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-lantern-primary">
            Hiring workflow
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-lantern-text">
            Applicant pipeline
          </h1>
          <p className="mt-1 text-sm text-lantern-text-secondary">
            {apps.length} {apps.length === 1 ? 'candidate' : 'candidates'} across all stages
          </p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text"
          onClick={() => onNavigate('MarketplaceJobDetail', { jobId })}
        >
          View job
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="overflow-x-auto pb-2">
        <div className="flex gap-3 min-w-max">
          {COLUMNS.map((col) => (
            <div
              key={col}
              className="w-64 shrink-0 rounded-lantern-xl border border-lantern-border bg-lantern-background-secondary/40 p-3"
            >
              <div className="mb-3 flex items-center justify-between gap-2 px-1">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-secondary">
                  {JOB_APPLICATION_STATUS_LABELS[col]}
                </h2>
                <span className="rounded-full bg-lantern-surface px-2 py-0.5 text-xs font-semibold text-lantern-text-tertiary">
                  {byStatus[col]?.length || 0}
                </span>
              </div>
              <ul className="space-y-2">
                {(byStatus[col] || []).map((app) => (
                  <li key={app.id} className="rounded-lg border border-lantern-border bg-lantern-surface p-3 space-y-2 shadow-sm">
                    <p className="text-sm font-medium text-lantern-text">
                      {app.applicant?.name || app.applicant?.username || 'Applicant'}
                    </p>
                    <p className="text-[11px] text-lantern-text-tertiary">
                      Applied{' '}
                      {new Date(app.createdAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                    {app.resumeUrl ? (
                      <a
                        href={app.resumeUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-lantern-primary underline"
                      >
                        Resume
                      </a>
                    ) : null}
                    <select
                      className="w-full text-xs rounded border border-lantern-border bg-lantern-background px-1 py-1"
                      value={app.status}
                      disabled={app.status === 'withdrawn'}
                      onChange={(e) =>
                        void updateJobApplicationStatus(app.id, {
                          status: e.target.value,
                        }).then(() => load())
                      }
                    >
                      {app.status === 'withdrawn' ? (
                        <option value="withdrawn">Withdrawn by applicant</option>
                      ) : null}
                      {EMPLOYER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {JOB_APPLICATION_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                    {app.dmThreadId && onOpenDm ? (
                      <button
                        type="button"
                        className="text-[11px] text-lantern-primary"
                        onClick={() => onOpenDm(app.dmThreadId!)}
                      >
                        Message
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
    </div>
  );
}
