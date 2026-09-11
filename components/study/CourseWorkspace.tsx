import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WORKSPACE_ACTIVITIES,
  WORKSPACE_LATER_COPY,
  courseWorkspaceLabel,
  hasEnoughNoteStudyContent,
  isLectureNote,
  isLessonNote,
  isWalkableAttachment,
  materialsForCourse,
  newLectureNoteTitle,
  resolveLectureStudioNote,
  resolveLessonStudioNote,
  testsFiledInCourse,
  type AdaptiveQuizItem,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, getSmartNotesCreditCost } from '@lantern/shared/utils/aiCredits';
import type { CompanionAction, CompanionUserContext, Deck, StudyNote } from '../../types';
import { AppMode } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card, FeatureDisc, ScreenHeader } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import AICompanionPanel from '../AICompanionPanel';
import WalkthroughScreen from '../walkthrough/WalkthroughScreen';
import { ManageOutlineModal } from '../academic/ManageOutlineModal';
import ImportAndStudyModal from '../ImportAndStudyModal';
import { NotesStudio } from './NotesStudio';
import { AdaptiveQuiz } from './AdaptiveQuiz';
import { LectureStudio } from './LectureStudio';
import { LessonStudio } from './LessonStudio';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { useAcademicStore } from '../../stores/academicStore';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';
import { useCompanionStore } from '../../stores/companionStore';
import { useAuthStore } from '../../stores/authStore';
import { useNoteHandlers } from '../../hooks/useNoteHandlers';
import { useAiJobUserId } from '../../hooks/useAiJobs';
import { useAppNavigation } from '../../hooks/useAppNavigation';
import { runAiJob } from '../../stores/aiJobRunner';
import { touchWorkspaceRecent } from '../../utils/workspaceRecents';
import * as notesApi from '../../services/notes';
import { fetchCourseTopics } from '../../services/academic';
import { getApiRoot, getAuthHeaders } from '../../services/supabase';
import type { CourseTopic } from '../../types';
import type { SmartNotesRequestOptions } from '@lantern/shared/utils/smartNotes';

interface CourseWorkspaceProps {
  courseId: string;
  theme: 'light' | 'dark';
  companionContext?: CompanionUserContext;
  onCompanionAction?: (action: CompanionAction) => void;
  onSelectDeck: (deck: Deck) => void;
  onStartMatch: (deck: Deck) => void;
  onOpenNote: (noteId: string) => void;
  onNewTest: () => void;
  onOpenTest: (testId: string) => void;
  onOpenLibrary: () => void;
}

