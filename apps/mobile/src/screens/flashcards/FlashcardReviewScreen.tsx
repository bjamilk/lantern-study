import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FlashcardType, FLASHCARD_GRADE_LABELS } from '@lantern/shared';
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
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { deckId?: string; deckName?: string } };
}

const GRADE_BUTTONS: {
  rating: PerformanceRating;
  variant: 'danger' | 'secondary' | 'primary' | 'accent';
  accessibilityLabel: string;
}[] = [
  {
    rating: 'again',
    variant: 'danger',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.again.label}, ${FLASHCARD_GRADE_LABELS.again.meaning}`,
  },
  {
    rating: 'hard',
    variant: 'secondary',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.hard.label}, ${FLASHCARD_GRADE_LABELS.hard.meaning}`,
  },
  {
    rating: 'good',
    variant: 'primary',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.good.label}, ${FLASHCARD_GRADE_LABELS.good.meaning}`,
  },
  {
    rating: 'easy',
    variant: 'accent',
    accessibilityLabel: `${FLASHCARD_GRADE_LABELS.easy.label}, ${FLASHCARD_GRADE_LABELS.easy.meaning}`,
  },
];

const GRADE_TEXT_CLASS: Record<(typeof GRADE_BUTTONS)[number]['variant'], string> = {
  danger: 'text-white',
  secondary: 'text-lantern-text',
  primary: 'text-white',
  accent: 'text-white',
};

const EMPTY_CARDS: Flashcard[] = [];

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
  // `presentation: 'fullScreenModal'` gives this route its own native window,
  // which the app-root SafeAreaProvider never measures: the raw
  // `useSafeAreaInsets()` returned 0 on every edge here, so the Exit/Undo row
  // drew under the clock and Again/Hard/Good/Easy sat on the gesture bar.
  const footerPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 12 });
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Review';
  const deck = useFlashcardStore(s => s.decks.find(d => d.id === deckId));

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
    const summaryBreakdown: { rating: PerformanceRating; textClass: string }[] = [
      { rating: 'again', textClass: 'text-red-500' },
      { rating: 'hard', textClass: 'text-orange-500' },
      { rating: 'good', textClass: 'text-green-500' },
      { rating: 'easy', textClass: 'text-blue-500' },
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
            {summaryBreakdown.map(({ rating, textClass }) => (
              <View key={rating} className="flex-1 items-center">
                <Text className={`text-xl font-bold ${textClass}`}>{gradeCounts[rating]}</Text>
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
          <Button fullWidth onPress={() => navigation.goBack()}>
            Done
          </Button>
        </View>
        </View>
      </Screen>
    );
  }

  const { front, back } = getCardDisplayText(currentCard);
  const isImageOcclusion = currentCard.type === FlashcardType.IMAGE_OCCLUSION;

  const renderGradeButton = ({
    rating,
    variant,
    accessibilityLabel,
  }: (typeof GRADE_BUTTONS)[number]) => (
    <Button
      key={rating}
      variant={variant}
      size="lg"
      className="flex-1"
      disabled={grading}
      accessibilityLabel={
        intervalPreview ? `${accessibilityLabel}, next in ${intervalPreview[rating]}` : accessibilityLabel
      }
      onPress={() => handleRate(rating)}
    >
      <View className="items-center">
        <Text className={`text-sm font-semibold ${GRADE_TEXT_CLASS[variant]}`}>
          {FLASHCARD_GRADE_LABELS[rating].label}
        </Text>
        <Text className={`text-xs opacity-80 ${GRADE_TEXT_CLASS[variant]}`}>
          {FLASHCARD_GRADE_LABELS[rating].meaning}
        </Text>
        {intervalPreview ? (
          <Text className={`text-[11px] mt-0.5 opacity-70 ${GRADE_TEXT_CLASS[variant]}`}>
            {intervalPreview[rating]}
          </Text>
        ) : null}
      </View>
    </Button>
  );

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
            {progress} / {sessionTotal}
          </Text>
        </View>
      </View>

      <View className="h-1 mx-4 rounded-full bg-lantern-background-secondary overflow-hidden mb-2">
        <View
          className="h-full bg-lantern-primary-fill rounded-full"
          style={{ width: `${(progress / sessionTotal) * 100}%`, backgroundColor: colors.primaryFill }}
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
