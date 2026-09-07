import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppIcon } from './ui/AppIcon';
import {
  JOBS_BROWSE_SEO,
  JOBS_COMPLIANCE_BANNER,
  JOB_EMPLOYMENT_TYPE_LABELS,
  JOB_EMPLOYMENT_TYPES,
  describeJobSearchFilters,
  formatJobCompensation,
  formatJobEngagementDuration,
  formatJobLocation,
  formatJobPostedDate,
  getJobEmployerTrustFromPosting,
  isJobEmploymentType,
  suggestJobSavedSearchName,
  type JobPosting,
  type JobSavedSearch,
  type JobSearchFilters,
} from "@lantern/shared";
import { usePageSeo } from "../hooks/usePageSeo";
import { JobTrustBadge } from "./jobs/JobTrustBadge";
import {
  createJobSavedSearch,
  deleteJobSavedSearch,
  fetchJobPostings,
  fetchJobSavedSearches,
  fetchJobSavedSearchMatches,
  fetchSavedJobPostings,
  setJobPostingSaved,
  updateJobSavedSearch,
} from "../services/jobsBoard";
import { JobsWorkspaceNav } from "./jobs/JobsWorkspaceNav";

interface Props {
  onNavigate: (screen: string, params?: Record<string, unknown>) => void;
  guestMode?: boolean;
  onSignInRequired?: () => void;
}

interface PortalFilters {
  search: string;
  employmentType: string;
  location: "" | "remote" | "onsite";
  compensationKind: "" | "paid" | "discuss" | "unpaid";
  minPay: string;
  companyOnly: boolean;
  sort: "newest" | "closing" | "trending";
}

const EMPTY_FILTERS: PortalFilters = {
  search: "",
  employmentType: "",
  location: "",
  compensationKind: "",
  minPay: "",
  companyOnly: false,
  sort: "trending",
};

/** The form's shape is UI-friendly; a saved search stores the shared shape. */
function toSearchFilters(portal: PortalFilters): JobSearchFilters {
  const filters: JobSearchFilters = {};
  const search = portal.search.trim();
  if (search) filters.search = search;
  if (isJobEmploymentType(portal.employmentType)) {
    filters.employmentType = portal.employmentType;
  }
  if (portal.location === "remote") filters.remote = true;
  if (portal.location === "onsite") filters.remote = false;
  if (portal.compensationKind)
    filters.compensationKind = portal.compensationKind;
  const minPay = Number(portal.minPay);
  if (Number.isFinite(minPay) && minPay > 0) filters.minPay = minPay;
  if (portal.companyOnly) filters.companyOnly = true;
  if (portal.sort === "closing" || portal.sort === "newest" || portal.sort === "trending") {
    filters.sort = portal.sort;
  }
  return filters;
}

function fromSearchFilters(filters: JobSearchFilters): PortalFilters {
  return {
    search: filters.search || "",
    employmentType: filters.employmentType || "",
    location:
      filters.remote === true
        ? "remote"
        : filters.remote === false
          ? "onsite"
          : "",
    compensationKind: filters.compensationKind || "",
    minPay: filters.minPay ? String(filters.minPay) : "",
    companyOnly: !!filters.companyOnly,
    sort:
      filters.sort === "closing" || filters.sort === "newest"
        ? filters.sort
        : "trending",
  };
}

/**
 * Filters live in the URL query string so a search survives a refresh and can
 * be shared or bookmarked. Only set params are written, so a clean browse URL
 * stays clean.
 */
function parseFiltersFromUrl(): PortalFilters {
  if (typeof window === "undefined") return EMPTY_FILTERS;
  const p = new URLSearchParams(window.location.search);
  const loc = p.get("loc");
  const comp = p.get("comp");
  const sort = p.get("sort");
  return {
    search: p.get("q") || "",
    employmentType: isJobEmploymentType(p.get("type") || "")
      ? p.get("type")!
      : "",
    location: loc === "remote" || loc === "onsite" ? loc : "",
    compensationKind:
      comp === "paid" || comp === "discuss" || comp === "unpaid" ? comp : "",
    minPay: Number(p.get("minPay")) > 0 ? String(Number(p.get("minPay"))) : "",
    companyOnly: p.get("companyOnly") === "1",
    sort: sort === "newest" || sort === "closing" ? sort : "trending",
  };
}

