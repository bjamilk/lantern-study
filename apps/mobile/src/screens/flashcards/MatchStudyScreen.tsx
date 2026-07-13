import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFlashcardStore } from '../../stores';
import { Button } from '../../components/ui';
import { useConfirmBeforeExit } from '../../hooks/useConfirmBeforeExit';
import { trackStudyActivity } from '../../services/gamification';
import { hapticSelection, hapticSuccess, hapticWarning } from '../../utils/haptics';

type NavigationProp = {
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { deckId?: string; deckName?: string } };
}

interface MatchTile {
  id: string;
  cardId: string;
  text: string;
  side: 'front' | 'back';
  matched: boolean;
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function MatchStudyScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const deckId = route.params?.deckId ?? '';
  const deckName = route.params?.deckName ?? 'Match';
  const { flashcards } = useFlashcardStore();

  const basicCards = useMemo(
    () =>
      (flashcards[deckId] ?? [])
        .filter(c => c.type === 'BASIC' && c.front && c.back)
        .slice(0, 6),
    [flashcards, deckId]
  );

  const [tiles, setTiles] = useState<MatchTile[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [wrongPair, setWrongPair] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const next: MatchTile[] = [];
    basicCards.forEach(card => {
      next.push({ id: `${card.id}-f`, cardId: card.id, text: card.front!, side: 'front', matched: false });
      next.push({ id: `${card.id}-b`, cardId: card.id, text: card.back!, side: 'back', matched: false });
    });
    setTiles(shuffle(next));
    setSelected(null);
    setWrongPair([]);
  }, [basicCards]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const matchedPairs = tiles.filter(t => t.matched).length / 2;
  const totalPairs = basicCards.length;
  const isComplete = totalPairs > 0 && matchedPairs === totalPairs;

  useEffect(() => {
    if (isComplete && totalPairs > 0) {
      trackStudyActivity('flashcard', totalPairs);
    }
  }, [isComplete, totalPairs]);

  useConfirmBeforeExit(basicCards.length > 0 && !isComplete, {
    title: 'Exit Match?',
    message: 'Your progress will be lost if you exit now.',
    confirmLabel: 'Exit',
    destructive: true,
  });

  const handleTilePress = useCallback(
    (tileId: string) => {
      const tile = tiles.find(t => t.id === tileId);
      if (!tile || tile.matched || wrongPair.length > 0) return;

      if (!selected) {
        hapticSelection();
        setSelected(tileId);
        return;
      }
      if (selected === tileId) {
        setSelected(null);
        return;
      }

      const first = tiles.find(t => t.id === selected)!;
      if (first.cardId === tile.cardId && first.side !== tile.side) {
        hapticSuccess();
        setTiles(prev => prev.map(t => (t.cardId === tile.cardId ? { ...t, matched: true } : t)));
        setSelected(null);
      } else {
        hapticWarning();
        setWrongPair([selected, tileId]);
        setTimeout(() => {
          setWrongPair([]);
          setSelected(null);
        }, 600);
      }
    },
    [selected, tiles, wrongPair.length]
  );

  if (!basicCards.length) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center px-6" edges={['top']}>
        <Text className="text-lg font-semibold text-lantern-text mb-2">Need more basic cards</Text>
        <Text className="text-sm text-lantern-text-secondary text-center mb-6">
          Match mode needs at least one front/back pair.
        </Text>
        <Button onPress={() => navigation.goBack()}>Back</Button>
      </SafeAreaView>
    );
  }

  if (isComplete) {
    return (
      <SafeAreaView className="flex-1 bg-lantern-background items-center justify-center px-6" edges={['top']}>
        <Text className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">All matched!</Text>
        <Text className="text-sm text-lantern-text-secondary mb-6">
          {deckName} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
        </Text>
        <Button onPress={() => navigation.goBack()}>Done</Button>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <View className="px-4 pt-2 pb-3 flex-row items-center justify-between">
        <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
          Exit
        </Button>
        <View className="items-end">
          <Text className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">{deckName}</Text>
          <Text className="text-xs text-lantern-text-secondary">
            {matchedPairs}/{totalPairs} pairs · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: Math.max(insets.bottom, 16) + 24,
        }}
      >
        <View className="flex-row flex-wrap gap-2 justify-center">
          {tiles.map(tile => {
            const isSelected = selected === tile.id;
            const isWrong = wrongPair.includes(tile.id);
            const isMatched = tile.matched;

            let tileClass = 'bg-lantern-surface border-lantern-border';
            if (isMatched) tileClass = 'bg-emerald-100 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-700';
            else if (isWrong) tileClass = 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700';
            else if (isSelected) tileClass = 'bg-lantern-primary-background dark:bg-lantern-primary-dark/40 border-lantern-primary dark:border-lantern-primary';

            return (
              <Pressable
                key={tile.id}
                onPress={() => handleTilePress(tile.id)}
                disabled={isMatched}
                className={`w-[47%] min-h-[88px] rounded-2xl border p-3 items-center justify-center active:opacity-90 ${tileClass}`}
              >
                <Text
                  className={`text-xs text-center font-medium ${tile.side === 'front' ? 'text-lantern-primary' : 'text-lantern-text'}`}
                  numberOfLines={4}
                >
                  {tile.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default MatchStudyScreen;
