/**
 * The Flashcards deck list — the standalone screen and, with `embedded`, the
 * Library's Flashcards tab. Creates decks, imports cards, and carries the
 * per-row action sheet (study, generate, offline, share, move, delete).
 *
 * Main exports: `FlashcardsScreen` (also the default). `DeckCard` is local.
 * Touches: flashcardStore (decks, cached cards, offline marks, cover path),
 * authStore, uiStore (the Library course/topic filter), confirmStore;
 * services/api `exportDeck`, services/academic `courseHasTopics`, and the
 * job-progress sheet for AI generation. Native: the share sheet via
 * utils/shareFile; the file pickers live inside the import sheets.
 * Presentation rules (title, subtitle, study-first order) come from ./deckList.
 *
 * Gotchas: the course/topic filter narrows client-side on the `course_id` /
 * `topic_id` each row carries, deliberately, so the shared store keeps the full
 * list for other readers. `UNFILED_COURSE_ID` and `UNTOPICED_TOPIC_ID` are
 * filter sentinels (the latter is the truthy string 'null'), never real ids to
 * file under. Two import doors exist and are not the same price — the AI note
 * import costs a credit, the cards import is free. Moving a deck to another
 * course always clears its topic. Sheets are sequenced with `SHEET_DISMISS_MS`
 * so two modals are never on screen at once.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../components/layout';
import { useAuthStore, useFlashcardStore, type Deck } from '../../stores';
import { ActionSheet, Button, Card, ScreenHeader, T, type ActionSheetItem } from '../../components/ui';
import { FeatureDisc, smallTextInk, useFeatureAccent } from '../../components/ui/FeatureDisc';
import { useUIStore } from '../../stores/uiStore';
import { matchesCourseFilter, matchesTopicFilter, UNFILED_COURSE_ID, UNTOPICED_TOPIC_ID } from '../../utils/libraryArchive';
import type { Course, CourseTopic } from '@lantern/shared/types';
import { humanizeFailureMessage } from '@lantern/shared/network';
import { pluralize } from '@lantern/shared/utils';
import { useTheme } from '../../theme';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { exportDeck } from '../../services/api';
import { shareTextFile, toSafeFileName, SharingUnavailableError } from '../../utils/shareFile';
import AIGenerateFlashcardsModal from '../../components/AIGenerateFlashcardsModal';
import { ImportCardsSheet } from '../../components/flashcards';
import { JobProgressSheet } from '../../components/jobs';
import { COURSE_TOPIC_COPY, FlashcardType, getDeckListStatsLine, getStudyCtaLabel } from '@lantern/shared';
import type { AIGeneratedFlashcard } from '../../services/ai';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useChrome, useScrollToTopRequest } from '../../components/layout/ChromeContext';
import { CoursePicker } from '../../components/CoursePicker';
import { TopicPicker } from '../../components/TopicPicker';
import { courseHasTopics } from '../../services/academic';
import { topicIdAfterCourseChange } from '../../utils/topicSelection';
import { navigate as navigateRootStack } from '../../navigation/navigationRef';
import { confirmSheet } from '../../stores/confirmStore';
import { AppIcon } from '../../components/ui/AppIcon';
import {
  CoverFailureLine,
  CoverPicker,
  CoverThumb,
  SHEET_DISMISS_MS,
  useCoverPicker,
} from '../../components/ui/CoverPicker';
import { readCoverPath } from '../../components/ui/coverPickerModel';

import { toTab } from '../../navigation/nestedTab';
import { deckDisplaySubtitle, deckDisplayTitle, isLibraryFlashcardDeck, sortDecksForList } from './deckList';

type NavigationProp = {
  navigate: (screen: string, params?: Record<string, unknown>) => void;
  goBack: () => void;
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

/**
 * `DeckCard` — one deck in the Library's Flashcards list.
 *
 * Spec §5.6 "list row": a NEUTRAL card with a 40 px feature disc, not a
 * painted header. What shipped before was six rose/pink/magenta LINEAR
 * GRADIENTS keyed off the row index, four white-on-tint chip buttons riding
 * on them and an amber CTA underneath — a hue that means nothing (index is
 * not identity), a gradient (§5.8 forbids them outright), and the loudest
 * surface in the app sitting in a list whose budget is 3–6% chromatic
 * (device pass on build 159, D2).
 *
 * Now: lime, because lime IS flashcards, and only in the 40 px disc and the
 * due pill. The stats line carries the numbers in `tabular-nums`; the row
 * itself opens the deck; ONE primaryFill action studies it; everything else
 * (generate, offline, share, move, delete) lives in the row's action sheet,
 * which is where it was already reachable by long-press.
 */
