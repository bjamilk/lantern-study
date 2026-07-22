import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { FlashcardType } from '@lantern/shared';
import type { PerformanceRating } from '@lantern/shared/utils';
import {
  buildFlashcardReviewQueue,
  getTodayStudyCounts,
  isNewFlashcard,
} from '@lantern/shared/settings';
import { useAuthStore, useFlashcardStore, type Flashcard } from '../../stores';
import { Button } from '../../components/ui';
import { SwipeableFlashcard } from '../../components/SwipeableFlashcard';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { trackStudyActivity } from '../../services/gamification';
import { trackFlashcardReviewStarted, trackFlashcardReviewCompleted } from '../../services/productAnalytics';
import { getCardDisplayText } from '../../utils/flashcardHelpers';
import { useSettingsStore } from '../../stores/settingsStore';
import { useStatsStore } from '../../stores/statsStore';
import { useTheme } from '../../theme';

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
  label: string;
  variant: 'danger' | 'secondary' | 'primary' | 'accent';
  accessibilityLabel: string;
}[] = [
  { rating: 'again', label: 'Again', variant: 'danger', accessibilityLabel: 'Rate again, needs more review' },
  { rating: 'hard', label: 'Hard', variant: 'secondary', accessibilityLabel: 'Rate hard' },
  { rating: 'good', label: 'Good', variant: 'primary', accessibilityLabel: 'Rate good' },
  { rating: 'easy', label: 'Easy', variant: 'accent', accessibilityLabel: 'Rate easy' },
];

