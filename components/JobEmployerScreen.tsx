import React, { useEffect, useState } from 'react';
import {
  JOBS_COMPANY_EEO_NOTICE,
  type JobCompany,
  type JobCompanyMemberRole,
  type JobPosting,
} from '@lantern/shared';
import {
  createJobCompany,
  fetchMyJobCompanies,
  fetchMyJobPostings,
} from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';
import { JobCompanyManageCard } from './jobs/JobCompanyManageCard';
import { useAuthStore } from '../stores/authStore';

export default function JobEmployerScreen({
  onNavigate,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}) {
  const actorUserId = useAuthStore((s) => s.currentUser?.id || null);
  const [companies, setCompanies] = useState<
    Array<{ role: JobCompanyMemberRole; company: JobCompany }>
  >([]);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [legalName, setLegalName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [website, setWebsite] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [c, j] = await Promise.all([fetchMyJobCompanies(), fetchMyJobPostings()]);
    setCompanies(
      ((c.data || []) as Array<{ role: JobCompanyMemberRole; company: JobCompany }>).filter(
        (row) => !!row.company?.id,
      ),
    );
    setJobs((j.data || []).filter((job) => !!job.companyId));
  };

  useEffect(() => {
    void load().catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
  }, []);

  const register = async () => {
    setError(null);
    setMessage(null);
    try {
      await createJobCompany({
        legalName,
        displayName: displayName || legalName,
        website,
        verificationDomain: domain,
      });
      setMessage('Company submitted for verification. An admin will review it.');
      setLegalName('');
      setDisplayName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create company');
    }
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
    <div className="max-w-3xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
      <JobsWorkspaceNav active="employer" onNavigate={onNavigate} onPostJob={() => onNavigate('CreateMarketplaceJob')} />

      <section className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-5 space-y-3">
        <h1 className="text-xl font-semibold text-lantern-text">Employer hub</h1>
        <p className="text-sm text-lantern-text-secondary">{JOBS_COMPANY_EEO_NOTICE}</p>

        <h2 className="text-sm font-semibold text-lantern-text pt-2">Your companies</h2>
        {companies.length === 0 ? (
          <p className="text-sm text-lantern-text-tertiary">No company profile yet.</p>
        ) : (
          <ul className="space-y-2">
            {companies.map((row) => (
              <JobCompanyManageCard
                key={row.company.id}
                company={row.company}
                role={row.role}
                actorUserId={actorUserId}
                onUpdated={(next) =>
                  setCompanies((prev) =>
                    prev.map((item) =>
                      item.company.id === next.id
                        ? { ...item, company: next }
                        : item,
                    ),
                  )
                }
                onOpenPublic={() =>
                  onNavigate('JobCompany', { companyId: row.company.id })
                }
              />
            ))}
          </ul>
        )}

        <div className="border-t border-lantern-border pt-3 space-y-2">
          <h2 className="text-sm font-semibold">Register a company</h2>
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Legal name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Website"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-lantern-border px-3 py-2 text-sm bg-lantern-background"
            placeholder="Work email domain (e.g. company.com)"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button
            type="button"
            disabled={!legalName.trim()}
            onClick={() => void register()}
            className="rounded-lg bg-lantern-primary text-white px-3 py-2 text-sm font-semibold disabled:opacity-60"
          >
            Submit for verification
          </button>
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-lantern-text">Company job pipelines</h2>
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            onClick={() => onNavigate('JobEmployerPipeline', { jobId: job.id })}
            className="w-full text-left rounded-lg border border-lantern-border p-3 hover:border-lantern-primary/40"
          >
            <span className="font-medium">{job.title}</span>
            <span className="text-xs text-lantern-text-tertiary ml-2">{job.status}</span>
          </button>
        ))}
        {jobs.length === 0 ? (
          <p className="text-sm text-lantern-text-tertiary">
            Post a job with a verified company to use the employer kanban.
          </p>
        ) : null}
      </section>
    </div>
    </div>
  );
}
