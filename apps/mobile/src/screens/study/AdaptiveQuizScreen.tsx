import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  ADAPTIVE_CONFIDENCE_CHOICES,
  ADAPTIVE_PAUSE_AFTER_MISSES,
  advanceAdaptiveQuiz,
  adaptiveDots,
  buildQuestionAsk,
  canConfirmAnswer,
  confirmAdaptiveAnswer,
  currentAdaptiveItem,
  hasEnoughNoteStudyContent,
  isWalkableAttachment,
  itemsFromUnknownQuestions,
  studioMaterials,
  masteryPercent,
  rateAdaptiveConfidence,
  resolveAdaptiveCorrectAnswer,
  resumeAdaptiveQuiz,
  setAdaptiveDraft,
  startAdaptiveQuiz,
  testsFiledInCourse,
  type AdaptiveConfidence,
  type AdaptiveQuizItem,
  type AdaptiveQuizSession,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { generateNoteQuiz, getNoteQuiz } from '../../services/notes';
import { fetchMobileTestDraft } from '../../services/testDrafts';
import type { StudyNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'AdaptiveQuiz'>;

function poolFromUnknown(payload: unknown): AdaptiveQuizItem[] {
  if (Array.isArray(payload)) return itemsFromUnknownQuestions(payload);
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.questions)) return itemsFromUnknownQuestions(record.questions);
    const nested =
      record.session && typeof record.session === 'object'
        ? (record.session as Record<string, unknown>).questions
        : undefined;
    if (Array.isArray(nested)) return itemsFromUnknownQuestions(nested);
  }
  return [];
}

