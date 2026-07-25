import React, { useEffect, useState } from 'react';
import { JOB_EMPLOYMENT_TYPE_LABELS, type JobPosting } from '@lantern/shared';
import { fetchMyJobPostings, updateJobPosting } from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

export default function MyJobPostingsScreen({
  onNavigate,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetchMyJobPostings()
      .then((res) => setJobs(res.data || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <JobsWorkspaceNav
        active="my_jobs"
        onNavigate={onNavigate}
        onPostJob={() => onNavigate('CreateMarketplaceJob')}
      />
      <h1 className="text-xl font-semibold text-lantern-text">My job posts</h1>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <ul className="space-y-2">
        {jobs.map((job) => (
          <li
            key={job.id}
            className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between"
          >
            <div className="min-w-0">
              <button
                type="button"
                className="font-semibold text-lantern-text text-left hover:text-lantern-primary"
                onClick={() => onNavigate('MarketplaceJobDetail', { jobId: job.id })}
              >
                {job.title}
              </button>
              <p className="text-xs text-lantern-text-tertiary mt-0.5">
                {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} · {job.status}
                {job.requiresSchoolApproval && job.status === 'pending_school_approval'
                  ? ' (awaiting school approval)'
                  : ''}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-lg border border-lantern-border"
                onClick={() => onNavigate('JobEmployerPipeline', { jobId: job.id })}
              >
                Applicants
              </button>
              {job.status === 'active' ? (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-lg border border-lantern-border"
                  onClick={() =>
                    void updateJobPosting(job.id, { status: 'closed' }).then(() => load())
                  }
                >
                  Close
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {jobs.length === 0 && !error ? (
        <p className="text-sm text-lantern-text-secondary">You have not posted any jobs yet.</p>
      ) : null}
    </div>
  );
}