function DeckCard({
  deck,
  onPress,
  onStudy,
  isOffline,
  onMore,
}: {
  deck: Deck;
  onPress: () => void;
  onStudy?: () => void;
  isOffline?: boolean;
  /** Row action sheet (study, generate, move, offline, share, delete). */
  onMore?: () => void;
}) {
  const { colors, isDark } = useTheme();
  const accent = useFeatureAccent('flashcards');
  const cardCount = deck.card_count ?? 0;
  const dueCount = deck.due_count ?? 0;
  // What a person reads, not what an uploader stored. See ./deckList.
  const title = deckDisplayTitle(deck);
  const subtitle = deckDisplaySubtitle(deck);
  const duePillInk = smallTextInk('flashcards', accent, isDark);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onMore}
      delayLongPress={350}
      className="mb-3 rounded-2xl border border-lantern-border bg-lantern-surface p-3 active:opacity-90"
      accessibilityRole="button"
      accessibilityLabel={`Deck ${title}. ${getDeckListStatsLine(dueCount, cardCount)}`}
      accessibilityHint={onMore ? 'Long press for more actions' : undefined}
    >
      <View className="flex-row items-center gap-3">
        {/* StudyFetch's row: when the deck has a cover, the picture fills the
            tile the pastel square occupied and the glyph becomes a badge on
            it. No cover and nothing changes — `CoverThumb` falls back to the
            same 40px FeatureDisc. */}
        <CoverThumb
          coverPath={readCoverPath(deck)}
          feature="flashcards"
          icon="layers"
          label="Flashcard deck"
        />
        <View className="flex-1 min-w-0">
          <View className="flex-row items-center gap-2">
            <T.Body style={{ fontWeight: '600' }} numberOfLines={1} className="flex-1">
              {title}
            </T.Body>
            {isOffline ? (
              <AppIcon
                name="cloud-done"
                size={14}
                color={accent.ink}
                accessibilityLabel="Saved for offline"
              />
            ) : null}
            {deck.is_shared ? (
              <T.Label tone="secondary" importantForAccessibility="no">
                Shared
              </T.Label>
            ) : null}
          </View>
          <T.Caption tone="secondary" tabular numberOfLines={1} importantForAccessibility="no">
            {getDeckListStatsLine(dueCount, cardCount)}
          </T.Caption>
        </View>
        {dueCount > 0 ? (
          <View
            style={{ backgroundColor: accent.tint }}
            className="px-2 py-0.5 rounded-full"
          >
            <T.Label
              tabular
              style={{ color: duePillInk, fontWeight: '700' }}
              importantForAccessibility="no"
            >
              {dueCount > 99 ? '99+' : dueCount} due
            </T.Label>
          </View>
        ) : null}
        {onMore ? (
          <Pressable
            onPress={e => {
              e.stopPropagation?.();
              onMore();
            }}
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${title}`}
            hitSlop={8}
          >
            <AppIcon name="ellipsis-vertical" size={18} color={colors.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {subtitle ? (
        <T.Caption tone="secondary" numberOfLines={2} className="mt-2">
          {subtitle}
        </T.Caption>
      ) : null}
      {onStudy && dueCount > 0 ? (
        /* The ONE saturated thing in the row, and only when there is
           something to do: a full-width primary button on every row put the
           list far over the 3% saturated-ink budget, and "Start studying" on
           a deck with nothing due was an action that opened a session with no
           cards. A deck with nothing ready is opened by its row; the sheet
           still carries the study CTA for it. */
        <View className="flex-row justify-end mt-2">
          <Button size="sm" onPress={onStudy} accessibilityLabel={getStudyCtaLabel(dueCount, cardCount)}>
            Study
          </Button>
        </View>
      ) : null}
    </Pressable>
  );
}

export function FlashcardsScreen({ navigation, embedded = false, listQuery = '' }: Props) {
  const { colors } = useTheme();
  const tabBarClearance = useTabBarClearance(embedded ? 16 : 8);
  const { onScroll: chromeOnScroll } = useChrome();
  // The contextual row's re-tap (spec v3 §7.2): pressing Flashcards while on
  // Flashcards sends this list back to the top rather than re-navigating.
  const listRef = useRef<FlatList>(null);
  useScrollToTopRequest(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
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
    deleteDeck,
    setDeckCoverPath,
  } = useFlashcardStore();
  /** Cards cached per deck; what the in-place search can match without the API. */
  const cardsByDeck = useFlashcardStore(s => s.flashcards);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  // The zero-credit door. Deliberately separate from `importOpen` above, which
  // opens the AI note import — that one costs an AI use, this one costs nothing.
  const [importCardsOpen, setImportCardsOpen] = useState(false);
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
    list = list.filter((d) => isLibraryFlashcardDeck(d));
    // Study-first: a deck with cards due is the reason this screen was
    // opened, and it used to sit under five decks reading "Nothing ready".
    if (!deckQuery) return sortDecksForList(list);
    // Cards as well as the deck's own name: "enzyme" means the cards, and the
    // ones already cached on this device are searchable with the API down.
    return sortDecksForList(
      list.filter(
        d =>
          d.name.toLowerCase().includes(deckQuery) ||
          deckDisplayTitle(d).toLowerCase().includes(deckQuery) ||
          Boolean(d.description && d.description.toLowerCase().includes(deckQuery)) ||
          (cardsByDeck[d.id] || []).some(
            c =>
              (c.front || '').toLowerCase().includes(deckQuery) ||
              (c.back || '').toLowerCase().includes(deckQuery) ||
              (c.clozeText || '').toLowerCase().includes(deckQuery)
          )
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
      appAlert('Could not move deck', e instanceof Error ? e.message : 'Please try again.');
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
      appAlert('Could not move deck', e instanceof Error ? e.message : 'Please try again.');
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
      appAlert('Offline change failed', e instanceof Error ? e.message : 'Please try again.');
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
        appAlert('Sharing unavailable', 'This device cannot open a share sheet.');
        return;
      }
      appAlert('Export failed', e instanceof Error ? e.message : 'Could not export deck');
    }
  };

  /**
   * Delete a deck from the list's own sheet.
   *
   * Only Deck detail could do this, so a deck a student did not want — a
   * generation they no longer need, an empty shell from a failed save — could
   * not be removed without opening it first. The card count is named in the
   * confirmation because that is what is actually being destroyed.
   */
  const handleDeleteDeck = async (deck: Deck) => {
    if (!user?.id) return;
    const count = deck.card_count ?? 0;
    const ok = await confirmSheet({
      title: 'Delete deck?',
      // The name as the LIST drew it: a student confirming a delete should be
      // reading the row they tapped, not the filename underneath it.
      message: `"${deckDisplayTitle(deck)}" and its ${pluralize(count, 'card')} will be permanently deleted. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteDeck(deck.id, user.id);
    } catch (e) {
      appAlert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
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
    appAlert('Success', `Added ${generated.length} flashcards to the deck.`);
    setAiModalOpen(false);
    setAiDeckId(null);
  };

  const dueCount = useMemo(() => decks.reduce((s, d) => s + (d.due_count || 0), 0), [decks]);

  /**
   * The cover sheet, owned once by the screen rather than per row.
   *
   * A hook cannot live inside `DeckCard` and still be driven from the row's
   * action sheet — but NOT read from `deckActions`, which `ActionSheet` clears
   * on close before the pressed row's handler even runs. The deck is latched
   * when "Add cover…" is pressed and held until the upload finishes; reading
   * it live is what produced `POST /decks//cover`.
   */
  const [coverDeck, setCoverDeck] = useState<Deck | null>(null);
  const coverDeckId = coverDeck?.id ?? '';
  const coverTargetHasCover = Boolean(readCoverPath(coverDeck));
  const coverTarget = useMemo(
    () => ({ kind: 'deck' as const, id: coverDeckId }),
    [coverDeckId],
  );
  const applyDeckCover = useCallback(
    (coverPath: string | null) => {
      if (coverDeckId) setDeckCoverPath(coverDeckId, coverPath);
    },
    [coverDeckId, setDeckCoverPath],
  );
  const coverPicker = useCoverPicker(coverTarget, {
    hasCover: coverTargetHasCover,
    onApplied: applyDeckCover,
  });

  const deckActionItems: ActionSheetItem[] = deckActions
    ? [
        {
          section: 'Deck',
          label: 'Open deck',
          icon: 'layers',
          onPress: () => navigation.navigate('DeckDetail', { deckId: deckActions.id, deckName: deckActions.name }),
        },
        {
          section: 'Study',
          label: getStudyCtaLabel(deckActions.due_count ?? 0, deckActions.card_count ?? 0),
          icon: 'play-circle',
          onPress: () => navigation.navigate('FlashcardReview', { deckId: deckActions.id, deckName: deckActions.name }),
        },
        {
          // Was a chip on the old gradient header; the row is neutral now, so
          // the sheet is where it lives.
          section: 'Study',
          label: 'Generate cards with AI',
          icon: 'sparkles',
          onPress: () => openAiForDeck(deckActions.id),
        },
        {
          section: 'Manage',
          label: readCoverPath(deckActions) ? 'Change cover…' : 'Add cover…',
          icon: 'image',
          hint: 'A picture on this deck in the list',
          // Let this sheet close before the cover sheet opens: two modals
          // animating over each other is how Android loses the second one.
          // The deck is captured now, because closing clears `deckActions`.
          onPress: () => {
            const deck = deckActions;
            setTimeout(() => {
              setCoverDeck(deck);
              coverPicker.open();
            }, SHEET_DISMISS_MS);
          },
        },
        {
          section: 'Manage',
          label: 'Move to course…',
          icon: 'school',
          hint: deckActions.course_id ? 'Filed under a course — pick another or clear it' : 'Not filed under a course yet',
          // Let the sheet dismiss before the course picker mounts.
          onPress: () => setTimeout(() => setCourseMoveDeck(deckActions), 50),
        },
        // Only offered once the deck has a course: a topic without its course
        // is rejected server-side.
        ...(deckActions.course_id
          ? [
              {
                section: 'Manage',
                label: 'Move to topic…',
                icon: 'list' as ActionSheetItem['icon'],
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
          section: 'Manage',
          label: offlineDeckIds.includes(deckActions.id) ? 'Remove from offline' : 'Save for offline',
          icon: offlineDeckIds.includes(deckActions.id) ? 'cloud-offline' : 'cloud-download',
          onPress: () => void handleToggleOffline(deckActions.id),
        },
        {
          section: 'Manage',
          label: 'Share as JSON',
          icon: 'share',
          onPress: () => void handleShareDeck(deckActions.id, deckActions.name),
        },
        {
          section: 'Manage',
          label: 'Delete deck',
          icon: 'trash',
          hint: `${pluralize(deckActions.card_count ?? 0, 'card')} will be deleted`,
          destructive: true,
          onPress: () => setTimeout(() => void handleDeleteDeck(deckActions), 50),
        },
      ]
    : [];

  const Wrapper = embedded ? View : SafeAreaView;
  const wrapperProps = embedded ? { className: 'flex-1 bg-lantern-background' } : { className: 'flex-1 bg-lantern-background', edges: ['top'] as const };

  return (
    <Wrapper {...wrapperProps}>
      {/* A cover failure belongs where the press happened, not in a toast that
          scrolls past: under the top of the list, in the server's own words. */}
      <CoverFailureLine failure={coverPicker.failure} onDismiss={coverPicker.dismissFailure} />
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
            Import notes
          </Button>
          <Button size="sm" onPress={() => setCreateOpen(true)}>
            + Deck
          </Button>
        </View>
      )}
      {!embedded && (
      <ScreenHeader
        onBack={() => navigation.goBack()}
        title="Flashcards"
        subtitle={pluralize(decks.length, 'deck')}
        right={
          <View className="flex-row gap-1.5">
            <Button size="sm" variant="secondary" onPress={() => setImportOpen(true)}>
              Import notes
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
          <Text className="text-xs text-amber-800 dark:text-amber-200">
            {humanizeFailureMessage(error)}
          </Text>
        </Pressable>
      ) : null}

      {courseFilter && !embedded ? (
        <View className="mx-4 mb-2 flex-row flex-wrap items-center gap-2">
          <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-primary-background">
            <AppIcon name="school" size={14} color={colors.primaryText} />
            <Text className="text-xs font-semibold text-lantern-primary-text" numberOfLines={1}>
              {courseFilter.label}
            </Text>
            <Pressable
              onPress={() => setCourseFilter(null)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Clear course filter ${courseFilter.label}`}
            >
              <AppIcon name="close-circle" size={16} color={colors.primaryText} />
            </Pressable>
          </View>
          {/* The topic narrows the list further, so it gets its own chip:
              the course chip alone makes a shorter list look like missing decks. */}
          {courseFilter.topicId ? (
            <View className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-lantern-background-secondary">
              <AppIcon name="bookmark" size={13} color={colors.textSecondary} />
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
                <AppIcon name="close-circle" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* The zero-credit door. No price line because there is no price: the
          parse happens on the device and no AI use is spent. */}
      <Pressable
        onPress={() => setImportCardsOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Import cards from a Quizlet or Anki text export. Free."
        className="mx-4 mb-3 flex-row items-center gap-3 px-3 py-3 rounded-2xl bg-lantern-surface border border-lantern-border"
      >
        <FeatureDisc feature="flashcards" icon="download" size={32} />
        <View className="flex-1">
          <T.Body className="font-semibold">Import cards</T.Body>
          <T.Caption tone="secondary">Free — Quizlet or Anki text export</T.Caption>
        </View>
        <AppIcon name="chevron-forward" size={18} color={colors.textTertiary} />
      </Pressable>

      {isLoading && decks.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primaryText} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          onScroll={chromeOnScroll}
          scrollEventThrottle={16}
          data={visibleDecks}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: tabBarClearance }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primaryText}
              colors={[colors.primaryText]}
              progressBackgroundColor={colors.surface}
            />
          }
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
                  ? 'This searches deck names and the cards saved on this device. “Search everything” above also covers other decks, cards and offline bundles.'
                  : courseFilter && decks.length > 0
                    ? 'Create a deck here, or use “Move to course…” on a deck to file it under this course.'
                    : 'Create your first deck to start studying with spaced repetition.'}
              </Text>
              {deckQuery ? null : (
                <>
                  <Button onPress={() => setCreateOpen(true)}>Create Deck</Button>
                  <Button className="mt-2" variant="secondary" onPress={() => setImportCardsOpen(true)}>
                    Import cards
                  </Button>
                </>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <DeckCard
              deck={item}
              onPress={() => navigation.navigate('DeckDetail', { deckId: item.id, deckName: item.name })}
              onStudy={() => navigation.navigate('FlashcardReview', { deckId: item.id, deckName: item.name })}
              isOffline={offlineDeckIds.includes(item.id)}
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

      <CoverPicker controller={coverPicker} title={coverDeck?.name ?? 'Cover image'} />

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
        onTurnIntoStudyProduct={(result) => {
          setImportOpen(false);
          navigateRootStack('Main', {
            screen: 'MarketTab',
            params: toTab('StudyProductDrafts', { source: { noteIds: [result.noteId], title: result.noteTitle } }),
          });
        }}
      />

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        {/* The deck-name field is `autoFocus`, so the keyboard is up the
            instant this opens; a centred, non-scrolling View then hid the
            Course/Topic pickers and Create behind it with no scroll range.
            `flexGrow` (not `flex-1`) on the backdrop keeps tap-to-dismiss
            covering the window while letting a tall card grow past it. */}
        <View className="flex-1 bg-black/40">
          <KeyboardAwareScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <Pressable
              className="px-6"
              style={{ flexGrow: 1, justifyContent: 'center', paddingVertical: 24 }}
              onPress={() => setCreateOpen(false)}
            >
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
          </KeyboardAwareScrollView>
        </View>
      </Modal>

      {aiDeckId ? (
        <AIGenerateFlashcardsModal
          visible={aiModalOpen}
          onClose={() => {
            setAiModalOpen(false);
            setAiDeckId(null);
          }}
          onFlashcardsGenerated={handleAIGenerated}
          // Wave G: naming the deck moves generation into the jobs store, so
          // the cards are saved (and notified) even if the student leaves.
          deckId={aiDeckId}
          deckName={decks.find((d) => d.id === aiDeckId)?.name}
          courseId={decks.find((d) => d.id === aiDeckId)?.course_id}
        />
      ) : null}

      <ImportCardsSheet
        visible={importCardsOpen}
        onClose={() => setImportCardsOpen(false)}
        onImported={({ deckId, deckName: name, queued }) => {
          // A queued import has a local `temp_` id the deck screen cannot
          // fetch, so it stays in the list rather than pushing a screen that
          // would ask the server for a deck the server has never heard of.
          if (queued) return;
          navigation.navigate('DeckDetail', { deckId, deckName: name });
        }}
      />

      <JobProgressSheet />
    </Wrapper>
  );
}

export default FlashcardsScreen;
