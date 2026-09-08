// ===========================================
// Lantern Study Mobile - New test
// ===========================================

/**
 * The door "+ New test" opens.
 *
 * Before this screen existed the button switched the GLOBAL tab to Chat —
 * temporary group-quiz wiring — so a press on the Study tab moved the student
 * to another destination with no explanation, and Home's Test door opened a
 * "Pick a group" sheet for a feature that has nothing to do with groups.
 *
 * There are three sources, and the screen is honest about all three: a deck
 * and a note each cost one AI credit and build a test of the student's own,
 * which lands in Available Tests; the group option is the ONE cross-tab path
 * in this lane and its card says "Opens your group chat" before it is pressed.
 *
 * Generation runs as a background job (stores/jobsStore), the same path the
 * note editor's "Turn into" tiles use: the progress sheet takes over, the test
 * is saved and notified even if the student leaves, and `saveGeneratedTest`
 * guarantees one job can never write two tests.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { appAlert } from '../../components/ui/appDialog';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen, useScreenBottomPadding, useScreenInsets } from '../../components/layout';
import { BackButton, FeatureDisc, useFeatureAccent } from '../../components/ui';
import { AppIcon } from '../../components/ui/AppIcon';
import { useTheme } from '../../theme';
import { typeScale } from '../../design/typeScale';
import { toTab } from '../../navigation/nestedTab';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { hasEnoughNoteStudyContent } from '@lantern/shared/utils';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useJobsStore } from '../../stores/jobsStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { saveGeneratedTest } from '../../services/jobArtifacts';
import { aiGenerateQuestions } from '../../services/ai';
import { generateNoteQuiz } from '../../services/notes';
import { trackAIToolUsed } from '../../services/productAnalytics';
import {
  MAX_GENERATED_QUESTIONS,
  TEST_BUILDER_SOURCES,
  deckStudyNotes,
  personalTestTitle,
  planConfirmedGeneration,
  planPickedTestSource,
  planPreselectedNote,
  testSourceConfirmCard,
  type TestBuilderSourceId,
  type TestSourceSelection,
} from './testAuthoring';

/** Cards below this are not enough for the generator to work from. */
const MIN_DECK_CARDS = 3;

type PickerKind = 'deck' | 'note' | null;

interface PickerRow {
  id: string;
  title: string;
  subtitle?: string;
  /** Set when the row cannot be used, and why. */
  disabledReason?: string;
}

