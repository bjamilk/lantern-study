import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createStudyPackDraft,
  fetchSemesterPackProposals,
} from '../services/supabase';
import { useToastStore } from '../stores/toastStore';
import {
  enqueueSemesterDraftsSequentially,
  maxSelectablePacks,
  STUDY_PACK_DRAFT_CREDITS,
  type SemesterPackProposal,
  type SemesterPackProposalResponse,
} from '@lantern/shared/marketplace';
import { AppIcon } from './ui/AppIcon';

interface Props {
  onBack: () => void;
  onNavigateToDrafts: () => void;
}

function formatNairaFromKobo(kobo: number): string {
  return `₦${Math.round(kobo / 100).toLocaleString()}`;
}

export const SemesterProductsScreen: React.FC<Props> = ({ onBack, onNavigateToDrafts }) => {
  const showToast = useToastStore((s) => s.showToast);
  const [data, setData] = useState<SemesterPackProposalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchSemesterPackProposals();
      setData(next);
      setError(null);
      const cap = Math.min(next.proposals.length, next.maxSelectable);
      setSelected(new Set(next.proposals.slice(0, cap).map((p) => p.courseId)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load semester proposals.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const proposals = data?.proposals ?? [];
  const remaining = data?.creditsRemaining ?? 0;
  const cap = data ? data.maxSelectable : maxSelectablePacks(remaining);
  const selectedList = useMemo(
    () => proposals.filter((p) => selected.has(p.courseId)),
    [proposals, selected],
  );
  const totalCredits = selectedList.length * STUDY_PACK_DRAFT_CREDITS;
  const overCap = selectedList.length > cap;

  const toggle = (courseId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  };

  const run = async () => {
    if (!selectedList.length || overCap || running) return;
    setRunning(true);
    try {
      const result = await enqueueSemesterDraftsSequentially(selectedList, (input) =>
        createStudyPackDraft(input),
      );
      if (result.failed > 0) {
        showToast(
          `Started ${result.ok} pack${result.ok === 1 ? '' : 's'}. Stopped: ${result.errors[0] || 'credit limit'}.`,
          'error',
        );
      } else {
        showToast(`Queued ${result.ok} study product${result.ok === 1 ? '' : 's'}.`);
      }
      onNavigateToDrafts();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-full bg-lantern-background">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 sm:py-7">
        <div className="flex items-center gap-3 mb-1">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg text-lantern-text-secondary hover:bg-lantern-background-secondary"
            aria-label="Back"
          >
            <AppIcon name="arrow-back" size={20} />
          </button>
          <h1 className="text-xl font-semibold text-lantern-text">Turn this semester into products</h1>
        </div>
        <p className="text-sm text-lantern-text-secondary ml-11 mb-4">
          Each selected course costs {STUDY_PACK_DRAFT_CREDITS} AI credits. Packs are generated one
          at a time so a daily limit cannot tear the batch.
        </p>

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 rounded-xl bg-lantern-background-secondary animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-lantern-error" role="alert">
            {error}{' '}
            <button type="button" className="underline font-semibold" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-lantern-text-secondary">
            No courses with notes this year. File notes under a course, then come back.
          </p>
        ) : (
          <>
            <p className="text-xs text-lantern-text-tertiary mb-3">
              {data?.creditsRemaining} of {data?.creditsLimit} credits left today · you can run at
              most {cap} pack{cap === 1 ? '' : 's'}.
            </p>
            <ul className="space-y-2">
              {proposals.map((p: SemesterPackProposal) => {
                const checked = selected.has(p.courseId);
                return (
                  <li key={p.courseId}>
                    <label className="flex items-start gap-3 rounded-xl border border-lantern-border bg-lantern-surface p-4 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(p.courseId)}
                        className="mt-1"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-lantern-text">
                          {p.suggestedTitle}
                        </span>
                        <span className="block text-xs text-lantern-text-tertiary mt-0.5">
                          {p.courseCode} · {p.noteCount} note{p.noteCount === 1 ? '' : 's'} ·{' '}
                          {p.creditCost} credits
                          {p.suggestedPriceKobo
                            ? ` · suggested ${formatNairaFromKobo(p.suggestedPriceKobo)}`
                            : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {overCap ? (
              <p className="mt-3 text-sm text-lantern-error" role="status">
                Selected cost {totalCredits} credits, but you have {remaining} left. Uncheck some
                courses.
              </p>
            ) : (
              <p className="mt-3 text-sm text-lantern-text-secondary">
                Total: {totalCredits} credits for {selectedList.length} pack
                {selectedList.length === 1 ? '' : 's'}.
              </p>
            )}
            <button
              type="button"
              disabled={!selectedList.length || overCap || running}
              onClick={() => void run()}
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-lantern-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              <AppIcon name="sparkles" size={16} />
              {running ? 'Starting…' : 'Generate selected packs'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default SemesterProductsScreen;
