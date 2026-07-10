import React, { useMemo } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { featureAccents } from '@lantern/shared/design';
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
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1 w-full"
        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 }}
      >
        <ScreenHeader title="Study" subtitle="Review due cards and jump back in" />

        <Card className="mb-4 border-l-4 border-l-emerald-500">
          <Text className="text-xl font-bold text-lantern-text mb-1">
            {dueCardsCount > 0 ? `${dueCardsCount} cards due` : 'All caught up!'}
          </Text>
          <Text className="text-sm text-lantern-text-secondary mb-4">
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
            className="flex-1 p-4 rounded-xl border border-lantern-border bg-lantern-surface"
          >
            <Ionicons name="sparkles" size={24} color={featureAccents.groups} />
            <Text className="font-semibold text-lantern-text mt-2">Library</Text>
            <Text className="text-xs text-lantern-text-secondary mt-1">Notes & decks</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate('TestsList')}
            className="flex-1 p-4 rounded-xl border border-lantern-border bg-lantern-surface"
          >
            <Ionicons name="clipboard-outline" size={24} color={featureAccents.groups} />
            <Text className="font-semibold text-lantern-text mt-2">Tests</Text>
            <Text className="text-xs text-lantern-text-secondary mt-1">Practice & review</Text>
          </Pressable>
        </View>

        {decks.slice(0, 4).map((deck) => (
          <Pressable
            key={deck.id}
            onPress={() => navigation.navigate('LearnStudy', { deckId: deck.id, deckName: deck.name })}
            className="flex-row items-center justify-between p-3 mb-2 rounded-xl border border-lantern-border bg-lantern-surface"
          >
            <View className="flex-1 mr-2">
              <Text className="font-medium text-lantern-text" numberOfLines={1}>{deck.name}</Text>
              <Text className="text-xs text-lantern-text-secondary" numberOfLines={1}>{deck.description || 'Flashcard deck'}</Text>
            </View>
            <Text className="text-sm font-semibold" style={{ color: featureAccents.groups }}>Learn</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

export default StudyHubScreen;
