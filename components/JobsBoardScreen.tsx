import React, { useCallback, useEffect, useState } from 'react';
import {
  JOBS_COMPLIANCE_BANNER,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  formatJobCompensation,
  formatJobEngagementDuration,
  type JobEmploymentType,
  type JobPosting,
} from '@lantern/shared';
import { fetchJobPostings } from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

interface Props {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

export default function JobsBoardScreen({ onNavigate }: Props) {
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [employmentType, setEmploymentType] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchJobPostings({
        page: 1,
        limit: 40,
        search: search.trim() || undefined,
        employmentType: employmentType || undefined,
      });
      setJobs(res.data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, [search, employmentType]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
    <div className="max-w-5xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
      <JobsWorkspaceNav
        active="jobs"
        onNavigate={onNavigate}
        onPostJob={() => onNavigate('CreateMarketplaceJob')}
      />

      <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-4 space-y-3">
        <div>
          <h1 className="text-xl font-semibold text-lantern-text">Jobs</h1>
          <p className="text-sm text-lantern-text-secondary mt-1">{JOBS_COMPLIANCE_BANNER}</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles, internships, gigs…"
            className="flex-1 rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm"
          />
          <select
            value={employmentType}
            onChange={(e) => setEmploymentType(e.target.value)}
            className="rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm"
          >
            <option value="">All types</option>
            {JOB_PHASE1_EMPLOYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {JOB_EMPLOYMENT_TYPE_LABELS[t as JobEmploymentType]}
              </option>
            ))}
            <option value="internship">Internship</option>
            <option value="full_time">Full-time</option>
            <option value="contract">Contract</option>
          </select>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-medium"
          >
            Search
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-lantern-text-tertiary">Loading jobs…</p>
      ) : error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : jobs.length === 0 ? (
        <div className="rounded-lantern-xl border border-dashed border-lantern-border p-8 text-center">
          <p className="text-lantern-text font-medium">No jobs yet</p>
          <p className="text-sm text-lantern-text-secondary mt-1">
            Post a role for companies, campus orgs, or individuals to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                onClick={() => onNavigate('MarketplaceJobDetail', { jobId: job.id })}
                className="w-full text-left rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-4 hover:border-lantern-primary/40 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-lantern-text truncate">{job.title}</h2>
                      {job.isSponsored ? (
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">
                          Sponsored
                        </span>
                      ) : null}
                      {job.company?.verificationStatus === 'verified' ? (
                        <span className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                          Verified company
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-lantern-text-tertiary mt-1">
                      {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}
                      {job.campusName ? ` · ${job.campusName}` : ''}
                      {job.isRemote ? ' · Remote' : ''}
                      {' · '}
                      {formatJobCompensation(job.compensation)}
                      {formatJobEngagementDuration(job.engagementDuration)
                        ? ` · ${formatJobEngagementDuration(job.engagementDuration)}`
                        : ''}
                    </p>
                    <p className="text-sm text-lantern-text-secondary mt-2 line-clamp-2">{job.description}</p>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
    </div>
  );
}
