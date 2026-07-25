import React, { useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import {
  JOB_APPLICATION_STATUS_LABELS,
  formatJobPostedDate,
  type JobApplication,
  type JobApplicationStatus,
  type JobPosting,
} from "@lantern/shared";
import { JobApplicantNotes } from "./JobApplicantNotes";
import { JobInterviewScheduler } from "./JobInterviewScheduler";
import { JobOfferPanel } from "./JobOfferPanel";

interface Props {
  application: JobApplication;
  posting?: JobPosting | null;
  currentUserId?: string | null;
  statuses: JobApplicationStatus[];
  onClose: () => void;
  onChangeStatus: (status: JobApplicationStatus) => void;
  onOpenResume: () => void;
  openingResume?: boolean;
  onOpenDm?: () => void;
  onNotesCountChange?: (applicationId: string, count: number) => void;
}

export function JobApplicantDetailModal({
  application,
  posting,
  currentUserId,
  statuses,
  onClose,
  onChangeStatus,
  onOpenResume,
  openingResume,
  onOpenDm,
  onNotesCountChange,
}: Props) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const name =
    application.applicant?.name ||
    application.applicant?.username ||
    "Applicant";
  const answers = Object.entries(application.answers || {});
  const hasResume = !!(application.resumePath || application.resumeUrl);
  const withdrawn = application.status === "withdrawn";

  // Answers are stored keyed by question id, so the prompt comes from the post.
  const promptFor = (questionId: string) =>
    posting?.screeningQuestions?.find((question) => question.id === questionId)
      ?.prompt || "Screening answer";

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Candidate details for ${name}`}
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-lantern-xl border border-lantern-border bg-lantern-surface sm:rounded-lantern-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-b border-lantern-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-lantern-text">
              {name}
            </h2>
            <p className="mt-0.5 text-xs text-lantern-text-tertiary">
              Applied{" "}
              {formatJobPostedDate(application.createdAt).replace(
                "Posted ",
                "",
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close candidate details"
            className="shrink-0 rounded-lg p-1.5 text-lantern-text-tertiary transition hover:bg-lantern-background"
          >
            <XMarkIcon className="h-5 w-5" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {hasResume ? (
              <button
                type="button"
                disabled={openingResume}
                onClick={onOpenResume}
                className="rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm font-medium text-lantern-text transition hover:border-lantern-primary/40 disabled:opacity-50"
              >
                {openingResume
                  ? "Opening…"
                  : application.resumeFilename || "View resume"}
              </button>
            ) : (
              <span className="text-sm text-lantern-text-tertiary">
                No resume attached
              </span>
            )}
            {application.dmThreadId && onOpenDm ? (
              <button
                type="button"
                onClick={onOpenDm}
                className="rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm font-medium text-lantern-text transition hover:border-lantern-primary/40"
              >
                Message
              </button>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="job-applicant-stage"
              className="text-sm font-medium text-lantern-text"
            >
              Stage
            </label>
            <select
              id="job-applicant-stage"
              value={application.status}
              disabled={withdrawn}
              onChange={(event) =>
                onChangeStatus(event.target.value as JobApplicationStatus)
              }
              className="mt-1.5 w-full rounded-lg border border-lantern-border bg-lantern-background px-3 py-2 text-sm text-lantern-text disabled:opacity-60"
            >
              {withdrawn ? (
                <option value="withdrawn">Withdrawn by applicant</option>
              ) : null}
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {JOB_APPLICATION_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </div>

          {answers.length ? (
            <div>
              <h3 className="text-sm font-semibold text-lantern-text">
                Screening answers
              </h3>
              <dl className="mt-1.5 space-y-2">
                {answers.map(([questionId, answer]) => (
                  <div
                    key={questionId}
                    className="rounded-lg border border-lantern-border bg-lantern-background p-3"
                  >
                    <dt className="text-xs font-medium text-lantern-text-secondary">
                      {promptFor(questionId)}
                    </dt>
                    <dd className="mt-1 whitespace-pre-wrap text-sm text-lantern-text">
                      {answer}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {withdrawn ? null : (
            <JobInterviewScheduler
              applicationId={application.id}
              candidateName={name}
              jobTitle={posting?.title}
            />
          )}

          {withdrawn ? null : (
            <JobOfferPanel
              applicationId={application.id}
              candidateName={name}
              posting={posting}
            />
          )}

          <JobApplicantNotes
            applicationId={application.id}
            currentUserId={currentUserId}
            onCountChange={onNotesCountChange}
          />
        </div>
      </div>
    </div>
  );
}

export default JobApplicantDetailModal;