function writeFiltersToUrl(portal: PortalFilters): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (portal.search.trim()) p.set("q", portal.search.trim());
  if (portal.employmentType) p.set("type", portal.employmentType);
  if (portal.location) p.set("loc", portal.location);
  if (portal.compensationKind) p.set("comp", portal.compensationKind);
  if (portal.minPay && Number(portal.minPay) > 0) p.set("minPay", portal.minPay);
  if (portal.companyOnly) p.set("companyOnly", "1");
  if (portal.sort && portal.sort !== "trending") p.set("sort", portal.sort);
  const qs = p.toString();
  // replaceState (not push) so filter tweaks don't stack up in Back history.
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + (qs ? `?${qs}` : ""),
  );
}

function formatDeadline(
  value?: string | null,
): { label: string; closed: boolean } | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const daysLeft = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  // A passed deadline must read as closed, not vanish and look open-ended.
  if (daysLeft < 0) return { label: "Applications closed", closed: true };
  if (daysLeft === 0) return { label: "Closes today", closed: false };
  if (daysLeft <= 7)
    return {
      label: `Closes in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      closed: false,
    };
  return {
    label: `Apply by ${date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    closed: false,
  };
}

function companyLabel(job: JobPosting) {
  return (
    job.company?.displayName ||
    job.poster?.name ||
    job.poster?.username ||
    "Independent poster"
  );
}

