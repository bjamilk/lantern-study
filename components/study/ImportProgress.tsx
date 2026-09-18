/**
 * What an import is doing, and where to go when it is done.
 *
 * Two presentational pieces, both driven entirely by props: `ImportStages`
 * (the three cards the import modal shows instead of a bare spinner) and
 * `WhereNextFork` (the completion choice). Neither reads a store, starts work
 * or knows what a note is — the modal owns the run and hands the state down,
 * which is what lets the whole model be unit-tested in
 * `@lantern/shared/utils/importStages` without React.
 *
 * WHAT IT REPLACES (measured 2026-09-17,
 * docs/studyfetch-mysets-2026-09-17/04-create-set-walkthrough.md §3). The
 * modal drew one spinner and the words "Creating your study materials…" for
 * however long the whole pipeline took — upload, extraction and two AI runs —
 * so a student could not tell a slow PDF from a stuck one, and a failure
 * arrived as a line of red text with no clue which step had produced it.
 *
 * NOT COPIED FROM THE REFERENCE, deliberately:
 *  - the animated "Processing Progress" bar and the "~10m remaining" ETA. Both
 *    are invented; the reference's own walk-through caught the ETA falling
 *    from ten minutes to sixteen seconds. A card here shows a bar only where
 *    the pipeline reports a real number, and `importWaitHint` gives a range
 *    instead of a countdown.
 *  - the running dog. Lantern's mark is the lantern.
 *
 * Touches: `@lantern/shared/utils/importStages` (every string and every rule),
 * `ui/AppIcon`, `ui/LanternBrandIcon`. Consumed by `ImportAndStudyModal`.
 */
import React from 'react';
import {
  IMPORT_RUN_SUBHEADING,
  WHERE_NEXT_FOOTER,
  WHERE_NEXT_TITLE,
  deriveImportStages,
  importRunHeading,
  importWaitHint,
  whereNextCards,
  type ImportRunState,
  type ImportStageCard,
  type WhereNextCardId,
} from '@lantern/shared/utils/importStages';
import { AppIcon } from '../ui/AppIcon';
import { LanternBrandIcon } from '../ui/LanternBrandIcon';

