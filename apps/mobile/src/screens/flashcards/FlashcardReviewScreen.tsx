/**
 * The `FlashcardReview` route (a fullScreenModal): the graded FSRS session.
 * Swipe or tap to reveal, grade Again/Hard/Good/Easy against a live interval
 * preview, undo the last grade, and — when Home opened a cross-deck plan —
 * continue into the next deck that still has due cards.
 *
 * Main exports: `FlashcardReviewScreen` (also the default).
 * Touches: flashcardStore (`fetchFlashcards`, `reviewFlashcard`, and a direct
 * `setState`+`saveToStorage` for undo), authStore, settingsStore (new-cards-per-day,
 * max interval, auto-advance delay, haptics), statsStore (today's counts),
 * featureTipStore, services/gamification and productAnalytics, and the presence
 * heartbeat. Native: expo-haptics. The queue, interval preview and advance guard
 * all come from @lantern/shared.
 *
 * Gotchas: the session queue is built ONCE per deck and frozen in
 * `queueSnapshotRef` (`=== null` check, so a deliberately empty queue stays
 * locked) — grading makes cards not-due, so rebuilding mid-session would drop
 * the rest of the queue, including lapsed cards re-queued for today.
 * `chainSnapshot` lives at module scope for the same reason: each leg of a
 * cross-deck chain is a fresh mount via `navigation.replace`, and re-counting
 * would shrink the total under the student. Grades are written through
 * immediately; undo restores the card LOCALLY only, so the server may already
 * hold the graded review.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FlashcardType, FLASHCARD_GRADE_LABELS } from '@lantern/shared';
import { continueDueReviewLabel, dueReviewProgress } from '@lantern/shared/learning';
import { isCardDue } from '@lantern/shared/utils/srs';
import type { PerformanceRating } from '@lantern/shared/utils';
import {
  FlashcardReviewAdvanceGuard,
  formatStudyInterval,
  previewFsrsIntervals,
  resolveAutoAdvanceDelayMs,
} from '@lantern/shared/utils';
import {
  buildFlashcardReviewQueue,
  getSrsMaxInterval,
  getTodayStudyCounts,
  isNewFlashcard,
} from '@lantern/shared/settings';
import { useAuthStore, useFlashcardStore, type Flashcard } from '../../stores';
import { Button } from '../../components/ui';
import { useFeatureAccent } from '../../components/ui/FeatureDisc';
import { flashcardGradeSkin } from '../../design/flashcardGradeSkin';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { SwipeableFlashcard } from '../../components/SwipeableFlashcard';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { trackStudyActivity } from '../../services/gamification';
import { trackFlashcardReviewStarted, trackFlashcardReviewCompleted, trackStudyModeCompleted, trackStudyModeSelected } from '../../services/productAnalytics';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import { getCardDisplayText } from '../../utils/flashcardHelpers';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStatsStore } from '../../stores/statsStore';
import { useTheme } from '../../theme';
import { setStudyIntent } from '../../hooks/usePresenceHeartbeat';

function withHaptic(action: () => Promise<void>) {
  if (useSettingsStore.getState().settings.accessibility.hapticFeedback) {
    void action();
  }
}

type NavigationProp = {
  goBack: () => void;
  /** Swap this deck's session for the next one, so Back still leaves review. */
  replace: (
    screen: 'FlashcardReview',
    params: { deckId: string; deckName?: string; queueDeckIds?: string[] }
  ) => void;
};

interface Props {
  navigation: NavigationProp;
  /**
   * `queueDeckIds` is the whole cross-deck due queue Home planned, in order.
   * Without it this screen is one deck and stops there, which is why a Home
   * button that said "Study all 68 due" used to deal 17; with it the session
   * continues deck by deck until the queue is spent.
   */
  route: { params?: { deckId?: string; deckName?: string; queueDeckIds?: string[] } };
}

const GRADE_BUTTONS: {
  rating: PerformanceRating;
  accessibilityLabel: string;
}[] = [
  {
    rating: 'again',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.again.label}, ${FLASHCARD_GRADE_LABELS.again.meaning}`,
  },
  {
    rating: 'hard',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.hard.label}, ${FLASHCARD_GRADE_LABELS.hard.meaning}`,
  },
  {
    rating: 'good',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.good.label}, ${FLASHCARD_GRADE_LABELS.good.meaning}`,
  },
  {
    rating: 'easy',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.easy.label}, ${FLASHCARD_GRADE_LABELS.easy.meaning}`,
  },
];