export default function JobsBoardScreen({
  onNavigate,
  guestMode,
  onSignInRequired,
}: Props) {
  usePageSeo(JOBS_BROWSE_SEO);
  const [jobs, setJobs] = useState<JobPosting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Failures of save/alert actions must not unmount the loaded list the way a
  // list-load error does, so they report through their own channel.
  const [actionError, setActionError] = useState<string | null>(null);
  // Seed from the URL so a shared/bookmarked search (or a refresh) restores it.
  const [filters, setFilters] = useState<PortalFilters>(parseFiltersFromUrl);
  const [appliedFilters, setAppliedFilters] =
    useState<PortalFilters>(parseFiltersFromUrl);
  const [view, setView] = useState<"browse" | "saved">("browse");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedSearches, setSavedSearches] = useState<JobSavedSearch[]>([]);
  const [savedSearchMatches, setSavedSearchMatches] = useState<Record<string, number>>({});
  const [savingSearch, setSavingSearch] = useState(false);
  const [searchNameDraft, setSearchNameDraft] = useState<string | null>(null);
  const limit = 12;
  // Monotonic request id: a slow, stale response must never overwrite the
  // rows or error state of a newer view/page/filter selection.
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    setError(null);
    try {
      if (view === "saved") {
        const res = await fetchSavedJobPostings();
        if (seq !== loadSeq.current) return;
        setJobs(res.data || []);
        setTotal((res.data || []).length);
        return;
      }
      const res = await fetchJobPostings({
        page,
        limit,
        search: appliedFilters.search.trim() || undefined,
        employmentType: appliedFilters.employmentType || undefined,
        remote:
          appliedFilters.location === "remote"
            ? true
            : appliedFilters.location === "onsite"
              ? false
              : undefined,
        compensationKind: appliedFilters.compensationKind || undefined,
        minPay:
          Number(appliedFilters.minPay) > 0
            ? Number(appliedFilters.minPay)
            : undefined,
        companyOnly: appliedFilters.companyOnly || undefined,
        sort: appliedFilters.sort,
      });
      if (seq !== loadSeq.current) return;
      setJobs(res.data || []);
      setTotal(res.pagination?.total ?? 0);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : "Failed to load jobs");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [appliedFilters, page, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Signed-out visitors have none; an error here should not block browsing.
    if (guestMode) {
      setSavedSearches([]);
      return;
    }
    void fetchJobSavedSearches()
      .then((res) => {
        const searches = res.data || [];
        setSavedSearches(searches);
        // In-app job alerts: count postings that appeared since each search
        // was last checked. Checking acknowledges, so badges are one-shot.
        void Promise.all(
          searches.map((saved) =>
            fetchJobSavedSearchMatches(saved.id)
              .then((m) => [saved.id, m.count] as const)
              .catch(() => [saved.id, 0] as const),
          ),
        ).then((pairs) => {
          setSavedSearchMatches(Object.fromEntries(pairs.filter(([, c]) => c > 0)));
        });
      })
      .catch(() => setSavedSearches([]));
  }, [guestMode]);

  const applyFilters = (event: React.FormEvent) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters(filters);
    writeFiltersToUrl(filters);
  };

  // Sort and the company-only toggle read as live controls, so they take
  // effect immediately instead of waiting for the Search button.
  const applyFilterPatch = (patch: Partial<PortalFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setAppliedFilters((current) => {
      const next = { ...current, ...patch };
      writeFiltersToUrl(next);
      return next;
    });
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
    setPage(1);
    writeFiltersToUrl(EMPTY_FILTERS);
  };

  const saveCurrentSearch = async (name: string) => {
    setSavingSearch(true);
    setActionError(null);
    try {
      // Save the results the user is looking at, not an unapplied draft.
      const res = await createJobSavedSearch({
        name,
        filters: toSearchFilters(appliedFilters),
        notify: true,
      });
      setSavedSearches((current) => [res.data, ...current]);
      setSearchNameDraft(null);
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not save this search",
      );
    } finally {
      setSavingSearch(false);
    }
  };

  const applySavedSearch = (saved: JobSavedSearch) => {
    const portal = fromSearchFilters(saved.filters);
    setFilters(portal);
    setAppliedFilters(portal);
    setView("browse");
    setPage(1);
    writeFiltersToUrl(portal);
  };

  const toggleSearchAlerts = async (saved: JobSavedSearch) => {
    const notify = !saved.notify;
    setSavedSearches((current) =>
      current.map((item) =>
        item.id === saved.id ? { ...item, notify } : item,
      ),
    );
    try {
      await updateJobSavedSearch(saved.id, { notify });
    } catch (e) {
      setSavedSearches((current) =>
        current.map((item) =>
          item.id === saved.id ? { ...item, notify: saved.notify } : item,
        ),
      );
      setActionError(
        e instanceof Error ? e.message : "Could not update alerts",
      );
    }
  };

  const removeSavedSearch = async (saved: JobSavedSearch) => {
    setSavedSearches((current) =>
      current.filter((item) => item.id !== saved.id),
    );
    try {
      await deleteJobSavedSearch(saved.id);
    } catch (e) {
      setSavedSearches((current) => [saved, ...current]);
      setActionError(
        e instanceof Error ? e.message : "Could not delete this search",
      );
    }
  };

  const toggleSaved = async (job: JobPosting) => {
    if (guestMode) {
      onSignInRequired?.();
      return;
    }
    const nextSaved = !job.isSaved;
    setSavingId(job.id);
    setActionError(null);
    // Reflect the change immediately, then reconcile if the request fails.
    setJobs((current) =>
      current.map((item) =>
        item.id === job.id ? { ...item, isSaved: nextSaved } : item,
      ),
    );
    try {
      await setJobPostingSaved(job.id, nextSaved);
      if (view === "saved" && !nextSaved) {
        setJobs((current) => current.filter((item) => item.id !== job.id));
        setTotal((current) => Math.max(0, current - 1));
      }
    } catch (e) {
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, isSaved: job.isSaved } : item,
        ),
      );
      setActionError(
        e instanceof Error ? e.message : "Could not update saved jobs",
      );
    } finally {
      setSavingId(null);
    }
  };

  const totalPages =
    view === "saved" ? 1 : Math.max(1, Math.ceil(total / limit));
  const hasFilters =
    !!appliedFilters.search ||
    !!appliedFilters.employmentType ||
    !!appliedFilters.location ||
    !!appliedFilters.compensationKind ||
    Number(appliedFilters.minPay) > 0 ||
    appliedFilters.companyOnly;

  return (
    <div className="flex-1 min-h-0 min-w-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain bg-lantern-background">
      <div className="max-w-6xl mx-auto px-4 py-4 pb-20 md:pb-8 space-y-5">
        {!guestMode ? (
          <JobsWorkspaceNav
            active="jobs"
            onNavigate={onNavigate}
            onPostJob={() => onNavigate("CreateMarketplaceJob")}
          />
        ) : (
          /* Guests get the Goods/Jobs switch the signed-in workspace nav provides. */
          <div
            role="group"
            aria-label="Explore section"
            className="inline-flex rounded-lg border border-lantern-border bg-lantern-surface p-0.5"
          >
            <button
              type="button"
              onClick={() => onNavigate("Marketplace")}
              className="inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-lantern-text-secondary hover:text-lantern-text transition-colors"
            >
              Goods
            </button>
            <span
              aria-current="page"
              className="inline-flex items-center rounded-md bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm"
            >
              Jobs
            </span>
          </div>
        )}

        <section className="overflow-hidden rounded-lantern-xl border border-lantern-border bg-lantern-surface shadow-sm">
          <div className="bg-gradient-to-br from-lantern-primary/10 via-lantern-surface to-lantern-surface px-5 py-6 sm:px-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lantern-primary">
              Opportunities across Nigeria
            </p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-lantern-text sm:text-3xl">
              Find work that fits your goals
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-lantern-text-secondary">
              Search full-time roles, internships, part-time work, tutoring,
              research, and local gigs.
            </p>

            {!guestMode ? (
              <div
                role="tablist"
                aria-label="Job list"
                className="mt-5 inline-flex rounded-lg border border-lantern-border bg-lantern-surface p-1"
              >
                {(
                  [
                    { id: "browse", label: "All jobs" },
                    { id: "saved", label: "Saved jobs" },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={view === tab.id}
                    onClick={() => {
                      setView(tab.id);
                      setPage(1);
                    }}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      view === tab.id
                        ? "bg-lantern-primary text-white shadow-sm"
                        : "text-lantern-text-secondary hover:text-lantern-text"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {view === "browse" ? (
            <form
              onSubmit={applyFilters}
              className="border-t border-lantern-border p-4 sm:p-5"
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(240px,2fr)_repeat(3,minmax(140px,1fr))_auto]">
                <label className="block">
                  <span className="sr-only">Search jobs</span>
                  <input
                    value={filters.search}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        search: event.target.value,
                      }))
                    }
                    placeholder="Job title, skill, or company"
                    className="h-11 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text outline-none transition focus:border-lantern-primary focus:ring-2 focus:ring-lantern-primary/20"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Job type</span>
                  <select
                    value={filters.employmentType}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        employmentType: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                  >
                    <option value="">All job types</option>
                    {JOB_EMPLOYMENT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {JOB_EMPLOYMENT_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Location type</span>
                  <select
                    value={filters.location}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        location: event.target
                          .value as PortalFilters["location"],
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                  >
                    <option value="">Any location</option>
                    <option value="remote">Remote</option>
                    <option value="onsite">On-site / hybrid</option>
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Compensation</span>
                  <select
                    value={filters.compensationKind}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        compensationKind: event.target
                          .value as PortalFilters["compensationKind"],
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                  >
                    <option value="">Any compensation</option>
                    <option value="paid">Paid</option>
                    <option value="discuss">Pay discussed</option>
                    <option value="unpaid">Unpaid</option>
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Minimum pay in naira</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={5000}
                    placeholder="Min pay ₦"
                    value={filters.minPay}
                    onChange={(event) =>
                      setFilters((current) => ({
                        ...current,
                        minPay: event.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text outline-none focus:border-lantern-primary"
                  />
                </label>
                <button
                  type="submit"
                  className="h-11 rounded-lg bg-lantern-primary px-5 text-sm font-semibold text-white transition hover:bg-lantern-primary/90 focus:outline-none focus:ring-2 focus:ring-lantern-primary/30"
                >
                  Search jobs
                </button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3">
                <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-lantern-text-secondary">
                  <input
                    type="checkbox"
                    checked={filters.companyOnly}
                    onChange={(event) =>
                      applyFilterPatch({ companyOnly: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-lantern-border text-lantern-primary focus:ring-lantern-primary"
                  />
                  Company roles only
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-lantern-text-secondary">
                  Sort
                  <select
                    value={filters.sort}
                    onChange={(event) =>
                      applyFilterPatch({
                        sort: event.target.value as PortalFilters["sort"],
                      })
                    }
                    className="rounded-md border border-lantern-border bg-lantern-background px-2 py-1 text-sm text-lantern-text"
                  >
                    <option value="trending">Trending</option>
                    <option value="newest">Newest</option>
                    <option value="closing">Closing soon</option>
                  </select>
                </label>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm font-medium text-lantern-primary hover:underline"
                  >
                    Clear filters
                  </button>
                ) : null}
                {!guestMode ? (
                  <button
                    type="button"
                    onClick={() =>
                      setSearchNameDraft(
                        searchNameDraft === null
                          ? suggestJobSavedSearchName(
                              toSearchFilters(appliedFilters),
                            )
                          : null,
                      )
                    }
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-lantern-primary hover:underline"
                  >
                    <AppIcon name="notifications-alert" size={16} aria-hidden />
                    Save search &amp; get alerts
                  </button>
                ) : null}
              </div>

              {!guestMode && searchNameDraft !== null ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-lantern-primary/30 bg-lantern-primary/5 p-3">
                  <label className="flex-1 min-w-[200px] text-sm">
                    <span className="sr-only">Name this search</span>
                    <input
                      autoFocus
                      value={searchNameDraft}
                      onChange={(event) =>
                        setSearchNameDraft(event.target.value)
                      }
                      placeholder="Name this search"
                      className="h-10 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 text-sm text-lantern-text"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={savingSearch || !searchNameDraft.trim()}
                    onClick={() =>
                      void saveCurrentSearch(searchNameDraft.trim())
                    }
                    className="h-10 rounded-lg bg-lantern-primary px-4 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {savingSearch ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setSearchNameDraft(null)}
                    className="h-10 rounded-lg border border-lantern-border px-4 text-sm font-medium text-lantern-text"
                  >
                    Cancel
                  </button>
                  <p className="w-full text-xs text-lantern-text-tertiary">
                    We&apos;ll notify you when a new job matches{" "}
                    {describeJobSearchFilters(toSearchFilters(appliedFilters))}.
                  </p>
                </div>
              ) : null}

              {!guestMode && savedSearches.length ? (
                <div className="mt-4 border-t border-lantern-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-lantern-text-tertiary">
                    Your saved searches
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {savedSearches.map((saved) => (
                      <li
                        key={saved.id}
                        className="flex items-center gap-1 rounded-full border border-lantern-border bg-lantern-background pl-3 pr-1.5 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => applySavedSearch(saved)}
                          title={describeJobSearchFilters(saved.filters)}
                          className="text-sm font-medium text-lantern-text hover:text-lantern-primary"
                        >
                          {saved.name}
                        </button>
                        {savedSearchMatches[saved.id] ? (
                          <span
                            aria-label={`${savedSearchMatches[saved.id]} new matches`}
                            className="rounded-full bg-lantern-primary px-1.5 py-0.5 text-label tracking-normal font-bold text-white"
                          >
                            {savedSearchMatches[saved.id]}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void toggleSearchAlerts(saved)}
                          aria-pressed={saved.notify}
                          aria-label={
                            saved.notify
                              ? `Turn off alerts for ${saved.name}`
                              : `Turn on alerts for ${saved.name}`
                          }
                          className={`rounded-full p-1 ${
                            saved.notify
                              ? "text-lantern-primary"
                              : "text-lantern-text-tertiary"
                          }`}
                        >
                          {saved.notify ? (
                            <AppIcon name="notifications-alert" size={16} aria-hidden />
                          ) : (
                            <AppIcon name="notifications-off" size={16} aria-hidden />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeSavedSearch(saved)}
                          aria-label={`Delete ${saved.name}`}
                          className="rounded-full p-1 text-lantern-text-tertiary hover:text-red-600"
                        >
                          <span aria-hidden>×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </form>
          ) : null}
        </section>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-lantern-text">
              {loading
                ? "Finding opportunities…"
                : view === "saved"
                  ? `${total} saved ${total === 1 ? "job" : "jobs"}`
                  : `${total} ${total === 1 ? "job" : "jobs"} found`}
            </h2>
            <p className="mt-0.5 text-xs text-lantern-text-tertiary">
              Review the poster and role details before sharing personal
              information.
            </p>
          </div>
          {!guestMode ? (
            <button
              type="button"
              onClick={() => onNavigate("MyJobApplications")}
              className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text hover:border-lantern-primary/40"
            >
              Track my applications
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onSignInRequired?.()}
              className="rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-sm font-medium text-lantern-text hover:border-lantern-primary/40"
            >
              Sign in to apply
            </button>
          )}
        </div>

        {actionError ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800"
          >
            <span>{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="shrink-0 font-semibold underline"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {error}
            <button
              type="button"
              className="ml-2 font-semibold underline"
              onClick={() => void load()}
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="space-y-3" aria-label="Loading jobs">
            {[0, 1, 2].map((item) => (
              <div
                key={item}
                className="h-44 animate-pulse rounded-lantern-xl border border-lantern-border bg-lantern-surface"
              />
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-lantern-xl border border-dashed border-lantern-border bg-lantern-surface/70 px-6 py-12 text-center">
            <p className="text-lg font-semibold text-lantern-text">
              {view === "saved" ? "No saved jobs yet" : "No matching jobs"}
            </p>
            <p className="mx-auto mt-2 max-w-md text-sm text-lantern-text-secondary">
              {view === "saved"
                ? "Save roles while browsing to compare them later and apply when you are ready."
                : "Try a broader keyword or remove a filter. New opportunities are added regularly."}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {view === "saved" ? (
                <button
                  type="button"
                  onClick={() => setView("browse")}
                  className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Browse jobs
                </button>
              ) : (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-lg bg-lantern-primary px-4 py-2 text-sm font-semibold text-white"
                >
                  Clear filters
                </button>
              )}
              <button
                type="button"
                onClick={() => onNavigate("CreateMarketplaceJob")}
                className="rounded-lg border border-lantern-border px-4 py-2 text-sm font-semibold text-lantern-text"
              >
                Post a job
              </button>
            </div>
          </div>
        ) : (
          <ul className="space-y-3">
            {jobs.map((job) => {
              const employer = companyLabel(job);
              const deadline = formatDeadline(job.deadline);
              const duration = formatJobEngagementDuration(
                job.engagementDuration,
              );
              return (
                <li key={job.id}>
                  <article
                    className={`group relative rounded-lantern-xl border bg-lantern-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-lantern-primary/50 hover:shadow-md focus-within:ring-2 focus-within:ring-lantern-primary/30 sm:p-5 ${
                      job.isSponsored
                        ? "border-amber-300/80"
                        : "border-lantern-border"
                    }`}
                  >
                    <div className="flex gap-4">
                      {job.company?.logoUrl ? (
                        <img
                          src={job.company.logoUrl}
                          alt=""
                          className="h-12 w-12 shrink-0 rounded-xl border border-lantern-border bg-white object-contain p-1.5"
                        />
                      ) : (
                        <div
                          aria-hidden="true"
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-lantern-primary/10 text-lg font-bold text-lantern-primary"
                        >
                          {employer.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="text-base font-semibold text-lantern-text transition group-hover:text-lantern-primary sm:text-lg">
                              {/* Stretched target keeps the whole card clickable without nesting buttons. */}
                              <button
                                type="button"
                                onClick={() =>
                                  onNavigate("MarketplaceJobDetail", {
                                    jobId: job.id,
                                  })
                                }
                                className="text-left after:absolute after:inset-0 after:content-[''] focus:outline-none"
                              >
                                {job.title}
                              </button>
                            </h3>
                            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 truncate text-sm text-lantern-text-secondary">
                              <span className="truncate">{employer}</span>
                              <JobTrustBadge
                                trust={getJobEmployerTrustFromPosting(job)}
                                compact
                              />
                            </p>
                          </div>
                          <div className="relative z-10 flex shrink-0 items-center gap-2">
                            {job.hasApplied ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-label font-bold uppercase tracking-wide text-emerald-800">
                                Already applied
                              </span>
                            ) : null}
                            {job.isSponsored ? (
                              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-label font-bold uppercase tracking-wide text-amber-800">
                                Featured
                              </span>
                            ) : null}
                            <button
                              type="button"
                              disabled={savingId === job.id}
                              aria-pressed={!!job.isSaved}
                              aria-label={
                                job.isSaved
                                  ? `Unsave ${job.title}`
                                  : `Save ${job.title}`
                              }
                              onClick={() => void toggleSaved(job)}
                              className="rounded-lg p-2 text-lantern-text-tertiary transition hover:bg-lantern-primary/10 hover:text-lantern-primary disabled:opacity-50"
                            >
                              {job.isSaved ? (
                                <AppIcon name="bookmark" size={20} filled className="text-lantern-primary" aria-hidden />
                              ) : (
                                <AppIcon name="bookmark" size={20} aria-hidden />
                              )}
                            </button>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full bg-lantern-background px-2.5 py-1 text-lantern-text-secondary">
                            {formatJobLocation(job)}
                          </span>
                          <span className="rounded-full bg-lantern-background px-2.5 py-1 text-lantern-text-secondary">
                            {JOB_EMPLOYMENT_TYPE_LABELS[job.employmentType]}
                          </span>
                          <span className="rounded-full bg-lantern-primary/10 px-2.5 py-1 font-medium text-lantern-primary">
                            {formatJobCompensation(job.compensation)}
                          </span>
                          {duration ? (
                            <span className="rounded-full bg-lantern-background px-2.5 py-1 text-lantern-text-secondary">
                              {duration}
                            </span>
                          ) : null}
                          {job.applyMode === "in_app" || job.applyMode === "both" ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              Easy Apply
                            </span>
                          ) : null}
                          {typeof job.applicationsCount === "number" &&
                          job.applicationsCount < 5 &&
                          !job.hasApplied ? (
                            <span className="rounded-full bg-lantern-primary/10 px-2.5 py-1 font-medium text-lantern-primary">
                              Be an early applicant
                            </span>
                          ) : null}
                        </div>

                        <p className="mt-3 line-clamp-2 text-sm leading-6 text-lantern-text-secondary">
                          {job.description}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-lantern-text-tertiary">
                          <span>{formatJobPostedDate(job.createdAt)}</span>
                          {deadline ? (
                            <span
                              className={
                                deadline.closed
                                  ? "font-medium text-red-700"
                                  : "font-medium text-amber-700"
                              }
                            >
                              {deadline.label}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        {!loading && !error && totalPages > 1 ? (
          <nav
            aria-label="Job results pages"
            className="flex items-center justify-center gap-3 pt-2"
          >
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-lantern-text-secondary">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              className="rounded-lg border border-lantern-border px-3 py-2 text-sm font-medium text-lantern-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </nav>
        ) : null}

        <p className="rounded-lg bg-lantern-surface/70 px-4 py-3 text-xs leading-5 text-lantern-text-tertiary">
          {JOBS_COMPLIANCE_BANNER}
        </p>
      </div>
    </div>
  );
}
