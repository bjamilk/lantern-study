import React, { useEffect, useMemo, useState } from 'react';
import type { JobApplication, JobApplicationStatus } from '@lantern/shared';
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
];

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
    <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
      <JobsWorkspaceNav active="employer" onNavigate={onNavigate} />
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold text-lantern-text">Applicant pipeline</h1>
        <button
          type="button"
          className="text-sm text-lantern-primary"
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
              className="w-56 shrink-0 rounded-lantern-xl border border-lantern-border bg-lantern-background-secondary/40 p-2"
            >
              <h2 className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary px-1 mb-2">
                {col} ({byStatus[col]?.length || 0})
              </h2>
              <ul className="space-y-2">
                {(byStatus[col] || []).map((app) => (
                  <li key={app.id} className="rounded-lg border border-lantern-border bg-lantern-surface p-2 space-y-2">
                    <p className="text-sm font-medium text-lantern-text">
                      {app.applicant?.name || app.applicant?.username || 'Applicant'}
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
                      onChange={(e) =>
                        void updateJobApplicationStatus(app.id, {
                          status: e.target.value,
                        }).then(() => load())
                      }
                    >
                      {COLUMNS.map((s) => (
                        <option key={s} value={s}>
                          {s}
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
  );
}
