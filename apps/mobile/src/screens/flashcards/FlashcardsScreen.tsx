import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore, useFlashcardStore, type Deck } from '../../stores';
import { Button, Card, ScreenHeader } from '../../components/ui';
import { useTheme } from '../../theme';
import { featureAccents } from '@lantern/shared/design';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import { FlashcardType } from '@lantern/shared';
import type { AIGeneratedFlashcard } from '../../services/ai';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface Props {
  navigation: NavigationProp;
  embedded?: boolean;
}

const ACCENT_GRADIENTS: [string, string, ...string[]][] = [
  ['#f43f5e', '#ec4899', '#d946ef'],
  ['#fb7185', '#f43f5e', '#e11d48'],
  ['#f472b6', '#fb7185', '#fda4af'],
  ['#e11d48', '#f43f5e', '#fb923c'],
  ['#d946ef', '#ec4899', '#f43f5e'],
  ['#fb923c', '#f43f5e', '#fda4af'],
];

function DeckCard({
  deck,
  index,
  onPress,
  onAIGenerate,
  onStudy,
}: {
  deck: Deck;
  index: number;
  onPress: () => void;
  onAIGenerate: () => void;
  onStudy?: () => void;
}) {
  const cardCount = deck.card_count ?? 0;
  const dueCount = deck.due_count ?? 0;
  const gradient = ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length];

  return (
    <Pressable onPress={onPress} className="mb-3 active:opacity-90">
      <View className="rounded-2xl overflow-hidden border border-lantern-border bg-lantern-surface shadow-sm">
        <LinearGradient
          colors={gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <View className="flex-row items-center gap-2 flex-1 min-w-0">
            <Ionicons name="layers-outline" size={18} color="rgba(255,255,255,0.9)" />
            <Text className="text-sm font-bold text-white flex-1" numberOfLines={1}>
              {deck.name}
            </Text>
            {deck.is_shared ? (
              <View className="bg-white/20 px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-white">Shared</Text>
              </View>
            ) : null}
          </View>
          {dueCount > 0 ? (
            <View className="bg-white/25 px-2 py-0.5 rounded-full ml-2">
              <Text className="text-[10px] font-bold text-white">{dueCount} due</Text>
            </View>
          ) : (
            <Pressable
              onPress={e => {
                e.stopPropagation?.();
                onAIGenerate();
              }}
              className="p-1.5 rounded-full bg-white/20 ml-2"
              hitSlop={8}
            >
              <Ionicons name="sparkles-outline" size={16} color="#ffffff" />
            </Pressable>
          )}
        </LinearGradient>
        <View className="px-4 py-3">
          {deck.description ? (
            <Text className="text-xs text-lantern-text-secondary mb-2" numberOfLines={2}>
              {deck.description}
            </Text>
          ) : null}
          <View className="flex-row gap-4 items-center justify-between">
            <View className="flex-row gap-4">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-xs text-lantern-text-secondary">Cards</Text>
              <Text className="text-sm font-semibold text-lantern-text">{cardCount}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Text className="text-xs text-lantern-text-secondary">Due</Text>
              <Text
                className={`text-sm font-semibold ${dueCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-lantern-text'}`}
              >
                {dueCount}
              </Text>
            </View>
            </View>
            {onStudy && dueCount > 0 ? (
              <Pressable onPress={(e) => { e.stopPropagation?.(); onStudy(); }} className="px-3 py-1.5 rounded-lg bg-amber-500">
                <Text className="text-xs font-bold text-white">Study</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export function FlashcardsScreen({ navigation, embedded = false }: Props) {
  const { colors } = useTheme();
  const user = useAuthStore(s => s.user);
  const { decks, isLoading, error, fetchDecks, createDeck, createFlashcard, clearError } = useFlashcardStore();
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [creating, setCreating] = useState(false);
  const [aiDeckId, setAiDeckId] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);

  const loadDecks = useCallback(async () => {
    if (!user?.id) return;
    await fetchDecks(user.id);
  }, [user?.id, fetchDecks]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadDecks();
    setRefreshing(false);
  };

  const handleCreateDeck = async () => {
    const name = deckName.trim();
    if (!name || !user?.id) return;
    setCreating(true);
    try {
      const deck = await createDeck(name, undefined, user.id);
      setCreateOpen(false);
      setDeckName('');
      navigation.navigate('DeckDetail', { deckId: deck.id, deckName: deck.name });
    } finally {
      setCreating(false);
    }
  };

  const openAiForDeck = (deckId: string) => {
    setAiDeckId(deckId);
    setAiModalOpen(true);
  };

  const handleAIGenerated = async (generated: AIGeneratedFlashcard[]) => {
    if (!user?.id || !aiDeckId || generated.length === 0) return;
    for (const card of generated) {
      await createFlashcard({
        deckId: aiDeckId,
        userId: user.id,
        type: FlashcardType.BASIC,
        front: card.front,
        back: card.back,
      });
    }
    Alert.alert('Success', `Added ${generated.length} flashcards to the deck.`);
    setAiModalOpen(false);
    setAiDeckId(null);
  };

  const dueCount = useMemo(() => decks.reduce((s, d) => s + (d.due_count || 0), 0), [decks]);

  const Wrapper = embedded ? View : SafeAreaView;
  const wrapperProps = embedded ? { className: 'flex-1 bg-lantern-background' } : { className: 'flex-1 bg-lantern-background', edges: ['top'] as const };

  return (
    <Wrapper {...wrapperProps}>
      {embedded && (
        <View className="flex-row flex-wrap gap-2 justify-end px-4 pt-3">
          {dueCount > 0 ? (
            <Button
              size="sm"
              variant="accent"
              onPress={() => {
                const deckWithDue = decks.find(d => (d.due_count || 0) > 0);
                if (deckWithDue) {
                  navigation.navigate('FlashcardReview', { deckId: deckWithDue.id, deckName: deckWithDue.name });
                }
              }}
            >
              Study due
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onPress={() => setImportOpen(true)}>
            Import
          </Button>
          <Button size="sm" onPress={() => setCreateOpen(true)}>
            + Deck
          </Button>
        </View>
      )}
      {!embedded && (
      <ScreenHeader
        title="Flashcards"
        subtitle={`${decks.length} deck${decks.length !== 1 ? 's' : ''}`}
        right={
          <View className="flex-row gap-1.5">
            <Button size="sm" variant="secondary" onPress={() => setImportOpen(true)}>
              Import
            </Button>
            <Button size="sm" onPress={() => setCreateOpen(true)}>
              + Deck
            </Button>
          </View>
        }
      />
      )}

      {!embedded && (
      <View className="flex-row gap-2 px-4 mb-3">
        <Pressable
          onPress={() => navigation.navigate('NotesList')}
          className="px-3 py-1.5 rounded-full bg-lantern-surface border border-lantern-border"
        >
          <Text className="text-xs font-medium text-lantern-text-secondary">Notes</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('TestsList')}
          className="px-3 py-1.5 rounded-full bg-lantern-surface border border-lantern-border"
        >
          <Text className="text-xs font-medium text-lantern-text-secondary">Tests</Text>
        </Pressable>
      </View>
      )}

      {error ? (
        <Pressable onPress={clearError} className="mx-4 mb-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800">
          <Text className="text-xs text-amber-800 dark:text-amber-200">{error}</Text>
        </Pressable>
      ) : null}

      {isLoading && decks.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={decks}
          keyExtractor={item => item.id}
          contentContainerClassName="px-4 pb-8"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              <Text className="text-lg font-semibold text-lantern-text mb-2">No decks yet</Text>
              <Text className="text-sm text-lantern-text-secondary text-center mb-6">
                Create your first deck to start studying with spaced repetition.
              </Text>
              <Button onPress={() => setCreateOpen(true)}>Create Deck</Button>
              <Button className="mt-2" variant="secondary" onPress={() => setImportOpen(true)}>
                Import deck
              </Button>
            </View>
          }
          renderItem={({ item, index }) => (
            <DeckCard
              deck={item}
              index={index}
              onPress={() => navigation.navigate('DeckDetail', { deckId: item.id, deckName: item.name })}
              onAIGenerate={() => openAiForDeck(item.id)}
              onStudy={() => navigation.navigate('FlashcardReview', { deckId: item.id, deckName: item.name })}
            />
          )}
        />
      )}

      <ImportAndStudyModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onOpenNote={noteId => navigation.navigate('NoteEditor', { noteId })}
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={() => setCreateOpen(false)}>
          <Pressable onPress={e => e.stopPropagation?.()}>
            <Card className="border-0 shadow-lg">
              <Text className="text-lg font-bold text-lantern-text mb-4">New Deck</Text>
              <TextInput
                value={deckName}
                onChangeText={setDeckName}
                placeholder="Deck name"
                placeholderTextColor="#94a3b8"
                autoFocus
                className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-background mb-4"
                placeholderTextColor={colors.inputPlaceholder}
              />
              <View className="flex-row gap-2">
                <Button variant="secondary" className="flex-1" onPress={() => setCreateOpen(false)}>
                  Cancel
                </Button>
                <Button className="flex-1" loading={creating} disabled={!deckName.trim()} onPress={handleCreateDeck}>
                  Create
                </Button>
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>

      {aiDeckId ? (
        <AIGenerateFlashcardsModal
          visible={aiModalOpen}
          onClose={() => {
            setAiModalOpen(false);
            setAiDeckId(null);
          }}
          onFlashcardsGenerated={handleAIGenerated}
        />
      ) : null}
    </Wrapper>
  );
}

export default FlashcardsScreen;