/** The tick / spinner / warning at the head of one card. */
const StageMark: React.FC<{ status: ImportStageCard['status'] }> = ({ status }) => {
  if (status === 'done') {
    return (
      <AppIcon
        name="checkmark-circle"
        size={20}
        aria-hidden="true"
        className="shrink-0 text-lantern-success"
      />
    );
  }
  if (status === 'failed') {
    return (
      <AppIcon
        name="alert-circle"
        size={20}
        aria-hidden="true"
        className="shrink-0 text-lantern-error"
      />
    );
  }
  if (status === 'active') {
    return (
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-lantern-text border-t-transparent"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-5 w-5 shrink-0 rounded-full border-2 border-dashed border-lantern-border"
    />
  );
};

const STATUS_WORD: Record<ImportStageCard['status'], string> = {
  pending: 'Not started',
  active: 'In progress',
  done: 'Done',
  failed: 'Failed',
};

const StageRow: React.FC<{ card: ImportStageCard; onRetry?: () => void }> = ({
  card,
  onRetry,
}) => (
  <li
    data-testid={`import-stage-${card.id}`}
    data-status={card.status}
    className={`flex items-start gap-3 rounded-xl border px-3 py-3 ${
      card.status === 'done'
        ? 'border-transparent bg-lantern-success/10'
        : card.status === 'failed'
          ? 'border-lantern-error/40 bg-lantern-error/5'
          : card.status === 'active'
            ? 'border-lantern-text'
            : 'border-lantern-border'
    }`}
  >
    <StageMark status={card.status} />
    <div className="min-w-0 flex-1">
      <p className="text-body font-medium text-lantern-text">
        {card.label}
        {/* The status in words, not only in colour and a glyph — the row has to
            read the same to a screen reader and to anyone who cannot tell the
            green tick from the amber warning. */}
        <span className="sr-only">{` — ${STATUS_WORD[card.status]}`}</span>
      </p>
      {card.percent !== null && card.status === 'active' ? (
        <div className="mt-2">
          <div
            role="progressbar"
            aria-valuenow={card.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${card.label} progress`}
            className="h-1.5 w-full overflow-hidden rounded-full bg-lantern-background-secondary"
          >
            <div
              className="h-full rounded-full bg-lantern-text transition-[width]"
              style={{ width: `${card.percent}%` }}
            />
          </div>
          <p className="mt-1 text-caption text-lantern-text-secondary">{card.percent}%</p>
        </div>
      ) : null}
      {card.error ? (
        <div className="mt-1 space-y-2">
          {/* The real reason, on the card that produced it. A banner at the
              bottom of the dialog would make the student guess which step
              broke. */}
          <p className="text-caption text-lantern-error">{card.error}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-lantern-border px-3 text-caption font-medium text-lantern-text hover:bg-lantern-background-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
            >
              <AppIcon name="refresh" size={14} aria-hidden="true" />
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  </li>
);

export interface ImportStagesProps {
  state: ImportRunState;
  /** Offered on the failed card only. */
  onRetry?: () => void;
  /** "Continue in background" — the run keeps going without this dialog. */
  onBackground?: () => void;
}

export const ImportStages: React.FC<ImportStagesProps> = ({ state, onRetry, onBackground }) => {
  const cards = deriveImportStages(state);
  const failed = cards.some((card) => card.status === 'failed');

  return (
    <div className="space-y-4 py-2">
      <div className="text-center">
        <span aria-hidden="true" className="mx-auto mb-3 block w-[56px]">
          <LanternBrandIcon size={56} />
        </span>
        <h3 className="font-display text-title text-lantern-text">
          {importRunHeading(state.kind)}
        </h3>
        <p className="mt-1 text-body text-lantern-text-secondary">{IMPORT_RUN_SUBHEADING}</p>
      </div>

      {/* `aria-live` on the list, not on each card: a screen reader should hear
          "Processing material — Done" as it happens, once. */}
      <ul className="space-y-2" aria-live="polite" aria-busy={!failed}>
        {cards.map((card) => (
          <StageRow key={card.id} card={card} onRetry={card.error ? onRetry : undefined} />
        ))}
      </ul>

      {failed ? null : (
        <p className="text-center text-caption text-lantern-text-muted">
          {importWaitHint(state.kind)}
        </p>
      )}

      {onBackground && !failed ? (
        <div className="text-center">
          <button
            type="button"
            onClick={onBackground}
            className="min-h-[44px] rounded-lg border border-lantern-border px-3 py-1.5 text-caption font-medium text-lantern-text hover:bg-lantern-background-secondary"
          >
            Continue in background
          </button>
        </div>
      ) : null}
    </div>
  );
};

export interface WhereNextForkProps {
  /** Absent when the run produced no note to open (an Anki card import). */
  onViewMaterial?: () => void;
  /** Present only when this set really has a plan. */
  onViewPlan?: () => void;
  onOpenSetHome: () => void;
  /** What arrived, in the student's words. Drawn above the cards. */
  summary?: React.ReactNode;
}

export const WhereNextFork: React.FC<WhereNextForkProps> = ({
  onViewMaterial,
  onViewPlan,
  onOpenSetHome,
  summary,
}) => {
  const cards = whereNextCards({
    hasMaterial: Boolean(onViewMaterial),
    hasPlan: Boolean(onViewPlan),
  });

  const press = (id: WhereNextCardId) => {
    if (id === 'material') onViewMaterial?.();
    else if (id === 'plan') onViewPlan?.();
    else onOpenSetHome();
  };

  return (
    <div className="space-y-4 py-2">
      {summary}
      <h3 className="text-center font-display text-title text-lantern-text">
        {WHERE_NEXT_TITLE}
      </h3>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            data-testid={`where-next-${card.id}`}
            onClick={() => press(card.id)}
            className="flex min-h-[44px] flex-col items-start gap-1 rounded-2xl border border-lantern-border p-4 text-left hover:border-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-primary"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-body font-semibold text-lantern-text">{card.title}</span>
              {card.recommended ? (
                <span className="rounded-full bg-lantern-text px-2 py-0.5 text-caption font-medium text-lantern-surface">
                  Recommended
                </span>
              ) : null}
            </span>
            <span className="text-caption text-lantern-text-secondary">{card.detail}</span>
          </button>
        ))}
      </div>
      <p className="text-center text-caption text-lantern-text-muted">{WHERE_NEXT_FOOTER}</p>
    </div>
  );
};
