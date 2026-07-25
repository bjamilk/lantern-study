import React, { useEffect, useState } from 'react';
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOBS_COMPANY_DISCLAIMER,
  type JobPosting,
} from '@lantern/shared';
import {
  applyToJob,
  fetchJobPosting,
  reportJobPosting,
  trackJobExternalApply,
} from '../services/jobsBoard';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

interface Props {
  jobId: string;
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}

export default function JobDetailScreen({ jobId, onNavigate, onOpenDm }: Props) {
  const [job, setJob] = useState<JobPosting | null>(null);
  const [message, setMessage] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resumeUrl, setResumeUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void fetchJobPosting(jobId)
      .then((res) => setJob(res.data))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load job'));
  }, [jobId]);

  const handleApply = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await applyToJob(job.id, {
        message: message.trim() || undefined,
        answers,
        resumeUrl: resumeUrl.trim() || null,
      });
      setSuccess(res.existing ? 'You already applied — opening chat.' : 'Application sent.');
      if (res.threadId && onOpenDm) onOpenDm(res.threadId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Apply failed');
    } finally {
      setBusy(false);
    }
  };

  const handleExternal = async () => {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await trackJobExternalApply(job.id);
      window.open(res.data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open external apply');
    } finally {
      setBusy(false);
    }
  };

  if (!job && !error) {
    return <p className="p-6 text-sm text-lantern-text-tertiary">Loading…</p>;
  }

  if (!job) {
    return (
      <div className="max-w-3xl mx-auto p-4">
        <p className="text-red-600 text-sm">{error}</p>
        <button type="button" className="mt-3 text-sm text-lantern-primary" onClick={() => onNavigate('MarketplaceJobs')}>
          Back to jobs
        </button>
      </div>
    );
  }

  const showInApp = job.applyMode === 'in_app' || job.applyMode === 'both';
  const showExternal = (job.applyMode === 'external' || job.applyMode === 'both') && !!job.externalUrl;

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
      <JobsWorkspaceNav active="jobs" onNavigate={onNavigate} />

      <article className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-5 space-y-4">
        <header>
          <p className="text-xs text-lantern-text-tertiary">
            {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType] || job.employmentType}
            {job.campusName ? ` · ${job.campusName}` : ''}
          </p>
          <h1 className="text-2xl font-semibold text-lantern-text mt-1">{job.title}</h1>
          {job.company ? (
            <p className="text-sm text-lantern-text-secondary mt-1">
              {job.company.displayName}
              {job.company.verificationStatus === 'verified' ? ' · Verified company' : ''}
            </p>
          ) : job.poster?.name ? (
            <p className="text-sm text-lantern-text-secondary mt-1">Posted by {job.poster.name}</p>
          ) : null}
        </header>

        <p className="text-sm text-lantern-text whitespace-pre-wrap break-words">{job.description}</p>

        {job.company ? (
          <p className="text-xs text-lantern-text-tertiary border-t border-lantern-border pt-3">
            {JOBS_COMPANY_DISCLAIMER}
          </p>
        ) : null}

        {showInApp ? (
          <div className="space-y-3 border-t border-lantern-border pt-4">
            <h2 className="text-sm font-semibold text-lantern-text">Easy Apply</h2>
            {(job.screeningQuestions || []).map((q) => (
              <label key={q.id} className="block text-sm">
                <span className="text-lantern-text-secondary">{q.prompt}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                  value={answers[q.id] || ''}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                />
              </label>
            ))}
            <label className="block text-sm">
              <span className="text-lantern-text-secondary">Message (optional)</span>
              <textarea
                className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                rows={3}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            {job.companyId ? (
              <label className="block text-sm">
                <span className="text-lantern-text-secondary">Resume URL (optional)</span>
                <input
                  className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                  value={resumeUrl}
                  onChange={(e) => setResumeUrl(e.target.value)}
                  placeholder="https://…"
                />
              </label>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleApply()}
              className="rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {busy ? 'Submitting…' : 'Apply / I’m interested'}
            </button>
          </div>
        ) : null}

        {showExternal ? (
          <div className="border-t border-lantern-border pt-4 space-y-2">
            <p className="text-sm text-lantern-text-secondary">
              This role also accepts applications on the company site.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleExternal()}
              className="rounded-lg border border-lantern-border px-4 py-2 text-sm font-medium hover:border-lantern-primary/40"
            >
              Apply on company site
            </button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-600">{success}</p> : null}

        <button
          type="button"
          className="text-xs text-lantern-text-tertiary underline"
          onClick={() =>
            void reportJobPosting(job.id, { reason: 'scam' }).then(() =>
              setSuccess('Report submitted. Thanks for flagging this.')
            )
          }
        >
          Report this job
        </button>
      </article>
    </div>
  );
}
