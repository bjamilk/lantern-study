import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
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
import { useFeatureTipStore } from '../../stores/featureTipStore';
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
import {
  FlashcardType,
  FLASHCARD_MODE_LABELS,
  FLASHCARD_STAT_LABELS,
  getStudyCtaLabel,
} from '@lantern/shared';
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

function PracticeButton({
  label,
  subtitle,
  onPress,
  disabled,
}: {
  label: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`flex-1 min-w-[46%] rounded-2xl px-3 py-3 border border-lantern-border bg-lantern-surface ${disabled ? 'opacity-50' : 'active:opacity-90'}`}
    >
      <Text className="text-sm font-semibold text-lantern-text">{label}</Text>
      <Text className="text-[11px] text-lantern-text-secondary mt-0.5">{subtitle}</Text>
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
          <Text className="flex-1 text-sm text-lantern-text" numberOfLines={2}>
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
  const user = useAuthStore((s) => s.user);
  const {
    decks,
    flashcards,
    isLoading,
    fetchFlashcards,
    fetchDecks,
    setCurrentDeck,
    createFlashcard,
    updateFlashcard,
  } = useFlashcardStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);
  const [flashcardModalOpen, setFlashcardModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [moreModesOpen, setMoreModesOpen] = useState(false);

  const deck = useMemo(() => decks.find((d) => d.id === deckId), [decks, deckId]);
  const cards = flashcards[deckId] ?? [];
  const stats = useMemo(() => getDeckCardStats(deckId, flashcards), [deckId, flashcards]);
  const deckName = deck?.name ?? route.params?.deckName ?? 'Deck';
  const studyLabel = getStudyCtaLabel(stats.dueCards, stats.total);
  const hasCards = cards.length > 0;

  const loadCards = useCallback(async () => {
    if (!deckId) return;
    await fetchFlashcards(deckId);
  }, [deckId, fetchFlashcards]);

  useEffect(() => {
    if (deck) setCurrentDeck(deck);
    loadCards();
    return () => setCurrentDeck(null);
  }, [deck?.id, loadCards, setCurrentDeck]);

  useEffect(() => {
    const { setTipReady } = useFeatureTipStore.getState();
    setTipReady('flashcards.deckModes', true);
    return () => setTipReady('flashcards.deckModes', false);
  }, []);

  const navigateStudy = (screen: string, extraParams?: Record<string, unknown>) => {
    navigation.navigate(screen, { deckId, deckName, ...extraParams });
  };

  const startTimedCram = () => {
    Alert.alert(FLASHCARD_MODE_LABELS.timed_drill.label, 'Choose session length', [
      { text: '5 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 5 }) },
      { text: '10 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 10 }) },
      { text: '15 min', onPress: () => navigateStudy('CramSession', { timedMinutes: 15 }) },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
        Alert.alert(
          'Imported',
          `${(imported.flashcards as unknown[])?.length ?? 0} cards imported.`
        );
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

  const openManageDeck = () => {
    const options = [
      'Add card',
      'Generate with AI',
      'Import',
      'Export JSON',
      'Export CSV',
      'Collaborators',
      'Cancel',
    ] as const;
    const cancelButtonIndex = options.length - 1;

    if (Platform.OS === 'ios') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ActionSheetIOS } = require('react-native') as typeof import('react-native');
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: [...options],
          cancelButtonIndex,
          title: 'Manage deck',
        },
        (buttonIndex) => {
          if (buttonIndex === 0) openCreateCard();
          else if (buttonIndex === 1) setAiModalOpen(true);
          else if (buttonIndex === 2) void handleImport();
          else if (buttonIndex === 3) void handleExportJson();
          else if (buttonIndex === 4) void handleExportCsv();
          else if (buttonIndex === 5) setCollaboratorsOpen(true);
        }
      );
      return;
    }

    Alert.alert('Manage deck', undefined, [
      { text: 'Add card', onPress: openCreateCard },
      { text: 'Generate with AI', onPress: () => setAiModalOpen(true) },
      { text: 'Import', onPress: () => void handleImport() },
      { text: 'Export JSON', onPress: () => void handleExportJson() },
      { text: 'Export CSV', onPress: () => void handleExportCsv() },
      { text: 'Collaborators', onPress: () => setCollaboratorsOpen(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title={deckName}
        subtitle={deck?.description}
        right={
          <View className="flex-row items-center gap-1">
            <Button variant="ghost" size="sm" onPress={openManageDeck} accessibilityLabel="Manage deck">
              <Ionicons name="ellipsis-horizontal" size={20} color="#6366f1" />
            </Button>
            <Button variant="ghost" size="sm" onPress={() => navigation.goBack()}>
              Back
            </Button>
          </View>
        }
      />

      <View className="px-4 mb-4">
        <Button
          size="lg"
          disabled={!hasCards || exporting || importing}
          onPress={() => navigateStudy('FlashcardReview')}
          className="mb-1"
        >
          <View className="flex-row items-center justify-center gap-2">
            <Ionicons name="play-circle" size={20} color="#fff" />
            <Text className="text-base font-semibold text-white">{studyLabel}</Text>
          </View>
        </Button>
        <Text className="text-[11px] text-lantern-text-secondary mb-3 px-0.5">
          {FLASHCARD_MODE_LABELS.smart_review.subtitle}
        </Text>

        <View className="flex-row flex-wrap gap-2 mb-2">
          <PracticeButton
            label={FLASHCARD_MODE_LABELS.quiz.label}
            subtitle={FLASHCARD_MODE_LABELS.quiz.subtitle}
            disabled={!hasCards}
            onPress={() => navigateStudy('LearnStudy')}
          />
          <PracticeButton
            label={FLASHCARD_MODE_LABELS.match.label}
            subtitle={FLASHCARD_MODE_LABELS.match.subtitle}
            disabled={!hasCards}
            onPress={() => navigateStudy('MatchStudy')}
          />
        </View>

        <Pressable
          onPress={() => setMoreModesOpen((o) => !o)}
          className="rounded-2xl border border-lantern-border bg-lantern-surface px-3 py-3 mb-3 active:opacity-90"
        >
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-lantern-text">More ways to study</Text>
            <Ionicons
              name={moreModesOpen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color="#6b7280"
            />
          </View>
          {moreModesOpen && (
            <View className="flex-row flex-wrap gap-2 mt-3 pt-3 border-t border-lantern-border">
              <PracticeButton
                label={FLASHCARD_MODE_LABELS.speed_run.label}
                subtitle={FLASHCARD_MODE_LABELS.speed_run.subtitle}
                disabled={!hasCards}
                onPress={() => navigateStudy('CramSession')}
              />
              <PracticeButton
                label={FLASHCARD_MODE_LABELS.timed_drill.label}
                subtitle={FLASHCARD_MODE_LABELS.timed_drill.subtitle}
                disabled={!hasCards}
                onPress={startTimedCram}
              />
            </View>
          )}
        </Pressable>

        {hasCards && (
          <Card>
            <View className="flex-row gap-3">
              <View className="items-center flex-1">
                <Text className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                  {stats.dueCards}
                </Text>
                <Text className="text-[11px] text-lantern-text-secondary text-center mt-0.5">
                  {FLASHCARD_STAT_LABELS.readyToReview}
                </Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-xl font-bold text-violet-600 dark:text-violet-400">
                  {stats.newCards}
                </Text>
                <Text className="text-[11px] text-lantern-text-secondary text-center mt-0.5">
                  {FLASHCARD_STAT_LABELS.notStarted}
                </Text>
              </View>
              <View className="items-center flex-1">
                <Text className="text-xl font-bold text-lantern-primary">{stats.total}</Text>
                <Text className="text-[11px] text-lantern-text-secondary text-center mt-0.5">
                  {FLASHCARD_STAT_LABELS.total}
                </Text>
              </View>
            </View>
          </Card>
        )}
      </View>

      <View className="px-4 pb-2">
        <Text className="text-sm font-semibold text-lantern-text">Cards ({cards.length})</Text>
      </View>

      {isLoading && cards.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerClassName="px-4 pb-8"
          ListEmptyComponent={
            <Card className="py-6">
              <Text className="text-base font-semibold text-lantern-text mb-1">Get this deck ready</Text>
              <Text className="text-sm text-lantern-text-secondary mb-4">
                Add a few cards, then tap Study for a smart review.
              </Text>
              <Text className="text-xs font-semibold text-lantern-text mb-2">1. Add cards</Text>
              <View className="flex-row flex-wrap gap-2 mb-4">
                <Button size="sm" onPress={openCreateCard}>
                  Add manually
                </Button>
                <Button size="sm" variant="secondary" onPress={() => setAiModalOpen(true)}>
                  Generate with AI
                </Button>
              </View>
              <Text className="text-xs font-semibold text-lantern-text-secondary">2. Study</Text>
              <Text className="text-[11px] text-lantern-text-secondary mt-1">
                The Study button unlocks once this deck has cards.
              </Text>
            </Card>
          }
          renderItem={({ item }) => (
            <FlashcardPreview card={item} onPress={() => openEditCard(item)} />
          )}
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
