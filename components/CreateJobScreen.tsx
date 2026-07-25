import React, { useEffect, useMemo, useState } from "react";
import {
  JOBS_CREATE_CONFIRMATION,
  JOBS_SCAM_PLAYBOOK_SUMMARY,
  JOB_COMPENSATION_PERIOD_LABELS,
  JOB_COMPENSATION_PERIODS,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_ENGAGEMENT_DURATION_UNIT_LABELS,
  JOB_ENGAGEMENT_DURATION_UNITS,
  JOB_INTENT_TEMPLATE_GROUPS,
  JOB_INTENT_TEMPLATES,
  JOB_PHASE1_EMPLOYMENT_TYPES,
  JOB_PHASE2_EMPLOYMENT_TYPES,
  JOB_POSTING_STATUS_LABELS,
  formatJobCompensation,
  formatJobLocation,
  isJobPostingEditable,
  jobIntentTemplatesByGroup,
  jobRequiresEngagementDuration,
  type JobCompensationPeriod,
  type JobEmploymentType,
  type JobEngagementDurationUnit,
  type JobPosting,
  type JobPostingStatus,
} from "@lantern/shared";
import {
  createJobPosting,
  fetchJobPosting,
  fetchJobTemplates,
  fetchMyJobCompanies,
  updateJobPosting,
} from "../services/jobsBoard";
import { fetchMarketplaceCampuses } from "../services/supabase";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";

interface Props {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  /** When set, the form edits that posting instead of creating a new one. */
  jobId?: string | null;
}