const EMPTY_CARDS: Flashcard[] = [];

/** One deck's share of the cross-deck plan, as it stood when the chain began. */
interface ChainLeg {
  deckId: string;
  deckName: string;
  dueCount: number;
}

/**
 * The chain's leg sizes, frozen for the life of the chain.
 *
 * The counter has to say "18 / 68" on the second deck, and 68 is only knowable
 * while the first deck's cards are still due. Grading them makes them not-due,
 * so a re-count at leg 2 would report 38 and the total would shrink under the
 * student — the opposite of the promise Home made. Each leg is a separate
 * mount (`navigation.replace`), so the snapshot lives at module scope rather
 * than in a ref: it is the one thing that must outlive the screen.
 *
 * It is re-seeded whenever a chain is entered at its first deck, which is the
 * only way Home starts one, so a new day's plan never reads yesterday's sizes.
 */
let chainSnapshot: { key: string; legs: ChainLeg[] } | null = null;

/**
 * Freeze (or reuse) the leg sizes for the queue this session belongs to.
 *
 * `sessionTotal` wins for the deck on screen, because that is the number of
 * cards this session will actually deal; the other legs are counted from the
 * store. Returns [] for a lone deck, which is the signal to keep the plain
 * "n / deckDue" counter.
 */
function resolveChainLegs(
  queueDeckIds: string[] | undefined,
  deckId: string,
  sessionTotal: number,
  decks: { id: string; name?: string | null }[],
  flashcards: Record<string, Flashcard[]>
): ChainLeg[] {
  const ids = queueDeckIds ?? [];
  if (ids.length <= 1 || sessionTotal <= 0) return [];
  const at = ids.indexOf(deckId);
  if (at < 0) return [];

  const key = ids.join('|');
  if (at > 0 && chainSnapshot?.key === key) return chainSnapshot.legs;

  const legs = ids.map((id, i) => ({
    deckId: id,
    deckName: (decks.find(d => d.id === id)?.name ?? '').trim() || 'Untitled deck',
    dueCount:
      i === at
        ? sessionTotal
        : (flashcards[id] ?? EMPTY_CARDS).filter(card => isCardDue(card.srsData)).length,
  }));
  chainSnapshot = { key, legs };
  return legs;
}

type GradeCounts = Record<PerformanceRating, number>;
const ZERO_GRADE_COUNTS: GradeCounts = { again: 0, hard: 0, good: 0, easy: 0 };

interface UndoSnapshot {
  cardId: string;
  deckId: string;
  /** Queue position the graded card occupied, to return to on undo. */
  index: number;
  /** Pre-grade card (with its pre-grade srsData) to restore into the store. */
  card: Flashcard;
  rating: PerformanceRating;
  wasNew: boolean;
}

/** mm:ss elapsed label for the end-of-session summary. */
function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function buildSessionQueue(cards: Flashcard[]): Flashcard[] {
  if (!cards.length) return [];
  const settings = useSettingsStore.getState().settings;
  const activityDays = useStatsStore.getState().stats?.activityDays ?? [];
  const today = getTodayStudyCounts(activityDays);
  return buildFlashcardReviewQueue(cards, {
    srsNewCardsPerDay: settings.study.srsNewCardsPerDay,
    newCardsIntroducedToday: today.newFlashcards,
  });
}

