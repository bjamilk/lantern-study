import React, { useEffect, useState } from 'react';
import type { JobApplication } from '@lantern/shared';
import { fetchMyJobApplications, updateJobApplicationStatus } from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

export default function MyJobApplicationsScreen({
  onNavigate,
  onOpenDm,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}) {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchMyJobApplications()
      .then((res) => setApps(res.data || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
    <div className="max-w-3xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
      <JobsWorkspaceNav active="my_applications" onNavigate={onNavigate} />
      <h1 className="text-xl font-semibold text-lantern-text">My applications</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ul className="space-y-2">
        {apps.map((app) => (
          <li
            key={app.id}
            className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div>
              <button
                type="button"
                className="font-semibold text-lantern-text hover:text-lantern-primary"
                onClick={() =>
                  app.postingId && onNavigate('MarketplaceJobDetail', { jobId: app.postingId })
                }
              >
                {app.posting?.title || 'Job'}
              </button>
              <p className="text-xs text-lantern-text-tertiary mt-0.5">
                Status: {app.status} · {app.source === 'external_click' ? 'External click' : 'In-app'}
              </p>
            </div>
            <div className="flex gap-2">
              {app.dmThreadId && onOpenDm ? (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-lg border border-lantern-border"
                  onClick={() => onOpenDm(app.dmThreadId!)}
                >
                  Open chat
                </button>
              ) : null}
              {app.status !== 'withdrawn' && app.status !== 'hired' ? (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-lg border border-lantern-border"
                  onClick={() =>
                    void updateJobApplicationStatus(app.id, {
                      status: 'withdrawn',
                      asApplicant: true,
                    }).then(() => load())
                  }
                >
                  Withdraw
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {apps.length === 0 && !error ? (
        <p className="text-sm text-lantern-text-secondary">No applications yet. Browse jobs to apply.</p>
      ) : null}
    </div>
    </div>
  );
}