export function AdaptiveQuizScreen({ navigation, route }: Props) {
  const { courseId, courseLabel, noteId, seedItems, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const tests = useTestStore((s) => s.tests);
  const openWithMessage = useCompanionStore((s) => s.openWithMessage);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const studyGoal = useStudyGoalsStore((s) => s.studyGoal);

  const [session, setSession] = useState<AdaptiveQuizSession | null>(null);
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceNoteId, setSourceNoteId] = useState<string | null>(noteId ?? null);
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const courseNotes = useMemo(
    () => studioMaterials(notes, { studySetId, courseId }),
    [notes, courseId, studySetId]
  );
  const noteOrder = useMemo(() => {
    const selected = courseNotes.find((note) => note.id === noteId);
    return selected
      ? [selected, ...courseNotes.filter((note) => note.id !== selected.id)]
      : courseNotes;
  }, [courseNotes, noteId]);
  const walkable = noteOrder.some((note) =>
    (note as StudyNote & { attachments?: Array<{ id?: string; type?: string }> }).attachments?.some(
      isWalkableAttachment
    )
  );

  const loadExisting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (seedItems && seedItems.length > 0) {
        setSourceTitle('This lesson');
        setSourceNoteId(noteId ?? noteOrder[0]?.id ?? null);
        setSession(startAdaptiveQuiz(seedItems));
        return;
      }
      for (const note of noteOrder) {
        const quiz = await getNoteQuiz(note.id).catch(() => null);
        const items = poolFromUnknown(quiz);
        if (items.length > 0) {
          setSourceTitle(note.title || 'Untitled note');
          setSourceNoteId(note.id);
          setSession(startAdaptiveQuiz(items));
          return;
        }
      }
      const noteIds = new Set(courseNotes.map((note) => note.id));
      const courseTests = testsFiledInCourse(
        tests.map((test) => ({
          id: test.id,
          courseId: null,
          sourceNoteId: test.sourceNoteId,
          sourceDeckId: undefined,
          deckId: test.deckId,
        })),
        // Course id is dead for matching here (every mapped row has courseId: null);
        // these tests are reached through noteIds, which now covers set materials.
        courseId ?? '',
        noteIds,
        new Set()
      );
      for (const row of courseTests) {
        const draft = await fetchMobileTestDraft(row.id).catch(() => null);
        const items = poolFromUnknown(draft);
        if (items.length > 0) {
          setSourceTitle('This course');
          setSourceNoteId(noteOrder[0]?.id ?? null);
          setSession(startAdaptiveQuiz(items));
          return;
        }
      }
      setSession(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load a quiz.');
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, [courseId, courseNotes, noteId, noteOrder, seedItems, tests]);

  useEffect(() => {
    void loadExisting();
  }, [loadExisting]);

  const writeFromNote = async (id: string) => {
    const note = courseNotes.find((row) => row.id === id);
    if (!note) {
      setError('Select a note in this course first.');
      return;
    }
    if (!hasEnoughNoteStudyContent(note)) {
      setError('Add more study content to this note first.');
      return;
    }
    setWriting(true);
    setError(null);
    try {
      const quiz = await generateNoteQuiz(id, studyGoal, 10);
      const items = poolFromUnknown(quiz.questions);
      if (items.length === 0) {
        setError('Could not write questions from that note.');
        return;
      }
      setSourceTitle(note.title || 'Untitled note');
      setSourceNoteId(id);
      setSession(startAdaptiveQuiz(items));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write questions.');
    } finally {
      setWriting(false);
    }
  };

  const item = session ? currentAdaptiveItem(session) : null;
  const mastery = session ? masteryPercent(session) : 0;
  const dots = session ? adaptiveDots(session) : [];
  const options =
    item?.kind === 'true_false' ? item.options || ['True', 'False'] : item?.options || [];
  const typed = item?.kind === 'fill_in_blank' || item?.kind === 'short_answer';

  const askAboutQuestion = () => {
    if (!item) return;
    if (sourceNoteId) {
      void setActiveNoteContext({ id: sourceNoteId, title: sourceTitle || 'Untitled note' });
    }
    openWithMessage(buildQuestionAsk({ stem: item.stem, explanation: item.explanation, noteTitle: sourceTitle }), {
      questionStem: item.stem,
      noteId: sourceNoteId || undefined,
    });
  };

  const openWalkthrough = () => {
    const note = noteOrder.find((row) =>
      (row as StudyNote & { attachments?: Array<{ id?: string; type?: string }> }).attachments?.some(
        isWalkableAttachment
      )
    ) as (StudyNote & { attachments?: Array<{ id?: string; type?: string }> }) | undefined;
    const attachment = note?.attachments?.find(isWalkableAttachment);
    if (!note || !attachment?.id) return;
    navigation.navigate('Walkthrough', { noteId: note.id, attachmentId: attachment.id });
  };

  const title = item
    ? `Q${session!.items.findIndex((row) => row.id === item.id) + 1} of ${session!.items.length}`
    : 'Quiz';

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader
        title={title}
        subtitle={session ? `Mastery ${mastery}% · ${courseLabel || 'Course'}` : courseLabel}
        onBack={() => navigation.goBack()}
        right={
          item ? (
            <Pressable
              onPress={askAboutQuestion}
              accessibilityRole="button"
              accessibilityLabel="Ask about this question"
              className="min-h-[44px] justify-center"
            >
              <T.Body>This question</T.Body>
            </Pressable>
          ) : null
        }
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16 }}
      >
        {dots.length > 0 ? (
          <View className="flex-row flex-wrap gap-1.5 mb-4" accessibilityLabel="Mastery dots">
            {dots.map((dot) => (
              <View
                key={dot.itemId}
                accessibilityLabel={dot.state}
                className={`h-2.5 w-2.5 rounded-full border ${
                  dot.state === 'current'
                    ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-ink'
                    : dot.state === 'correct'
                      ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                      : dot.state === 'missed'
                        ? 'border-lantern-warning bg-lantern-warning/20'
                        : dot.state === 'requeued'
                          ? 'border-lantern-feature-tests-ink bg-lantern-surface'
                          : 'border-lantern-border'
                }`}
              />
            ))}
          </View>
        ) : null}

        {loading ? <T.Body tone="secondary">Looking for questions in this course…</T.Body> : null}
        {error ? <T.Body>{error}</T.Body> : null}

        {!loading && !session ? (
          <View className="gap-3">
            <T.Body tone="secondary">
              Start from a note. Writing new questions uses{' '}
              {formatCreditCost(AI_CREDIT_COSTS.generate_questions)}.
            </T.Body>
            {noteOrder.length === 0 ? (
              <T.Body tone="secondary">Import or create a note first.</T.Body>
            ) : (
              noteOrder.map((note) => (
                <Button
                  key={note.id}
                  disabled={writing}
                  onPress={() => void writeFromNote(note.id)}
                >
                  {`Write questions · ${note.title || 'Untitled note'}`}
                </Button>
              ))
            )}
          </View>
        ) : null}

        {session && item && session.phase !== 'done' ? (
          <View className="gap-3">
            {item.topic ? <T.Label>{item.topic}</T.Label> : null}
            <T.Body>{item.stem}</T.Body>

            {session.phase === 'answer' ? (
              typed ? (
                <TextInput
                  value={session.draft}
                  onChangeText={(value) => setSession(setAdaptiveDraft(session, value))}
                  accessibilityLabel={item.kind === 'fill_in_blank' ? 'Fill in the blank' : 'Short answer'}
                  multiline
                  className="min-h-[96px] rounded-xl border border-lantern-border bg-lantern-surface p-3 text-body text-lantern-text"
                />
              ) : (
                <View>
                  {options.map((option) => {
                    const selected = session.draft === option;
                    return (
                      <Pressable
                        key={option}
                        onPress={() => setSession(setAdaptiveDraft(session, option))}
                        accessibilityRole="button"
                        className={`min-h-[44px] justify-center rounded-xl border px-3 py-2 mb-2 ${
                          selected
                            ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                            : 'border-lantern-border bg-lantern-surface'
                        }`}
                      >
                        <T.Body>{option}</T.Body>
                      </Pressable>
                    );
                  })}
                </View>
              )
            ) : (
              <T.Caption tone="secondary">Your answer: {session.lockedAnswer}</T.Caption>
            )}

            {session.phase === 'answer' ? (
              <Button
                disabled={!canConfirmAnswer(item.kind, session.draft)}
                onPress={() => setSession(confirmAdaptiveAnswer(session))}
              >
                Confirm answer
              </Button>
            ) : null}

            {session.phase === 'confidence' ? (
              <View>
                <T.Label>How sure are you?</T.Label>
                <View className="flex-row flex-wrap gap-2 mt-2">
                  {ADAPTIVE_CONFIDENCE_CHOICES.map((choice) => (
                    <Pressable
                      key={choice.id}
                      onPress={() =>
                        setSession(rateAdaptiveConfidence(session, choice.id as AdaptiveConfidence))
                      }
                      accessibilityRole="button"
                      className="min-h-[44px] justify-center rounded-full border border-lantern-border px-3"
                    >
                      <T.Body>
                        {choice.label} · {choice.hint}
                      </T.Body>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {session.phase === 'feedback' || session.phase === 'paused' ? (
              <View className="rounded-xl border border-lantern-border bg-lantern-surface p-3 gap-2">
                <T.Body>
                  {session.lastGrade?.correct ? 'Right' : 'Not quite'}
                  {session.lastGrade ? ` · confidence ${session.lastGrade.confidence}` : ''}
                </T.Body>
                {!session.lastGrade?.correct ? (
                  <T.Caption tone="secondary">
                    Answer: {resolveAdaptiveCorrectAnswer(item.correctAnswer, item.options)}
                  </T.Caption>
                ) : null}
                {item.explanation ? (
                  <T.Body>{item.explanation}</T.Body>
                ) : (
                  <T.Caption tone="secondary">No stored explanation — ask about this question.</T.Caption>
                )}
              </View>
            ) : null}

            {session.phase === 'feedback' ? (
              <Button onPress={() => setSession(advanceAdaptiveQuiz(session))}>Next</Button>
            ) : null}

            {session.phase === 'paused' ? (
              <View className="gap-2">
                <T.Body>
                  {ADAPTIVE_PAUSE_AFTER_MISSES} misses in a row. Review the notes
                  {walkable ? ' or walk through the source' : ''}, then come back.
                </T.Body>
                <Button
                  onPress={() => {
                    const note = noteOrder[0];
                    if (note) navigation.navigate('NoteEditor', { noteId: note.id });
                    else navigation.goBack();
                  }}
                >
                  Back to notes
                </Button>
                {walkable ? (
                  <Button variant="secondary" onPress={openWalkthrough}>
                    Walkthrough
                  </Button>
                ) : null}
                <Button variant="secondary" onPress={() => setSession(resumeAdaptiveQuiz(session))}>
                  Keep going
                </Button>
              </View>
            ) : null}
          </View>
        ) : null}

        {session?.phase === 'done' ? (
          <View className="gap-3">
            <T.Body>
              Quiz finished · mastery {mastery}%. Practice tests are still under Test if you want
              exam conditions.
            </T.Body>
            <Button onPress={() => void loadExisting()}>Quiz again</Button>
            <Button variant="secondary" onPress={() => navigation.goBack()}>
              Back to course
            </Button>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default AdaptiveQuizScreen;
