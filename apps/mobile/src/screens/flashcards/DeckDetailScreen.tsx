import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { shareTextFile, toSafeFileName, SharingUnavailableError } from '../../utils/shareFile';
import { useAuthStore, useFlashcardStore, type Flashcard } from '../../stores';
import { useFeatureTipStore } from '../../stores/featureTipStore';
import {
  exportDeck,
  exportDeckCsv,
  importDeck,
  importDeckCsv,
  importDeckApkg,
  resetDeckStatistics,
} from '../../services/api';
import { ActionSheet, Button, Card, ScreenHeader, type ActionSheetItem } from '../../components/ui';
import { CoursePicker } from '../../components/CoursePicker';
import { confirmSheet } from '../../stores/confirmStore';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import CollaboratorsModal from '../../components/CollaboratorsModal';
import { PublishStudyPackModal } from '../settings/PublishStudyPackModal';
import CreateFlashcardModal, { type FlashcardDraft } from '../../components/CreateFlashcardModal';
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

const MAX_PREVIEW_TAGS = 4;

function FlashcardPreview({ card, onPress }: { card: Flashcard; onPress: () => void }) {
  const { front } = getCardDisplayText(card);
  const status = getCardStatus(card);
  const tags = Array.isArray(card.tags) ? card.tags.filter(Boolean) : [];

  // The row is a single Pressable rather than a Pressable wrapping a Card. The
  // nested version did not register taps on Android at all — the press never
  // reached onPress — so the card styling is applied directly here and there is
  // only one view in the touch path.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={front}
      className="mb-2 px-4 py-3 rounded-lantern-xl border border-lantern-border bg-lantern-surface active:opacity-90"
    >
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
      {tags.length > 0 ? (
        <View className="flex-row flex-wrap items-center gap-1 mt-1.5" accessibilityLabel={`Tags: ${tags.join(', ')}`}>
          {tags.slice(0, MAX_PREVIEW_TAGS).map((tag) => (
            <View key={tag} className="px-1.5 py-0.5 rounded-full bg-lantern-background-secondary">
              <Text className="text-[10px] text-lantern-text-secondary">#{tag}</Text>
            </View>
          ))}
          {tags.length > MAX_PREVIEW_TAGS ? (
            <Text className="text-[10px] text-lantern-text-tertiary">+{tags.length - MAX_PREVIEW_TAGS}</Text>
          ) : null}
        </View>
      ) : null}
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
    deleteFlashcard,
    updateDeck,
    deleteDeck,
    offlineDeckIds,
    markDeckOffline,
    unmarkDeckOffline,
  } = useFlashcardStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  const [collaboratorsOpen, setCollaboratorsOpen] = useState(false);
  const [flashcardModalOpen, setFlashcardModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [moreModesOpen, setMoreModesOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [editDeckOpen, setEditDeckOpen] = useState(false);
  const [deckDraftName, setDeckDraftName] = useState('');
  const [deckDraftDescription, setDeckDraftDescription] = useState('');
  const [deckDraftCourseId, setDeckDraftCourseId] = useState<string | null>(null);
  const [savingDeck, setSavingDeck] = useState(false);
  /** "Move to course…" from the manage sheet (CoursePicker in controlled mode). */
  const [courseMoveOpen, setCourseMoveOpen] = useState(false);

  const deck = useMemo(() => decks.find((d) => d.id === deckId), [decks, deckId]);
  const cards = flashcards[deckId] ?? [];
  const stats = useMemo(() => getDeckCardStats(deckId, flashcards), [deckId, flashcards]);
  const deckName = deck?.name ?? route.params?.deckName ?? 'Deck';
  const studyLabel = getStudyCtaLabel(stats.dueCards, stats.total);
  const hasCards = cards.length > 0;
  const isOffline = offlineDeckIds.includes(deckId);

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

  const handleFlashcardSubmit = async (data: FlashcardDraft) => {
    if (!user?.id) return;
    // Cloze rows must carry null front/back — the database's
    // check_flashcard_fields constraint rejects empty strings there.
    const payload =
      data.type === FlashcardType.CLOZE
        ? { type: FlashcardType.CLOZE, clozeText: data.clozeText, front: null, back: null }
        : data.type === FlashcardType.IMAGE_OCCLUSION
          ? {
              type: FlashcardType.IMAGE_OCCLUSION,
              front: data.front ?? null,
              back: null,
              clozeText: null,
              imageUrl: data.imageUrl,
              occlusionData: data.occlusionData,
            }
          : {
              type: FlashcardType.BASIC,
              front: data.front,
              back: data.back,
              clozeText: null,
              imageUrl: data.imageUrl ?? null,
            };

    // Tags ride along for every card type; the modal always sends an array so
    // clearing the field on edit actually clears them (PUT accepts `tags`).
    const tags = data.tags;

    if (editingCard) {
      await updateFlashcard(editingCard.id, deckId, { ...payload, ...(tags ? { tags } : {}) }, user.id);
      setEditingCard(null);
      return;
    }
    await createFlashcard({
      deckId,
      userId: user.id,
      type: payload.type,
      front: payload.front ?? undefined,
      back: payload.back ?? undefined,
      clozeText: payload.clozeText ?? undefined,
      imageUrl: ('imageUrl' in payload ? payload.imageUrl : undefined) ?? undefined,
      occlusionData: 'occlusionData' in payload ? payload.occlusionData : undefined,
      tags,
    });
  };

  const handleMoveToCourse = async (course: { id: string } | null) => {
    if (!user?.id || !deckId) return;
    try {
      await updateDeck(deckId, { courseId: course?.id ?? null }, user.id);
    } catch (e) {
      Alert.alert('Could not move deck', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCourseMoveOpen(false);
    }
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
      await shareTextFile({
        fileName: toSafeFileName(deckName || 'deck', 'json'),
        contents: JSON.stringify(data, null, 2),
        dialogTitle: `Share ${deckName}`,
      });
    } catch (e: unknown) {
      if (e instanceof SharingUnavailableError) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
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
      await shareTextFile({
        fileName: toSafeFileName(deckName || 'deck', 'csv'),
        contents: csv,
        dialogTitle: `Share ${deckName}`,
      });
    } catch (e: unknown) {
      if (e instanceof SharingUnavailableError) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
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

  const openEditDeck = () => {
    setDeckDraftName(deck?.name ?? deckName);
    setDeckDraftDescription(deck?.description ?? '');
    setDeckDraftCourseId(deck?.course_id ?? null);
    setEditDeckOpen(true);
  };

  const handleSaveDeck = async () => {
    if (!user?.id || !deckId) return;
    const name = deckDraftName.trim();
    if (!name) return;
    setSavingDeck(true);
    try {
      const courseChanged = (deck?.course_id ?? null) !== deckDraftCourseId;
      await updateDeck(
        deckId,
        {
          name,
          description: deckDraftDescription.trim(),
          ...(courseChanged ? { courseId: deckDraftCourseId } : {}),
        },
        user.id
      );
      setEditDeckOpen(false);
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSavingDeck(false);
    }
  };

  const handleDeleteDeck = async () => {
    if (!user?.id || !deckId) return;
    const ok = await confirmSheet({
      title: 'Delete deck?',
      message: `"${deckName}" and its ${stats.total} card${stats.total === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDeck(deckId, user.id);
      navigation.goBack();
    } catch (e) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleResetProgress = async () => {
    if (!user?.id || !deckId) return;
    const ok = await confirmSheet({
      title: 'Reset progress?',
      message:
        'Every card in this deck goes back to new. Your review history for the deck is cleared, but the cards themselves are kept.',
      confirmLabel: 'Reset',
      danger: true,
    });
    if (!ok) return;
    try {
      await resetDeckStatistics(deckId, user.id);
      await loadCards();
      await fetchDecks(user.id);
      Alert.alert('Progress reset', 'All cards in this deck are new again.');
    } catch (e) {
      Alert.alert('Could not reset', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleToggleOffline = async () => {
    if (!user?.id || !deckId) return;
    try {
      if (isOffline) {
        await unmarkDeckOffline(deckId);
      } else {
        await markDeckOffline(deckId, user.id);
      }
    } catch (e) {
      Alert.alert('Offline change failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  const handleDeleteCard = async (card: Flashcard) => {
    if (!user?.id || !deckId) return;
    const { front } = getCardDisplayText(card);
    const ok = await confirmSheet({
      title: 'Delete card?',
      message: front.length > 80 ? `${front.slice(0, 80)}…` : front,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteFlashcard(card.id, deckId, user.id);
      setFlashcardModalOpen(false);
      setEditingCard(null);
    } catch (e) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  // One sheet for both platforms. This used to branch: ActionSheetIOS on iOS and
  // Alert.alert on Android — but Android's dialog caps at three buttons and drops
  // the rest without warning, so Export JSON, Export CSV and Collaborators were
  // simply unreachable there while iOS showed all seven.
  const manageItems: ActionSheetItem[] = [
    { section: 'Cards', label: 'Add card', icon: 'add-circle-outline', onPress: openCreateCard },
    {
      section: 'Cards',
      label: 'Generate with AI',
      icon: 'sparkles-outline',
      onPress: () => setAiModalOpen(true),
    },
    // Offline and export sit directly under Cards rather than at the bottom:
    // buried below eight other rows they were effectively undiscoverable.
    {
      section: 'Share & offline',
      label: isOffline ? 'Remove from offline' : 'Save for offline',
      icon: isOffline ? 'cloud-offline-outline' : 'cloud-download-outline',
      hint: isOffline
        ? 'Stop keeping this deck on the device'
        : 'Study this deck without a connection',
      onPress: () => void handleToggleOffline(),
    },
    {
      section: 'Share & offline',
      label: 'Export JSON',
      icon: 'share-outline',
      hint: 'Send this deck to another Lantern user',
      onPress: () => void handleExportJson(),
    },
    {
      section: 'Share & offline',
      label: 'Export CSV',
      icon: 'share-outline',
      onPress: () => void handleExportCsv(),
    },
    ...(hasCards
      ? [
          {
            section: 'Share & offline',
            label: 'Sell as study pack…',
            icon: 'storefront-outline',
            hint: 'List these flashcards on the Marketplace',
            onPress: () => setTimeout(() => setSellOpen(true), 50),
          } as ActionSheetItem,
        ]
      : []),
    {
      section: 'Share & offline',
      label: 'Import',
      icon: 'download-outline',
      hint: 'JSON, CSV or Anki .apkg',
      onPress: () => void handleImport(),
    },
    {
      section: 'Share & offline',
      label: 'Collaborators',
      icon: 'people-outline',
      onPress: () => setCollaboratorsOpen(true),
    },
    { section: 'Deck', label: 'Edit deck', icon: 'pencil-outline', onPress: openEditDeck },
    {
      section: 'Deck',
      label: 'Move to course…',
      icon: 'school-outline',
      hint: deck?.course_id ? 'Filed under a course — pick another or clear it' : 'File this deck under a course',
      // Let the sheet dismiss before the course picker mounts.
      onPress: () => setTimeout(() => setCourseMoveOpen(true), 50),
    },
    {
      section: 'Deck',
      label: 'Reset progress',
      icon: 'refresh-outline',
      hint: 'Send every card back to new',
      destructive: true,
      onPress: () => void handleResetProgress(),
    },
    {
      section: 'Deck',
      label: 'Delete deck',
      icon: 'trash-outline',
      destructive: true,
      onPress: () => void handleDeleteDeck(),
    },
  ];

  const openManageDeck = () => setManageOpen(true);

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
              {/* Only shown when the deck actually has some, so a healthy deck
                  is not given a permanent zero to worry about. */}
              {stats.trickyCards > 0 ? (
                <View className="items-center flex-1">
                  <Text className="text-xl font-bold text-amber-600 dark:text-amber-400">
                    {stats.trickyCards}
                  </Text>
                  <Text className="text-[11px] text-lantern-text-secondary text-center mt-0.5">
                    {FLASHCARD_STAT_LABELS.trickyCards}
                  </Text>
                </View>
              ) : null}
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
        userId={user?.id}
        deckId={deckId}
        editingFlashcard={editingCard}
        onSubmit={handleFlashcardSubmit}
        onDelete={editingCard ? () => void handleDeleteCard(editingCard) : undefined}
      />

      <ActionSheet
        visible={manageOpen}
        title="Manage deck"
        items={manageItems}
        onClose={() => setManageOpen(false)}
      />

      <PublishStudyPackModal
        visible={sellOpen}
        onClose={() => setSellOpen(false)}
        defaultTitle={deck?.name}
        defaultCourseId={deck?.course_id ?? null}
        content={{
          flashcards: cards
            .map((c) => {
              const { front, back } = getCardDisplayText(c);
              return {
                front,
                back,
                tags: Array.isArray(c.tags) ? (c.tags.filter(Boolean) as string[]) : undefined,
              };
            })
            .filter((c) => c.front.trim().length > 0),
        }}
      />

      <CoursePicker
        visible={courseMoveOpen}
        onClose={() => setCourseMoveOpen(false)}
        value={deck?.course_id ?? null}
        onChange={(course) => void handleMoveToCourse(course)}
        title="Move to course"
        placeholder="Choose a course"
      />

      <Modal transparent visible={editDeckOpen} animationType="fade" onRequestClose={() => setEditDeckOpen(false)}>
        <Pressable className="flex-1 bg-black/40 justify-center px-6" onPress={() => setEditDeckOpen(false)}>
          <Pressable onPress={(e) => e.stopPropagation?.()}>
            <Card>
              <Text className="text-lg font-bold text-lantern-text mb-3">Edit deck</Text>
              <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Name</Text>
              <TextInput
                value={deckDraftName}
                onChangeText={setDeckDraftName}
                placeholder="Deck name"
                placeholderTextColor="#94a3b8"
                className="border border-lantern-border rounded-xl px-3 py-2 mb-3 text-lantern-text"
              />
              <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Description</Text>
              <TextInput
                value={deckDraftDescription}
                onChangeText={setDeckDraftDescription}
                placeholder="Optional"
                placeholderTextColor="#94a3b8"
                multiline
                className="border border-lantern-border rounded-xl px-3 py-2 mb-3 text-lantern-text"
              />
              <Text className="text-xs font-medium text-lantern-text-secondary mb-1">Course (optional)</Text>
              <View className="mb-4">
                <CoursePicker
                  value={deckDraftCourseId}
                  onChange={course => setDeckDraftCourseId(course?.id ?? null)}
                  placeholder="File this deck under a course"
                  title="Course for this deck"
                />
              </View>
              <View className="flex-row gap-2">
                <Button variant="secondary" className="flex-1" onPress={() => setEditDeckOpen(false)}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  loading={savingDeck}
                  disabled={!deckDraftName.trim()}
                  onPress={() => void handleSaveDeck()}
                >
                  Save
                </Button>
              </View>
            </Card>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

export default DeckDetailScreen;
