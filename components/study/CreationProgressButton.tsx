/**
 * "Creation progress" — the header control that says what is still being made,
 * from any page.
 *
 * WHAT IT REPLACES (measured 2026-09-17,
 * docs/studyfetch-mysets-2026-09-17/04-create-set-walkthrough.md §6). Lantern
 * listed in-flight work in one place only: the "Recent uploads" section at the
 * bottom of a set's Upload Materials page. So a student who started an import
 * and then went anywhere else — the notes editor, another set, the dashboard —
 * had no way to ask whether it was still going, which is the question the whole
 * background-jobs design exists to answer.
 *
 * LABELLED, unlike the reference. Its header icons carry no tooltip and no
 * text, so the popover is behind an unmarked page glyph. Lantern's controls say
 * what they are; the label collapses to the badge on a narrow bar but the
 * accessible name never does.
 *
 * Touches: `stores/aiJobStore` and `stores/noteUploadStore` (read only, through
 * `creationProgress.toCreationEntries`), `stores/authStore` for the owner id,
 * `utils/navigation` to open a finished item. Rendered by `SetRoomTopBar`.
 *
 * Gotcha: both stores hand back a NEW array on every call, so the rows are
 * memoised on `jobs` — passing a selector that allocates into
 * `useAiJobStore(...)` re-renders forever.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CREATION_TABS,
  CREATIONS_EMPTY,
  countCreations,
  creationsSummary,
  filterCreations,
  type CreationTab,
} from '@lantern/shared/utils/importStages';
import { useAiJobStore } from '../../stores/aiJobStore';
import { useNoteUploadStore } from '../../stores/noteUploadStore';
import { useAuthStore } from '../../stores/authStore';
import { AppIcon } from '../ui/AppIcon';
import { toCreationEntries } from './creationProgress';

const STATUS_TONE: Record<string, string> = {
  processing: 'text-lantern-text-secondary',
  done: 'text-lantern-success',
  failed: 'text-lantern-error',
};

export interface CreationProgressButtonProps {
  /** Open a finished item. Given its in-app route. */
  onOpen?: (route: string) => void;
}

export const CreationProgressButton: React.FC<CreationProgressButtonProps> = ({ onOpen }) => {
  const aiJobs = useAiJobStore((s) => s.jobs);
  const uploadJobs = useNoteUploadStore((s) => s.jobs);
  const userId = useAuthStore((s) => s.currentUser?.id);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<CreationTab>('all');
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const rows = useMemo(
    () => toCreationEntries(aiJobs, uploadJobs, userId),
    [aiJobs, uploadJobs, userId]
  );
  const processing = countCreations(rows, 'processing');
  const shown = useMemo(() => filterCreations(rows, tab), [rows, tab]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        data-testid="creation-progress-button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="dialog"
        aria-expanded={open}
        // The count is IN the accessible name: a badge that only exists as a
        // coloured dot tells a screen reader nothing.
        aria-label={
          processing > 0
            ? `Creation progress — ${processing} still processing`
            : 'Creation progress'
        }
        className="relative inline-flex h-8 items-center gap-1.5 rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
      >
        <AppIcon name="sync" size={16} aria-hidden />
        <span className="hidden sm:inline">Creation progress</span>
        {processing > 0 ? (
          <span
            aria-hidden="true"
            className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-lantern-text px-1 text-caption font-semibold text-lantern-surface"
          >
            {processing}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Creation progress"
          data-testid="creation-progress-popover"
          className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-lantern-border bg-lantern-surface p-3 shadow-lantern-lg"
        >
          <p className="font-display text-heading text-lantern-text">Creation progress</p>
          <p className="text-caption text-lantern-text-secondary">{creationsSummary(rows)}</p>

          <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="Filter creations">
            {CREATION_TABS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`min-h-[36px] rounded-full border px-2.5 text-caption capitalize ${
                  tab === id
                    ? 'border-transparent bg-lantern-text text-lantern-surface'
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {id}
              </button>
            ))}
          </div>

          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
            {shown.length === 0 ? (
              <p className="px-1 py-3 text-body text-lantern-text-secondary">{CREATIONS_EMPTY}</p>
            ) : (
              shown.map((row) => {
                const body = (
                  <>
                    <span className="block truncate text-body font-medium text-lantern-text">
                      {row.title}
                    </span>
                    <span className={`block truncate text-caption ${STATUS_TONE[row.status]}`}>
                      {row.detail || row.status}
                    </span>
                  </>
                );
                return row.route && onOpen ? (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpen(row.route!);
                    }}
                    className="block w-full min-h-[44px] rounded-xl px-2 py-1.5 text-left hover:bg-lantern-background-secondary"
                  >
                    {body}
                  </button>
                ) : (
                  <div key={row.id} className="min-h-[44px] rounded-xl px-2 py-1.5">
                    {body}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default CreationProgressButton;
