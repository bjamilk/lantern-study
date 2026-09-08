import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  JOB_APPLICATION_STATUS_DESCRIPTIONS,
  JOB_APPLICATION_STATUS_LABELS,
  type JobApplicantProfile,
  type JobApplication,
  type JobApplicationStatus,
  type JobInterview,
  type JobOffer,
} from "@lantern/shared";
import {
  fetchJobApplicantProfile,
  fetchJobApplicationResumeUrl,
  fetchMyJobApplications,
  fetchMyJobInterviews,
  fetchMyJobOffers,
  saveJobApplicantProfile,
  updateJobApplicationStatus,
} from "../services/jobsBoard";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";
import { JobInterviewInvite } from "./jobs/JobInterviewInvite";
import { JobOfferCard } from "./jobs/JobOfferCard";
import { ResumeUploadField } from "./jobs/ResumeUploadField";
import { confirmDialog } from "../stores/confirmStore";
import { planWithdrawApplicationConfirm } from "../utils/destructiveConfirm";

const CLOSED_STATUSES = new Set<JobApplicationStatus>([
  "hired",
  "rejected",
  "withdrawn",
]);

const STATUS_STYLES: Record<JobApplicationStatus, string> = {
  interested: "bg-sky-100 text-sky-800",
  chatting: "bg-indigo-100 text-indigo-800",
  new: "bg-blue-100 text-blue-800",
  reviewing: "bg-violet-100 text-violet-800",
  interview: "bg-amber-100 text-amber-800",
  offer: "bg-emerald-100 text-emerald-800",
  hired: "bg-emerald-100 text-emerald-800",
  rejected: "bg-slate-100 text-slate-700",
  withdrawn: "bg-slate-100 text-slate-700",
};

