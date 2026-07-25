import React, { useEffect, useState } from 'react';
import {
  CAMPUS_JOB_INTENT_TEMPLATES,
  JOBS_CREATE_CONFIRMATION,
  JOBS_SCAM_PLAYBOOK_SUMMARY,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  JOB_PHASE2_EMPLOYMENT_TYPES,
  type JobEmploymentType,
} from '@lantern/shared';
import { createJobPosting, fetchJobTemplates, fetchMyJobCompanies } from '../services/jobsBoard';
import { fetchMarketplaceCampuses } from '../services/supabase';
import { JobsWorkspaceNav } from './jobs/JobsWorkspaceNav';

interface Props {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
}

export default function CreateJobScreen({ onNavigate }: Props) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [employmentType, setEmploymentType] = useState<JobEmploymentType>('tutoring');
  const [campusId, setCampusId] = useState('');
  const [campuses, setCampuses] = useState<Array<{ id: string; name: string }>>([]);
  const [compensationKind, setCompensationKind] = useState<'paid' | 'unpaid' | 'discuss'>('discuss');
  const [amountMin, setAmountMin] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [companyId, setCompanyId] = useState('');
  const [companies, setCompanies] = useState<Array<{ id: string; displayName: string; verificationStatus: string }>>([]);
  const [applyMode, setApplyMode] = useState<'in_app' | 'external' | 'both'>('in_app');
  const [externalUrl, setExternalUrl] = useState('');
  const [isSponsored, setIsSponsored] = useState(false);
  const [requiresSchoolApproval, setRequiresSchoolApproval] = useState(false);
  const [atsWebhookUrl, setAtsWebhookUrl] = useState('');
  const [screener1, setScreener1] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMarketplaceCampuses('NG').then((list) =>
      setCampuses((list || []).map((c: any) => ({ id: c.id, name: c.name })))
    );
    void fetchMyJobCompanies()
      .then((res) =>
        setCompanies(
          (res.data || [])
            .map((row: any) => row.company)
            .filter(Boolean)
            .map((c: any) => ({
              id: c.id,
              displayName: c.displayName || c.display_name,
              verificationStatus: c.verificationStatus || c.verification_status,
            }))
        )
      )
      .catch(() => undefined);
    void fetchJobTemplates().catch(() => undefined);
  }, []);

  const applyTemplate = (id: string) => {
    const t = CAMPUS_JOB_INTENT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    setEmploymentType(t.employmentType);
    setTitle(t.title);
    setDescription(t.descriptionHint);
    setScreener1(t.suggestedScreeners[0] || '');
  };

  const submit = async () => {
    if (!confirmed) {
      setError('Confirm the posting attestation first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const types = companyId ? JOB_PHASE2_EMPLOYMENT_TYPES : JOB_PHASE1_EMPLOYMENT_TYPES;
      if (!types.includes(employmentType)) {
        throw new Error('That employment type requires a verified company account.');
      }
      const screeningQuestions = screener1.trim()
        ? [{ prompt: screener1.trim(), questionType: 'text' as const, required: true }]
        : [];
      const res = await createJobPosting({
        title,
        description,
        employmentType,
        campusId: campusId || null,
        compensation: {
          kind: compensationKind,
          currency: 'NGN',
          amountMin: amountMin ? Number(amountMin) : null,
          period: compensationKind === 'paid' ? 'hour' : null,
        },
        applyMode,
        externalUrl: externalUrl || null,
        companyId: companyId || null,
        status: 'active',
        requiresSchoolApproval,
        isSponsored: companyId ? isSponsored : false,
        atsWebhookUrl: atsWebhookUrl || null,
        screeningQuestions,
      });
      onNavigate('MarketplaceJobDetail', { jobId: (res.data as any).id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create job');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-4 space-y-4">
      <JobsWorkspaceNav active="my_jobs" onNavigate={onNavigate} />

      <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-5 space-y-4">
        <h1 className="text-xl font-semibold text-lantern-text">Post a job</h1>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-2">
            Quick templates
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CAMPUS_JOB_INTENT_TEMPLATES.slice(0, 6).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => applyTemplate(t.id)}
                className="text-xs px-2 py-1 rounded-lg border border-lantern-border hover:border-lantern-primary/40"
              >
                {t.title.replace(/\s*\[.*?\]\s*/g, ' ').trim()}
              </button>
            ))}
          </div>
        </div>

        <label className="block text-sm">
          Title
          <input
            className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <label className="block text-sm">
          Description
          <textarea
            className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Type
            <select
              className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
              value={employmentType}
              onChange={(e) => setEmploymentType(e.target.value as JobEmploymentType)}
            >
              {(companyId ? JOB_PHASE2_EMPLOYMENT_TYPES : JOB_PHASE1_EMPLOYMENT_TYPES).map((t) => (
                <option key={t} value={t}>
                  {JOB_EMPLOYMENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Campus
            <select
              className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
              value={campusId}
              onChange={(e) => setCampusId(e.target.value)}
            >
              <option value="">Any / not specified</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block text-sm">
            Compensation
            <select
              className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
              value={compensationKind}
              onChange={(e) => setCompensationKind(e.target.value as typeof compensationKind)}
            >
              <option value="discuss">Discuss</option>
              <option value="paid">Paid</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          {compensationKind === 'paid' ? (
            <label className="block text-sm">
              Amount (NGN)
              <input
                type="number"
                className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                value={amountMin}
                onChange={(e) => setAmountMin(e.target.value)}
              />
            </label>
          ) : null}
        </div>

        <label className="block text-sm">
          Screening question (optional)
          <input
            className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
            value={screener1}
            onChange={(e) => setScreener1(e.target.value)}
          />
        </label>

        {companies.length > 0 ? (
          <div className="space-y-3 border-t border-lantern-border pt-3">
            <label className="block text-sm">
              Post as company (Phase 2)
              <select
                className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
              >
                <option value="">Personal / campus poster</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName} ({c.verificationStatus})
                  </option>
                ))}
              </select>
            </label>
            {companyId ? (
              <>
                <label className="block text-sm">
                  Apply mode
                  <select
                    className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                    value={applyMode}
                    onChange={(e) => setApplyMode(e.target.value as typeof applyMode)}
                  >
                    <option value="in_app">Easy Apply only</option>
                    <option value="external">Company site only</option>
                    <option value="both">Both</option>
                  </select>
                </label>
                {(applyMode === 'external' || applyMode === 'both') && (
                  <label className="block text-sm">
                    External apply URL
                    <input
                      className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                      value={externalUrl}
                      onChange={(e) => setExternalUrl(e.target.value)}
                    />
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={isSponsored} onChange={(e) => setIsSponsored(e.target.checked)} />
                  Sponsored / featured placement
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiresSchoolApproval}
                    onChange={(e) => setRequiresSchoolApproval(e.target.checked)}
                  />
                  Require school / career-services approval
                </label>
                <label className="block text-sm">
                  ATS webhook URL (optional)
                  <input
                    className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                    value={atsWebhookUrl}
                    onChange={(e) => setAtsWebhookUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </label>
              </>
            ) : null}
          </div>
        ) : null}

        <ul className="text-xs text-lantern-text-tertiary space-y-1 list-disc pl-4">
          {JOBS_SCAM_PLAYBOOK_SUMMARY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{JOBS_CREATE_CONFIRMATION}</span>
        </label>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          disabled={busy || !title.trim()}
          onClick={() => void submit()}
          className="rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {busy ? 'Publishing…' : 'Publish job'}
        </button>
      </div>
    </div>
  );
}
