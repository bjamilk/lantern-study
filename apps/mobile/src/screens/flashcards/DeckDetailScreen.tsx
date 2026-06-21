import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Share,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore, useFlashcardStore, type Flashcard } from '../../stores';
import {
  exportDeck,
  exportDeckCsv,
  importDeck,
  importDeckCsv,
  importDeckApkg,
} from '../../services/api';
import { Button, Card, ScreenHeader } from '../../components/ui';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import CollaboratorsModal from '../../components/CollaboratorsModal';
import CreateFlashcardModal from '../../components/CreateFlashcardModal';
import { FlashcardType } from '@lantern/shared';
import type { AIGeneratedFlashcard } from '../../services/ai';
import { getCardDisplayText, getCardStatus, getDeckCardStats } from '../../utils/flashcardHelpers';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
};

interface Props {
  navigation: NavigationProp;
  route: { params?: { deckId?: string; deckName?: string } };
}

function StudyButton({
  label,
  subtitle,
  colorClass,
  onPress,
  disabled,
}: {
  label: string;
  subtitle: string;
  colorClass: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 min-w-[46%] rounded-2xl px-3 py-3 ${colorClass} ${disabled ? 'opacity-50' : 'active:opacity-90'}`}
    >
      <Text className="text-sm font-semibold text-white">{label}</Text>
      <Text className="text-[11px] text-white/80 mt-0.5">{subtitle}</Text>
    </Pressable>
  );
}

function FlashcardPreview({ card, onPress }: { card: Flashcard; onPress: () => void }) {
  const { front } = getCardDisplayText(card);
  const status = getCardStatus(card);

  return (
    <Pressable onPress={onPress}>
      <Card className="mb-2 py-3 active:opacity-90">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="flex-1 text-sm text-slate-800 dark:text-slate-100" numberOfLines={2}>
          {front}
        </Text>
        <View style={{ backgroundColor: `${status.color}22` }} className="px-2 py-0.5 rounded-full">
          <Text style={{ color: status.color }} className="text-[10px] font-semibold">
            {status.label}
          </Text>
        </View>
      </View>
    </Card>
    </Pressable>
  );
}

export function DeckDetailScreen({ navigation, route }: Props) {
  const deckId = route.params?.deckId ?? '';
  const user = useAuthStore(s => s.user);
  const { decks, flashcards, isLoading, fetchFlashcards, fetchDecks, setCurrentDeck, createFlashcard, updateFlashcard } =
    useFlashcardStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);
  const [flashcardModalOpen, setFlashcardModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);

  const deck = useMemo(() => decks.find(d => d.id === deckId), [decks, deckId]);
  const cards = flashcards[deckId] ?? [];
  const stats = useMemo(() => getDeckCardStats(deckId, flashcards), [deckId, flashcards]);
  const deckName = deck?.name ?? route.params?.deckName ?? 'Deck';

  const loadCards = useCallback(async () => {
    if (!deckId) return;
    await fetchFlashcards(deckId);
  }, [deckId, fetchFlashcards]);

  useEffect(() => {
    if (deck) setCurrentDeck(deck);
    loadCards();
    return () => setCurrentDeck(null);
  }, [deck?.id, loadCards, setCurrentDeck]);

  const navigateStudy = (screen: string, extraParams?: Record<string, unknown>) => {
    navigation.navigate(screen, { deckId, deckName, ...extraParams });
  };

  const startTimedCram = () => {
    Alert.alert(
      'Timed Cram',
      'Choose session length',
      [
        { text: '5 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 5 }) },
        { text: '10 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 10 }) },
        { text: '15 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 15 }) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handleAIGenerated = async (generated: AIGeneratedFlashcard[]) => {
    if (!user?.id || generated.length === 0) return;
    for (const card of generated) {
      await createFlashcard({
        deckId,
        userId: user.id,
        type: FlashcardType.BASIC,
        front: card.front,
        back: card.back,
      });
    }
    Alert.alert('Success', `Added ${generated.length} flashcards to the deck.`);
  };

  const handleFlashcardSubmit = async (data: { front: string; back: string }) => {
    if (!user?.id) return;
    if (editingCard) {
      await updateFlashcard(editingCard.id, deckId, { front: data.front, back: data.back }, user.id);
      setEditingCard(null);
      return;
    }
    await createFlashcard({
      deckId, 
      userId: user.id,
      type: FlashcardType.BASIC,
      front: data.front,
      back: data.back,
    });
  };

  const openCreateCard = () => {
    setEditingCard(null);
    setFlashcardModalOpen(true);
  };

  const openEditCard = (card: Flashcard) => {
    setEditingCard(card);
    setFlashcardModalOpen(true);
  };

  const handleExportJson = async () => {
    if (!deckId) return;
    setExporting(true);
    try {
      const data = await exportDeck(deckId);
      await Share.share({
        message: JSON.stringify(data, null, 2),
        title: `${deckName}.json`,
      });
    } catch (e: unknown) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not export deck');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    if (!deckId) return;
    setExporting(true);
    try {
      const csv = await exportDeckCsv(deckId);
      await Share.share({ message: csv, title: `${deckName}.csv` });
    } catch (e: unknown) {
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not export CSV');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    if (!user?.id) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      const name = asset.name?.toLowerCase() || '';
      setImporting(true);

      if (name.endsWith('.apkg')) {
        const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
        const imported = await importDeckApkg(base64, user.id);
        await fetchDecks(user.id);
        const newDeck = imported.deck as { id: string; name: string };
        navigation.navigate('DeckDetail', { deckId: newDeck.id, deckName: newDeck.name });
        Alert.alert('Imported', `Deck "${newDeck.name}" imported from APKG.`);
      } else if (name.endsWith('.csv')) {
        const csv = await FileSystem.readAsStringAsync(asset.uri);
        const imported = await importDeckCsv(csv, user.id, deckName);
        await fetchDecks(user.id);
        await loadCards();
        Alert.alert('Imported', `${(imported.flashcards as unknown[])?.length ?? 0} cards imported.`);
      } else {
        const text = await FileSystem.readAsStringAsync(asset.uri);
        const json = JSON.parse(text);
        const imported = await importDeck(json, user.id);
        await fetchDecks(user.id);
        const newDeck = imported.deck as { id: string; name: string };
        navigation.navigate('DeckDetail', { deckId: newDeck.id, deckName: newDeck.name });
        Alert.alert('Imported', `Deck "${newDeck.name}" imported.`);
      }
    } catch (e: unknown) {
      Alert.alert('Import failed', e instanceof Error ? e.message : 'Could not import file');
    } finally {
      setImporting(false);
    }
  };

  const hasCards = cards.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-slate-50 dark:bg-slate-900" edges={['top']}>
      <ScreenHeader
        title={deckName}
        subtitle={deck?.description}
        right={
          <View className="flex-row items-center gap-1">
            <Button variant="ghost" size="sm" onPress={() => setCollaboratorsOpen(true)}>
              <Ionicons name="people-outline" size={18} color="#6366f1" />
            </Button>
            <Button variant="ghost" size="sm" onPress={() => setAiModalOpen(true)}>
              <Ionicons name="sparkles-outline" size={18} color="#6366f1" />
            </Button>
            <Button size="sm" onPress={openCreateCard}>
              + Card
            </Button>
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Back
            </Button>
      </View>
        }
      />

      <View className="px-4 mb-4">
        <Card>
          <View className="flex-row flex-wrap gap-3">
            <View className="items-center flex-1 min-w-[22%]">
              <Text className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{stats.total}</Text>
              <Text className="text-[11px] text-slate-500 dark:text-slate-400">Total</Text>
            </View>
            <View className="items-center flex-1 min-w-[22%]">
              <Text className="text-xl font-bold text-amber-600 dark:text-amber-400">{stats.dueCards}</Text>
              <Text className="text-[11px] text-slate-500 dark:text-slate-400">Due</Text>
              </View>
            <View className="items-center flex-1 min-w-[22%]">
              <Text className="text-xl font-bold text-violet-600 dark:text-violet-400">{stats.newCards}</Text>
              <Text className="text-[11px] text-slate-500 dark:text-slate-400">New</Text>
            </View>
            <View className="items-center flex-1 min-w-[22%]">
              <Text className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{stats.mastered}</Text>
              <Text className="text-[11px] text-slate-500 dark:text-slate-400">Mastered</Text>
            </View>
          </View>
        </Card>

        <View className="flex-row flex-wrap gap-2 mt-3">
          <StudyButton
            label="Review"
            subtitle="Spaced repetition"
            colorClass="bg-indigo-500"
            disabled={!hasCards}
            onPress={() => navigateStudy('FlashcardReview')}
          />
          <StudyButton
            label="Cram"
            subtitle="Quick practice"
            colorClass="bg-amber-500"
            disabled={!hasCards}
            onPress={() => navigateStudy('CramSession')}
          />
          <StudyButton
            label="Timed Cram"
            subtitle="Countdown mode"
            colorClass="bg-orange-500"
            disabled={!hasCards}
            onPress={startTimedCram}
          />
          <StudyButton
            label="Match"
            subtitle="Pair terms"
            colorClass="bg-emerald-500"
            disabled={!hasCards}
            onPress={() => navigateStudy('MatchStudy')}
          />
          <StudyButton
            label="Learn"
            subtitle="Guided quiz"
            colorClass="bg-violet-500"
            disabled={!hasCards}
            onPress={() => navigateStudy('LearnStudy')}
          />
        </View>

        <View className="flex-row flex-wrap gap-2 mt-3">
          <View className="min-w-[46%]">
            <Button size="sm" variant="secondary" loading={exporting} onPress={() => void handleExportJson()}>
              Export JSON
            </Button>
            <Text className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 px-1">
              Full backup (images + progress)
            </Text>
          </View>
          <View className="min-w-[46%]">
            <Button size="sm" variant="secondary" loading={exporting} onPress={() => void handleExportCsv()}>
              Export CSV
            </Button>
            <Text className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 px-1">
              Spreadsheet (front/back only)
            </Text>
          </View>
          <Button size="sm" variant="secondary" loading={importing} onPress={() => void handleImport()}>
            Import
          </Button>
        </View>
      </View>

      <View className="px-4 pb-2">
        <Text className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Cards ({cards.length})
        </Text>
      </View>

      {isLoading && cards.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={item => item.id}
          contentContainerClassName="px-4 pb-8"
          ListEmptyComponent={
            <View className="items-center py-10">
              <Text className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                No flashcards in this deck yet.
              </Text>
              <Button onPress={openCreateCard}>Add first card</Button>
            </View>
          }
          renderItem={({ item }) => <FlashcardPreview card={item} onPress={() => openEditCard(item)} />}
        />
      )}

      <AIGenerateFlashcardsModal
        visible={aiModalOpen}
        onClose={() => setAiModalOpen(false)}
        onFlashcardsGenerated={handleAIGenerated}
      />

      <CollaboratorsModal
        visible={collaboratorsOpen}
        onClose={() => setCollaboratorsOpen(false)}
        deckId={deckId}
        currentUserId={user?.id}
      />

      <CreateFlashcardModal
        visible={flashcardModalOpen}
        onClose={() => {
          setFlashcardModalOpen(false);
          setEditingCard(null);
        }}
        editingFlashcard={editingCard}
        onSubmit={handleFlashcardSubmit}
      />
    </SafeAreaView>
  );
}

export default DeckDetailScreen;