const EMPTY_CARDS: Flashcard[] = [];

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
  const insets = useSafeAreaInsets();
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Review';
  const user = useAuthStore(s => s.user);
  const deckCards = useFlashcardStore(s => s.flashcards[deckId] ?? EMPTY_CARDS);
  const isLoading = useFlashcardStore(s => s.isLoading);
  const fetchFlashcards = useFlashcardStore(s => s.fetchFlashcards);
  const reviewFlashcard = useFlashcardStore(s => s.reviewFlashcard);

  const queueSnapshotRef = useRef<Flashcard[] | null>(null);
  const startTrackedRef = useRef(false);
  const completeTrackedRef = useRef(false);
  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [grading, setGrading] = useState(false);

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
    setIndex(0);
    setShowBack(false);
  }, [deckId]);

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

  useEffect(() => {
    if (sessionTotal > 0 && !startTrackedRef.current) {
      startTrackedRef.current = true;
      trackFlashcardReviewStarted(sessionTotal, deckId);
    }
  }, [sessionTotal, deckId]);

  useEffect(() => {
    if (isComplete && !completeTrackedRef.current) {
      completeTrackedRef.current = true;
      trackFlashcardReviewCompleted(sessionTotal);
    }
  }, [isComplete, sessionTotal]);

  useConfirmBeforeExit(sessionTotal > 0 && !isComplete, {
    title: 'Exit Review?',
    message: 'Cards you have already graded are saved. Exit this session anyway?',
    confirmLabel: 'Exit',
    destructive: true,
  });

  useEffect(() => {
    setShowBack(false);
    setGrading(false);
  }, [index]);

  const handleToggleBack = useCallback(() => {
    withHaptic(() => Haptics.selectionAsync());
    setShowBack(prev => !prev);
  }, []);

  const handleRate = useCallback(
    (rating: PerformanceRating) => {
      if (!currentCard || !user?.id || grading) return;

      setGrading(true);
      if (rating === 'again' || rating === 'hard') {
        withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
      } else {
        withHaptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      }

      const wasNew = isNewFlashcard(currentCard);
      const cardId = currentCard.id;
      // Advance immediately — local SRS update is applied synchronously in the store.
      setIndex(prev => prev + 1);
      setShowBack(false);

      void reviewFlashcard(cardId, deckId, rating, user.id)
        .then(() => {
          trackStudyActivity('flashcard', 1);
          if (wasNew) {
            trackStudyActivity('flashcard_new', 1);
          }
        })
        .catch((err) => {
          console.error('Failed to save review:', err);
        })
        .finally(() => {
          setGrading(false);
        });
    },
    [currentCard, user?.id, grading, reviewFlashcard, deckId]
  );

  const shellStyle = { flex: 1, backgroundColor: colors.background };

  if (!deckId) {
    return (
      <SafeAreaView style={shellStyle} className="items-center justify-center px-6" edges={['top']}>
        <Text className="text-lg font-semibold text-lantern-text mb-2" style={{ color: colors.text }}>
          Deck not found
        </Text>
        <Button onPress={() => navigation.goBack()}>Go back</Button>
      </SafeAreaView>
    );
  }

  if (sessionTotal === 0) {
    const stillLoading = isLoading || (deckCards.length === 0 && queueSnapshotRef.current === null);
    const hasNewLeft = deckCards.some((c) => isNewFlashcard(c));
    return (
      <SafeAreaView style={shellStyle} className="items-center justify-center px-6" edges={['top']}>
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
      </SafeAreaView>
    );
  }

  if (isComplete || !currentCard) {
    return (
      <SafeAreaView style={shellStyle} className="items-center justify-center px-6" edges={['top']}>
        <Text className="text-2xl font-bold text-lantern-primary mb-2" style={{ color: colors.primary }}>
          Session complete
        </Text>
        <Text
          className="text-sm text-lantern-text-secondary text-center mb-6"
          style={{ color: colors.textSecondary }}
        >
          You reviewed {sessionTotal} card{sessionTotal !== 1 ? 's' : ''} in {deckName}.
        </Text>
        <Button onPress={() => navigation.goBack()}>Done</Button>
      </SafeAreaView>
    );
  }

  const { front, back } = getCardDisplayText(currentCard);
  const isImageOcclusion = currentCard.type === FlashcardType.IMAGE_OCCLUSION;

  return (
    <SafeAreaView style={shellStyle} edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <Text className="text-sm font-medium text-lantern-text-secondary" style={{ color: colors.textSecondary }}>
          {progress} / {sessionTotal}
        </Text>
      </View>

      <View className="h-1 mx-4 rounded-full bg-lantern-background-secondary overflow-hidden mb-2">
        <View
          className="h-full bg-lantern-primary rounded-full"
          style={{ width: `${(progress / sessionTotal) * 100}%`, backgroundColor: colors.primary }}
        />
      </View>

      {index === 0 && !showBack ? (
        <Text
          className="text-xs text-center text-lantern-text-secondary px-6 mb-3"
          style={{ color: colors.textSecondary }}
        >
          Tap to flip · Swipe to grade (left Again, right Good, up Easy, down Hard)
        </Text>
      ) : null}

      <View className="flex-1 px-4 justify-center">
        {nextCard ? (
          <View className="absolute left-4 right-4 top-1/2 -mt-32 opacity-30 scale-95">
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
      </View>

      <View className="px-4 gap-3" style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}>
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
              {GRADE_BUTTONS.slice(0, 2).map(({ rating, label, variant, accessibilityLabel }) => (
                <Button
                  key={rating}
                  variant={variant}
                  size="lg"
                  className="flex-1"
                  disabled={grading}
                  accessibilityLabel={accessibilityLabel}
                  onPress={() => handleRate(rating)}
                >
                  {label}
                </Button>
              ))}
            </View>
            <View className="flex-row gap-2">
              {GRADE_BUTTONS.slice(2).map(({ rating, label, variant, accessibilityLabel }) => (
                <Button
                  key={rating}
                  variant={variant}
                  size="lg"
                  className="flex-1"
                  disabled={grading}
                  accessibilityLabel={accessibilityLabel}
                  onPress={() => handleRate(rating)}
                >
                  {label}
                </Button>
              ))}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

export default FlashcardReviewScreen;
