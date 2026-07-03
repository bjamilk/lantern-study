import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { Button, Card, ScreenHeader } from '../../components/ui';

interface Props {
  navigation: {
    navigate: (screen: string, params?: Record<string, unknown>) => void;
  };
}

export function StudyHubScreen({ navigation }: Props) {
  const { decks } = useFlashcardStore();

  const dueCardsCount = useMemo(
    () => decks.reduce((sum, d) => sum + (d.due_count || 0), 0),
    [decks]
  );

  const startDueReview = () => {
    const best = [...decks].sort((a, b) => (b.due_count || 0) - (a.due_count || 0))[0];
    if (best) {
      navigation.navigate('DeckDetail', { deckId: best.id, deckName: best.name });
    } else {
      navigation.navigate('FlashcardsList');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScrollView className="flex-1 px-4 py-4" contentContainerStyle={{ paddingBottom: 24 }}>
        <ScreenHeader title="Study" subtitle="Review due cards and jump back in" />

        <Card className="mb-4 border-l-4 border-l-indigo-500">
          <Text className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-1">
            {dueCardsCount > 0 ? `${dueCardsCount} cards due` : 'All caught up!'}
          </Text>
          <Text className="text-sm text-slate-500 dark:text-slate-400 mb-4">
            {dueCardsCount > 0
              ? 'Spaced repetition keeps knowledge fresh.'
              : 'Import material or create a deck to get started.'}
          </Text>
          <Button onPress={startDueReview}>
            {dueCardsCount > 0 ? 'Review due cards' : 'Browse decks'}
          </Button>
        </Card>

        <View className="flex-row gap-3 mb-4">
          <Pressable
            onPress={() => navigation.navigate('Library', { tab: 'notes' })}
            className="flex-1 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <Ionicons name="sparkles" size={24} color="#6366f1" />
            <Text className="font-semibold text-slate-900 dark:text-slate-100 mt-2">Library</Text>
            <Text className="text-xs text-slate-500 mt-1">Notes & decks</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('TestsList')}
            className="flex-1 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <Ionicons name="clipboard-outline" size={24} color="#10b981" />
            <Text className="font-semibold text-slate-900 dark:text-slate-100 mt-2">Tests</Text>
            <Text className="text-xs text-slate-500 mt-1">Practice & review</Text>
          </Pressable>
        </View>

        {decks.slice(0, 4).map((deck) => (
          <Pressable
            key={deck.id}
            onPress={() => navigation.navigate('LearnStudy', { deckId: deck.id, deckName: deck.name })}
            className="flex-row items-center justify-between p-3 mb-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
          >
            <View className="flex-1 mr-2">
              <Text className="font-medium text-slate-900 dark:text-slate-100" numberOfLines={1}>{deck.name}</Text>
              <Text className="text-xs text-slate-500" numberOfLines={1}>{deck.description || 'Flashcard deck'}</Text>
            </View>
            <Text className="text-sm font-semibold text-indigo-600">Learn</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

export default StudyHubScreen;
