import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  JOB_APPLICATION_STATUS_DESCRIPTIONS,
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplication,
  type JobApplicationStatus,
} from '@lantern/shared';
import { fetchMyJobApplications, updateJobApplicationStatus } from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

const CLOSED_STATUSES = new Set<JobApplicationStatus>(['hired', 'rejected', 'withdrawn']);

const STATUS_STYLES: Record<JobApplicationStatus, string> = {
  interested: 'bg-sky-100 text-sky-800',
  chatting: 'bg-indigo-100 text-indigo-800',
  new: 'bg-blue-100 text-blue-800',
  reviewing: 'bg-violet-100 text-violet-800',
  interview: 'bg-amber-100 text-amber-800',
  offer: 'bg-emerald-100 text-emerald-800',
  hired: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-slate-100 text-slate-700',
  withdrawn: 'bg-slate-100 text-slate-700',
};

export default function MyJobApplicationsScreen({
  onNavigate,
  onOpenDm,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}) {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'active' | 'closed' | 'all'>('active');
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchMyJobApplications();
      setApps(response.data || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredApps = useMemo(() => {
    const sorted = [...apps].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
    if (view === 'all') return sorted;
    return sorted.filter((application) =>
      view === 'closed'
        ? CLOSED_STATUSES.has(application.status)
        : !CLOSED_STATUSES.has(application.status)
    );
  }, [apps, view]);

  const activeCount = apps.filter((application) => !CLOSED_STATUSES.has(application.status)).length;
  const interviewCount = apps.filter((application) =>
    ['interview', 'offer'].includes(application.status)
  ).length;

  const withdraw = async (applicationId: string) => {
    setWithdrawingId(applicationId);
    setError(null);
    try {
      await updateJobApplicationStatus(applicationId, {
        status: 'withdrawn',
        asApplicant: true,
      });
      await load();
    } catch (withdrawError) {
      setError(withdrawError instanceof Error ? withdrawError.message : 'Could not withdraw');
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-5xl mx-auto px-4 py-4 pb-20 md:pb-8 space-y-5">
        <JobsWorkspaceNav active="my_applications" onNavigate={onNavigate} />

        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-lantern-primary">
            Candidate workspace
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-lantern-text">My applications</h1>
          <p className="mt-1 text-sm text-lantern-text-secondary">
            Follow every application from submission to decision.
          </p>
        </header>

        <section aria-label="Application summary" className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Total applications
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">{apps.length}</p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Active
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">{activeCount}</p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Interview / offer
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">{interviewCount}</p>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-lantern-border bg-lantern-surface p-1">
            {(['active', 'closed', 'all'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === option
                    ? 'bg-lantern-primary text-white shadow-sm'
                    : 'text-lantern-text-secondary hover:text-lantern-text'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate('MarketplaceJobs')}
            className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Find more jobs
          </button>
        </div>

        {error ? (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="space-y-3" aria-label="Loading applications">
            {[0, 1].map((item) => (
              <div
                key={item}
                className="h-40 animate-pulse rounded-lantern-xl border border-lantern-border bg-lantern-surface"
              />
            ))}
          </div>
        ) : filteredApps.length ? (
          <ul className="space-y-3">
            {filteredApps.map((application) => {
              const posting = application.posting;
              const employer =
                posting?.company?.displayName ||
                posting?.poster?.name ||
                posting?.poster?.username ||
                'Independent poster';
              const canWithdraw = !CLOSED_STATUSES.has(application.status);

              return (
                <li
                  key={application.id}
                  className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 shadow-sm sm:p-5"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          className="text-left text-base font-semibold text-lantern-text hover:text-lantern-primary"
                          onClick={() =>
                            application.postingId &&
                            onNavigate('MarketplaceJobDetail', {
                              jobId: application.postingId,
                            })
                          }
                        >
                          {posting?.title || 'Job'}
                        </button>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
                        >
                          {JOB_APPLICATION_STATUS_LABELS[application.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-lantern-text-secondary">{employer}</p>
                      <p className="mt-3 text-sm text-lantern-text">
                        {JOB_APPLICATION_STATUS_DESCRIPTIONS[application.status]}
                      </p>
                      <p className="mt-2 text-xs text-lantern-text-tertiary">
                        Updated{' '}
                        {new Date(application.updatedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                        {' · '}
                        {application.source === 'external_click'
                          ? 'External application'
                          : 'Lantern Easy Apply'}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {application.dmThreadId && onOpenDm ? (
                        <button
                          type="button"
                          className="rounded-lg border border-lantern-primary px-3 py-2 text-sm font-medium text-lantern-primary hover:bg-lantern-primary/5"
                          onClick={() => onOpenDm(application.dmThreadId!)}
                        >
                          Message poster
                        </button>
                      ) : null}
                      {canWithdraw ? (
                        <button
                          type="button"
                          disabled={withdrawingId === application.id}
                          className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text-secondary hover:text-lantern-text disabled:opacity-50"
                          onClick={() => void withdraw(application.id)}
                        >
                          {withdrawingId === application.id ? 'Withdrawing…' : 'Withdraw'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lantern-xl border border-dashed border-lantern-border bg-lantern-surface/70 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-lantern-text">
              {apps.length === 0 ? 'No applications yet' : `No ${view} applications`}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-lantern-text-secondary">
              {apps.length === 0
                ? 'Explore open roles and submit your first application.'
                : 'Applications will appear here when they move into this category.'}
            </p>
            {apps.length === 0 ? (
              <button
                type="button"
                onClick={() => onNavigate('MarketplaceJobs')}
                className="mt-5 rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
              >
                Browse jobs
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
