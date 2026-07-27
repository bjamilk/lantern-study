import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { shuffleArray } from '@lantern/shared/utils';
import { useFlashcardStore, type Flashcard } from '../../stores';
import { Button, Card } from '../../components/ui';
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
  route: { params?: { deckId?: string; deckName?: string; timedMinutes?: number } };
}

export function CramSessionScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Cram';
  const timedMinutes = route.params?.timedMinutes ?? 0;
  const { flashcards } = useFlashcardStore();

  const allCards = useMemo(() => flashcards[deckId] ?? [], [flashcards, deckId]);
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
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center px-6" edges={['top']}>
        <Text className="text-lg font-semibold text-lantern-text mb-2">No cards to cram</Text>
        <Button onPress={() => navigation.goBack()}>Back</Button>
      </SafeAreaView>
    );
  }

  if (isComplete) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center px-6" edges={['top']}>
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
      </SafeAreaView>
    );
  }

  const { front, back } = getCardDisplayText(currentCard!);

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <View className="items-end">
          <Text className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Cram · {index + 1}/{queue.length}
          </Text>
          {timedMinutes > 0 ? (
            <Text className={`text-xs ${timeRemaining < 60 ? 'text-red-500' : 'text-lantern-text-secondary'}`}>
              {formatTime(timeRemaining)}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="flex-1 px-4 justify-center">
        <Pressable onPress={() => { hapticSelection(); setShowBack(v => !v); }} className="active:opacity-95">
          <Card className="min-h-[220px] items-center justify-center border-amber-100 dark:border-amber-900/40">
            <Text className="text-xs uppercase tracking-wide text-lantern-text-tertiary mb-3">
              {showBack ? 'Answer' : 'Question'}
            </Text>
            <Text className="text-xl font-medium text-lantern-text text-center px-2">
              {showBack ? back || front : front}
            </Text>
            {!showBack ? (
              <Text className="text-xs text-amber-600 mt-6">Tap to reveal</Text>
            ) : null}
          </Card>
        </Pressable>
      </View>

      <View className="px-4 gap-2" style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}>
        {!showBack ? (
          <Button variant="accent" fullWidth onPress={() => setShowBack(true)}>
            Show Answer
          </Button>
        ) : (
          <View className="flex-row gap-3">
            <Button variant="danger" className="flex-1" onPress={() => advance(false)}>
              Missed
            </Button>
            <Button variant="accent" className="flex-1" onPress={() => advance(true)}>
              Got it
            </Button>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

export default CramSessionScreen;
