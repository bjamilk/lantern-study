import React, { useState } from "react";
import {
  JOB_REPORT_DETAILS_MAX_LENGTH,
  JOB_REPORT_REASON_LABELS,
  JOB_REPORT_REASONS,
  type JobReportReason,
} from "@lantern/shared";
import { reportJobPosting } from "../../services/jobsBoard";

interface Props {
  jobId: string;
  onReported?: () => void;
}

/** Reason + optional details for flagging a suspicious job. */
export function JobReportForm({ jobId, onReported }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<JobReportReason>("scam");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await reportJobPosting(jobId, {
        reason,
        details: details.trim() || undefined,
      });
      setDone(true);
      setOpen(false);
      onReported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit report");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="text-xs text-emerald-700">
        Report submitted. Thanks for helping keep Jobs safer.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-lantern-text-tertiary underline"
        onClick={() => setOpen(true)}
      >
        Report this job
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-lantern-border bg-lantern-background p-3 space-y-2">
      <p className="text-sm font-semibold text-lantern-text">Report this job</p>
      <label className="block text-xs text-lantern-text-secondary">
        Reason
        <select
          className="mt-1 w-full rounded-lg border border-lantern-border px-2 py-1.5 text-sm bg-lantern-surface"
          value={reason}
          onChange={(e) => setReason(e.target.value as JobReportReason)}
        >
          {JOB_REPORT_REASONS.map((r) => (
            <option key={r} value={r}>
              {JOB_REPORT_REASON_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-lantern-text-secondary">
        Details (optional)
        <textarea
          className="mt-1 w-full rounded-lg border border-lantern-border px-2 py-1.5 text-sm bg-lantern-surface min-h-[64px]"
          maxLength={JOB_REPORT_DETAILS_MAX_LENGTH}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="What looked off?"
        />
      </label>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-lantern-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
        >
          {busy ? "Sending…" : "Submit report"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen(false)}
          className="rounded-lg border border-lantern-border px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
