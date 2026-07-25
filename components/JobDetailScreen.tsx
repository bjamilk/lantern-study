import React, { useEffect, useState } from 'react';
import {
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOBS_COMPANY_DISCLAIMER,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
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
    return (
      <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain bg-lantern-background">
        <p className="p-6 text-sm text-lantern-text-tertiary">Loading…</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overscroll-contain bg-lantern-background">
      <div className="max-w-3xl mx-auto p-4 pb-20 md:pb-6">
        <p className="text-red-600 text-sm">{error}</p>
        <button type="button" className="mt-3 text-sm text-lantern-primary" onClick={() => onNavigate('MarketplaceJobs')}>
          Back to jobs
        </button>
      </div>
      </div>
    );
  }

  const showInApp = job.applyMode === 'in_app' || job.applyMode === 'both';
  const showExternal = (job.applyMode === 'external' || job.applyMode === 'both') && !!job.externalUrl;
  const employer = job.company?.displayName || job.poster?.name || job.poster?.username || 'Independent poster';
  const duration = formatJobEngagementDuration(job.engagementDuration);
  const deadline = job.deadline
    ? new Date(job.deadline).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-6xl mx-auto px-4 py-4 pb-20 md:pb-8 space-y-4">
        <JobsWorkspaceNav active="jobs" onNavigate={onNavigate} />

        <button
          type="button"
          className="text-sm font-medium text-lantern-primary hover:underline"
          onClick={() => onNavigate('MarketplaceJobs')}
        >
          ← Back to job results
        </button>

        <header className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-5 shadow-sm sm:p-7">
          <div className="flex items-start gap-4">
            {job.company?.logoUrl ? (
              <img
                src={job.company.logoUrl}
                alt=""
                className="h-14 w-14 shrink-0 rounded-xl border border-lantern-border bg-white object-contain p-2 sm:h-16 sm:w-16"
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-lantern-primary/10 text-xl font-bold text-lantern-primary sm:h-16 sm:w-16"
              >
                {employer.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {job.isSponsored ? (
                  <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                    Featured
                  </span>
                ) : null}
                {job.company?.verificationStatus === 'verified' ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
                    Verified company
                  </span>
                ) : null}
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight text-lantern-text sm:text-3xl">
                {job.title}
              </h1>
              <p className="mt-1 text-sm font-medium text-lantern-text-secondary">{employer}</p>
              <p className="mt-2 text-sm text-lantern-text-tertiary">
                {formatJobLocation(job)} · {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]} ·{' '}
                {formatJobPostedDate(job.createdAt)}
              </p>
            </div>
          </div>
        </header>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <main className="space-y-4">
            <section className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-lantern-text">Job overview</h2>
              <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg bg-lantern-background p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
                    Compensation
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-lantern-text">
                    {formatJobCompensation(job.compensation)}
                  </dd>
                </div>
                <div className="rounded-lg bg-lantern-background p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
                    Job type
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-lantern-text">
                    {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                  </dd>
                </div>
                <div className="rounded-lg bg-lantern-background p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
                    Location
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-lantern-text">
                    {formatJobLocation(job)}
                  </dd>
                </div>
                <div className="rounded-lg bg-lantern-background p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
                    {deadline ? 'Application deadline' : 'Duration'}
                  </dt>
                  <dd className="mt-1 text-sm font-semibold text-lantern-text">
                    {deadline || duration || 'Ongoing'}
                  </dd>
                </div>
              </dl>
            </section>

            <article className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-lantern-text">About this role</h2>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-lantern-text">
                {job.description}
              </p>
            </article>

            <section className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-semibold text-lantern-text">About the poster</h2>
              <p className="mt-2 text-sm font-semibold text-lantern-text">{employer}</p>
              <p className="mt-1 text-sm text-lantern-text-secondary">
                {job.company
                  ? job.company.verificationStatus === 'verified'
                    ? 'This company has completed Lantern’s company verification.'
                    : 'This company has not completed Lantern’s company verification.'
                  : 'This role was posted by an individual or organization without a company profile.'}
              </p>
              {job.company?.website ? (
                <a
                  href={job.company.website}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-block text-sm font-medium text-lantern-primary hover:underline"
                >
                  Visit company website
                </a>
              ) : null}
              {job.company ? (
                <p className="mt-4 border-t border-lantern-border pt-3 text-xs leading-5 text-lantern-text-tertiary">
                  {JOBS_COMPANY_DISCLAIMER}
                </p>
              ) : null}
            </section>

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
          </main>

          <aside className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-5 shadow-sm lg:sticky lg:top-4">
            <h2 className="text-lg font-semibold text-lantern-text">
              {showInApp ? 'Apply for this job' : 'Continue your application'}
            </h2>
            <p className="mt-1 text-sm text-lantern-text-secondary">
              {showInApp
                ? 'Send your details directly to the poster.'
                : 'This employer accepts applications on an external site.'}
            </p>

            {showInApp ? (
              <form
                className="mt-5 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleApply();
                }}
              >
                {(job.screeningQuestions || []).map((question) => (
                  <label key={question.id} className="block text-sm">
                    <span className="font-medium text-lantern-text">
                      {question.prompt}
                      {question.required ? ' *' : ''}
                    </span>
                    {question.questionType === 'single_choice' ? (
                      <select
                        required={question.required}
                        className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-lantern-text outline-none focus:border-lantern-primary"
                        value={answers[question.id] || ''}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                      >
                        <option value="">Select an answer</option>
                        {(question.options || []).map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        required={question.required}
                        className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-lantern-text outline-none focus:border-lantern-primary"
                        value={answers[question.id] || ''}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                      />
                    )}
                  </label>
                ))}
                <label className="block text-sm">
                  <span className="font-medium text-lantern-text">Message to the poster</span>
                  <span className="ml-1 text-lantern-text-tertiary">(optional)</span>
                  <textarea
                    className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-lantern-text outline-none focus:border-lantern-primary"
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder="Briefly introduce yourself and your interest."
                  />
                </label>
                {job.companyId ? (
                  <label className="block text-sm">
                    <span className="font-medium text-lantern-text">Resume URL</span>
                    <span className="ml-1 text-lantern-text-tertiary">(optional)</span>
                    <input
                      type="url"
                      className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-lantern-text outline-none focus:border-lantern-primary"
                      value={resumeUrl}
                      onChange={(event) => setResumeUrl(event.target.value)}
                      placeholder="https://…"
                    />
                  </label>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-lg bg-lantern-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-lantern-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busy ? 'Submitting…' : 'Submit application'}
                </button>
              </form>
            ) : null}

            {showExternal ? (
              <div className={`${showInApp ? 'mt-4 border-t border-lantern-border pt-4' : 'mt-5'}`}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleExternal()}
                  className="w-full rounded-lg border border-lantern-primary px-4 py-3 text-sm font-semibold text-lantern-primary hover:bg-lantern-primary/5 disabled:opacity-60"
                >
                  Apply on company site
                </button>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            {success ? (
              <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{success}</p>
            ) : null}
            <p className="mt-4 text-xs leading-5 text-lantern-text-tertiary">
              Never pay a fee to apply. Do not send BVN, NIN, passwords, or banking details.
            </p>
          </aside>
        </div>
      </div>
    </div>
  );
}