export default function CreateJobScreen({ onNavigate, jobId }: Props) {
  const isEdit = !!jobId;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [employmentType, setEmploymentType] =
    useState<JobEmploymentType>("part_time");
  const [campusId, setCampusId] = useState("");
  const [campuses, setCampuses] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [compensationKind, setCompensationKind] = useState<
    "paid" | "unpaid" | "discuss"
  >("discuss");
  const [amountMin, setAmountMin] = useState("");
  const [payPeriod, setPayPeriod] = useState<JobCompensationPeriod>("month");
  const [durationKind, setDurationKind] = useState<"ongoing" | "fixed">(
    "fixed",
  );
  const [durationValue, setDurationValue] = useState("1");
  const [durationUnit, setDurationUnit] =
    useState<JobEngagementDurationUnit>("month");
  const [confirmed, setConfirmed] = useState(false);
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<
    Array<{ id: string; displayName: string; verificationStatus: string }>
  >([]);
  const [applyMode, setApplyMode] = useState<"in_app" | "external" | "both">(
    "in_app",
  );
  const [externalUrl, setExternalUrl] = useState("");
  const [isSponsored, setIsSponsored] = useState(false);
  const [requiresSchoolApproval, setRequiresSchoolApproval] = useState(false);
  const [atsWebhookUrl, setAtsWebhookUrl] = useState("");
  const [screener1, setScreener1] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingJob, setLoadingJob] = useState(isEdit);
  const [status, setStatus] = useState<JobPostingStatus>("active");
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    void fetchMarketplaceCampuses("NG").then((list) =>
      setCampuses((list || []).map((c: any) => ({ id: c.id, name: c.name }))),
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
            })),
        ),
      )
      .catch(() => undefined);
    void fetchJobTemplates().catch(() => undefined);
  }, []);

  // Prefill from the existing post when editing.
  useEffect(() => {
    if (!jobId) return;
    let active = true;
    setLoadingJob(true);
    fetchJobPosting(jobId)
      .then((res) => {
        const job = res.data;
        if (!active || !job) return;
        setTitle(job.title || "");
        setDescription(job.description || "");
        setEmploymentType(job.employmentType);
        setCampusId(job.campusId || "");
        setStatus(job.status);
        setCompanyId(job.companyId || "");
        setApplyMode(job.applyMode || "in_app");
        setExternalUrl(job.externalUrl || "");
        setIsSponsored(!!job.isSponsored);
        setRequiresSchoolApproval(!!job.requiresSchoolApproval);
        setAtsWebhookUrl(job.atsWebhookUrl || "");
        setScreener1(job.screeningQuestions?.[0]?.prompt || "");

        const compensation = job.compensation || { kind: "discuss" as const };
        setCompensationKind(compensation.kind);
        setAmountMin(
          compensation.amountMin != null ? String(compensation.amountMin) : "",
        );
        if (compensation.period) setPayPeriod(compensation.period);

        const duration = job.engagementDuration;
        if (duration?.kind === "fixed") {
          setDurationKind("fixed");
          setDurationValue(String(duration.value));
          setDurationUnit(duration.unit);
        } else if (duration?.kind === "ongoing") {
          setDurationKind("ongoing");
        }

        // The attestation was already accepted when the post was created.
        setConfirmed(true);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load this job",
        ),
      )
      .finally(() => {
        if (active) setLoadingJob(false);
      });
    return () => {
      active = false;
    };
  }, [jobId]);

  const allowedTypes = useMemo(
    () =>
      companyId ? JOB_PHASE2_EMPLOYMENT_TYPES : JOB_PHASE1_EMPLOYMENT_TYPES,
    [companyId],
  );

  useEffect(() => {
    if (loadingJob) return;
    if (!allowedTypes.includes(employmentType)) {
      setEmploymentType("part_time");
    }
  }, [allowedTypes, employmentType, loadingJob]);

  const applyTemplate = (id: string) => {
    const t = JOB_INTENT_TEMPLATES.find((x) => x.id === id);
    if (!t) return;
    if (!allowedTypes.includes(t.employmentType) && !companyId) {
      setError(
        "That template’s type needs a company account. Select a company below, or pick another template.",
      );
    } else {
      setError(null);
    }
    setEmploymentType(t.employmentType);
    setTitle(t.title);
    setDescription(t.descriptionHint);
    setScreener1(t.suggestedScreeners[0] || "");
  };

  /** Shared shape for both create and edit, so the two cannot drift. */
  const buildPayload = () => {
    if (!allowedTypes.includes(employmentType)) {
      throw new Error(
        "That employment type requires a verified company account.",
      );
    }
    if (compensationKind === "paid" && !payPeriod) {
      throw new Error("Select a pay period for the compensated amount.");
    }
    if (compensationKind === "paid" && !amountMin.trim()) {
      throw new Error("Enter the compensated amount.");
    }
    if (jobRequiresEngagementDuration(employmentType)) {
      if (
        durationKind === "fixed" &&
        (!durationValue.trim() || Number(durationValue) < 1)
      ) {
        throw new Error("Enter how long this role lasts.");
      }
    }
    return {
      title,
      description,
      employmentType,
      campusId: campusId || null,
      compensation: {
        kind: compensationKind,
        currency: "NGN",
        amountMin:
          compensationKind === "paid" && amountMin ? Number(amountMin) : null,
        period: compensationKind === "paid" ? payPeriod : null,
      },
      engagementDuration: jobRequiresEngagementDuration(employmentType)
        ? durationKind === "ongoing"
          ? { kind: "ongoing" as const }
          : {
              kind: "fixed" as const,
              value: Number(durationValue),
              unit: durationUnit,
            }
        : null,
      applyMode,
      externalUrl: externalUrl || null,
      requiresSchoolApproval,
      isSponsored: companyId ? isSponsored : false,
      atsWebhookUrl: atsWebhookUrl || null,
      screeningQuestions: screener1.trim()
        ? [
            {
              prompt: screener1.trim(),
              questionType: "text" as const,
              required: true,
            },
          ]
        : [],
    };
  };

  const submit = async (nextStatus: JobPostingStatus) => {
    if (!confirmed) {
      setError("Confirm the posting attestation first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = buildPayload();
      if (isEdit && jobId) {
        // An unchanged status is sent as-is; the API treats it as a no-op.
        await updateJobPosting(jobId, { ...payload, status: nextStatus });
        onNavigate("MarketplaceJobDetail", { jobId });
      } else {
        const res = await createJobPosting({
          ...payload,
          companyId: companyId || null,
          status: nextStatus,
        });
        onNavigate("MarketplaceJobDetail", { jobId: (res.data as any).id });
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : `Failed to ${isEdit ? "save" : "create"} job`,
      );
    } finally {
      setBusy(false);
    }
  };

  const locked = isEdit && !isJobPostingEditable(status);

  // Mirrors what a candidate sees, so a draft can be checked before publishing.
  const preview: Pick<
    JobPosting,
    "isRemote" | "locationText" | "campusName"
  > & {
    compensationLabel: string;
  } = {
    isRemote: false,
    locationText: null,
    campusName: campuses.find((c) => c.id === campusId)?.name || null,
    compensationLabel: formatJobCompensation({
      kind: compensationKind,
      currency: "NGN",
      amountMin:
        compensationKind === "paid" && amountMin ? Number(amountMin) : null,
      period: compensationKind === "paid" ? payPeriod : null,
    }),
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-2xl mx-auto px-4 py-4 pb-20 md:pb-6 space-y-4">
        <JobsWorkspaceNav active="my_jobs" onNavigate={onNavigate} />

        <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface/95 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-lantern-text">
              {isEdit ? "Edit job" : "Post a job"}
            </h1>
            {isEdit ? (
              <span className="rounded-full bg-lantern-background px-2.5 py-1 text-xs font-semibold text-lantern-text-secondary">
                {JOB_POSTING_STATUS_LABELS[status]}
              </span>
            ) : null}
          </div>

          {loadingJob ? (
            <p className="text-sm text-lantern-text-secondary">Loading job…</p>
          ) : null}

          {locked ? (
            <p
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              This job was removed by moderation and can no longer be edited.
            </p>
          ) : null}

          {!isEdit ? (
            <div className="space-y-3">
              {JOB_INTENT_TEMPLATE_GROUPS.map((group) => (
                <div key={group.id}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary mb-2">
                    {group.label}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {jobIntentTemplatesByGroup(group.id).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => applyTemplate(t.id)}
                        className="text-xs px-2 py-1 rounded-lg border border-lantern-border hover:border-lantern-primary/40"
                      >
                        {t.title.replace(/\s*\[.*?\]\s*/g, " ").trim()}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

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
              Type of job offer
              <select
                className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                value={employmentType}
                onChange={(e) =>
                  setEmploymentType(e.target.value as JobEmploymentType)
                }
              >
                {allowedTypes.map((t) => (
                  <option key={t} value={t}>
                    {JOB_EMPLOYMENT_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Campus (optional)
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
                onChange={(e) =>
                  setCompensationKind(e.target.value as typeof compensationKind)
                }
              >
                <option value="discuss">Discuss</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Unpaid</option>
              </select>
            </label>
            {compensationKind === "paid" ? (
              <label className="block text-sm">
                Amount (NGN)
                <input
                  type="number"
                  min={0}
                  className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                />
              </label>
            ) : null}
          </div>

          {compensationKind === "paid" ? (
            <label className="block text-sm">
              Pay period
              <select
                className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                value={payPeriod}
                onChange={(e) =>
                  setPayPeriod(e.target.value as JobCompensationPeriod)
                }
              >
                {JOB_COMPENSATION_PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {JOB_COMPENSATION_PERIOD_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {jobRequiresEngagementDuration(employmentType) ? (
            <div className="space-y-2 rounded-lg border border-lantern-border p-3 bg-lantern-background/60">
              <p className="text-sm font-medium text-lantern-text">
                How long does this role last?
              </p>
              <label className="block text-sm">
                Duration
                <select
                  className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                  value={durationKind}
                  onChange={(e) =>
                    setDurationKind(e.target.value as "ongoing" | "fixed")
                  }
                >
                  <option value="fixed">Fixed length</option>
                  <option value="ongoing">Ongoing</option>
                </select>
              </label>
              {durationKind === "fixed" ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block text-sm">
                    Length
                    <input
                      type="number"
                      min={1}
                      className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                      value={durationValue}
                      onChange={(e) => setDurationValue(e.target.value)}
                    />
                  </label>
                  <label className="block text-sm">
                    Unit
                    <select
                      className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                      value={durationUnit}
                      onChange={(e) =>
                        setDurationUnit(
                          e.target.value as JobEngagementDurationUnit,
                        )
                      }
                    >
                      {JOB_ENGAGEMENT_DURATION_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {JOB_ENGAGEMENT_DURATION_UNIT_LABELS[u]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          ) : null}

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
                Post as company
                <select
                  className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background disabled:opacity-60"
                  value={companyId}
                  disabled={isEdit}
                  onChange={(e) => setCompanyId(e.target.value)}
                >
                  <option value="">Individual / org (no company)</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.displayName} ({c.verificationStatus})
                    </option>
                  ))}
                </select>
              </label>
              {isEdit ? (
                <p className="text-xs text-lantern-text-tertiary">
                  The posting owner cannot be changed after publishing.
                </p>
              ) : null}
              {companyId ? (
                <>
                  <label className="block text-sm">
                    Apply mode
                    <select
                      className="mt-1 w-full rounded-lg border border-lantern-border px-3 py-2 bg-lantern-background"
                      value={applyMode}
                      onChange={(e) =>
                        setApplyMode(e.target.value as typeof applyMode)
                      }
                    >
                      <option value="in_app">Easy Apply only</option>
                      <option value="external">Company site only</option>
                      <option value="both">Both</option>
                    </select>
                  </label>
                  {(applyMode === "external" || applyMode === "both") && (
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
                    <input
                      type="checkbox"
                      checked={isSponsored}
                      onChange={(e) => setIsSponsored(e.target.checked)}
                    />
                    Sponsored / featured placement
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={requiresSchoolApproval}
                      onChange={(e) =>
                        setRequiresSchoolApproval(e.target.checked)
                      }
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

          {previewing ? (
            <section
              aria-label="Candidate preview"
              className="rounded-lantern-xl border border-lantern-primary/30 bg-lantern-background p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-lantern-primary">
                How candidates will see it
              </p>
              <h2 className="mt-2 text-lg font-bold text-lantern-text">
                {title.trim() || "Untitled job"}
              </h2>
              <p className="mt-1 text-sm text-lantern-text-secondary">
                {JOB_EMPLOYMENT_TYPE_LABELS[employmentType]} ·{" "}
                {formatJobLocation(preview)}
              </p>
              <p className="mt-2 text-sm font-medium text-lantern-text">
                {preview.compensationLabel}
              </p>
              <p className="mt-3 whitespace-pre-wrap text-sm text-lantern-text">
                {description.trim() || "No description yet."}
              </p>
              {screener1.trim() ? (
                <p className="mt-3 text-xs text-lantern-text-tertiary">
                  Applicants answer: {screener1.trim()}
                </p>
              ) : null}
            </section>
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

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || locked || !title.trim()}
              onClick={() =>
                void submit(isEdit && status !== "draft" ? status : "active")
              }
              className="rounded-lg bg-lantern-primary text-white px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {busy
                ? "Saving…"
                : isEdit
                  ? status === "draft"
                    ? "Publish job"
                    : "Save changes"
                  : "Publish job"}
            </button>
            {status === "draft" || !isEdit ? (
              <button
                type="button"
                disabled={busy || locked || !title.trim()}
                onClick={() => void submit("draft")}
                className="rounded-lg border border-lantern-border px-4 py-2 text-sm font-medium text-lantern-text disabled:opacity-60"
              >
                Save as draft
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setPreviewing((current) => !current)}
              className="rounded-lg border border-lantern-border px-4 py-2 text-sm font-medium text-lantern-text"
            >
              {previewing ? "Hide preview" : "Preview"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