export default function MyJobApplicationsScreen({
  onNavigate,
  onOpenDm,
}: {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  onOpenDm?: (threadId: string) => void;
}) {
  const [apps, setApps] = useState<JobApplication[]>([]);
  const [interviews, setInterviews] = useState<JobInterview[]>([]);
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [error, setError] = useState<string | null>(null);
  // A failed list load must render as a failure with a retry — not as the
  // "No applications yet" empty state.
  const [loadError, setLoadError] = useState<string | null>(null);
  // Interviews and offers ride a separate fetch; if it fails the candidate
  // could silently miss a live offer, so the failure has to be visible.
  const [sideDataFailed, setSideDataFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"active" | "closed" | "all">("active");
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [profile, setProfile] = useState<JobApplicantProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState({
    headline: "",
    phone: "",
    locationText: "",
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetchMyJobApplications();
      setApps(response.data || []);
    } catch (fetchError) {
      setLoadError(
        fetchError instanceof Error
          ? fetchError.message
          : "Failed to load applications",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadSideData = useCallback(() => {
    // One request for every interview beats one per application card.
    setSideDataFailed(false);
    void Promise.all([
      fetchMyJobInterviews().then((response) =>
        setInterviews(response.data || []),
      ),
      fetchMyJobOffers().then((response) => setOffers(response.data || [])),
    ]).catch(() => setSideDataFailed(true));
  }, []);

  useEffect(() => {
    loadSideData();
  }, [loadSideData]);

  useEffect(() => {
    void fetchJobApplicantProfile()
      .then((response) => {
        setProfile(response.data);
        setProfileDraft({
          headline: response.data?.headline || "",
          phone: response.data?.phone || "",
          locationText: response.data?.locationText || "",
        });
      })
      .catch(() => setProfile(null));
  }, []);

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingProfile(true);
    setProfileSaved(false);
    setError(null);
    try {
      const response = await saveJobApplicantProfile(profileDraft);
      setProfile(response.data);
      setProfileSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save your details",
      );
    } finally {
      setSavingProfile(false);
    }
  };

  /**
   * The newest unfinished interview per application. Cancelled and completed
   * rounds stay out so an old invitation cannot be answered, but a declined one
   * is kept so the candidate can see their own answer landed.
   */
  const interviewsByApplication = useMemo(() => {
    const map = new Map<string, JobInterview>();
    for (const interview of interviews) {
      if (
        interview.status === "cancelled" ||
        interview.status === "completed"
      ) {
        continue;
      }
      const current = map.get(interview.applicationId);
      if (
        !current ||
        new Date(interview.createdAt).getTime() >
          new Date(current.createdAt).getTime()
      ) {
        map.set(interview.applicationId, interview);
      }
    }
    return map;
  }, [interviews]);

  const applyInterviewUpdate = useCallback((updated: JobInterview) => {
    setInterviews((prev) =>
      prev.map((item) => (item.id === updated.id ? updated : item)),
    );
  }, []);

  /**
   * The newest offer per application. Withdrawn ones stay out; an accepted or
   * declined one is kept so the candidate can still see the terms they answered.
   */
  const offersByApplication = useMemo(() => {
    const map = new Map<string, JobOffer>();
    for (const offer of offers) {
      if (offer.status === "withdrawn") continue;
      const current = map.get(offer.applicationId);
      if (
        !current ||
        new Date(offer.createdAt).getTime() >
          new Date(current.createdAt).getTime()
      ) {
        map.set(offer.applicationId, offer);
      }
    }
    return map;
  }, [offers]);

  /**
   * Accepting an offer also moves the application to hired, so the list is
   * refreshed rather than patched to keep the status badge honest.
   */
  const applyOfferUpdate = useCallback(
    (updated: JobOffer) => {
      setOffers((prev) =>
        prev.map((item) => (item.id === updated.id ? updated : item)),
      );
      void load();
    },
    [load],
  );

  const filteredApps = useMemo(() => {
    const sorted = [...apps].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (view === "all") return sorted;
    return sorted.filter((application) =>
      view === "closed"
        ? CLOSED_STATUSES.has(application.status)
        : !CLOSED_STATUSES.has(application.status),
    );
  }, [apps, view]);

  const activeCount = apps.filter(
    (application) => !CLOSED_STATUSES.has(application.status),
  ).length;
  const interviewCount = apps.filter((application) =>
    ["interview", "offer"].includes(application.status),
  ).length;

  const openResume = async (applicationId: string) => {
    setError(null);
    try {
      const response = await fetchJobApplicationResumeUrl(applicationId);
      window.open(response.data.url, "_blank", "noopener,noreferrer");
    } catch (resumeError) {
      setError(
        resumeError instanceof Error
          ? resumeError.message
          : "Could not open the resume",
      );
    }
  };

  const withdraw = async (applicationId: string, jobTitle?: string | null) => {
    // Withdrawing is permanent and blocks re-applying — never one stray click,
    // and never the browser's native confirm chrome.
    const ok = await confirmDialog(planWithdrawApplicationConfirm({ title: jobTitle }));
    if (!ok) return;
    setWithdrawingId(applicationId);
    setError(null);
    try {
      await updateJobApplicationStatus(applicationId, {
        status: "withdrawn",
        asApplicant: true,
      });
      await load();
    } catch (withdrawError) {
      setError(
        withdrawError instanceof Error
          ? withdrawError.message
          : "Could not withdraw",
      );
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
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-lantern-text">
            My applications
          </h1>
          <p className="mt-1 text-sm text-lantern-text-secondary">
            Follow every application from submission to decision.
          </p>
        </header>

        <section
          aria-label="Application summary"
          className="grid gap-3 sm:grid-cols-3"
        >
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Total applications
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {apps.length}
            </p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Active
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {activeCount}
            </p>
          </div>
          <div className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-lantern-text-tertiary">
              Interview / offer
            </p>
            <p className="mt-2 text-2xl font-bold text-lantern-text">
              {interviewCount}
            </p>
          </div>
        </section>

        <section className="rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold text-lantern-text">
              Your applicant profile
            </h2>
            {profileSaved ? (
              <span className="text-xs font-medium text-emerald-700">
                Saved
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-lantern-text-secondary">
            Employers see these details with every application, so you only
            enter them once.
          </p>

          <div className="mt-4">
            <ResumeUploadField profile={profile} onUploaded={setProfile} />
          </div>

          <form onSubmit={saveProfile} className="mt-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block text-sm sm:col-span-3">
                <span className="font-medium text-lantern-text">Headline</span>
                <input
                  value={profileDraft.headline}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      headline: event.target.value,
                    }))
                  }
                  maxLength={160}
                  placeholder="Final-year computer science student · React and Node"
                  className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-lantern-text">Phone</span>
                <input
                  value={profileDraft.phone}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      phone: event.target.value,
                    }))
                  }
                  maxLength={40}
                  placeholder="080…"
                  className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="font-medium text-lantern-text">Location</span>
                <input
                  value={profileDraft.locationText}
                  onChange={(event) =>
                    setProfileDraft((current) => ({
                      ...current,
                      locationText: event.target.value,
                    }))
                  }
                  maxLength={120}
                  placeholder="Lagos, Nigeria"
                  className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2.5 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                />
              </label>
            </div>
            <button
              type="submit"
              disabled={savingProfile}
              className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-lantern-primary/90 disabled:opacity-60"
            >
              {savingProfile ? "Saving…" : "Save details"}
            </button>
          </form>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-lantern-border bg-lantern-surface p-1">
            {(["active", "closed", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition ${
                  view === option
                    ? "bg-lantern-primary text-white shadow-sm"
                    : "text-lantern-text-secondary hover:text-lantern-text"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate("MarketplaceJobs")}
            className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
          >
            Find more jobs
          </button>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {error}
          </p>
        ) : null}

        {sideDataFailed ? (
          <p
            role="alert"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          >
            Interview and offer updates could not be loaded — your list below
            may be missing a live offer.{" "}
            <button
              type="button"
              onClick={loadSideData}
              className="font-semibold underline"
            >
              Retry
            </button>
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
        ) : loadError ? (
          <div
            role="alert"
            className="rounded-lantern-xl border border-red-200 bg-red-50 px-6 py-10 text-center"
          >
            <p className="text-sm font-medium text-red-700">{loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-4 rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Try again
            </button>
          </div>
        ) : filteredApps.length ? (
          <ul className="space-y-3">
            {filteredApps.map((application) => {
              const posting = application.posting;
              const employer =
                posting?.company?.displayName ||
                posting?.poster?.name ||
                posting?.poster?.username ||
                "Independent poster";
              const canWithdraw = !CLOSED_STATUSES.has(application.status);
              const liveInterview = interviewsByApplication.get(application.id);
              const liveOffer = offersByApplication.get(application.id);

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
                            onNavigate("MarketplaceJobDetail", {
                              jobId: application.postingId,
                            })
                          }
                        >
                          {posting?.title || "Job"}
                        </button>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status]}`}
                        >
                          {JOB_APPLICATION_STATUS_LABELS[application.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-lantern-text-secondary">
                        {employer}
                      </p>
                      <p className="mt-3 text-sm text-lantern-text">
                        {
                          JOB_APPLICATION_STATUS_DESCRIPTIONS[
                            application.status
                          ]
                        }
                      </p>
                      <p className="mt-2 text-xs text-lantern-text-tertiary">
                        {[
                          `Applied ${new Date(application.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                          liveInterview
                            ? `Interview ${new Date(liveInterview.scheduledAt || liveInterview.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                            : null,
                          liveOffer
                            ? `Offer ${new Date(liveOffer.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                            : null,
                          `${JOB_APPLICATION_STATUS_LABELS[application.status]} ${new Date(application.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
                        ]
                          .filter(Boolean)
                          .join("  →  ")}
                      </p>
                      <p className="mt-1 text-xs text-lantern-text-tertiary">
                        {application.source === "external_click"
                          ? "External application"
                          : "Lantern Easy Apply"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {application.resumePath || application.resumeUrl ? (
                        <button
                          type="button"
                          className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text hover:border-lantern-primary/40"
                          onClick={() => void openResume(application.id)}
                        >
                          View resume
                        </button>
                      ) : null}
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
                          onClick={() => void withdraw(application.id, posting?.title)}
                        >
                          {withdrawingId === application.id
                            ? "Withdrawing…"
                            : "Withdraw"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {liveOffer ? (
                    <JobOfferCard
                      offer={liveOffer}
                      onUpdated={applyOfferUpdate}
                    />
                  ) : null}
                  {liveInterview ? (
                    <JobInterviewInvite
                      interview={liveInterview}
                      onUpdated={applyInterviewUpdate}
                      jobTitle={posting?.title}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="rounded-lantern-xl border border-dashed border-lantern-border bg-lantern-surface/70 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-lantern-text">
              {apps.length === 0
                ? "No applications yet"
                : `No ${view} applications`}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-lantern-text-secondary">
              {apps.length === 0
                ? "Explore open roles and submit your first application."
                : "Applications will appear here when they move into this category."}
            </p>
            {apps.length === 0 ? (
              <button
                type="button"
                onClick={() => onNavigate("MarketplaceJobs")}
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
