/**
 * The inline review card — Home's first "Recent activities" row when the
 * student has something due. The phone's copy of web's
 * `components/dashboard/InlineReviewCard.tsx`.
 *
 * It asks a REAL card the student already owns and is already scheduled to
 * see: the front, a `Show answer`, then the back with the same four grades,
 * same labels and same colours as the review session.
 *
 * GRADING IS NOT A SECOND PATH. It calls `useFlashcardStore.reviewFlashcard`,
 * the exact action `FlashcardReviewScreen` calls at line 431, with the same
 * arguments and the same `trackStudyActivity` follow-up — so the FSRS
 * scheduling, the offline queue, the CAS/version handling and the quest and
 * streak counters all move as if the card had been graded inside a session.
 * There is no scheduler here and no AI: nothing is generated, nothing costs
 * credits, and when nothing is due the card does not render at all.
 *
 * `Skip` advances without grading — a skipped card stays due and comes back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FLASHCARD_GRADE_LABELS } from '@lantern/shared/flashcards/labels';
import type { FlashcardGradeId } from '@lantern/shared/flashcards/labels';
import { useAuthStore, useFlashcardStore } from '../../stores';
import { trackStudyActivity } from '../../services/gamification';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTheme } from '../../theme';
import { flashcardGradeSkin } from '../../design/flashcardGradeSkin';
import { Button, T } from '../ui';
import { FeatureDisc, useFeatureAccent } from '../ui/FeatureDisc';
import {
  INITIAL_INLINE_REVIEW_STATE,
  inlineDueLabelCount,
  inlineReviewCurrent,
  inlineReviewReduce,
  inlineStudyAllTarget,
  selectInlineDueCards,
  type InlineDueCard,
} from './inlineReview';

const GRADES: readonly FlashcardGradeId[] = ['again', 'hard', 'good', 'easy'];

export interface InlineReviewCardProps {
  /**
   * Home's own due tally — `dueReviewPlan().totalDue`, the number the greeting
   * button says and the number the session actually deals. The inline queue is
   * NOT that number: it drops cloze and occlusion cards and cards with an empty
   * face, because it can only render a plain two-sided prompt. Live, those two
   * disagreed on the same screen ("Study all 62 due" under a hero saying 67),
   * so the link reads the plan total and only the card's own prompt comes from
   * the inline queue.
   */
  dueTotal?: number | null;
  /**
   * Start the SAME cross-deck session Home's greeting button starts — on the
   * phone that is `handlePrimaryAction`, which opens the first leg and hands
   * the route the rest of `reviewPlan.legs`. The link is not rendered without
   * it: a component with no navigator has no honest second destination, and a
   * "Study all 67 due" that went nowhere is worse than no link.
   */
  onStudyAllDue?: () => void;
}

