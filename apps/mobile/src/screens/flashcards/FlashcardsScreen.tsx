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
import { ActionSheet, Button, Card, ScreenHeader, type ActionSheetItem } from '../../components/ui';
import { useUIStore } from '../../stores/uiStore';
import { matchesCourseFilter, matchesTopicFilter, UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import type { Course, CourseTopic } from '@lantern/shared/types';
import { useTheme } from '../../theme';
import { featureAccents } from '@lantern/shared/design';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { exportDeck } from '../../services/api';
import { shareTextFile, toSafeFileName, SharingUnavailableError } from '../../utils/shareFile';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import { COURSE_TOPIC_COPY, FlashcardType, getDeckListStatsLine, getStudyCtaLabel } from '@lantern/shared';
import type { AIGeneratedFlashcard } from '../../services/ai';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { courseHasTopics } from '../../services/academic';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
};

interface Props {
  navigation: NavigationProp;
  embedded?: boolean;
  /**
   * Embedded only: the Library's search box, which narrows this list in place.
   * See the same prop on NotesScreen for why typing filters rather than
   * handing off to the server search.
   */
  listQuery?: string;
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
  isOffline,
  onToggleOffline,
  onShare,
  onMore,
}: {
  deck: Deck;
  index: number;
  onPress: () => void;
  onAIGenerate: () => void;
  onStudy?: () => void;
  isOffline?: boolean;
  onToggleOffline?: () => void;
  onShare?: () => void;
  /** Row action sheet (Move to course…, offline, share). Also on long-press. */
  onMore?: () => void;
}) {
  const cardCount = deck.card_count ?? 0;
  const dueCount = deck.due_count ?? 0;
  const gradient = ACCENT_GRADIENTS[index % ACCENT_GRADIENTS.length];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      delayLongPress={350}
      className="mb-3 active:opacity-90"
      accessibilityRole="button"
      accessibilityLabel={`Deck ${deck.name}`}
      accessibilityHint={onMore ? 'Long press for more actions' : undefined}
    >
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
          <View className="flex-row items-center gap-1.5 ml-2 flex-shrink-0">
            {dueCount > 0 ? (
              <View className="bg-white/25 px-2 py-0.5 rounded-full">
                <Text className="text-[10px] font-bold text-white">{dueCount} due</Text>
              </View>
            ) : null}
            <Pressable
              onPress={e => {
                e.stopPropagation?.();
                onToggleOffline?.();
              }}
              accessibilityRole="button"
              accessibilityLabel={isOffline ? 'Remove from offline' : 'Save for offline'}
              className="px-2 py-1 rounded-full bg-white/20"
              hitSlop={8}
            >
              <Ionicons
                name={isOffline ? 'cloud-done' : 'cloud-download-outline'}
                size={14}
                color="#ffffff"
              />
            </Pressable>
            <Pressable
              onPress={e => {
                e.stopPropagation?.();
                onShare?.();
              }}
              accessibilityRole="button"
              accessibilityLabel="Share this deck"
              className="px-2 py-1 rounded-full bg-white/20"
              hitSlop={8}
            >
              <Ionicons name="share-outline" size={14} color="#ffffff" />
            </Pressable>
            <Pressable
              onPress={e => {
                e.stopPropagation?.();
                onAIGenerate();
              }}
              className="flex-row items-center gap-1 px-2 py-1 rounded-full bg-white/20"
              hitSlop={8}
            >
              <Ionicons name="sparkles-outline" size={14} color="#ffffff" />
              <Text className="text-[10px] font-bold text-white">Generate</Text>
            </Pressable>
            {onMore ? (
              <Pressable
                onPress={e => {
                  e.stopPropagation?.();
                  onMore();
                }}
                accessibilityRole="button"
                accessibilityLabel={`More actions for ${deck.name}`}
                className="px-2 py-1 rounded-full bg-white/20"
                hitSlop={8}
              >
                <Ionicons name="ellipsis-horizontal" size={14} color="#ffffff" />
              </Pressable>
            ) : null}
          </View>
        </LinearGradient>
        <View className="px-4 py-3">
          {deck.description ? (
            <Text className="text-xs text-lantern-text-secondary mb-2" numberOfLines={2}>
              {deck.description}
            </Text>
          ) : null}
          <Text className="text-xs text-lantern-text-secondary mb-3">
            {getDeckListStatsLine(dueCount, cardCount)}
          </Text>
          {onStudy ? (
            <Pressable
              onPress={e => {
                e.stopPropagation?.();
                onStudy();
              }}
              className="px-4 py-2.5 rounded-xl bg-amber-500 active:opacity-90"
            >
              <Text className="text-sm font-bold text-white text-center">
                {getStudyCtaLabel(dueCount, cardCount)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export function FlashcardsScreen({ navigation, embedded = false, listQuery = '' }: Props) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(embedded ? 16 : 8);
  const user = useAuthStore(s => s.user);
  const {
    decks,
    isLoading,
    error,
    fetchDecks,
    createDeck,
    createFlashcard,
    clearError,
    offlineDeckIds,
    markDeckOffline,
    unmarkDeckOffline,
  } = useFlashcardStore();
  /** Cards cached per deck; what the in-place search can match without the API. */
  const cardsByDeck = useFlashcardStore(s => s.flashcards);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deckName, setDeckName] = useState('');
  const [deckCourseId, setDeckCourseId] = useState<string | null>(null);
  const [deckTopicId, setDeckTopicId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [aiDeckId, setAiDeckId] = useState<string | null>(null);
  const [aiModalOpen, setAiModalOpen] = useState(false);
  /** Deck whose row action sheet is open. */
  const [deckActions, setDeckActions] = useState<Deck | null>(null);
  /** Deck being moved via "Move to course…". */
  const [courseMoveDeck, setCourseMoveDeck] = useState<Deck | null>(null);
  /**
   * Deck being filed via "Move to topic…". A topic needs its course, so this
   * opens either from a deck that already has one or as the second step of a
   * course move.
   */
  const [topicMoveDeck, setTopicMoveDeck] = useState<{ deck: Deck; courseId: string } | null>(null);

  // Library archive: course filter picked in the Library tree. Decks load whole
  // into the shared store and narrow client-side here on the course_id/topic_id
  // every row carries — deliberately, so other readers keep the full list.
  const courseFilter = useUIStore(s => s.libraryCourseFilter);
  const setCourseFilter = useUIStore(s => s.setLibraryCourseFilter);
  const courseFilterId = courseFilter?.id ?? null;
  /** Topic inside that course (Phase 1 · A); only meaningful with a real course. */
  const topicFilterId = courseFilter?.topicId ?? null;
  const defaultCourseId =
    courseFilterId && courseFilterId !== UNFILED_COURSE_ID ? courseFilterId : null;
  /** UNTOPICED_TOPIC_ID is the string 'null' (truthy) — a filter, never a real topic to file under. */
  const defaultTopicId =
    defaultCourseId && topicFilterId && topicFilterId !== UNTOPICED_TOPIC_ID ? topicFilterId : null;
  const { updateDeck } = useFlashcardStore();

  const loadDecks = useCallback(async () => {
    if (!user?.id) return;
    await fetchDecks(user.id);
  }, [user?.id, fetchDecks]);

  useEffect(() => {
    loadDecks();
  }, [loadDecks]);

  // New decks default to the course — and the topic — the Library is filtered to.
  useEffect(() => {
    if (createOpen) {
      setDeckCourseId(defaultCourseId);
      setDeckTopicId(defaultTopicId);
    }
  }, [createOpen, defaultCourseId, defaultTopicId]);

  const deckQuery = listQuery.trim().toLowerCase();
  const visibleDecks = useMemo(() => {
    let list = decks;
    if (courseFilterId) {
      list = list.filter(d => matchesCourseFilter(d.course_id, courseFilterId));
      if (topicFilterId) list = list.filter(d => matchesTopicFilter(d.topic_id, topicFilterId));
    }
    if (!deckQuery) return list;
    // Cards as well as the deck's own name: "enzyme" means the cards, and the
    // ones already cached on this device are searchable with the API down.
    return list.filter(
      d =>
        d.name.toLowerCase().includes(deckQuery) ||
        Boolean(d.description && d.description.toLowerCase().includes(deckQuery)) ||
        (cardsByDeck[d.id] || []).some(
          c =>
            (c.front || '').toLowerCase().includes(deckQuery) ||
            (c.back || '').toLowerCase().includes(deckQuery) ||
            (c.clozeText || '').toLowerCase().includes(deckQuery)
        )
    );
  }, [decks, courseFilterId, topicFilterId, deckQuery, cardsByDeck]);

  const handleMoveDeckToCourse = async (course: Course | null) => {
    const deck = courseMoveDeck;
    if (!deck || !user?.id) return;
    const nextCourseId = course?.id ?? null;
    try {
      // The topic always goes with the course: a deck landing in a new course
      // cannot keep a topic from the old one.
      await updateDeck(deck.id, { courseId: nextCourseId, topicId: null }, user.id);
      // Second step: now the course is known, offer its syllabus outline — but
      // only when there is one, so filing a deck under a course with no outline
      // costs no extra dismissal.
      if (nextCourseId) {
        void courseHasTopics(nextCourseId).then(hasTopics => {
          if (hasTopics) setTimeout(() => setTopicMoveDeck({ deck, courseId: nextCourseId }), 50);
        });
      }
    } catch (e) {
      Alert.alert('Could not move deck', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setCourseMoveDeck(null);
    }
  };

  const handleMoveDeckToTopic = async (topic: CourseTopic | null) => {
    const target = topicMoveDeck;
    if (!target || !user?.id) return;
    try {
      await updateDeck(target.deck.id, { topicId: topic?.id ?? null }, user.id);
    } catch (e) {
      Alert.alert('Could not move deck', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setTopicMoveDeck(null);
    }
  };

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
      const deck = await createDeck(name, undefined, user.id, {
        courseId: deckCourseId,
        topicId: deckTopicId,
      });
      setCreateOpen(false);
      setDeckName('');
      setDeckCourseId(null);
      setDeckTopicId(null);
      navigation.navigate('DeckDetail', { deckId: deck.id, deckName: deck.name });
    } finally {
      setCreating(false);
    }
  };

  const openAiForDeck = (deckId: string) => {
    setAiDeckId(deckId);
    setAiModalOpen(true);
  };

  const handleToggleOffline = async (deckId: string) => {
    if (!user?.id) return;
    try {
      if (offlineDeckIds.includes(deckId)) await unmarkDeckOffline(deckId);
      else await markDeckOffline(deckId, user.id);
    } catch (e) {
      Alert.alert('Offline change failed', e instanceof Error ? e.message : 'Please try again.');
    }
  };

  /** Share the deck as JSON so another Lantern user can import it. */
  const handleShareDeck = async (deckId: string, name: string) => {
    try {
      const data = await exportDeck(deckId);
      await shareTextFile({
        fileName: toSafeFileName(name || 'deck', 'json'),
        contents: JSON.stringify(data, null, 2),
        dialogTitle: `Share ${name}`,
      });
    } catch (e) {
      if (e instanceof SharingUnavailableError) {
        Alert.alert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      Alert.alert('Export failed', e instanceof Error ? e.message : 'Could not export deck');
    }
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

  const deckActionItems: ActionSheetItem[] = deckActions
    ? [
        {
          section: 'Deck',
          label: 'Open deck',
          icon: 'layers-outline',
          onPress: () => navigation.navigate('DeckDetail', { deckId: deckActions.id, deckName: deckActions.name }),
        },
        {
          section: 'Deck',
          label: getStudyCtaLabel(deckActions.due_count ?? 0, deckActions.card_count ?? 0),
          icon: 'play-circle-outline',
          onPress: () => navigation.navigate('FlashcardReview', { deckId: deckActions.id, deckName: deckActions.name }),
        },
        {
          section: 'Organise',
          label: 'Move to course…',
          icon: 'school-outline',
          hint: deckActions.course_id ? 'Filed under a course — pick another or clear it' : 'Not filed under a course yet',
          // Let the sheet dismiss before the course picker mounts.
          onPress: () => setTimeout(() => setCourseMoveDeck(deckActions), 50),
        },
        // Only offered once the deck has a course: a topic without its course
        // is rejected server-side.
        ...(deckActions.course_id
          ? [
              {
                section: 'Organise',
                label: 'Move to topic…',
                icon: 'list-outline' as ActionSheetItem['icon'],
                hint: 'Where this sits in the course outline',
                onPress: () =>
                  setTimeout(
                    () =>
                      setTopicMoveDeck({
                        deck: deckActions,
                        courseId: deckActions.course_id as string,
                      }),
                    50,
                  ),
              },
            ]
          : []),
        {
          section: 'Organise',
          label: offlineDeckIds.includes(deckActions.id) ? 'Remove from offline' : 'Save for offline',
          icon: offlineDeckIds.includes(deckActions.id) ? 'cloud-offline-outline' : 'cloud-download-outline',
          onPress: () => void handleToggleOffline(deckActions.id),
        },
        {
          section: 'Organise',
          label: 'Share as JSON',
          icon: 'share-outline',
          onPress: () => void handleShareDeck(deckActions.id, deckActions.name),
        },
      ]
    : [];

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

      {courseFilter && !embedded ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2">
          <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background">
            <Ionicons name="school-outline" size={14} color={colors.primary} />
            <Text className="text-xs font-semibold text-lantern-primary" numberOfLines={1}>
              {courseFilter.label}
            </Text>
            <Pressable
              onPress={() => setCourseFilter(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear course filter ${courseFilter.label}`}
            >
              <Ionicons name="close-circle" size={16} color={colors.primary} />
            </Pressable>
          </View>
          {/* The topic narrows the list further, so it gets its own chip:
              the course chip alone makes a shorter list look like missing decks. */}
          {courseFilter.topicId ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary">
              <Ionicons name="bookmark-outline" size={13} color={colors.textSecondary} />
              <Text className="text-xs font-medium text-lantern-text-secondary" numberOfLines={1}>
                {courseFilter.topicId === UNTOPICED_TOPIC_ID ? COURSE_TOPIC_COPY.none : courseFilter.topicLabel || COURSE_TOPIC_COPY.filterLabel}
              </Text>
              <Pressable
                // Clear the topic, keep the course.
                onPress={() => setCourseFilter({ id: courseFilter.id, label: courseFilter.label })}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear topic filter"
              >
                <Ionicons name="close-circle" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {isLoading && decks.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={visibleDecks}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListEmptyComponent={
            <View className="items-center py-16 px-6">
              {/* With a query typed, "No decks yet" would read as if the decks
                  had gone; say what did not match instead. */}
              <Text className="text-lg font-semibold text-lantern-text mb-2">
                {deckQuery
                  ? `No decks match “${listQuery.trim()}”`
                  : courseFilter && decks.length > 0
                    ? `No decks in ${courseFilter.label}`
                    : 'No decks yet'}
              </Text>
              <Text className="text-sm text-lantern-text-secondary text-center mb-6">
                {deckQuery
                  ? 'This searches deck names and the cards saved on this device. “Search everything” above also covers your notes and offline bundles.'
                  : courseFilter && decks.length > 0
                    ? 'Create a deck here, or use “Move to course…” on a deck to file it under this course.'
                    : 'Create your first deck to start studying with spaced repetition.'}
              </Text>
              {deckQuery ? null : (
                <>
                  <Button onPress={() => setCreateOpen(true)}>Create Deck</Button>
                  <Button className="mt-2" variant="secondary" onPress={() => setImportOpen(true)}>
                    Import deck
                  </Button>
                </>
              )}
            </View>
          }
          renderItem={({ item, index }) => (
            <DeckCard
              deck={item}
              index={index}
              onPress={() => navigation.navigate('DeckDetail', { deckId: item.id, deckName: item.name })}
              onAIGenerate={() => openAiForDeck(item.id)}
              onStudy={() => navigation.navigate('FlashcardReview', { deckId: item.id, deckName: item.name })}
              isOffline={offlineDeckIds.includes(item.id)}
              onToggleOffline={() => void handleToggleOffline(item.id)}
              onShare={() => void handleShareDeck(item.id, item.name)}
              onMore={() => setDeckActions(item)}
            />
          )}
        />
      )}

      <ActionSheet
        visible={!!deckActions}
        title={deckActions?.name ?? 'Deck'}
        items={deckActionItems}
        onClose={() => setDeckActions(null)}
      />

      <CoursePicker
        visible={!!courseMoveDeck}
        onClose={() => setCourseMoveDeck(null)}
        value={courseMoveDeck?.course_id ?? null}
        onChange={course => void handleMoveDeckToCourse(course)}
        title="Move to course"
        placeholder="Choose a course"
      />

      <TopicPicker
        visible={!!topicMoveDeck}
        onClose={() => setTopicMoveDeck(null)}
        courseId={topicMoveDeck?.courseId ?? null}
        value={topicMoveDeck?.deck.topic_id ?? null}
        onChange={topic => void handleMoveDeckToTopic(topic)}
        title="Move to topic"
        placeholder="Choose a topic"
      />

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
                autoFocus
                className="border border-lantern-border rounded-2xl px-4 py-3 text-lantern-text bg-lantern-background mb-3"
                placeholderTextColor={colors.inputPlaceholder}
              />
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Course (optional)</Text>
              <View className="mb-3">
                <CoursePicker
                  value={deckCourseId}
                  onChange={course => {
                    const nextCourseId = course?.id ?? null;
                    setDeckTopicId(topicIdAfterCourseChange(deckTopicId, deckCourseId, nextCourseId));
                    setDeckCourseId(nextCourseId);
                  }}
                  placeholder="File this deck under a course"
                  title="Course for this deck"
                />
              </View>
              <Text className="text-xs font-semibold text-lantern-text-secondary mb-1">Topic (optional)</Text>
              <View className="mb-4">
                <TopicPicker
                  courseId={deckCourseId}
                  value={deckTopicId}
                  onChange={topic => setDeckTopicId(topic?.id ?? null)}
                  placeholder="Which part of the syllabus?"
                  title="Topic for this deck"
                />
              </View>
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