export function FlashcardReviewScreen({ navigation, route }: Props) {
  const { reduceMotion, colors } = useTheme();
  const flashcardsAccent = useFeatureAccent('flashcards');
  // `presentation: 'fullScreenModal'` gives this route its own native window,
  // which the app-root SafeAreaProvider never measures: the raw
  // `useSafeAreaInsets()` returned 0 on every edge here, so the Exit/Undo row
  // drew under the clock and Again/Hard/Good/Easy sat on the gesture bar.
  const footerPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 12 });
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Review';
  const deck = useFlashcardStore(s => s.decks.find(d => d.id === deckId));
  const allDecks = useFlashcardStore(s => s.decks);
  const allFlashcards = useFlashcardStore(s => s.flashcards);

  // Phase 3 M / 4 V — course + topic ride the existing heartbeat so Discover
  // presence can open a real study room, not only a review-intent count.
  useEffect(() => {
    setStudyIntent({
      context: 'reviewing',
      courseId: deck?.course_id || undefined,
      topic: deck?.name || deckName,
    });
    return () => setStudyIntent(null);
  }, [deck?.course_id, deck?.name, deckName]);
  const user = useAuthStore(s => s.user);
  const deckCards = useFlashcardStore(s => s.flashcards[deckId] ?? EMPTY_CARDS);
  const isLoading = useFlashcardStore(s => s.isLoading);
  const fetchFlashcards = useFlashcardStore(s => s.fetchFlashcards);
  const reviewFlashcard = useFlashcardStore(s => s.reviewFlashcard);
  const srsMaxInterval = useSettingsStore(s => s.settings.study.srsMaxInterval);

  const queueSnapshotRef = useRef<Flashcard[] | null>(null);
  const startTrackedRef = useRef(false);
  const completeTrackedRef = useRef(false);
  const advanceGuardRef = useRef(new FlashcardReviewAdvanceGuard());
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const userIdRef = useRef(user?.id);
  userIdRef.current = user?.id;
  const sessionStartRef = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [grading, setGrading] = useState(false);
  const [showSwipeHint, setShowSwipeHint] = useState(true);
  const [gradeCounts, setGradeCounts] = useState<GradeCounts>(ZERO_GRADE_COUNTS);
  const [newCount, setNewCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [undoSnapshot, setUndoSnapshot] = useState<UndoSnapshot | null>(null);

  const clearAutoAdvanceTimer = useCallback(() => {
    if (autoAdvanceTimerRef.current != null) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!deckId) return;
    if (deckCards.length === 0) {
      void fetchFlashcards(deckId);
    }
  }, [deckId, deckCards.length, fetchFlashcards]);

  // Reset session when switching decks
  useEffect(() => {
    queueSnapshotRef.current = null;
    startTrackedRef.current = false;
    completeTrackedRef.current = false;
    sessionStartRef.current = null;
    advanceGuardRef.current.reset();
    clearAutoAdvanceTimer();
    setIndex(0);
    setShowBack(false);
    setGrading(false);
    setShowSwipeHint(true);
    setGradeCounts(ZERO_GRADE_COUNTS);
    setNewCount(0);
    setElapsedMs(0);
    setUndoSnapshot(null);
  }, [deckId, clearAutoAdvanceTimer]);

  // Lock the queue once cards are available (=== null so an intentional empty queue stays locked)
  if (queueSnapshotRef.current === null && !isLoading && deckCards.length > 0) {
    queueSnapshotRef.current = buildSessionQueue(deckCards);
  }
  const queue = queueSnapshotRef.current ?? EMPTY_CARDS;
  const sessionTotal = queue.length;

  const currentCard = queue[index];
  const isComplete = sessionTotal > 0 && index >= sessionTotal;
  const progress = sessionTotal ? Math.min(index + 1, sessionTotal) : 0;
  const nextCard = queue[index + 1];
  const canUndo = undoSnapshot != null;

  /**
   * Where this card sits in the WHOLE plan Home opened, not just this deck.
   *
   * Null for an ordinary single-deck session, which keeps its "n / deckDue".
   */
  const chainLegs = resolveChainLegs(
    route.params?.queueDeckIds,
    deckId,
    sessionTotal,
    allDecks,
    allFlashcards
  );
  const chainProgress = dueReviewProgress(
    { legs: chainLegs },
    chainLegs.findIndex(leg => leg.deckId === deckId),
    index
  );

  /**
   * The next deck in the queue that still has due cards.
   *
   * Read at render from the store, not from what Home planned, so a deck the
   * student cleared elsewhere in the meantime is skipped rather than offered
   * as an empty session. Decks whose cards are not loaded look empty and are
   * skipped too — the offer is only ever made for cards we can prove are due.
   */
  const nextLeg = useMemo(() => {
    const queue = route.params?.queueDeckIds ?? [];
    const at = queue.indexOf(deckId);
    if (at < 0) return null;
    for (const id of queue.slice(at + 1)) {
      const dueCount = (allFlashcards[id] ?? EMPTY_CARDS).filter(card => isCardDue(card.srsData)).length;
      if (dueCount === 0) continue;
      const name = (allDecks.find(d => d.id === id)?.name ?? '').trim();
      return { deckId: id, deckName: name || 'Untitled deck', dueCount };
    }
    return null;
  }, [route.params?.queueDeckIds, deckId, allFlashcards, allDecks]);

  // Anki-style interval preview: what each grade would schedule for THIS card,
  // computed once per card. Uses the same maxInterval source the store schedules
  // with (getSrsMaxInterval on study settings), so the preview matches grading.
  const intervalPreview = useMemo<Record<PerformanceRating, string> | null>(() => {
    if (!currentCard) return null;
    const days = previewFsrsIntervals(currentCard.srsData, {
      maxInterval: getSrsMaxInterval({ srsMaxInterval }),
    });
    return {
      again: formatStudyInterval(days.again),
      hard: formatStudyInterval(days.hard),
      good: formatStudyInterval(days.good),
      easy: formatStudyInterval(days.easy),
    };
  }, [currentCard, srsMaxInterval]);

  useEffect(() => {
    const { setTipReady } = useFeatureTipStore.getState();
    const ready = sessionTotal > 0 && !isComplete;
    setTipReady('flashcards.grading', ready);
    return () => setTipReady('flashcards.grading', false);
  }, [sessionTotal, isComplete]);

  useEffect(() => {
    if (sessionTotal > 0 && !startTrackedRef.current) {
      startTrackedRef.current = true;
      sessionStartRef.current = Date.now();
      trackStudyModeSelected('smart_review');
      trackFlashcardReviewStarted(sessionTotal, deckId);
    }
  }, [sessionTotal, deckId]);

  useEffect(() => {
    if (isComplete && !completeTrackedRef.current) {
      completeTrackedRef.current = true;
      if (sessionStartRef.current != null) {
        setElapsedMs(Date.now() - sessionStartRef.current);
      }
      trackFlashcardReviewCompleted(sessionTotal);
      trackStudyModeCompleted('smart_review');
    }
  }, [isComplete, sessionTotal]);

  useConfirmBeforeExit(sessionTotal > 0 && !isComplete, {
    title: 'Exit Review?',
    message: 'Cards you have already graded are saved. Exit this session anyway?',
    confirmLabel: 'Exit',
    destructive: true,
  });

  useEffect(() => {
    advanceGuardRef.current.setActiveCard(currentCard?.id ?? null);
    clearAutoAdvanceTimer();
    setShowBack(false);
    setGrading(false);
  }, [index, currentCard?.id, clearAutoAdvanceTimer]);

  useEffect(() => () => clearAutoAdvanceTimer(), [clearAutoAdvanceTimer]);

  const handleToggleBack = useCallback(() => {
    withHaptic(() => Haptics.selectionAsync());
    setShowBack(prev => !prev);
  }, []);

  const handleRate = useCallback(
    (rating: PerformanceRating, expectedCardId?: string) => {
      if (!currentCard) return;
      if (expectedCardId && expectedCardId !== currentCard.id) return;

      // Prefer the latest auth id so a stale render without user cannot freeze grading.
      const userId = userIdRef.current ?? user?.id;
      if (!userId) return;

      const claim = advanceGuardRef.current.tryClaimAdvance(currentCard.id);
      if (!claim.ok || claim.generation == null) return;

      setGrading(true);
      if (rating === 'again' || rating === 'hard') {
        withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
      } else {
        withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      }

      const wasNew = isNewFlashcard(currentCard);
      const cardId = currentCard.id;

      // Single-level undo snapshot: capture the pre-grade card (srsData intact —
      // the store schedules into a fresh object, so this queue reference stays
      // pre-grade) plus this position, before the store mutates. Count the grade
      // for the end-of-session summary here so undo can reverse it exactly.
      setUndoSnapshot({
        cardId,
        deckId,
        index,
        card: {
          ...currentCard,
          srsData: currentCard.srsData ? { ...currentCard.srsData } : currentCard.srsData,
        },
        rating,
        wasNew,
      });
      setGradeCounts(prev => ({ ...prev, [rating]: prev[rating] + 1 }));
      if (wasNew) setNewCount(prev => prev + 1);

      const delayMs = resolveAutoAdvanceDelayMs(
        useSettingsStore.getState().settings.study.autoAdvanceDelay
      );

      const advance = () => {
        if (!advanceGuardRef.current.isAdvanceGenerationCurrent(claim.generation!)) return;
        setIndex(prev => prev + 1);
        setShowBack(false);
      };

      clearAutoAdvanceTimer();
      if (delayMs <= 0) {
        advance();
      } else {
        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          advance();
        }, delayMs);
      }

      void reviewFlashcard(cardId, deckId, rating, userId)
        .then(() => {
          setShowSwipeHint(false);
          trackStudyActivity('flashcard', 1);
          if (wasNew) {
            trackStudyActivity('flashcard_new', 1);
          }
        })
        .catch((err) => {
          console.error('Failed to save review:', err);
        });
    },
    [currentCard, user?.id, reviewFlashcard, deckId, index, clearAutoAdvanceTimer]
  );

  const handleUndo = useCallback(() => {
    const snap = undoSnapshot;
    if (!snap) return;

    clearAutoAdvanceTimer();
    // Void any pending auto-advance and re-open the card for grading: reset()
    // clears the guard's rated-id set and bumps its generation, then re-arm the
    // restored card as active so a re-grade can claim it.
    advanceGuardRef.current.reset();
    advanceGuardRef.current.setActiveCard(snap.cardId);

    // Restore the pre-grade card locally so the user can re-grade. This is a
    // LOCAL restore only — the server may already hold the graded review (see
    // report). saveToStorage persists the revert so a remount can't resurrect it.
    useFlashcardStore.setState(current => {
      const cards = current.flashcards[snap.deckId];
      if (!cards) return current;
      return {
        flashcards: {
          ...current.flashcards,
          [snap.deckId]: cards.map(c => (c.id === snap.cardId ? snap.card : c)),
        },
      };
    });
    void useFlashcardStore.getState().saveToStorage();

    // Reverse the summary counters so undo never double-counts.
    setGradeCounts(prev => ({ ...prev, [snap.rating]: Math.max(0, prev[snap.rating] - 1) }));
    if (snap.wasNew) setNewCount(prev => Math.max(0, prev - 1));

    withHaptic(() => Haptics.selectionAsync());
    setUndoSnapshot(null);
    setShowBack(false);
    setGrading(false);
    setIndex(snap.index);
  }, [undoSnapshot, clearAutoAdvanceTimer]);

  const shellStyle = { flex: 1, backgroundColor: colors.background };

  if (!deckId) {
    return (
      <Screen edges={['top']} bottom="safe" className="flex-1" style={shellStyle}>
        <View className="flex-1 items-center justify-center px-6">
        <Text className="text-lg font-semibold text-lantern-text mb-2" style={{ color: colors.text }}>
          Deck not found
        </Text>
        <Button onPress={() => navigation.goBack()}>Go back</Button>
        </View>
      </Screen>
    );
  }

  if (sessionTotal === 0) {
    const stillLoading = isLoading || (deckCards.length === 0 && queueSnapshotRef.current === null);
    const hasNewLeft = deckCards.some((c) => isNewFlashcard(c));
    return (
      <Screen edges={['top']} bottom="safe" className="flex-1" style={shellStyle}>
        <View className="flex-1 items-center justify-center px-6">
        <Text className="text-lg font-semibold text-lantern-text mb-2" style={{ color: colors.text }}>
          {stillLoading ? 'Loading cards…' : 'Nothing to review'}
        </Text>
        <Text
          className="text-sm text-lantern-text-secondary text-center mb-6"
          style={{ color: colors.textSecondary }}
        >
          {stillLoading
            ? 'Preparing your review session.'
            : hasNewLeft
              ? "You've reached today's new-card limit. Try Cram or Match, or come back tomorrow for more new cards."
              : 'No cards are due right now. Try Cram to practice every card, or come back later.'}
        </Text>
        <Button onPress={() => navigation.goBack()}>Back to Deck</Button>
        </View>
      </Screen>
    );
  }

  if (!currentCard && !isComplete && sessionTotal > 0) {
    return (
      <Screen edges={['top']} bottom="safe" className="flex-1" style={shellStyle}>
        <View className="flex-1 items-center justify-center px-6">
        <Text className="text-lg font-semibold text-lantern-text mb-2" style={{ color: colors.text }}>
          Card unavailable
        </Text>
        <Text
          className="text-sm text-lantern-text-secondary text-center mb-6"
          style={{ color: colors.textSecondary }}
        >
          This review step could not load. Continue to the next card or exit.
        </Text>
        <View className="gap-3 w-full max-w-sm">
          <Button
            fullWidth
            onPress={() => {
              clearAutoAdvanceTimer();
              setIndex((prev) => prev + 1);
            }}
          >
            Continue
          </Button>
          <Button fullWidth variant="secondary" onPress={() => navigation.goBack()}>
            Exit
          </Button>
        </View>
        </View>
      </Screen>
    );
  }

  if (isComplete || !currentCard) {
    const reviewedCount = gradeCounts.again + gradeCounts.hard + gradeCounts.good + gradeCounts.easy;
    const reviewCount = Math.max(0, reviewedCount - newCount);
    const summaryBreakdown: { rating: PerformanceRating; color: string }[] = [
      { rating: 'again', color: colors.error },
      { rating: 'hard', color: colors.text },
      { rating: 'good', color: colors.success },
      { rating: 'easy', color: flashcardsAccent.ink },
    ];
    return (
      <Screen edges={['top']} bottom="safe" className="flex-1" style={shellStyle}>
        <View className="flex-1 items-center justify-center px-6">
        <Text className="text-2xl font-bold text-lantern-primary-text mb-1" style={{ color: colors.primaryText }}>
          Session complete
        </Text>
        <Text
          className="text-sm text-lantern-text-secondary text-center mb-5"
          style={{ color: colors.textSecondary }}
        >
          {reviewedCount} card{reviewedCount !== 1 ? 's' : ''} reviewed in {deckName}
          {elapsedMs > 0 ? ` · ${formatElapsed(elapsedMs)}` : ''}
        </Text>

        <View
          className="w-full max-w-sm rounded-2xl bg-lantern-surface border border-lantern-border p-4 mb-6"
          style={{ backgroundColor: colors.surface, borderColor: colors.border }}
        >
          <View className="flex-row justify-between">
            {summaryBreakdown.map(({ rating, color }) => (
              <View key={rating} className="flex-1 items-center">
                <Text className="text-xl font-bold" style={{ color }}>{gradeCounts[rating]}</Text>
                <Text
                  className="text-xs text-lantern-text-secondary mt-0.5"
                  style={{ color: colors.textSecondary }}
                >
                  {FLASHCARD_GRADE_LABELS[rating].label}
                </Text>
              </View>
            ))}
          </View>
          <View className="h-px my-3 bg-lantern-border" style={{ backgroundColor: colors.border }} />
          <View className="flex-row justify-between">
            <Text className="text-xs text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
              New: {newCount}
            </Text>
            <Text className="text-xs text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
              Review: {reviewCount}
            </Text>
          </View>
        </View>

        <View className="w-full max-w-sm gap-3">
          {canUndo ? (
            <Button
              fullWidth
              variant="secondary"
              accessibilityLabel="Undo last grade"
              onPress={handleUndo}
            >
              Undo last card
            </Button>
          ) : null}
          {nextLeg ? (
            <Button
              fullWidth
              accessibilityLabel={continueDueReviewLabel(nextLeg)}
              onPress={() =>
                navigation.replace('FlashcardReview', {
                  deckId: nextLeg.deckId,
                  deckName: nextLeg.deckName,
                  queueDeckIds: route.params?.queueDeckIds,
                })
              }
            >
              {continueDueReviewLabel(nextLeg)}
            </Button>
          ) : null}
          <Button fullWidth variant={nextLeg ? 'secondary' : 'primary'} onPress={() => navigation.goBack()}>
            Done
          </Button>
        </View>
        </View>
      </Screen>
    );
  }

  const { front, back } = getCardDisplayText(currentCard);
  const isImageOcclusion = currentCard.type === FlashcardType.IMAGE_OCCLUSION;

  // The shared skin (src/design/flashcardGradeSkin.ts), so this screen and
  // Home's inline card paint a grade identically — and so the "Again" pairing
  // is AA in one place rather than two.
  const gradeChipSkin = (rating: PerformanceRating) =>
    flashcardGradeSkin(rating, colors, flashcardsAccent);

  const renderGradeButton = ({
    rating,
    accessibilityLabel,
  }: (typeof GRADE_BUTTONS)[number]) => {
    const skin = gradeChipSkin(rating);
    return (
      <Pressable
        key={rating}
        disabled={grading}
        accessibilityRole="button"
        accessibilityLabel={
          intervalPreview ? `${accessibilityLabel}, next in ${intervalPreview[rating]}` : accessibilityLabel
        }
        onPress={() => handleRate(rating)}
        className="flex-1"
        style={{
          minHeight: 56,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: skin.backgroundColor,
          paddingVertical: 10,
          paddingHorizontal: 8,
          opacity: grading ? 0.5 : 1,
        }}
      >
        <View className="items-center">
          <Text className="text-sm font-semibold" style={{ color: skin.color }}>
            {FLASHCARD_GRADE_LABELS[rating].label}
          </Text>
          <Text className="text-xs" style={{ color: skin.color, opacity: 0.8 }}>
            {FLASHCARD_GRADE_LABELS[rating].meaning}
          </Text>
          {intervalPreview ? (
            <Text className="text-[11px] mt-0.5" style={{ color: skin.color, opacity: 0.7 }}>
              {intervalPreview[rating]}
            </Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={['top']} bottom="none" className="flex-1" style={shellStyle}>
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <View className="flex-row items-center gap-2">
          {canUndo ? (
            <Button
              variant="ghost"
              size="sm"
              accessibilityLabel="Undo last grade"
              onPress={handleUndo}
            >
              Undo
            </Button>
          ) : null}
          <Text className="text-sm font-medium text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
            {chainProgress ? `${chainProgress.overall} / ${chainProgress.total}` : `${progress} / ${sessionTotal}`}
          </Text>
        </View>
      </View>

      {chainProgress ? (
        <Text
          className="text-caption px-4 pb-2 text-lantern-text-secondary"
          style={{ color: colors.textSecondary }}
          accessibilityLabel={`${chainProgress.deckLabel}, card ${chainProgress.overall} of ${chainProgress.total}`}
        >
          {chainProgress.deckLabel}
        </Text>
      ) : null}

      <View className="h-1 mx-4 rounded-full bg-lantern-background-secondary overflow-hidden mb-2">
        <View
          className="h-full bg-lantern-primary-fill rounded-full"
          style={{
            // Matches the counter above it: a chained session fills across the
            // whole plan, so the bar does not reset to empty on every deck.
            width: `${((chainProgress ? chainProgress.overall / chainProgress.total : progress / sessionTotal) || 0) * 100}%`,
            backgroundColor: colors.primaryFill,
          }}
        />
      </View>

      {showSwipeHint ? (
        <Text
          className="text-xs text-center text-lantern-text-secondary px-6 mb-3"
          style={{ color: colors.textSecondary }}
        >
          Tap to flip · Swipe to grade (left Again, right Good, up Easy, down Hard)
        </Text>
      ) : null}

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 8 }}
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
        showsVerticalScrollIndicator
      >
        {nextCard ? (
          <View className="absolute left-0 right-0 top-1/2 -mt-32 opacity-30 scale-95" pointerEvents="none">
            <View
              className="min-h-[260px] rounded-2xl bg-lantern-surface border border-lantern-border"
              style={{ backgroundColor: colors.surface, borderColor: colors.border }}
            />
          </View>
        ) : null}

        <SwipeableFlashcard
          card={currentCard}
          cardKey={currentCard.id}
          front={front}
          back={back}
          isImageOcclusion={isImageOcclusion}
          showBack={showBack}
          reduceMotion={reduceMotion}
          onToggleBack={handleToggleBack}
          onGrade={handleRate}
        />
      </ScrollView>

      <View className="px-4 gap-3" style={{ paddingBottom: footerPadding }}>
        {!showBack ? (
          <Button
            fullWidth
            size="lg"
            onPress={() => {
              withHaptic(() => Haptics.selectionAsync());
              setShowBack(true);
            }}
          >
            Show Answer
          </Button>
        ) : (
          <>
            <View className="flex-row gap-2">
              {GRADE_BUTTONS.slice(0, 2).map(renderGradeButton)}
            </View>
            <View className="flex-row gap-2">
              {GRADE_BUTTONS.slice(2).map(renderGradeButton)}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

export default FlashcardReviewScreen;
