import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppMode } from '../../types';
import { FLASHCARD_GRADE_LABELS, type FlashcardGradeId } from '@lantern/shared';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useFlashcardHandlers } from '../../hooks/useFlashcardHandlers';
import { navigateForAppMode } from '../../utils/appNavigation';
import { FLASHCARD_GRADE_CHIP } from '../flashcards/FlashcardFace';
import { AppIcon } from '../ui/AppIcon';
import { FeatureDisc } from '../ui/FeatureDisc';
import {
  INITIAL_INLINE_REVIEW_STATE,
  inlineReviewCurrent,
  inlineReviewReduce,
  selectInlineDueCards,
  type InlineDueCard,
} from './inlineReview';

const GRADES: readonly FlashcardGradeId[] = ['again', 'hard', 'good', 'easy'];

/**
 * The inline review card — Home's first "Recent activities" row when the
 * student has something due.
 *
 * It asks a REAL card the student already owns and is already scheduled to
 * see: the front, a `Show answer`, then the back with the same four grades,
 * same labels and same colours as the review session. Grading goes through
 * `handleUpdateSrsData`, the exact action `FlashcardReviewScreen` is handed as
 * `onUpdateSrs`, so the FSRS state, the offline queue and the quest/streak
 * tracking all update as if the card had been graded inside a session. There
 * is no second scheduler here and no AI: nothing is generated, nothing costs
 * credits, and when nothing is due the card does not render at all.
 *
 * `Skip` advances without grading — a skipped card stays due and comes back.
 */
export const InlineReviewCard: React.FC = () => {
  const flashcards = useFlashcardStore((s) => s.flashcards);
  const decks = useFlashcardStore((s) => s.decks);
  const { handleUpdateSrsData, handleStartReview } = useFlashcardHandlers();

  // The live due list: it shrinks as cards are graded, so it is the honest
  // source for "N due", but it cannot be the cursor — a graded card leaves it
  // immediately and every later index would shift under the student.
  const liveQueue = useMemo(() => selectInlineDueCards(flashcards, decks), [flashcards, decks]);

  const [queue, setQueue] = useState<InlineDueCard[]>(liveQueue);
  const [state, setState] = useState(INITIAL_INLINE_REVIEW_STATE);
  // Decks and cards load after Home's first paint, so the captured queue is
  // refreshed until the student touches the card — never after, or a grade
  // would reshuffle the deck under their hand.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setQueue((prev) => (sameCards(prev, liveQueue) ? prev : liveQueue));
  }, [liveQueue]);

  const current = inlineReviewCurrent(queue, state);
  const dueCount = liveQueue.length;

  const advance = useCallback(() => {
    touched.current = true;
    setState((prev) => inlineReviewReduce(prev, 'advance'));
  }, []);

  const grade = useCallback(
    (id: string, rating: FlashcardGradeId) => {
      void handleUpdateSrsData(id, rating);
      advance();
    },
    [advance, handleUpdateSrsData]
  );

  const studyAll = useCallback(() => {
    // The session is per-deck. When everything due lives in one deck, open
    // that deck's session directly; when it is spread across decks, the
    // flashcards screen is where the student picks which one to run.
    const deckIds = new Set(liveQueue.map((card) => card.deckId));
    const onlyDeckId = deckIds.size === 1 ? [...deckIds][0] : null;
    const deck = onlyDeckId ? decks.find((d) => d.id === onlyDeckId) : undefined;
    if (deck) {
      handleStartReview(deck);
      return;
    }
    navigateForAppMode(AppMode.FLASHCARDS);
  }, [decks, handleStartReview, liveQueue]);

  if (!current) return null;

  return (
    <div className="mb-3 rounded-2xl border border-lantern-border bg-lantern-surface p-4">
      <div className="flex items-center gap-3">
        <FeatureDisc
          feature="flashcards"
          size={32}
          icon={<AppIcon name="layers" size={16} />}
        />
        <div className="min-w-0 flex-1">
          <p className="text-caption text-lantern-text-secondary">Due now</p>
          <p className="text-body font-semibold text-lantern-text truncate">
            {current.deckName || 'Flashcards'}
          </p>
        </div>
        <span className="shrink-0 text-caption text-lantern-text-tertiary tabular-nums">
          {dueCount} due
        </span>
      </div>

      <div
        key={current.id}
        className="animate-in fade-in slide-in-from-bottom-2 duration-200 mt-3"
      >
        <p className="text-body text-lantern-text whitespace-pre-wrap">{current.front}</p>

        {state.phase === 'back' ? (
          <>
            <p className="mt-2 border-t border-lantern-border pt-2 text-body text-lantern-text whitespace-pre-wrap">
              {current.back}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {GRADES.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => grade(current.id, id)}
                  className={`rounded-xl py-2 text-body font-semibold transition-colors ${FLASHCARD_GRADE_CHIP[id]}`}
                >
                  {FLASHCARD_GRADE_LABELS[id].label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setState((prev) => inlineReviewReduce(prev, 'reveal'))}
              className="rounded-xl border border-lantern-border bg-lantern-background-secondary px-4 py-2 text-body font-semibold text-lantern-text transition-colors hover:bg-lantern-background-secondary/70"
            >
              Show answer
            </button>
            <button
              type="button"
              onClick={advance}
              className="rounded-xl px-3 py-2 text-body text-lantern-text-secondary transition-colors hover:text-lantern-text"
            >
              Skip
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={studyAll}
        className="mt-3 text-caption font-semibold text-lantern-ink hover:underline"
      >
        Study all {dueCount} due
      </button>
    </div>
  );
};

function sameCards(a: InlineDueCard[], b: InlineDueCard[]): boolean {
  return a.length === b.length && a.every((card, i) => card.id === b[i].id);
}

export default InlineReviewCard;
