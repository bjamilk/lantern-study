import React, { useState } from "react";
import {
  JOB_INTERVIEW_LOCATION_LABELS,
  JOB_INTERVIEW_MODE_LABELS,
  JOB_INTERVIEW_STATUS_LABELS,
  canApplicantRespondToJobInterview,
  describeJobInterviewSchedule,
  type JobInterview,
} from "@lantern/shared";
import { respondToJobInterview } from "../../services/jobsBoard";

interface Props {
  interview: JobInterview;
  onUpdated: (interview: JobInterview) => void;
}

function formatSlot(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Candidate view of an interview: pick one of the offered times, or decline. */
export function JobInterviewInvite({ interview, onUpdated }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRespond = canApplicantRespondToJobInterview(interview.status);
  const upcomingSlots = (interview.proposedSlots || []).filter(
    (slot) => new Date(slot).getTime() > Date.now(),
  );

  const respond = async (action: "accept" | "decline", slot?: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await respondToJobInterview(interview.id, action, slot);
      onUpdated(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your response");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-lantern-text">
          {canRespond
            ? "Interview invitation"
            : `Interview · ${JOB_INTERVIEW_STATUS_LABELS[interview.status]}`}
        </p>
        <span className="text-xs text-lantern-text-secondary">
          {JOB_INTERVIEW_MODE_LABELS[interview.mode]} ·{" "}
          {interview.durationMinutes} min
        </span>
      </div>

      {canRespond ? (
        upcomingSlots.length ? (
          <>
            <p className="mt-1 text-xs text-lantern-text-secondary">
              Choose a time that works for you.
            </p>
            <ul className="mt-2 space-y-1.5">
              {upcomingSlots.map((slot) => (
                <li key={slot}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void respond("accept", slot)}
                    className="w-full rounded-lg border border-lantern-border bg-lantern-surface px-3 py-2 text-left text-sm font-medium text-lantern-text transition hover:border-lantern-primary disabled:opacity-50"
                  >
                    {formatSlot(slot)}
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={busy}
              onClick={() => void respond("decline")}
              className="mt-2 text-xs font-medium text-lantern-text-tertiary underline hover:text-red-600 disabled:opacity-50"
            >
              None of these work for me
            </button>
          </>
        ) : (
          <p className="mt-1 text-xs text-lantern-text-secondary">
            The proposed times have passed. The employer needs to send new ones.
          </p>
        )
      ) : (
        <p className="mt-1 text-sm text-lantern-text">
          {describeJobInterviewSchedule(interview)}
        </p>
      )}

      {interview.locationText && interview.status === "confirmed" ? (
        <p className="mt-2 break-words text-xs text-lantern-text-secondary">
          {JOB_INTERVIEW_LOCATION_LABELS[interview.mode]}:{" "}
          {interview.locationText}
        </p>
      ) : null}
      {interview.details ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-lantern-text-secondary">
          {interview.details}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default JobInterviewInvite;