export function InlineReviewCard({ dueTotal, onStudyAllDue }: InlineReviewCardProps) {
  const { colors } = useTheme();
  const flashcardsAccent = useFeatureAccent('flashcards');
  const decks = useFlashcardStore((s) => s.decks);
  const flashcardsByDeck = useFlashcardStore((s) => s.flashcards);
  const reviewFlashcard = useFlashcardStore((s) => s.reviewFlashcard);
  const userId = useAuthStore((s) => s.user?.id);

  // The live due list: it shrinks as cards are graded, so it is the honest
  // source for "N due", but it cannot be the cursor — a graded card leaves it
  // immediately and every later index would shift under the student.
  const liveQueue = useMemo(() => {
    const all = Object.values(flashcardsByDeck).flat();
    return selectInlineDueCards(all, decks);
  }, [flashcardsByDeck, decks]);

  const [queue, setQueue] = useState<InlineDueCard[]>(liveQueue);
  const [state, setState] = useState(INITIAL_INLINE_REVIEW_STATE);
  // Decks and cards load after Home's first paint, so the captured queue is
  // refreshed until the student touches the card — never after, or a grade
  // would reshuffle the deck under their hand.
  const touched = useRef(false);
  /** Cards already sent to the store, so one card is never graded twice. */
  const gradedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (touched.current) return;
    setQueue((prev) => (sameCards(prev, liveQueue) ? prev : liveQueue));
  }, [liveQueue]);

  const current = inlineReviewCurrent(queue, state);
  // The label is Home's plan total when Home handed one over, so the link and
  // the hero cannot say different numbers about the same pile.
  const dueCount = inlineDueLabelCount(dueTotal, liveQueue.length);

  const advance = useCallback(() => {
    touched.current = true;
    setState((prev) => inlineReviewReduce(prev, 'advance'));
  }, []);

  const grade = useCallback(
    (card: InlineDueCard, rating: FlashcardGradeId) => {
      // No user, no grade: the store's write is per-user and a signed-out
      // grade would drop the review rather than queue it.
      if (!userId) return;
      // Per-CARD, not a global "grading" flag. A double tap must not send the
      // same review twice; a fast tap on the NEXT card must not be swallowed
      // while the previous request is still in flight, which is what a shared
      // in-flight flag did.
      if (gradedRef.current.has(card.id)) return;
      gradedRef.current.add(card.id);

      // Same confirmation the session gives, gated by the same setting.
      if (useSettingsStore.getState().settings.accessibility.hapticFeedback) {
        void Haptics.notificationAsync(
          rating === 'again' || rating === 'hard'
            ? Haptics.NotificationFeedbackType.Warning
            : Haptics.NotificationFeedbackType.Success
        );
      }

      void reviewFlashcard(card.id, card.deckId, rating, userId)
        .then(() => {
          // The session's own follow-up, so a grade given here feeds the
          // streak and the daily quests exactly as one given in a session.
          // Only `flashcard` — never `flashcard_new`: the inline queue is
          // due cards, and a due card has been reviewed before by definition
          // (`isNewFlashcard` is false for everything selectInlineDueCards
          // returns), so a new-card quest cannot be earned here.
          trackStudyActivity('flashcard', 1);
        })
        .catch((err) => {
          console.error('Failed to save inline review:', err);
        });
      advance();
    },
    [advance, reviewFlashcard, userId]
  );

  /**
   * The four grade chips, painted with the ONE shared skin
   * (`src/design/flashcardGradeSkin.ts`), the same helper the review session
   * uses, so a grade looks the same wherever it is given. The skin carries the
   * "Again" pairing this card introduced — red fill, page ink, because
   * `colors.error` on `colors.errorBackground` measures 4.23:1 light / 4.45:1
   * dark and fails AA — and `flashcardGradeSkinContrast.test.ts` gates it.
   */
  const gradeChipSkin = (rating: FlashcardGradeId) =>
    flashcardGradeSkin(rating, colors, flashcardsAccent);

  if (!current) return null;

  const showStudyAll = inlineStudyAllTarget(liveQueue, Boolean(onStudyAllDue)).kind === 'home';

  return (
    <View
      className="mb-2 rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4"
      testID="home-inline-review"
    >
      <View className="flex-row items-center gap-3">
        <FeatureDisc feature="flashcards" icon="layers" size={40} />
        <View className="flex-1 min-w-0">
          <T.Caption tone="secondary" numberOfLines={1}>
            Due now
          </T.Caption>
          <T.Body style={{ fontWeight: '600' }} numberOfLines={1}>
            {current.deckName || 'Flashcards'}
          </T.Body>
        </View>
        <T.Caption tone="tertiary" tabular numberOfLines={1}>
          {dueCount} due
        </T.Caption>
      </View>

      <T.Body className="mt-3">{current.front}</T.Body>

      {state.phase === 'back' ? (
        <>
          <T.Body
            className="mt-2 pt-2 border-t border-lantern-border"
            testID="home-inline-review-back"
          >
            {current.back}
          </T.Body>
          <View className="mt-3 flex-row gap-2">
            {GRADES.map((rating) => {
              const skin = gradeChipSkin(rating);
              return (
                <Pressable
                  key={rating}
                  onPress={() => grade(current, rating)}
                  accessibilityRole="button"
                  accessibilityLabel={`${FLASHCARD_GRADE_LABELS[rating].label}, ${FLASHCARD_GRADE_LABELS[rating].meaning}`}
                  testID={`home-inline-review-${rating}`}
                  className="flex-1 items-center justify-center active:opacity-80"
                  style={{
                    minHeight: 44,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: skin.backgroundColor,
                    paddingVertical: 8,
                    paddingHorizontal: 4,
                  }}
                >
                  <T.Body
                    importantForAccessibility="no"
                    numberOfLines={1}
                    style={{ color: skin.color, fontWeight: '600' }}
                  >
                    {FLASHCARD_GRADE_LABELS[rating].label}
                  </T.Body>
                </Pressable>
              );
            })}
          </View>
          {/* Skip lives on BOTH faces. It used to disappear the moment the
              card turned over, so a student who revealed an answer they could
              not grade honestly had no way past the card except grading it —
              which writes a review they did not mean. Skipping from the back
              advances ungraded exactly as it does from the front: the card
              stays due and comes back. */}
          <View className="mt-2 flex-row">
            <Button variant="ghost" onPress={advance} testID="home-inline-review-skip">
              Skip
            </Button>
          </View>
        </>
      ) : (
        <View className="mt-3 flex-row items-center gap-2">
          <Button
            variant="secondary"
            onPress={() => setState((prev) => inlineReviewReduce(prev, 'reveal'))}
            testID="home-inline-review-show-answer"
          >
            Show answer
          </Button>
          <Button variant="ghost" onPress={advance} testID="home-inline-review-skip">
            Skip
          </Button>
        </View>
      )}

      {showStudyAll ? (
        <Pressable
          onPress={onStudyAllDue}
          accessibilityRole="button"
          testID="home-inline-review-study-all"
          className="mt-3 self-start active:opacity-80"
        >
          <T.Caption style={{ fontWeight: '600' }}>Study all {dueCount} due</T.Caption>
        </Pressable>
      ) : null}
    </View>
  );
}

function sameCards(a: InlineDueCard[], b: InlineDueCard[]): boolean {
  return a.length === b.length && a.every((card, i) => card.id === b[i].id);
}

export default InlineReviewCard;
