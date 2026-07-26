import React, { useState } from "react";
import {
  JOB_APPLICATION_STATUS_LABELS,
  JOB_EMPLOYER_BULK_STATUSES,
  type JobApplicationStatus,
} from "@lantern/shared";

interface Props {
  selectedCount: number;
  totalCount: number;
  busy?: boolean;
  onClear: () => void;
  onSelectAll: () => void;
  onBulkStatus: (status: JobApplicationStatus) => void | Promise<void>;
  onExportSelected: () => void | Promise<void>;
  onExportAll: () => void | Promise<void>;
}

/**
 * Sticky action strip for the employer pipeline. Appears once at least one
 * candidate is selected; export-all stays available even with an empty selection.
 */
export function JobBulkActionsBar({
  selectedCount,
  totalCount,
  busy,
  onClear,
  onSelectAll,
  onBulkStatus,
  onExportSelected,
  onExportAll,
}: Props) {
  const [status, setStatus] = useState<JobApplicationStatus>("reviewing");

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-lantern-xl border border-lantern-border bg-lantern-surface p-3 shadow-sm">
      <p className="mr-auto text-sm text-lantern-text">
        {selectedCount > 0 ? (
          <>
            <strong>{selectedCount}</strong> selected
          </>
        ) : (
          <>
            <strong>{totalCount}</strong> applicants
          </>
        )}
      </p>

      <button
        type="button"
        disabled={busy || totalCount === 0}
        onClick={onSelectAll}
        className="text-xs font-semibold text-lantern-primary underline disabled:opacity-50"
      >
        Select all
      </button>
      {selectedCount > 0 ? (
        <button
          type="button"
          disabled={busy}
          onClick={onClear}
          className="text-xs font-semibold text-lantern-text-secondary underline disabled:opacity-50"
        >
          Clear
        </button>
      ) : null}

      <label className="flex items-center gap-1.5 text-xs text-lantern-text-secondary">
        Move to
        <select
          value={status}
          disabled={busy || selectedCount === 0}
          onChange={(event) =>
            setStatus(event.target.value as JobApplicationStatus)
          }
          className="rounded-lg border border-lantern-border bg-lantern-background px-2 py-1.5 text-sm text-lantern-text disabled:opacity-50"
        >
          {JOB_EMPLOYER_BULK_STATUSES.map((value) => (
            <option key={value} value={value}>
              {JOB_APPLICATION_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={busy || selectedCount === 0}
        onClick={() => void onBulkStatus(status)}
        className="rounded-lg bg-lantern-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Updating…" : "Apply"}
      </button>

      <button
        type="button"
        disabled={busy || selectedCount === 0}
        onClick={() => void onExportSelected()}
        className="rounded-lg border border-lantern-border px-3 py-1.5 text-sm font-medium text-lantern-text disabled:opacity-50"
      >
        Export selected
      </button>
      <button
        type="button"
        disabled={busy || totalCount === 0}
        onClick={() => void onExportAll()}
        className="rounded-lg border border-lantern-border px-3 py-1.5 text-sm font-medium text-lantern-text disabled:opacity-50"
      >
        Export CSV
      </button>
    </div>
  );
}

export default JobBulkActionsBar;
