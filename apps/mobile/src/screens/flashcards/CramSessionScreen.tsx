/**
 * The `CramSession` route (a fullScreenModal): an ungraded speed run through a
 * deck. Tap to reveal, mark Got it or Missed, optionally against a clock, then
 * retry just the misses.
 *
 * Main exports: `CramSessionScreen` (also the default).
 * Touches: flashcardStore (reads `flashcards[deckId]`; writes nothing — cram
 * never touches FSRS scheduling), services/gamification `trackStudyActivity`
 * and productAnalytics. Native: expo-haptics via utils/haptics.
 *
 * Gotchas: `cardIds` narrows the deck to a subset (Play's missed cards, for
 * example) but falls back to the whole deck when none of the ids are present.
 * Nothing is persisted — the whole session is screen state, which is why
 * `useConfirmBeforeExit` guards leaving mid-run. The two tracking refs are
 * reset per deck/timer so one session reports start and completion once.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { FlashcardType } from '@lantern/shared';
import { shuffleArray } from '@lantern/shared/utils';
import { useFlashcardStore, type Flashcard } from '../../stores';
import { Button } from '../../components/ui';
import { useFeatureAccent } from '../../components/ui/FeatureDisc';
import { CARD, useTheme } from '../../theme';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { FlashcardImage } from '../../components/FlashcardImage';
import { ImageOcclusionView } from '../../components/ImageOcclusionView';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { trackStudyActivity } from '../../services/gamification';
import { trackStudyModeCompleted, trackStudyModeSelected } from '../../services/productAnalytics';
import { getCardDisplayText } from '../../utils/flashcardHelpers';
import { hapticSelection, hapticSuccess, hapticWarning } from '../../utils/haptics';

type NavigationProp = {
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { deckId?: string; deckName?: string; timedMinutes?: number; cardIds?: string[] } };
}

export function CramSessionScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const flashcardsAccent = useFeatureAccent('flashcards');
  // `presentation: 'fullScreenModal'` puts this route in its own native
  // window, which the app-root SafeAreaProvider never measures — the raw
  // `useSafeAreaInsets()` this used to call returned 0 on every edge, so the
  // Exit row drew under the clock and the grade buttons sat on the gesture
  // bar. `Screen`/`useScreenBottomPadding` fall back to initialWindowMetrics.
  const footerPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 12 });
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Cram';
  const timedMinutes = route.params?.timedMinutes ?? 0;
  const cardIds = route.params?.cardIds;
  const { flashcards } = useFlashcardStore();

  const allCards = useMemo(() => {
    const pool = flashcards[deckId] ?? [];
    if (!cardIds?.length) return pool;
    const wanted = new Set(cardIds);
    const filtered = pool.filter((card) => wanted.has(card.id));
    return filtered.length > 0 ? filtered : pool;
  }, [flashcards, deckId, cardIds]);
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [index, setIndex] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [correct, setCorrect] = useState(0);
  const [incorrect, setIncorrect] = useState(0);
  const [missedCards, setMissedCards] = useState<Flashcard[]>([]);
  const [timeRemaining, setTimeRemaining] = useState(timedMinutes > 0 ? timedMinutes * 60 : 0);
  const [sessionEnded, setSessionEnded] = useState(false);
  const startTrackedRef = useRef(false);
  const completeTrackedRef = useRef(false);
  const studyMode = timedMinutes > 0 ? 'timed_drill' : 'speed_run';

  useEffect(() => {
    startTrackedRef.current = false;
    completeTrackedRef.current = false;
  }, [deckId, timedMinutes]);

  useEffect(() => {
    if (queue.length > 0 && !startTrackedRef.current) {
      startTrackedRef.current = true;
      trackStudyModeSelected(studyMode);
    }
  }, [queue.length, studyMode]);

  useEffect(() => {
    setQueue(shuffleArray(allCards));
    setIndex(0);
    setCorrect(0);
    setIncorrect(0);
    setMissedCards([]);
    setShowBack(false);
    setSessionEnded(false);
    setTimeRemaining(timedMinutes > 0 ? timedMinutes * 60 : 0);
  }, [allCards, deckId, timedMinutes]);

  const endSession = useCallback(() => {
    setSessionEnded(true);
  }, []);

  useEffect(() => {
    if (timedMinutes <= 0 || sessionEnded || !queue.length) return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          endSession();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timedMinutes, sessionEnded, queue.length, endSession]);

  const currentCard: Flashcard | undefined = queue[index];
  const isComplete = sessionEnded || index >= queue.length;

  useConfirmBeforeExit(queue.length > 0 && !isComplete, {
    title: 'Exit Cram Session?',
    message: 'Your progress will be lost if you exit now.',
    confirmLabel: 'Exit',
    destructive: true,
  });

  useEffect(() => {
    setShowBack(false);
  }, [index]);

  useEffect(() => {
    if (isComplete && !completeTrackedRef.current && (correct + incorrect) > 0) {
      completeTrackedRef.current = true;
      trackStudyActivity('flashcard', correct + incorrect);
      trackStudyModeCompleted(studyMode);
    }
  }, [isComplete, correct, incorrect, studyMode]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const advance = (wasCorrect: boolean) => {
    if (!currentCard) return;
    if (wasCorrect) {
      hapticSuccess();
      setCorrect(c => c + 1);
    } else {
      hapticWarning();
      setIncorrect(c => c + 1);
      setMissedCards(prev => [...prev, currentCard]);
    }
    setIndex(prev => prev + 1);
  };

  const handleRetryMissed = () => {
    const retryQueue = shuffleArray(missedCards);
    setQueue(retryQueue);
    setIndex(0);
    setCorrect(0);
    setIncorrect(0);
    setMissedCards([]);
    setSessionEnded(false);
    setTimeRemaining(timedMinutes > 0 ? timedMinutes * 60 : 0);
  };

  if (!queue.length && !allCards.length) {
    return (
      <Screen edges={['top']} bottom="safe">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-lantern-text mb-2">No cards to cram</Text>
          <Button onPress={() => navigation.goBack()}>Back</Button>
        </View>
      </Screen>
    );
  }

  if (isComplete) {
    return (
      <Screen edges={['top']} bottom="safe">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-2xl font-bold text-amber-600 dark:text-amber-400 mb-2">Cram complete</Text>
          <Text className="text-sm text-lantern-text-secondary text-center mb-1">{deckName}</Text>
          <Text className="text-base text-lantern-text mb-6">
            {correct} correct · {incorrect} incorrect
          </Text>
          {missedCards.length > 0 ? (
            <Button variant="accent" className="mb-3 w-full" onPress={handleRetryMissed}>
              Retry missed cards ({missedCards.length})
            </Button>
          ) : null}
          <Button onPress={() => navigation.goBack()}>Done</Button>
        </View>
      </Screen>
    );
  }

  const { front, back } = getCardDisplayText(currentCard!);
  // Image-occlusion cards have no text sides, so the text-only rendering below
  // showed "(No question text)" — draw the occluded image instead, exactly as
  // SwipeableFlashcard does in the graded review.
  const isImageOcclusion = currentCard!.type === FlashcardType.IMAGE_OCCLUSION;

  return (
    <Screen edges={['top']} bottom="none">
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <View className="items-end">
          <Text className="text-sm font-medium" style={{ color: flashcardsAccent.ink }}>
            Cram · {index + 1}/{queue.length}
          </Text>
          {timedMinutes > 0 ? (
            <Text
              className="text-xs"
              style={{ color: timeRemaining < 60 ? colors.error : colors.textSecondary }}
            >
              {formatTime(timeRemaining)}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="flex-1 px-4 justify-center">
        <Pressable onPress={() => { hapticSelection(); setShowBack(v => !v); }} className="active:opacity-95">
          <View
            className="min-h-[220px] overflow-hidden bg-lantern-surface items-center justify-center px-4 pb-5"
            style={{
              borderRadius: CARD.radius,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <View style={{ height: 3, alignSelf: 'stretch', backgroundColor: flashcardsAccent.ink, marginBottom: 16 }} />
            <Text
              className="text-xs uppercase tracking-wide font-semibold mb-3"
              style={{ color: flashcardsAccent.ink }}
            >
              {showBack ? 'Answer' : 'Question'}
            </Text>
            {isImageOcclusion ? (
              <View className="w-full px-1">
                {currentCard!.front?.trim() ? (
                  <Text className="text-base font-medium text-lantern-text text-center px-2 mb-3">
                    {currentCard!.front.trim()}
                  </Text>
                ) : null}
                <ImageOcclusionView card={currentCard!} showAnswer={showBack} />
              </View>
            ) : (
              <>
                <FlashcardImage url={currentCard!.imageUrl} />
                <Text className="text-xl font-medium text-lantern-text text-center px-2">
                  {showBack ? back || front : front}
                </Text>
              </>
            )}
            {!showBack ? (
              <Text className="text-xs mt-6" style={{ color: colors.textTertiary }}>
                Tap to reveal
              </Text>
            ) : null}
          </View>
        </Pressable>
      </View>

      <View className="px-4 gap-2" style={{ paddingBottom: footerPadding }}>
        {!showBack ? (
          <Button fullWidth onPress={() => setShowBack(true)}>
            Show answer
          </Button>
        ) : (
          <View className="flex-row gap-3">
            <Pressable
              onPress={() => advance(false)}
              className="flex-1 items-center justify-center"
              style={{
                minHeight: 48,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.errorBackground,
              }}
            >
              <Text className="font-semibold" style={{ color: colors.error }}>Missed</Text>
            </Pressable>
            <Pressable
              onPress={() => advance(true)}
              className="flex-1 items-center justify-center"
              style={{
                minHeight: 48,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.successBackground,
              }}
            >
              <Text className="font-semibold" style={{ color: colors.success }}>Got it</Text>
            </Pressable>
          </View>
        )}
      </View>
    </Screen>
  );
}

export default CramSessionScreen;