export const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  courseId,
  theme,
  companionContext,
  onCompanionAction,
  onSelectDeck,
  onStartMatch,
  onOpenNote,
  onNewTest,
  onOpenTest,
  onOpenLibrary,
}) => {
  const { navigateTo } = useAppNavigation();
  const currentUserId = useAuthStore((s) => s.currentUser?.id);
  const noteHandlers = useNoteHandlers(currentUserId);
  const aiJobUserId = useAiJobUserId();
  const showToast = useToastStore((s) => s.showToast);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const closeCompanion = useCompanionStore((s) => s.close);

  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const myCourses = useAcademicStore((s) => s.myCourses);

  const storeNotes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const decks = useFlashcardStore((s) => s.decks);
  const testResults = useTestStore((s) => s.testResults);

  const [fetchedNotes, setFetchedNotes] = useState<StudyNote[]>([]);
  const [fetchedTests, setFetchedTests] = useState<WorkspaceTestRow[]>([]);
  const [activity, setActivity] = useState<WorkspaceActivityId>('notes');
  const [importOpen, setImportOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [turning, setTurning] = useState(false);
  const [writingQuiz, setWritingQuiz] = useState(false);
  const [quizSeed, setQuizSeed] = useState<AdaptiveQuizItem[] | null>(null);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  const reloadNotes = useCallback(() => {
    return notesApi.fetchNotes({ courseId }).then((rows) => {
      setFetchedNotes(Array.isArray(rows) ? rows : []);
    });
  }, [courseId]);

  const reloadTests = useCallback(() => {
    return fetchWorkspaceTests(courseId).then(setFetchedTests);
  }, [courseId]);

  useEffect(() => {
    touchWorkspaceRecent(courseId);
    closeCompanion();
    void loadMyCourses();
  }, [courseId, loadMyCourses, closeCompanion]);

  useEffect(() => {
    let cancelled = false;
    void reloadNotes().catch(() => {
      if (!cancelled) setFetchedNotes([]);
    });
    void reloadTests().catch(() => {
      if (!cancelled) setFetchedTests([]);
    });
    void fetchCourseTopics(courseId)
      .then((rows) => {
        if (!cancelled) setTopics(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, reloadNotes, reloadTests]);

  const course = resolveCourse(courseId) ?? myCourses.find((row) => row.course.id === courseId)?.course;
  const label = course ? courseWorkspaceLabel(course) : 'Course';

  const notes = useMemo(() => {
    const byId = new Map<string, StudyNote>();
    for (const note of [...storeNotes, ...fetchedNotes]) {
      byId.set(note.id, note);
    }
    return materialsForCourse([...byId.values()], courseId);
  }, [storeNotes, fetchedNotes, courseId]);

  const courseDecks = useMemo(() => materialsForCourse(decks, courseId), [decks, courseId]);
  const lectures = useMemo(() => notes.filter(isLectureNote), [notes]);
  const lessons = useMemo(() => notes.filter(isLessonNote), [notes]);
  const steeredToLecture = useRef(false);
  useEffect(() => {
    steeredToLecture.current = false;
  }, [courseId]);
  useEffect(() => {
    if (steeredToLecture.current) return;
    if (lectureStatus === 'idle' || !lectureNoteId) return;
    if (!notes.some((row) => row.id === lectureNoteId)) return;
    setActivity('lecture');
    steeredToLecture.current = true;
  }, [courseId, lectureNoteId, lectureStatus, notes]);
  const noteIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const deckIds = useMemo(() => new Set(courseDecks.map((d) => d.id)), [courseDecks]);
  const courseTests = useMemo(() => {
    const byId = new Map<string, WorkspaceTestRow>();
    for (const row of [
      ...fetchedTests,
      ...testResults.map((result) => ({
        id: result.id,
        title: result.session.title || 'Test',
        courseId: result.session.config?.courseId,
        sourceNoteId: result.session.config?.sourceNoteId ?? undefined,
        sourceDeckId: result.session.config?.sourceDeckId ?? undefined,
      })),
    ]) {
      byId.set(row.id, row);
    }
    return testsFiledInCourse([...byId.values()], courseId, noteIds, deckIds);
  }, [fetchedTests, testResults, courseId, noteIds, deckIds]);

  const openNote = useCallback(
    async (noteId: string) => {
      await loadNote(noteId);
      const note = useNotesStore.getState().selectedNote;
      if (note) {
        void setActiveNoteContext({ id: note.id, title: note.title || 'Untitled note' });
      }
    },
    [loadNote, setActiveNoteContext]
  );

  useEffect(() => {
    if (activity !== 'lecture') return;
    const decision = resolveLectureStudioNote({
      lectures,
      selectedNoteId: selectedNote?.id,
      recordingNoteId: lectureNoteId && lectureStatus !== 'idle' ? lectureNoteId : null,
      todayTitle: newLectureNoteTitle(),
    });
    if (decision.action !== 'resume') return;
    if (selectedNote?.id === decision.noteId) return;
    void openNote(decision.noteId);
  }, [activity, lectureNoteId, lectureStatus, lectures, openNote, selectedNote?.id]);

  useEffect(() => {
    if (activity !== 'lesson') return;
    const decision = resolveLessonStudioNote({
      lessons,
      selectedNoteId: selectedNote?.id,
    });
    if (decision.action !== 'resume') return;
    if (selectedNote?.id === decision.noteId) return;
    void openNote(decision.noteId);
  }, [activity, lessons, openNote, selectedNote?.id]);

  const handleActivity = (id: WorkspaceActivityId, status: 'ready' | 'later') => {
    if (status === 'later') {
      showToast(WORKSPACE_LATER_COPY, 'info');
      return;
    }
    setActivity(id);
    if (id === 'quiz') setQuizSeed(null);
    if (id === 'lecture') {
      const decision = resolveLectureStudioNote({
        lectures,
        selectedNoteId: selectedNote?.id,
        recordingNoteId: lectureNoteId && lectureStatus !== 'idle' ? lectureNoteId : null,
        todayTitle: newLectureNoteTitle(),
      });
      if (decision.action === 'resume') {
        void openNote(decision.noteId);
      }
      return;
    }
    if (id === 'lesson') {
      const decision = resolveLessonStudioNote({
        lessons,
        selectedNoteId: selectedNote?.id,
      });
      if (decision.action === 'resume') {
        void openNote(decision.noteId);
      }
      return;
    }
    if (id === 'walkthrough') {
      const current = useNotesStore.getState().selectedNote;
      if (!current?.attachments?.find(isWalkableAttachment)) {
        const fallback = notes.find((row) => row.attachments?.some(isWalkableAttachment));
        if (fallback) void openNote(fallback.id);
      }
    }
    if (id === 'plan') {
      setOutlineOpen(true);
    }
  };

  const handleTurnInto = async (target: TurnIntoTargetId) => {
    if (!currentUserId) {
      showToast('Sign in to generate study materials.', 'error');
      return;
    }
    const note = useNotesStore.getState().selectedNote;
    if (!note || note.courseId !== courseId) {
      showToast('Select a note in this course first.', 'info');
      return;
    }
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    setTurning(true);
    try {
      const title = note.title || 'Untitled note';
      const workspacePath = `/study/courses/${encodeURIComponent(courseId)}`;
      if (target === 'cards') {
        const run = async () => noteHandlers.handleCreateFlashcardDeckFromNote(10);
        if (!aiJobUserId) {
          const result = await run();
          if (!result) throw new Error('Could not save a deck from this note.');
        } else {
          await runAiJob(
            {
              userId: aiJobUserId,
              kind: 'flashcards',
              title,
              stages: ['Reading your note', 'Writing flashcards', 'Saving your deck'],
              creditCost: AI_CREDIT_COSTS.generate_flashcards,
              target: { path: workspacePath, label: 'Back to course' },
            },
            async (report, hooks) => {
              report(1);
              const result = await noteHandlers.handleCreateFlashcardDeckFromNote(10, undefined, hooks);
              report(2);
              if (!result) throw new Error('Could not save a deck from this note.');
              return result;
            }
          );
        }
        showToast('Deck saved in this course.', 'success');
      } else {
        const run = async () => noteHandlers.handleStartNoteQuiz();
        if (!aiJobUserId) {
          const result = await run();
          if (!result) throw new Error('Could not save a test from this note.');
        } else {
          await runAiJob(
            {
              userId: aiJobUserId,
              kind: 'quiz',
              title,
              stages: ['Reading your note', 'Writing questions', 'Saving your test'],
              creditCost: AI_CREDIT_COSTS.generate_questions,
              target: { path: workspacePath, label: 'Back to course' },
            },
            async (report, hooks) => {
              report(1);
              const result = await noteHandlers.handleStartNoteQuiz(undefined, hooks);
              report(2);
              if (!result) throw new Error('Could not save a test from this note.');
              return result;
            }
          );
        }
        showToast('Practice test saved in this course.', 'success');
        void reloadTests().catch(() => undefined);
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not generate that.', 'error');
    } finally {
      setTurning(false);
    }
  };

  const handleWriteQuizQuestions = async (noteId: string) => {
    const note =
      notes.find((row) => row.id === noteId) ?? useNotesStore.getState().selectedNote;
    if (!note || note.courseId !== courseId) {
      throw new Error('Select a note in this course first.');
    }
    if (!hasEnoughNoteStudyContent(note)) {
      throw new Error('Add more study content to this note first.');
    }
    setWritingQuiz(true);
    try {
      const run = () =>
        notesApi.generateNoteQuiz(noteId, undefined, 10).then((row) => row.questions || []);
      if (!aiJobUserId) return run();
      const workspacePath = `/study/courses/${encodeURIComponent(courseId)}`;
      return runAiJob(
        {
          userId: aiJobUserId,
          kind: 'quiz',
          title: note.title || 'Untitled note',
          stages: ['Reading your note', 'Writing questions', 'Opening the quiz'],
          creditCost: AI_CREDIT_COSTS.generate_questions,
          target: { path: workspacePath, label: 'Back to course' },
        },
        async (report) => {
          report(1);
          const questions = await run();
          report(2);
          return questions;
        }
      );
    } finally {
      setWritingQuiz(false);
    }
  };

  const handleStudioSmartNote = async (
    editorState: { title?: string; body?: string },
    options?: SmartNotesRequestOptions
  ) => {
    const note = useNotesStore.getState().selectedNote;
    if (!note || note.courseId !== courseId) {
      throw new Error('Select a note in this course first.');
    }
    const run = () => noteHandlers.handleSmartNote(note.id, editorState, options);
    if (!aiJobUserId) return run();
    const workspacePath = `/study/courses/${encodeURIComponent(courseId)}`;
    return runAiJob(
      {
        userId: aiJobUserId,
        kind: 'smart_notes',
        title: editorState.title || note.title || 'Untitled note',
        stages: ['Reading your note', 'Writing Smart Notes', 'Saving to your note'],
        creditCost: getSmartNotesCreditCost(options?.depth),
        target: { path: workspacePath, label: 'Back to course' },
      },
      async (report) => {
        report(1);
        const summary = await run();
        report(2);
        return summary;
      }
    );
  };

  const walkable = selectedNote?.attachments?.find(isWalkableAttachment)
    || notes.find((row) => row.id === selectedNote?.id)?.attachments?.find(isWalkableAttachment);

  const studioNote = selectedNote
    ? {
        ...selectedNote,
        attachments:
          selectedNote.attachments?.length
            ? selectedNote.attachments
            : notes.find((row) => row.id === selectedNote.id)?.attachments,
      }
    : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
      <div className="px-4 md:px-6 pt-4 shrink-0">
        <ScreenHeader
          title={label}
          subtitle="Notes, cards, tests and lectures in one room"
          actions={
            <Button variant="secondary" onClick={() => navigateTo(AppMode.STUDY_HUB)}>
              All courses
            </Button>
          }
        />
        <div className="flex flex-wrap gap-1.5 pb-4">
          {WORKSPACE_ACTIVITIES.map((item) => {
            const active = activity === item.id && item.status === 'ready';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleActivity(item.id, item.status)}
                aria-pressed={active}
                title={item.promise}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-2.5 text-caption font-medium transition-colors ${
                  active
                    ? `border-transparent ${FEATURE_TINT_BG[item.feature]} ${FEATURE_INK_TEXT[item.feature]}`
                    : 'border-lantern-border bg-lantern-surface text-lantern-text-secondary hover:border-lantern-text-tertiary'
                } ${item.status === 'later' ? 'opacity-70' : ''}`}
              >
                <AppIcon name={item.icon} size={16} />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden px-4 md:px-6 pb-4 gap-4">
        <div className="flex flex-1 min-h-[32rem] gap-4 min-w-0 flex-col lg:flex-row">
        <aside className="w-full lg:w-72 shrink-0 flex flex-col min-h-0 lg:max-w-xs max-h-64 lg:max-h-none">
          <Card padding="md" className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-label uppercase text-lantern-text-secondary">Materials</h2>
              <button
                type="button"
                onClick={() => setImportOpen(true)}
                className="text-caption font-medium text-lantern-primary-text hover:underline"
              >
                Import
              </button>
            </div>
            <MaterialGroup
              title="Notes"
              empty="No notes in this course yet"
              items={notes.map((note) => ({
                id: note.id,
                label: note.title || 'Untitled note',
                feature: isLectureNote(note) ? ('recording' as const) : ('notes' as const),
                icon: isLectureNote(note) ? ('mic' as const) : ('document-text' as const),
                selected: selectedNote?.id === note.id,
                onClick: () => {
                  void openNote(note.id);
                  setActivity(isLectureNote(note) ? 'lecture' : isLessonNote(note) ? 'lesson' : 'notes');
                },
              }))}
            />
            <MaterialGroup
              title="Decks"
              empty="No decks filed here"
              items={courseDecks.map((deck) => ({
                id: deck.id,
                label: deck.name,
                feature: 'flashcards' as const,
                icon: 'layers' as const,
                selected: false,
                onClick: () => onSelectDeck(deck),
              }))}
            />
            <MaterialGroup
              title="Tests"
              empty="No tests from this course yet"
              items={courseTests.map((test) => ({
                id: test.id,
                label: test.title || 'Test',
                feature: 'tests' as const,
                icon: 'clipboard' as const,
                selected: false,
                onClick: () => onOpenTest(test.id),
              }))}
            />
            <MaterialGroup
              title="Lectures"
              empty="Record a lecture to file it here"
              items={lectures.map((note) => ({
                id: note.id,
                label: note.title || 'Lecture',
                feature: 'recording' as const,
                icon: 'mic' as const,
                selected: selectedNote?.id === note.id,
                onClick: () => {
                  void openNote(note.id);
                  setActivity('lecture');
                },
              }))}
            />
            <MaterialGroup
              title="Lessons"
              empty="Start a lesson from a note"
              items={lessons.map((note) => ({
                id: note.id,
                label: note.title || 'Lesson',
                feature: 'ai' as const,
                icon: 'school' as const,
                selected: selectedNote?.id === note.id,
                onClick: () => {
                  void openNote(note.id);
                  setActivity('lesson');
                },
              }))}
            />
            <button
              type="button"
              onClick={onOpenLibrary}
              className="mt-4 text-caption text-lantern-text-secondary hover:underline"
            >
              All materials in Library
            </button>
          </Card>
        </aside>

        <section className="hidden sm:flex flex-1 min-w-0 min-h-[32rem]">
          {activity === 'notes' && studioNote && studioNote.courseId === courseId ? (
            <NotesStudio
              note={studioNote}
              sourceAttachment={walkable}
              theme={theme}
              turning={turning}
              onTurnInto={(target) => void handleTurnInto(target)}
              onSmartNote={handleStudioSmartNote}
            />
          ) : activity === 'walkthrough' && selectedNote && walkable?.id ? (
            <WalkthroughScreen
              variant="pane"
              isOpen
              onClose={() => setActivity('notes')}
              noteId={selectedNote.id}
              noteTitle={selectedNote.title || 'Untitled note'}
              attachmentId={walkable.id}
              documentLabel={walkable.fileName}
              theme={theme}
            />
          ) : activity === 'quiz' ? (
            <AdaptiveQuiz
              courseId={courseId}
              theme={theme}
              notes={notes}
              selectedNoteId={selectedNote?.id}
              testIds={courseTests.map((test) => test.id)}
              canWalkthrough={Boolean(walkable)}
              writing={writingQuiz}
              seedItems={quizSeed}
              onWriteQuestions={handleWriteQuizQuestions}
              onOpenNotes={() => setActivity('notes')}
              onOpenWalkthrough={() => handleActivity('walkthrough', 'ready')}
            />
          ) : activity === 'lecture' ? (
            <LectureStudio
              courseId={courseId}
              theme={theme}
              note={
                selectedNote && (isLectureNote(selectedNote) || selectedNote.id === lectureNoteId)
                  ? selectedNote
                  : lectures.find((row) => row.id === lectureNoteId) || null
              }
              lectures={lectures}
              turning={turning}
              onTurnInto={(target) => void handleTurnInto(target)}
              onSmartNote={handleStudioSmartNote}
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
            />
          ) : activity === 'lesson' ? (
            <LessonStudio
              courseId={courseId}
              theme={theme}
              notes={notes}
              selectedNote={selectedNote && selectedNote.courseId === courseId ? selectedNote : null}
              turning={turning}
              onTurnInto={(target) => void handleTurnInto(target)}
              onOpenQuiz={(items) => {
                setQuizSeed(items);
                setActivity('quiz');
              }}
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
            />
          ) : (
          <Card padding="lg" className="flex-1 min-h-0 overflow-y-auto">
            {activity === 'notes' && (
              <div className="space-y-4">
                <h2 className="text-heading">Notes</h2>
                <p className="text-body text-lantern-text-secondary">
                  Pick a note from the list, or import material into this course.
                </p>
              </div>
            )}
            {activity === 'walkthrough' && (
              <div className="space-y-4">
                <h2 className="text-heading">Walkthrough</h2>
                <p className="text-body text-lantern-text-secondary">
                  Select a note with a PDF or slides attached.
                </p>
              </div>
            )}
            {activity === 'cards' && (
              <div className="space-y-3">
                <h2 className="text-heading">Cards</h2>
                {courseDecks.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">
                    Turn a note into flashcards, or open Library to file an existing deck here.
                  </p>
                ) : (
                  courseDecks.map((deck) => (
                    <button
                      key={deck.id}
                      type="button"
                      onClick={() => onSelectDeck(deck)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-lantern-border text-left hover:bg-lantern-background-secondary"
                    >
                      <FeatureDisc feature="flashcards" icon={<AppIcon name="layers" size={20} />} />
                      <span className="text-body font-semibold truncate">{deck.name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {activity === 'test' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-heading">Test</h2>
                  <Button size="sm" onClick={onNewTest}>
                    New test
                  </Button>
                </div>
                {courseTests.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">
                    Turn a note into a practice test, or build one from this course’s decks.
                  </p>
                ) : (
                  courseTests.map((test) => (
                    <button
                      key={test.id}
                      type="button"
                      onClick={() => onOpenTest(test.id)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-lantern-border text-left hover:bg-lantern-background-secondary"
                    >
                      <FeatureDisc feature="tests" icon={<AppIcon name="clipboard" size={20} />} />
                      <span className="text-body font-semibold truncate">{test.title || 'Test'}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            {activity === 'play' && (
              <div className="space-y-3">
                <h2 className="text-heading">Play</h2>
                <p className="text-caption text-lantern-text-secondary">Match game from this course’s cards.</p>
                {courseDecks.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">File a deck in this course first.</p>
                ) : (
                  courseDecks.map((deck) => (
                    <Button key={deck.id} variant="secondary" onClick={() => onStartMatch(deck)}>
                      Match · {deck.name}
                    </Button>
                  ))
                )}
              </div>
            )}
            {activity === 'plan' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-heading">Plan</h2>
                  <Button size="sm" onClick={() => setOutlineOpen(true)}>
                    Edit outline
                  </Button>
                </div>
                {topics.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">
                    Add topics so this course has a syllabus to study against.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {topics.map((topic) => (
                      <li key={topic.id} className="text-body">
                        {topic.title}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}
            {activity === 'lecture' && (
              <p className="text-body text-lantern-text-secondary">Open lecture on a wider screen.</p>
            )}
            {activity === 'lesson' && (
              <p className="text-body text-lantern-text-secondary">Open lesson on a wider screen.</p>
            )}
          </Card>
          )}
        </section>
        </div>

        <aside className="flex w-full lg:w-80 h-72 lg:h-auto shrink-0 min-h-0">
          <div className="flex-1 min-h-0 rounded-lantern-xl border border-lantern-border overflow-hidden">
            <AICompanionPanel
              variant="rail"
              context={companionContext}
              onAction={onCompanionAction}
              theme={theme}
            />
          </div>
        </aside>
      </div>

      <ManageOutlineModal
        isOpen={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        courseId={courseId}
        courseLabel={label}
        onChanged={() => {
          void fetchCourseTopics(courseId).then((rows) => setTopics(Array.isArray(rows) ? rows : []));
        }}
      />
      {importOpen && (
        <ImportAndStudyModal
          isOpen={importOpen}
          courseId={courseId}
          onClose={() => setImportOpen(false)}
          onComplete={() => {
            void reloadNotes().catch(() => undefined);
          }}
          onOpenNote={(noteId) => {
            setImportOpen(false);
            void openNote(noteId);
            setActivity('notes');
          }}
        />
      )}
    </div>
  );
};

function MaterialGroup({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{
    id: string;
    label: string;
    feature: 'notes' | 'flashcards' | 'tests' | 'recording' | 'ai';
    icon: 'document-text' | 'layers' | 'clipboard' | 'mic' | 'school';
    selected: boolean;
    onClick: () => void;
  }>;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-label text-lantern-text-secondary mb-1">{title}</h3>
      {items.length === 0 ? (
        <p className="text-caption text-lantern-text-tertiary">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={item.onClick}
                className={`w-full flex items-center gap-2 p-2 rounded-lg text-left ${
                  item.selected ? 'bg-lantern-background-secondary' : 'hover:bg-lantern-background-secondary'
                }`}
              >
                <FeatureDisc feature={item.feature} icon={<AppIcon name={item.icon} size={14} />} size={24} />
                <span className="text-body truncate">{item.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default CourseWorkspace;

interface WorkspaceTestRow {
  id: string;
  title: string;
  courseId?: string | null;
  sourceNoteId?: string | null;
  sourceDeckId?: string | null;
}

async function fetchWorkspaceTests(courseId: string): Promise<WorkspaceTestRow[]> {
  const params = new URLSearchParams({
    courseId,
    lean: '1',
    page: '1',
    limit: '100',
    sort: 'newest',
  });
  const doFetch = async () =>
    fetch(`${getApiRoot()}/api/v1/tests?${params.toString()}`, {
      headers: await getAuthHeaders(),
    });
  let response = await doFetch();
  if (response.status === 401 || response.status === 403) {
    const { handleApiAuthFailure } = await import('../../services/sessionHandler');
    if (await handleApiAuthFailure(response.status)) {
      response = await doFetch();
    } else {
      return [];
    }
  }
  if (!response.ok) return [];
  const payload = (await response.json()) as { data?: unknown };
  const rows = Array.isArray(payload.data) ? payload.data : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (!id) return [];
    const config =
      record.config && typeof record.config === 'object'
        ? (record.config as Record<string, unknown>)
        : {};
    const session =
      record.session && typeof record.session === 'object'
        ? (record.session as Record<string, unknown>)
        : {};
    const sessionConfig =
      session.config && typeof session.config === 'object'
        ? (session.config as Record<string, unknown>)
        : {};
    const title =
      (typeof record.title === 'string' && record.title) ||
      (typeof config.name === 'string' && config.name) ||
      (typeof session.title === 'string' && session.title) ||
      'Test';
    return [
      {
        id,
        title,
        courseId:
          (typeof record.courseId === 'string' && record.courseId) ||
          (typeof sessionConfig.courseId === 'string' && sessionConfig.courseId) ||
          courseId,
        sourceNoteId:
          (typeof record.sourceNoteId === 'string' && record.sourceNoteId) ||
          (typeof config.sourceNoteId === 'string' && config.sourceNoteId) ||
          (typeof sessionConfig.sourceNoteId === 'string' && sessionConfig.sourceNoteId) ||
          null,
        sourceDeckId:
          (typeof record.sourceDeckId === 'string' && record.sourceDeckId) ||
          (typeof config.sourceDeckId === 'string' && config.sourceDeckId) ||
          (typeof sessionConfig.sourceDeckId === 'string' && sessionConfig.sourceDeckId) ||
          null,
      },
    ];
  });
}
