import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFlashcardStore, type Flashcard } from '../../stores';
import { Button, Card } from '../../components/ui';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { FlashcardImage } from '../../components/FlashcardImage';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { trackStudyActivity } from '../../services/gamification';
import { trackStudyModeCompleted, trackStudyModeSelected } from '../../services/productAnalytics';
import { getCardDisplayText } from '../../utils/flashcardHelpers';
import { hapticSuccess, hapticWarning } from '../../utils/haptics';

type NavigationProp = {
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { deckId?: string; deckName?: string } };
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function LearnStudyScreen({ navigation, route }: Props) {
  // fullScreenModal route: the raw safe-area hook reports 0 on every edge in
  // its detached window, so the header drew under the clock and the answer
  // options ran into the gesture bar. The primitive restores both.
  const listPadding = useScreenBottomPadding({ bottom: 'safe', bottomExtra: 24 });
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Learn';
  const { flashcards } = useFlashcardStore();

  const eligible = useMemo(
    () => (flashcards[deckId] ?? []).filter(c => getCardDisplayText(c).front && getCardDisplayText(c).back),
    [flashcards, deckId]
  );

  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [mastered, setMastered] = useState(0);
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const startTrackedRef = useRef(false);
  const completeTrackedRef = useRef(false);

  useEffect(() => {
    setQueue(shuffle(eligible));
    setMastered(0);
    setFeedback(null);
    startTrackedRef.current = false;
    completeTrackedRef.current = false;
  }, [eligible]);

  useEffect(() => {
    if (eligible.length > 0 && !startTrackedRef.current) {
      startTrackedRef.current = true;
      trackStudyModeSelected('quiz');
    }
  }, [eligible.length]);

  const current = queue[0];
  const isDone = eligible.length > 0 && queue.length === 0;

  useConfirmBeforeExit(eligible.length > 0 && !isDone, {
    title: 'Exit Learn Session?',
    message: 'Your progress will be lost if you exit now.',
    confirmLabel: 'Exit',
    destructive: true,
  });

  useEffect(() => {
    if (isDone && mastered > 0 && !completeTrackedRef.current) {
      completeTrackedRef.current = true;
      trackStudyActivity('flashcard', mastered);
      trackStudyModeCompleted('quiz');
    }
  }, [isDone, mastered]);

  const options = useMemo(() => {
    if (!current) return [];
    const { back } = getCardDisplayText(current);
    const distractors = shuffle(
      eligible.filter(c => c.id !== current.id).map(c => getCardDisplayText(c).back)
    ).slice(0, 3);
    return shuffle([back, ...distractors]);
  }, [current, eligible]);

  const handleAnswer = (choice: string) => {
    if (!current || feedback) return;
    const { back } = getCardDisplayText(current);
    const correct = choice === back;
    if (correct) hapticSuccess();
    else hapticWarning();
    setFeedback(correct ? 'correct' : 'wrong');

    setTimeout(() => {
      if (correct) {
        setMastered(m => m + 1);
        setQueue(q => q.slice(1));
      } else {
        setQueue(q => [...q.slice(1), current]);
      }
      setFeedback(null);
    }, 700);
  };

  if (!eligible.length) {
    return (
      <Screen edges={['top']} bottom="safe">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-lg font-semibold text-lantern-text mb-2">No cards to learn</Text>
          <Button onPress={() => navigation.goBack()}>Back</Button>
        </View>
      </Screen>
    );
  }

  if (isDone) {
    return (
      <Screen edges={['top']} bottom="safe">
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-2xl font-bold text-violet-600 dark:text-violet-400 mb-2">Learn complete</Text>
          <Text className="text-sm text-lantern-text-secondary text-center mb-6">
            {deckName} · {mastered} card{mastered !== 1 ? 's' : ''} mastered
          </Text>
          <Button onPress={() => navigation.goBack()}>Done</Button>
        </View>
      </Screen>
    );
  }

  const { front } = getCardDisplayText(current);

  return (
    <Screen edges={['top']} bottom="none">
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <Text className="text-sm font-medium text-violet-600 dark:text-violet-400">
          {mastered}/{eligible.length} mastered
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: listPadding,
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <Card className="mb-4 border-violet-100 dark:border-violet-900/40">
          <Text className="text-xs uppercase tracking-wide text-lantern-text-tertiary mb-2">Question</Text>
          {/* A picture attached to a basic card was stored but never drawn here. */}
          <FlashcardImage url={current.imageUrl} />
          <Text className="text-lg font-medium text-lantern-text">{front}</Text>
        </Card>

        <Text className="text-sm font-semibold text-lantern-text-secondary mb-3">Pick the answer</Text>

        <View className="gap-2">
          {options.map(option => {
            const { back } = getCardDisplayText(current);
            let optionClass = 'bg-lantern-surface border-lantern-border';
            if (feedback && option === back) {
              optionClass = 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-400 dark:border-emerald-600';
            } else if (feedback === 'wrong' && option !== back) {
              optionClass = 'bg-lantern-surface border-lantern-border opacity-60';
            }

            return (
              <Pressable
                key={option}
                onPress={() => handleAnswer(option)}
                disabled={!!feedback}
                className={`rounded-2xl border px-4 py-3 active:opacity-90 ${optionClass}`}
              >
                <Text className="text-sm text-lantern-text">{option}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

export default LearnStudyScreen;