export default function TestBuilderScreen() {
  const navigation = useNavigation<any>();
  /**
   * `noteId` arrives from the note editor's contextual row (spec v3 §7.2):
   * the student was reading a note and asked for a test of it. The builder
   * opens with that note already chosen — a "From this note" card above the
   * sources with its own Generate action — rather than on the picker, so the
   * student lands on the builder, not on a modal. It is still a confirmation,
   * not a shortcut past one: generating costs a credit and nothing here
   * spends it before the screen has been read.
   */
  const requestedNoteId = (useRoute().params as { noteId?: string } | undefined)?.noteId;
  const { colors } = useTheme();
  const testsAccent = useFeatureAccent('tests');
  const insets = useScreenInsets();
  const listPadding = useScreenBottomPadding();

  const userId = useAuthStore(s => s.user?.id);
  const decks = useFlashcardStore(s => s.decks);
  const fetchDecks = useFlashcardStore(s => s.fetchDecks);
  const flashcardsByDeck = useFlashcardStore(s => s.flashcards);
  const fetchFlashcards = useFlashcardStore(s => s.fetchFlashcards);
  const notes = useNotesStore(s => s.notes);
  const loadNotes = useNotesStore(s => s.loadNotes);

  const [picker, setPicker] = useState<PickerKind>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * The source the student has chosen and NOT yet paid for.
   *
   * The picker used to generate on the tap of a row: one press on a note's
   * name took an AI use, with no confirmation and no button that ever said
   * what it cost. A row now only fills this in; the labelled button below is
   * the only thing that spends.
   */
  const [selection, setSelection] = useState<TestSourceSelection | null>(null);

  useEffect(() => {
    if (userId) void fetchDecks(userId).catch(() => undefined);
    void loadNotes().catch(() => undefined);
  }, [userId, fetchDecks, loadNotes]);

  const deckRows = useMemo<PickerRow[]>(
    () =>
      decks.map(deck => {
        const cards = deck.card_count ?? flashcardsByDeck[deck.id]?.length ?? 0;
        return {
          id: deck.id,
          title: deck.name,
          subtitle: cards === 1 ? '1 card' : `${cards} cards`,
          disabledReason:
            cards > 0 && cards < MIN_DECK_CARDS
              ? `Needs at least ${MIN_DECK_CARDS} cards`
              : cards === 0
                ? 'No cards yet'
                : undefined,
        };
      }),
    [decks, flashcardsByDeck]
  );

  const noteRows = useMemo<PickerRow[]>(() => {
    const rows = notes.map(note => ({
      id: note.id,
      title: note.title || 'Untitled note',
      subtitle: hasEnoughNoteStudyContent(note) ? undefined : 'Needs more content',
      disabledReason: hasEnoughNoteStudyContent(note) ? undefined : 'Needs more content',
    }));
    // The note the student came from goes first, so the row they mean is the
    // one under their thumb rather than somewhere down a list of everything
    // they have ever written.
    if (!requestedNoteId) return rows;
    const asked = rows.findIndex(row => row.id === requestedNoteId);
    if (asked <= 0) return rows;
    return [rows[asked], ...rows.slice(0, asked), ...rows.slice(asked + 1)];
  }, [notes, requestedNoteId]);

  /**
   * Land back on the Tests list once a job is under way.
   *
   * `goBack`, never a nested navigate: this screen was pushed onto the Study
   * stack from TestsList, so the list is already underneath it and the
   * generated test appears there when the job settles.
   */
  const returnToTests = useCallback(() => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate('TestsList');
  }, [navigation]);

  const handleDeckPicked = useCallback(
    async (deckId: string, deckName: string) => {
      setBusyId(deckId);
      try {
        // The cards may not be loaded yet — the deck list carries counts, not
        // content — so fetch before deciding there is nothing to work from.
        if (!flashcardsByDeck[deckId]?.length) await fetchFlashcards(deckId);
        const cards = useFlashcardStore.getState().flashcards[deckId] || [];
        const notesText = deckStudyNotes(cards);
        if (notesText.trim().length < 50) {
          appAlert(
            'Not enough to work from',
            'This deck does not have enough card text yet. Add a few more cards and try again.'
          );
          return;
        }

        const title = personalTestTitle(deckName);
        setPicker(null);
        useJobsStore.getState().startJob({
          kind: 'test',
          sourceTitle: deckName,
          // A ceiling, not a promise: the generator writes what the cards
          // support, so the sheet says "up to" until the save counts one.
          requestedCount: MAX_GENERATED_QUESTIONS,
          requestedCountIsMax: true,
          run: async ({ jobId, onServerJob, onStage }) => {
            const { questions } = await aiGenerateQuestions(notesText, {
              count: MAX_GENERATED_QUESTIONS,
              subject: deckName,
              onJobUpdate: p => {
                if (p.jobId) onServerJob(p.jobId);
              },
            });
            trackAIToolUsed('generate_questions');
            if (!questions.length) {
              throw new Error('Could not generate questions from this deck.');
            }
            onStage('Saving your test');
            // One save path for every generator: it counts only what the
            // server took, and will not write this job's test twice.
            // The deck travels with the save so the server can file its
            // provenance (`config.sourceDeckId` + title) — that is what the
            // results screen's "From <deck>" chip reads back.
            const { ref, saved } = await saveGeneratedTest({ jobId, title, sourceDeckId: deckId, questions });
            return { artifact: ref, resultCount: saved };
          },
        });
        returnToTests();
      } catch (error) {
        appAlert(
          'Could not start',
          error instanceof Error ? error.message : 'Try again in a moment.'
        );
      } finally {
        setBusyId(null);
      }
    },
    [flashcardsByDeck, fetchFlashcards, returnToTests]
  );

  const handleNotePicked = useCallback(
    (noteId: string, noteTitle: string) => {
      const title = personalTestTitle(noteTitle);
      setPicker(null);
      useJobsStore.getState().startJob({
        kind: 'test',
        sourceTitle: noteTitle,
        requestedCount: MAX_GENERATED_QUESTIONS,
        requestedCountIsMax: true,
        run: async ({ jobId, onServerJob, onStage }) => {
          const { studyGoal } = useStudyGoalsStore.getState();
          const session = await generateNoteQuiz(
            noteId,
            studyGoal,
            MAX_GENERATED_QUESTIONS,
            onServerJob
          );
          if (!session.questions.length) {
            throw new Error('Could not generate a test from this note.');
          }
          onStage('Saving your test');
          const { ref, saved } = await saveGeneratedTest({
            jobId,
            title,
            sourceNoteId: noteId,
            questions: session.questions,
          });
          return { artifact: ref, resultCount: saved };
        },
      });
      returnToTests();
    },
    [returnToTests]
  );

  /**
   * The only cross-tab navigate in this lane, and the card said so before it
   * was pressed. `toTab` supplies `initial: false`, so the chat list stays
   * underneath the group and Back reaches it.
   */
  const handleGroup = useCallback(() => {
    const parent = navigation.getParent?.();
    (parent ?? navigation).navigate('ChatTab', toTab('GroupsList'));
  }, [navigation]);

  const handleSource = useCallback(
    (id: TestBuilderSourceId) => {
      if (id === 'group') return handleGroup();
      setPicker(id);
    },
    [handleGroup]
  );

  const preselected = useMemo(
    () => planPreselectedNote(requestedNoteId, noteRows),
    [requestedNoteId, noteRows]
  );

  /**
   * The note the student arrived from fills the same confirmation card the
   * picker fills — one card, one labelled button, one price, whichever door
   * was used. It never overwrites a source the student has since chosen.
   */
  useEffect(() => {
    if (!preselected || preselected.disabledReason) return;
    setSelection(current =>
      current ? current : { kind: 'note', id: preselected.id, title: preselected.title }
    );
  }, [preselected]);

  /** Tapping a row of the picker CHOOSES it. Nothing is spent here. */
  const handlePickRow = useCallback((kind: 'deck' | 'note', row: PickerRow) => {
    const plan = planPickedTestSource({
      kind,
      id: row.id,
      title: row.title,
      subtitle: row.subtitle,
      disabledReason: row.disabledReason,
    });
    if (plan.action === 'refuse') {
      appAlert('Cannot use this one', plan.reason);
      return;
    }
    setSelection(plan.selection);
    setPicker(null);
  }, []);

  const confirmCard = useMemo(
    () =>
      selection
        ? testSourceConfirmCard(
            selection,
            formatCreditCost(AI_CREDIT_COSTS.generate_questions),
            MAX_GENERATED_QUESTIONS
          )
        : null,
    [selection]
  );

  /** The one press that costs anything, and it says so on its face. */
  const handleGenerate = useCallback(() => {
    const plan = planConfirmedGeneration(selection, {
      busy: busyId !== null,
      max: MAX_GENERATED_QUESTIONS,
    });
    if (plan.action === 'refuse') {
      appAlert('Nothing to generate yet', plan.reason);
      return;
    }
    if (plan.kind === 'deck') void handleDeckPicked(plan.id, plan.title);
    else handleNotePicked(plan.id, plan.title);
  }, [selection, busyId, handleDeckPicked, handleNotePicked]);

  const pickerRows = picker === 'deck' ? deckRows : picker === 'note' ? noteRows : [];
  const pickerTitle = picker === 'deck' ? 'Pick a deck' : 'Pick a note';
  const pickerEmpty =
    picker === 'deck'
      ? 'You have no decks yet. Make one under Flashcards, then come back.'
      : 'You have no notes yet. Write one under Library, then come back.';

  return (
    <Screen edges={['top']} bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={styles.header}>
        <View style={styles.headerTopRow}>
          <BackButton onPress={() => navigation.goBack()} style={{ marginLeft: -9, marginRight: 4 }} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>New test</Text>
        </View>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          Build one from your own material, or set one up with your group
        </Text>
      </View>

      <FlatList
        data={TEST_BUILDER_SOURCES}
        keyExtractor={item => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: listPadding }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          confirmCard ? (
            <View
              style={[styles.preselectCard, { backgroundColor: testsAccent.tint }]}
              accessibilityLabel={`${confirmCard.eyebrow.toLowerCase()}: ${confirmCard.title}.`}
              testID="test-builder-selected-source"
            >
              <Text style={[styles.preselectEyebrow, { color: testsAccent.ink }]}>
                {confirmCard.eyebrow}
              </Text>
              <Text style={[styles.sourceTitle, { color: colors.text }]} numberOfLines={2}>
                {confirmCard.title}
              </Text>
              {confirmCard.subtitle ? (
                <Text style={[styles.sourceDescription, { color: colors.textSecondary }]}>
                  {confirmCard.subtitle}
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.preselectAction, { backgroundColor: colors.primaryFill }]}
                onPress={handleGenerate}
                disabled={busyId !== null}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ disabled: busyId !== null }}
                accessibilityLabel={confirmCard.accessibilityLabel}
                testID="test-builder-generate"
              >
                {busyId !== null ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <AppIcon name="sparkles" size={15} color="#ffffff" />
                )}
                <Text style={[styles.preselectActionText, { color: '#ffffff' }]}>
                  {confirmCard.buttonLabel}
                </Text>
              </TouchableOpacity>
              <Text style={[styles.sourceDescription, { color: colors.textSecondary, marginTop: 8 }]}>
                Or pick another source below.
              </Text>
            </View>
          ) : preselected?.disabledReason ? (
            <View
              style={[styles.preselectCard, { backgroundColor: testsAccent.tint }]}
              accessibilityLabel={`From this note: ${preselected.title}. ${preselected.disabledReason}.`}
              testID="test-builder-preselected-note"
            >
              <Text style={[styles.preselectEyebrow, { color: testsAccent.ink }]}>FROM THIS NOTE</Text>
              <Text style={[styles.sourceTitle, { color: colors.text }]} numberOfLines={2}>
                {preselected.title}
              </Text>
              <Text style={[styles.sourceDescription, { color: colors.textSecondary }]}>
                {preselected.disabledReason}
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.sourceCard, { backgroundColor: colors.card }]}
            onPress={() => handleSource(item.id)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.description}${
              item.costsCredit ? ` Costs ${formatCreditCost(AI_CREDIT_COSTS.generate_questions)}.` : ''
            }`}
            testID={`test-builder-source-${item.id}`}
          >
            <FeatureDisc
              feature={item.id === 'group' ? 'groups' : 'tests'}
              icon={item.id === 'deck' ? 'layers' : item.id === 'note' ? 'document-text' : 'people'}
              size={40}
            />
            <View style={{ width: 12 }} />
            <View style={styles.sourceInfo}>
              <Text style={[styles.sourceTitle, { color: colors.text }]}>{item.title}</Text>
              <Text style={[styles.sourceDescription, { color: colors.textSecondary }]}>
                {item.description}
              </Text>
              {item.costsCredit ? (
                <View style={styles.costRow}>
                  <AppIcon name="sparkles" size={13} color={testsAccent.ink} />
                  <Text style={[styles.costText, { color: testsAccent.ink }]}>
                    {formatCreditCost(AI_CREDIT_COSTS.generate_questions)}
                  </Text>
                </View>
              ) : null}
            </View>
            <AppIcon name="chevron-forward" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      />

      <Modal
        visible={picker !== null}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={() => setPicker(null)}
      >
        <View style={styles.overlay}>
          <View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, paddingBottom: Math.max(24, insets.bottom + 16) },
            ]}
          >
            <View style={[styles.sheetHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{pickerTitle}</Text>
              <TouchableOpacity
                onPress={() => setPicker(null)}
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <AppIcon name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <FlatList
              data={pickerRows}
              keyExtractor={item => item.id}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={[styles.sheetEmpty, { color: colors.textSecondary }]}>
                  {pickerEmpty}
                </Text>
              }
              renderItem={({ item }) => {
                const disabled = !!item.disabledReason || busyId !== null;
                return (
                  <TouchableOpacity
                    style={[styles.pickerRow, { borderBottomColor: colors.border }, disabled && styles.pickerRowDisabled]}
                    disabled={disabled}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ disabled }}
                    accessibilityLabel={[item.title, item.disabledReason ?? item.subtitle]
                      .filter(Boolean)
                      .join('. ')}
                    onPress={() => handlePickRow(picker === 'deck' ? 'deck' : 'note', item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerTitle, { color: colors.text }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {item.disabledReason || item.subtitle ? (
                        <Text style={[styles.pickerSubtitle, { color: colors.textSecondary }]}>
                          {item.disabledReason || item.subtitle}
                        </Text>
                      ) : null}
                    </View>
                    {busyId === item.id ? (
                      <ActivityIndicator size="small" color={testsAccent.ink} />
                    ) : (
                      <AppIcon name="chevron-forward" size={18} color={colors.textSecondary} />
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    ...typeScale.display,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    ...typeScale.body,
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  sourceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  sourceInfo: {
    flex: 1,
  },
  sourceTitle: {
    ...typeScale.heading,
    fontWeight: '600',
    marginBottom: 2,
  },
  sourceDescription: {
    ...typeScale.caption,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  costText: {
    ...typeScale.label,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    // A definite fraction of the window, not a percentage on a flexing box:
    // the same pixel rule the config sheet keeps since build 147.
    maxHeight: '75%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  sheetTitle: {
    ...typeScale.heading,
    fontWeight: '700',
  },
  sheetEmpty: {
    ...typeScale.body,
    padding: 20,
  },
  preselectCard: {
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  preselectEyebrow: {
    ...typeScale.label,
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  preselectAction: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 10,
    gap: 8,
  },
  preselectActionText: {
    ...typeScale.body,
    fontWeight: '600',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  pickerRowDisabled: {
    opacity: 0.45,
  },
  pickerTitle: {
    ...typeScale.body,
    fontWeight: '600',
  },
  pickerSubtitle: {
    ...typeScale.caption,
  },
});
