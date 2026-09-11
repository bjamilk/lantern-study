import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  WORKSPACE_ACTIVITIES,
  WORKSPACE_LATER_COPY,
  TURN_INTO_TARGETS,
  courseWorkspaceLabel,
  hasEnoughNoteStudyContent,
  isLectureNote,
  isLessonNote,
  isWalkableAttachment,
  materialsForCourse,
  newLectureNoteTitle,
  resolveLectureStudioNote,
  testsFiledInCourse,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, formatCreditCost } from '@lantern/shared/utils/aiCredits';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, Card, FeatureDisc, ScreenHeader, T } from '../../components/ui';
import { type AppIconName } from '../../components/ui/AppIcon';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useJobsStore } from '../../stores/jobsStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { saveGeneratedDeck, saveGeneratedTest } from '../../services/jobArtifacts';
import { aiGenerateFlashcards } from '../../services/ai';
import { generateNoteQuiz } from '../../services/notes';
import { getMyActiveCourses } from '../../services/academic';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { touchWorkspaceRecent } from '../../utils/workspaceRecents';
import type { UserCourse } from '@lantern/shared/types';
import type { StudyNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'CourseRoom'>;

export function CourseRoomScreen({ navigation, route }: Props) {
  const { courseId, courseLabel } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const showToast = useToastStore((s) => s.showToast);
  const startJob = useJobsStore((s) => s.startJob);
  const loadNote = useNotesStore((s) => s.loadNote);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const decks = useFlashcardStore((s) => s.decks);
  const tests = useTestStore((s) => s.tests);
  const userId = useAuthStore((s) => s.user?.id);
  const [enrolment, setEnrolment] = useState<UserCourse | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  useEffect(() => {
    void touchWorkspaceRecent(courseId);
    void getMyActiveCourses().then((rows) => {
      setEnrolment(rows.find((row) => row.course.id === courseId) ?? null);
    });
    void useNotesStore.getState().loadNotes().catch(() => undefined);
    if (userId) void useTestStore.getState().fetchTests(userId).catch(() => undefined);
  }, [courseId, userId]);

  const label =
    courseLabel ||
    (enrolment ? courseWorkspaceLabel(enrolment.course) : 'Course');

  const courseNotes = useMemo(() => materialsForCourse(notes, courseId), [notes, courseId]);
  const courseDecks = useMemo(() => materialsForCourse(decks, courseId), [decks, courseId]);
  const lectures = useMemo(() => courseNotes.filter(isLectureNote), [courseNotes]);
  const lessons = useMemo(() => courseNotes.filter(isLessonNote), [courseNotes]);
  const noteIds = useMemo(() => new Set(courseNotes.map((n) => n.id)), [courseNotes]);
  const deckIds = useMemo(() => new Set(courseDecks.map((d) => d.id)), [courseDecks]);
  const courseTests = useMemo(
    () =>
      testsFiledInCourse(
        tests.map((test) => ({
          id: test.id,
          courseId: null,
          sourceNoteId: test.sourceNoteId,
          sourceDeckId: undefined,
          deckId: test.deckId,
        })),
        courseId,
        noteIds,
        deckIds
      ),
    [tests, courseId, noteIds, deckIds]
  );

  const openLectureStudio = (existingNoteId?: string) => {
    const decision = resolveLectureStudioNote({
      lectures,
      selectedNoteId: existingNoteId || selectedNote?.id,
      recordingNoteId: lectureNoteId && lectureStatus !== 'idle' ? lectureNoteId : null,
      todayTitle: newLectureNoteTitle(),
    });
    const noteId = decision.action === 'resume' ? decision.noteId : existingNoteId;
    if (noteId) void loadNote(noteId);
    navigation.navigate('LectureStudio', {
      courseId,
      courseLabel: label,
      noteId,
    });
  };

  const handleActivity = (id: WorkspaceActivityId, status: 'ready' | 'later') => {
    if (status === 'later') {
      showToast(WORKSPACE_LATER_COPY, 'info');
      return;
    }
    switch (id) {
      case 'notes': {
        const note =
          selectedNote && selectedNote.courseId === courseId ? selectedNote : courseNotes[0];
        if (!note) {
          showToast('Import or create a note first.', 'info');
          return;
        }
        selectNote(note.id);
        navigation.navigate('NoteEditor', { noteId: note.id });
        return;
      }
      case 'walkthrough': {
        const note = (selectedNote && selectedNote.courseId === courseId
          ? selectedNote
          : courseNotes.find((n) => n.attachments?.some(isWalkableAttachment))) as
          | (StudyNote & { attachments?: Array<{ id?: string; type?: string }> })
          | undefined;
        const attachment = note?.attachments?.find(isWalkableAttachment);
        if (!note || !attachment?.id) {
          showToast('Select a note with a PDF or slides attached.', 'info');
          return;
        }
        navigation.navigate('Walkthrough', { noteId: note.id, attachmentId: attachment.id });
        return;
      }
      case 'quiz': {
        const note =
          selectedNote && selectedNote.courseId === courseId ? selectedNote : courseNotes[0];
        navigation.navigate('AdaptiveQuiz', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
        });
        return;
      }
      case 'cards':
        if (courseDecks[0]) {
          navigation.navigate('DeckDetail', {
            deckId: courseDecks[0].id,
            deckName: courseDecks[0].name,
          });
        } else {
          showToast('No decks in this course yet. Turn a note into cards.', 'info');
        }
        return;
      case 'test':
        navigation.navigate('TestsList', { courseId, courseLabel: label });
        return;
      case 'lecture':
        openLectureStudio();
        return;
      case 'lesson': {
        const note =
          selectedNote && selectedNote.courseId === courseId && isLessonNote(selectedNote)
            ? selectedNote
            : courseNotes.find(isLessonNote);
        navigation.navigate('LessonStudio', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
        });
        return;
      }
      case 'play':
        if (courseDecks[0]) {
          navigation.navigate('MatchStudy', {
            deckId: courseDecks[0].id,
            deckName: courseDecks[0].name,
          });
        } else {
          showToast('File a deck in this course first.', 'info');
        }
        return;
      case 'plan':
        navigation.navigate('Library', {
          manageOutlineCourseId: courseId,
          manageOutlineCourseLabel: label,
        });
        return;
      default:
        return;
    }
  };

  const turnInto = (target: TurnIntoTargetId, note: StudyNote) => {
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    if (!userId) {
      showToast('Sign in to generate study materials.', 'error');
      return;
    }
    const noteTitle = note.title || 'Untitled Note';
    const content = (note.body || note.summary || '').slice(0, 8000);

    if (target === 'cards') {
      const count = normalizeFlashcardCount();
      startJob({
        kind: 'flashcards',
        sourceTitle: noteTitle,
        requestedCount: count,
        run: async ({ jobId, onServerJob, onStage }) => {
          const { flashcards } = await aiGenerateFlashcards(content, {
            count,
            style: 'concise',
            onJobUpdate: (p) => {
              if (p.jobId) onServerJob(p.jobId);
            },
          });
          if (!flashcards.length) {
            throw new Error('Could not generate flashcards from this note.');
          }
          onStage('Saving to your deck');
          const { ref, saved } = await saveGeneratedDeck({
            jobId,
            userId,
            cards: flashcards,
            deckName: `From: ${noteTitle}`,
            description: `Generated from note: ${noteTitle}`,
            courseId,
          });
          return { artifact: ref, resultCount: saved };
        },
      });
      showToast('Building flashcards for this course…', 'info');
      return;
    }

    startJob({
      kind: 'test',
      sourceTitle: noteTitle,
      requestedCount: 10,
      requestedCountIsMax: true,
      run: async ({ jobId, onServerJob, onStage }) => {
        const { studyGoal } = useStudyGoalsStore.getState();
        const session = await generateNoteQuiz(note.id, studyGoal, 10, onServerJob);
        if (!session.questions.length) {
          throw new Error('Could not generate a test from this note.');
        }
        onStage('Saving your test');
        const { ref, saved } = await saveGeneratedTest({
          jobId,
          title: `Test · ${noteTitle}`,
          sourceNoteId: note.id,
          questions: session.questions,
          courseId,
        });
        return { artifact: ref, resultCount: saved };
      },
    });
    showToast('Building a practice test for this course…', 'info');
  };

  const selectNote = useCallback(
    (noteId: string) => {
      void loadNote(noteId);
    },
    [loadNote]
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16, paddingTop: 8 }}
      >
        <ScreenHeader title={label} subtitle="This course’s notes, cards, tests and lectures" />

        <View className="flex-row flex-wrap gap-2 mb-4">
          {WORKSPACE_ACTIVITIES.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => handleActivity(item.id, item.status)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              className="w-[47%] min-h-[72px] rounded-xl border border-lantern-border bg-lantern-surface px-3 py-3 active:opacity-80"
            >
              <View className="flex-row items-center gap-2">
                <FeatureDisc feature={item.feature} icon={item.icon as AppIconName} size={32} />
                <View className="flex-1 min-w-0">
                  <T.Body numberOfLines={1}>{item.label}</T.Body>
                  <T.Caption tone="secondary" numberOfLines={1}>
                    {item.status === 'later' ? 'Later wave' : item.promise}
                  </T.Caption>
                </View>
              </View>
            </Pressable>
          ))}
        </View>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Notes
          </T.Caption>
          {courseNotes.length === 0 ? (
            <T.Body tone="secondary">No notes in this course yet.</T.Body>
          ) : (
            courseNotes.map((note, index) => (
              <View key={note.id} className={index > 0 ? 'border-t border-lantern-border' : undefined}>
                <Pressable
                  onPress={() => {
                    selectNote(note.id);
                    if (isLectureNote(note)) {
                      navigation.navigate('LectureStudio', {
                        courseId,
                        courseLabel: label,
                        noteId: note.id,
                      });
                      return;
                    }
                    if (isLessonNote(note)) {
                      navigation.navigate('LessonStudio', {
                        courseId,
                        courseLabel: label,
                        noteId: note.id,
                      });
                      return;
                    }
                    navigation.navigate('NoteEditor', { noteId: note.id });
                  }}
                  className="py-3"
                >
                  <T.Body numberOfLines={1}>{note.title || 'Untitled note'}</T.Body>
                </Pressable>
                <View className="flex-row flex-wrap gap-2 pb-3">
                  {TURN_INTO_TARGETS.map((target) => (
                    <Button
                      key={target.id}
                      size="sm"
                      variant="secondary"
                      onPress={() => turnInto(target.id, note)}
                    >
                      {`${target.label} · ${formatCreditCost(
                        target.id === 'cards'
                          ? AI_CREDIT_COSTS.generate_flashcards
                          : AI_CREDIT_COSTS.generate_questions
                      )}`}
                    </Button>
                  ))}
                </View>
              </View>
            ))
          )}
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Decks
          </T.Caption>
          {courseDecks.length === 0 ? (
            <T.Body tone="secondary">No decks filed here.</T.Body>
          ) : (
            courseDecks.map((deck, index) => (
              <Pressable
                key={deck.id}
                onPress={() =>
                  navigation.navigate('DeckDetail', { deckId: deck.id, deckName: deck.name })
                }
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{deck.name}</T.Body>
              </Pressable>
            ))
          )}
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Tests
          </T.Caption>
          {courseTests.length === 0 ? (
            <T.Body tone="secondary">No tests from this course yet.</T.Body>
          ) : (
            courseTests.map((test, index) => {
              const row = tests.find((t) => t.id === test.id);
              return (
                <Pressable
                  key={test.id}
                  onPress={() =>
                    navigation.navigate('TestsList', { courseId, courseLabel: label })
                  }
                  className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
                >
                  <T.Body numberOfLines={1}>{row?.name || 'Test'}</T.Body>
                </Pressable>
              );
            })
          )}
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Lectures
          </T.Caption>
          {lectures.length === 0 ? (
            <T.Body tone="secondary">Record a lecture to file it here.</T.Body>
          ) : (
            lectures.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() => openLectureStudio(note.id)}
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Lecture'}</T.Body>
              </Pressable>
            ))
          )}
        </Card>

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Lessons
          </T.Caption>
          {lessons.length === 0 ? (
            <T.Body tone="secondary">Start a lesson from a note.</T.Body>
          ) : (
            lessons.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() =>
                  navigation.navigate('LessonStudio', {
                    courseId,
                    courseLabel: label,
                    noteId: note.id,
                  })
                }
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Lesson'}</T.Body>
              </Pressable>
            ))
          )}
        </Card>

        <Button className="mb-3" onPress={() => setImportOpen(true)}>
          Import into this course
        </Button>
        <Button
          variant="ghost"
          onPress={() => navigation.navigate('Library', { tab: 'notes' })}
        >
          All materials
        </Button>
      </ScrollView>

      <ImportAndStudyModal
        visible={importOpen}
        courseId={courseId}
        onClose={() => setImportOpen(false)}
        onOpenNote={(noteId) => {
          setImportOpen(false);
          navigation.navigate('NoteEditor', { noteId });
        }}
      />
    </SafeAreaView>
  );
}

export default CourseRoomScreen;
