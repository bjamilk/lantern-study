import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  WORKSPACE_ACTIVITIES,
  scopeNoun,
  scopedCopy,
  workspaceActivityPromise,
  WORKSPACE_LATER_COPY,
  courseWorkspaceLabel,
  formatCourseMaterialCounts,
  hasEnoughNoteStudyContent,
  isCalendarNote,
  isEssayNote,
  isLectureNote,
  isLessonNote,
  isRecapNote,
  isWalkableAttachment,
  materialsForCourse,
  materialsForStudySet,
  newLectureNoteTitle,
  studySetLabel,
  studySetNotePayload,
  resolveCalendarStudioNote,
  resolveEssayStudioNote,
  resolveLectureStudioNote,
  resolveLessonStudioNote,
  resolveRecapStudioNote,
  testsFiledInCourse,
  testsFiledInStudySet,
  buildStudySetPath,
  firstQuestionPreview,
  resumeKindFromActivity,
  upcomingExamsFromNotes,
  workspaceActivityFromPath,
  type AdaptiveQuizItem,
  type StudyCalendarSession,
  type StudySetHomeTool,
  type StudySetRecommendedKind,
  type StudySetUnit,
  topicsFromReadingNotes,
  type StudySetPath,
  type StudySetPathActivity,
  type MessageNoteDraft,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, getSmartNotesCreditCost } from '@lantern/shared/utils/aiCredits';
import { pluralize } from '@lantern/shared/utils/plural';
import type { CompanionAction, CompanionUserContext, Deck, StudyNote } from '../../types';
import { AppMode } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card, FeatureDisc, ScreenHeader } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import AICompanionPanel from '../AICompanionPanel';
import WalkthroughScreen from '../walkthrough/WalkthroughScreen';
import { ManageOutlineModal } from '../academic/ManageOutlineModal';
import ImportAndStudyModal from '../ImportAndStudyModal';
import { ClassOfficialMaterials } from '../classes/ClassOfficialMaterials';
import { NotesStudio } from './NotesStudio';
import { AdaptiveQuiz } from './AdaptiveQuiz';
import { LectureStudio } from './LectureStudio';
import { LessonStudio } from './LessonStudio';
import { RecapStudio } from './RecapStudio';
import { StudyCalendar } from './StudyCalendar';
import { EssayStudio } from './EssayStudio';
import { PlayStudio } from './PlayStudio';
import { StudySetHome } from './StudySetHome';
import CreateStudySetModal from './CreateStudySetModal';
import { StudySetSettingsModal } from './StudySetSettingsModal';
import { StudySetTimer } from './StudySetTimer';
import { StudySetUpload } from './StudySetUpload';
import { CreateFromSource, parseCardExport } from './CreateFromSource';
import { createDeckWithCards } from '../../services/apiEndpoints';
import { StudySetPlanPanel } from './StudySetPlanPanel';
import { StudySetArtifactLibrary } from './StudySetArtifactLibrary';
import { StudySetGuidedPrompts } from './StudySetGuidedPrompts';
import { StudyWorkspaceBar } from './StudyWorkspaceBar';
import { fetchStudySetPlan, replaceStudySetPlan, updateStudySetTopicStatus } from '../../services/academic';
import { useStudyResumeStore } from '../../stores/studyResumeStore';
import type { StudySetTopic } from '@lantern/shared';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { useAcademicStore } from '../../stores/academicStore';
import { useStudySetStore } from '../../stores/studySetStore';
import { CoursePicker } from '../academic/CoursePicker';
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
  courseId?: string;
  studySetId?: string;
  routePath?: StudySetPath | null;
  theme: 'light' | 'dark';
  companionContext?: CompanionUserContext;
  onCompanionAction?: (action: CompanionAction) => void;
  onSelectDeck: (deck: Deck) => void;
  onStartMatch: (deck: Deck) => void;
  onStartCram: (deck: Deck, timerSeconds?: number, cardIds?: string[]) => void;
  onOpenNote: (noteId: string) => void;
  onNewTest: () => void;
  onOpenTest: (testId: string) => void;
  onOpenLibrary: () => void;
}

export const CourseWorkspace: React.FC<CourseWorkspaceProps> = ({
  courseId: courseIdProp,
  studySetId,
  routePath,
  theme,
  companionContext,
  onCompanionAction,
  onSelectDeck,
  onStartMatch,
  onStartCram,
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
  const companionNote = useCompanionStore((s) => s.activeNoteContext);
  const closeCompanion = useCompanionStore((s) => s.close);
  const resetCompanionForScope = useCompanionStore((s) => s.resetForScope);

  const loadMyCourses = useAcademicStore((s) => s.loadMyCourses);
  const resolveCourse = useAcademicStore((s) => s.resolveCourse);
  const myCourses = useAcademicStore((s) => s.myCourses);
  const loadSets = useStudySetStore((s) => s.loadSets);
  const updateSet = useStudySetStore((s) => s.updateSet);
  const createSet = useStudySetStore((s) => s.createSet);
  const touchOpened = useStudySetStore((s) => s.touchOpened);
  const openPicker = useStudySetStore((s) => s.openPicker);
  const folders = useStudySetStore((s) => s.folders);
  const loadFolders = useStudySetStore((s) => s.loadFolders);
  const sets = useStudySetStore((s) => s.sets);
  const studySet = useStudySetStore((s) => (studySetId ? s.resolveSet(studySetId) : null));
  const courseId = studySet?.courseId || courseIdProp || '';
  type RoomActivity = WorkspaceActivityId | 'home' | 'add';

  const storeNotes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const decks = useFlashcardStore((s) => s.decks);
  const flashcards = useFlashcardStore((s) => s.flashcards);
  const testResults = useTestStore((s) => s.testResults);

  const [fetchedNotes, setFetchedNotes] = useState<StudyNote[]>([]);
  const [fetchedTests, setFetchedTests] = useState<WorkspaceTestRow[]>([]);
  const [activity, setActivity] = useState<RoomActivity>(
    studySetId ? (workspaceActivityFromPath(routePath?.activity) === 'add' ? 'add' : workspaceActivityFromPath(routePath?.activity)) : 'notes'
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [topics, setTopics] = useState<CourseTopic[]>([]);
  const [turning, setTurning] = useState(false);
  // A turn-into asked for a note the room had not opened; it runs once that
  // note is the selected one.
  const [pendingTurnInto, setPendingTurnInto] = useState<{ target: TurnIntoTargetId; noteId: string } | null>(null);
  const [writingQuiz, setWritingQuiz] = useState(false);
  const [quizSeed, setQuizSeed] = useState<AdaptiveQuizItem[] | null>(null);
  const [planTopics, setPlanTopics] = useState<StudySetTopic[]>([]);
  const [planUnits, setPlanUnits] = useState<StudySetUnit[]>([]);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [quizQuestionCount, setQuizQuestionCount] = useState(10);
  const [importSource, setImportSource] = useState<'pdf' | 'ppt' | 'audio' | 'video' | 'youtube' | 'paste' | null>(null);
  const [companionRail, setCompanionRail] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
  );
  const [createKind, setCreateKind] = useState<'recap' | 'lesson' | null>(null);
  const [quizLive, setQuizLive] = useState(false);
  const recordActivity = useStudyResumeStore((s) => s.recordActivity);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  const reloadNotes = useCallback(() => {
    return notesApi
      .fetchNotes(
        studySetId ? { studySetId } : courseId ? { courseId } : {}
      )
      .then((rows) => {
        setFetchedNotes(Array.isArray(rows) ? rows : []);
      });
  }, [courseId, studySetId]);

  const reloadTests = useCallback(() => {
    if (!courseId && !studySetId) {
      setFetchedTests([]);
      return Promise.resolve();
    }
    return fetchWorkspaceTests({ courseId, studySetId }).then(setFetchedTests);
  }, [courseId, studySetId]);

  useEffect(() => {
    void loadSets().catch(() => undefined);
    void loadFolders().catch(() => undefined);
  }, [loadFolders, loadSets]);

  useEffect(() => {
    if (!studySetId) return;
    touchOpened(studySetId);
  }, [studySetId, touchOpened]);

  useEffect(() => {
    if (!studySetId) {
      setPlanTopics([]);
      setPlanUnits([]);
      return;
    }
    let cancelled = false;
    void fetchStudySetPlan(studySetId)
      .then((data) => {
        if (cancelled) return;
        applyPlanPayload(data, setPlanUnits, setPlanTopics);
      })
      .catch(() => {
        if (!cancelled) {
          setPlanTopics([]);
          setPlanUnits([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studySetId]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setCompanionRail(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (!routePath) return;
    setActivity(workspaceActivityFromPath(routePath.activity));
  }, [routePath?.activity, routePath?.createNew]);

  useEffect(() => {
    if (courseId) touchWorkspaceRecent(courseId);
    closeCompanion();
    // The attachment belongs to the room it was made in. Watching `courseId`
    // alone let a note attached in one course-less set stay stapled to every
    // question asked in the next one, so the set id leads here.
    resetCompanionForScope(studySetId ?? courseId ?? null);
    void loadMyCourses();
  }, [courseId, studySetId, loadMyCourses, closeCompanion, resetCompanionForScope]);

  useEffect(() => {
    let cancelled = false;
    void reloadNotes().catch(() => {
      if (!cancelled) setFetchedNotes([]);
    });
    void reloadTests().catch(() => {
      if (!cancelled) setFetchedTests([]);
    });
    if (!courseId) {
      setTopics([]);
      return () => {
        cancelled = true;
      };
    }
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
  }, [courseId, studySetId, reloadNotes, reloadTests]);

  const course = resolveCourse(courseId) ?? myCourses.find((row) => row.course.id === courseId)?.course;
  const label = studySetId ? studySetLabel(studySet || { title: '' }) : course ? courseWorkspaceLabel(course) : 'Course';
  const roomNoun = scopeNoun(studySetId, courseId);
  const workspacePath = studySetId
    ? `/study/sets/${encodeURIComponent(studySetId)}`
    : `/study/courses/${encodeURIComponent(courseId)}`;

  const go = useCallback(
    (next: RoomActivity | StudySetPathActivity, extras: Partial<StudySetPath> = {}) => {
      const pathActivity: StudySetPathActivity =
        next === 'add'
          ? 'add'
          : next === 'home'
            ? 'home'
            : (extras.activity as StudySetPathActivity | undefined) ??
              (next as StudySetPathActivity);
      if (studySetId) {
        const href = buildStudySetPath({
          studySetId,
          activity: pathActivity,
          noteId: extras.noteId,
          deckId: extras.deckId,
          testId: extras.testId,
          quizId: extras.quizId,
          createNew: extras.createNew,
          cardSession: extras.cardSession,
          playSession: extras.playSession,
        });
        recordActivity({
          kind: resumeKindFromActivity(pathActivity),
          title: label,
          studySetId,
          href,
          at: new Date().toISOString(),
        });
        navigateTo(AppMode.STUDY_SET_WORKSPACE, {
          studySetId,
          workspaceActivity: pathActivity,
          noteId: extras.noteId,
          deckId: extras.deckId,
          testId: extras.testId,
          quizId: extras.quizId,
          createNew: extras.createNew,
          cardSession: extras.cardSession,
          playSession: extras.playSession,
        });
        return;
      }
      setActivity(workspaceActivityFromPath(pathActivity));
    },
    [label, navigateTo, recordActivity, studySetId]
  );
  const noteInRoom = (note: { courseId?: string | null; studySetId?: string | null } | null | undefined) => {
    if (!note) return false;
    return studySetId ? note.studySetId === studySetId : note.courseId === courseId;
  };

  const filedNotes = useMemo(() => {
    const byId = new Map<string, StudyNote>();
    for (const note of [...storeNotes, ...fetchedNotes]) {
      byId.set(note.id, note);
    }
    const all = [...byId.values()];
    return studySetId ? materialsForStudySet(all, studySetId) : materialsForCourse(all, courseId);
  }, [storeNotes, fetchedNotes, courseId, studySetId]);
  const calendars = useMemo(() => filedNotes.filter(isCalendarNote), [filedNotes]);
  const notes = useMemo(() => filedNotes.filter((note) => !isCalendarNote(note)), [filedNotes]);
  const readingNotes = useMemo(
    () =>
      notes.filter(
        (note) =>
          !isLectureNote(note) &&
          !isLessonNote(note) &&
          !isRecapNote(note) &&
          !isEssayNote(note)
      ),
    [notes]
  );

  const courseDecks = useMemo(
    () => (studySetId ? materialsForStudySet(decks, studySetId) : materialsForCourse(decks, courseId)),
    [decks, courseId, studySetId]
  );
  const lectures = useMemo(() => notes.filter(isLectureNote), [notes]);
  const lessons = useMemo(() => notes.filter(isLessonNote), [notes]);
  const recaps = useMemo(() => notes.filter(isRecapNote), [notes]);
  const essays = useMemo(() => notes.filter(isEssayNote), [notes]);
  const homeMaterials = useMemo(
    () =>
      [...readingNotes, ...lectures].sort((a, b) =>
        (b.updatedAt || '').localeCompare(a.updatedAt || '')
      ),
    [lectures, readingNotes]
  );
  const exams = useMemo(() => upcomingExamsFromNotes(calendars), [calendars]);
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
    const rows = [...byId.values()];
    return studySetId
      ? testsFiledInStudySet(rows, studySetId, noteIds, deckIds)
      : testsFiledInCourse(rows, courseId, noteIds, deckIds);
  }, [fetchedTests, testResults, courseId, studySetId, noteIds, deckIds]);

  const openNote = useCallback(
    async (noteId: string) => {
      await loadNote(noteId);
      const note = useNotesStore.getState().selectedNote;
      if (note) {
        void setActiveNoteContext({
          id: note.id,
          title: note.title || 'Untitled note',
          scopeId: studySetId ?? courseId ?? null,
        });
      }
    },
    [loadNote, setActiveNoteContext, studySetId, courseId]
  );

  useEffect(() => {
    if (routePath?.noteId) void openNote(routePath.noteId);
  }, [routePath?.noteId, openNote]);

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

  useEffect(() => {
    if (activity !== 'recap') return;
    const decision = resolveRecapStudioNote({
      recaps,
      selectedNoteId: selectedNote?.id,
    });
    if (decision.action !== 'resume') return;
    if (selectedNote?.id === decision.noteId) return;
    void openNote(decision.noteId);
  }, [activity, recaps, openNote, selectedNote?.id]);

  useEffect(() => {
    if (activity !== 'essay') return;
    const decision = resolveEssayStudioNote({
      essays,
      selectedNoteId: selectedNote?.id,
    });
    if (decision.action !== 'resume') return;
    if (selectedNote?.id === decision.noteId) return;
    void openNote(decision.noteId);
  }, [activity, essays, openNote, selectedNote?.id]);

  const openSetChat = (message?: string) => {
    if (message) useCompanionStore.getState().openWithMessage(message);
    else useCompanionStore.getState().open();
  };

  const kickPlanGeneration = useCallback(async () => {
    if (!studySetId || planTopics.length > 0 || planGenerating) return;
    setPlanGenerating(true);
    try {
      const existing = await fetchStudySetPlan(studySetId);
      const existingTopics = Array.isArray((existing as { topics?: StudySetTopic[] })?.topics)
        ? (existing as { topics: StudySetTopic[] }).topics
        : [];
      if (existingTopics.length > 0) {
        applyPlanPayload(existing, setPlanUnits, setPlanTopics);
        return;
      }
      const rows = await notesApi.fetchNotes({ studySetId });
      const sourceNotes = (Array.isArray(rows) ? rows : []).filter(
        (note) =>
          !isCalendarNote(note) &&
          !isLessonNote(note) &&
          !isRecapNote(note) &&
          !isEssayNote(note)
      );
      const built = topicsFromReadingNotes(studySetId, sourceNotes);
      if (built.topics.length === 0) return;
      const saved = await replaceStudySetPlan(studySetId, {
        units: [{ title: built.unit.title, position: built.unit.position }],
        topics: built.topics.map((topic) => ({
          unitIndex: 0,
          title: topic.title,
          position: topic.position,
          status: topic.status,
          sourceNoteIds: topic.sourceNoteIds,
        })),
      });
      applyPlanPayload(saved, setPlanUnits, setPlanTopics);
    } catch {
      // Local fallback stays on set home until the student opens Plan.
    } finally {
      setPlanGenerating(false);
    }
  }, [planGenerating, planTopics.length, studySetId]);

  const handleHomeTool = (tool: StudySetHomeTool) => {
    if (tool.id === 'import') {
      go('add');
      return;
    }
    if (tool.id === 'ask') {
      openSetChat(`Help me study ${label}. What should I do next in this set?`);
      return;
    }
    if (tool.id === 'recap' && recaps.length === 0) setCreateKind('recap');
    if (tool.id === 'lesson' && lessons.length === 0) setCreateKind('lesson');
    if (tool.activity) handleActivity(tool.activity, 'ready');
  };

  /**
   * File one chat answer as a note in THIS room, then run the ordinary
   * turn-into on it.
   *
   * Saving first is not a detour: the four studios open on a note, the
   * generation jobs read a note, and a student who paid for a deck should be
   * able to find the text it came from. `handleTurnInto` then does the rest —
   * credits, the delivery UI, the ticks — so a message and a note never drift
   * into two different prices or two different destinations.
   */
  const handleTurnIntoMessage = async (target: TurnIntoTargetId, draft: MessageNoteDraft) => {
    if (!currentUserId) {
      showToast('Sign in to save this answer.', 'error');
      return;
    }
    let created: StudyNote;
    try {
      created = await useNotesStore.getState().createNote({
        ...draft,
        ...studySetNotePayload({ courseId, studySetId }),
      });
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not save that answer as a note.',
        'error'
      );
      return;
    }
    void reloadNotes().catch(() => undefined);
    showToast(`Answer saved as a note in this ${roomNoun}.`, 'success');
    await handleTurnInto(target, created.id);
  };

  const handleNewNote = async () => {
    const created = await useNotesStore.getState().createNote({
      title: 'Untitled note',
      body: '',
      ...studySetNotePayload({ courseId, studySetId }),
    });
    await openNote(created.id);
    void reloadNotes().catch(() => undefined);
    go('notes', { noteId: created.id });
  };

  const handleActivity = (id: WorkspaceActivityId, status: 'ready' | 'later') => {
    if (status === 'later') {
      showToast(WORKSPACE_LATER_COPY, 'info');
      return;
    }
    go(id);
    if (id === 'quiz') {
      setQuizSeed(null);
      setQuizLive(false);
    }
    if (id === 'notes') {
      const current = useNotesStore.getState().selectedNote;
      if (
        current &&
        (isCalendarNote(current) ||
          isEssayNote(current) ||
          isLectureNote(current) ||
          isLessonNote(current) ||
          isRecapNote(current))
      ) {
        if (readingNotes[0]) void openNote(readingNotes[0].id);
      }
    }
    if (id === 'essay') {
      const decision = resolveEssayStudioNote({
        essays,
        selectedNoteId: selectedNote?.id,
      });
      if (decision.action === 'resume') {
        void openNote(decision.noteId);
      }
      return;
    }
    if (id === 'plan') {
      const decision = resolveCalendarStudioNote({
        calendars,
        selectedNoteId: selectedNote?.id,
      });
      if (decision.action === 'resume') {
        void openNote(decision.noteId);
      }
      return;
    }
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
    if (id === 'recap') {
      const decision = resolveRecapStudioNote({
        recaps,
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
  };

  const openCalendarSession = async (session: StudyCalendarSession) => {
    if (session.kind === 'cards') {
      const deck = courseDecks.find((row) => row.id === session.targetId) || courseDecks[0];
      if (!deck) {
        showToast(`File a deck in this ${roomNoun} first.`, 'info');
        return;
      }
      const deckCards = flashcards.filter((card) => card.deckId === deck.id);
      if (deckCards.length === 0) {
        onSelectDeck(deck);
        return;
      }
      onStartCram(deck);
      return;
    }
    if (session.targetId) await openNote(session.targetId);
    setQuizSeed(null);
    setActivity('quiz');
  };

  // Tick targets already made from a note so nobody pays for a second copy.
  // Decks carry no source-note link, so only tests can be ticked.
  const turnIntoExisting = useCallback(
    (noteId: string): Partial<Record<TurnIntoTargetId, boolean>> => ({
      test: courseTests.some((row) => row.sourceNoteId === noteId),
    }),
    [courseTests]
  );

  /**
   * Turn-into always acts on the note the caller names, not on whatever the
   * room happens to have open: the companion can attach a note the room has
   * never opened. The note handlers read the SELECTED note, so a named note
   * that is not selected has to be opened first, and the work has to wait for
   * that to land (see `pendingTurnInto` below) — running in the same tick
   * would generate from the previously selected note.
   */
  const handleTurnInto = async (target: TurnIntoTargetId, noteId?: string) => {
    if (!currentUserId) {
      showToast('Sign in to generate study materials.', 'error');
      return;
    }
    if (noteId && useNotesStore.getState().selectedNote?.id !== noteId) {
      await openNote(noteId);
      if (useNotesStore.getState().selectedNote?.id !== noteId) {
        showToast('Could not open that note.', 'error');
        return;
      }
      setPendingTurnInto({ target, noteId });
      return;
    }
    const note = useNotesStore.getState().selectedNote;
    if (!note || !noteInRoom(note)) {
      showToast(`Select a note in this ${roomNoun} first.`, 'info');
      return;
    }
    // Lesson, recap, essay and play are places, not jobs. Opening the studio
    // IS the action; whatever that studio asks of a model bills there, which
    // is why none of these four start a generation run here.
    if (target === 'lesson' || target === 'recap' || target === 'essay' || target === 'play') {
      go(target, target === 'play' ? {} : { noteId: note.id });
      return;
    }
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    setTurning(true);
    try {
      const title = note.title || 'Untitled note';
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
              target: { path: workspacePath, label: studySetId ? 'Back to set' : 'Back to course' },
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
        showToast(`Deck saved in this ${roomNoun}.`, 'success');
        setActivity('cards');
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
              target: { path: workspacePath, label: studySetId ? 'Back to set' : 'Back to course' },
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
        showToast(`Practice test saved in this ${roomNoun}.`, 'success');
        void reloadTests().catch(() => undefined);
        setActivity('test');
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not generate that.', 'error');
    } finally {
      setTurning(false);
    }
  };

  // The deferred half of `handleTurnInto`: the note it was asked for is now
  // both loaded and selected, so the note handlers — which close over the
  // selected note — will read the right one.
  useEffect(() => {
    if (!pendingTurnInto || selectedNote?.id !== pendingTurnInto.noteId) return;
    const { target } = pendingTurnInto;
    setPendingTurnInto(null);
    void handleTurnInto(target);
    // handleTurnInto is re-created every render; re-running on its identity
    // would fire the job twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTurnInto, selectedNote?.id]);

  const handleWriteQuizQuestions = async (noteId: string) => {
    const note =
      notes.find((row) => row.id === noteId) ?? useNotesStore.getState().selectedNote;
    if (!note || !noteInRoom(note)) {
      throw new Error(`Select a note in this ${roomNoun} first.`);
    }
    if (!hasEnoughNoteStudyContent(note)) {
      throw new Error('Add more study content to this note first.');
    }
    setWritingQuiz(true);
    try {
      const run = () =>
        notesApi.generateNoteQuiz(noteId, undefined, quizQuestionCount).then((row) => row.questions || []);
      if (!aiJobUserId) return run();
      return runAiJob(
        {
          userId: aiJobUserId,
          kind: 'quiz',
          title: note.title || 'Untitled note',
          stages: ['Reading your note', 'Writing questions', 'Opening the quiz'],
          creditCost: AI_CREDIT_COSTS.generate_questions,
          target: { path: workspacePath, label: studySetId ? 'Back to set' : 'Back to course' },
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
    if (!note || !noteInRoom(note)) {
      throw new Error(`Select a note in this ${roomNoun} first.`);
    }
    const run = () => noteHandlers.handleSmartNote(note.id, editorState, options);
    if (!aiJobUserId) return run();
    return runAiJob(
      {
        userId: aiJobUserId,
        kind: 'smart_notes',
        title: editorState.title || note.title || 'Untitled note',
        stages: ['Reading your note', 'Writing Smart Notes', 'Saving to your note'],
        creditCost: getSmartNotesCreditCost(options?.depth),
        target: { path: workspacePath, label: studySetId ? 'Back to set' : 'Back to course' },
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
      <StudyWorkspaceBar
        active="study"
        onSelect={(section) => {
          if (section === 'library') onOpenLibrary();
        }}
      />
      <div className="px-4 md:px-6 pt-4 shrink-0">
        <ScreenHeader
          title={label}
          subtitle={
            studySetId ? undefined : 'Notes, cards, tests and lectures in one room'
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {studySetId ? <StudySetTimer setId={studySetId} /> : null}
              {!companionRail ? (
                <Button
                  variant="secondary"
                  onClick={() => openSetChat()}
                  aria-label="Chat"
                >
                  <AppIcon name="chatbubbles" size={16} />
                  <span className="ml-1.5">Chat</span>
                </Button>
              ) : null}
              {studySetId && activity !== 'home' ? (
                <Button variant="secondary" onClick={() => go('home')}>
                  Set home
                </Button>
              ) : null}
              {studySetId ? (
                <Button variant="secondary" onClick={() => setSettingsOpen(true)} aria-label="Study set settings">
                  <AppIcon name="settings" size={16} />
                </Button>
              ) : null}
              {studySetId && sets.length > 1 ? (
                <label className="sr-only" htmlFor="study-set-switcher">
                  Switch study set
                </label>
              ) : null}
              {studySetId && sets.length > 0 ? (
                <select
                  id="study-set-switcher"
                  value={studySetId}
                  onChange={(event) => {
                    if (event.target.value === '__new') {
                      setCreateOpen(true);
                      return;
                    }
                    navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId: event.target.value });
                  }}
                  className="min-h-[44px] rounded-xl border border-lantern-border bg-lantern-surface px-3 text-caption text-lantern-text"
                >
                  {sets.map((set) => (
                    <option key={set.id} value={set.id}>
                      {studySetLabel(set)}
                    </option>
                  ))}
                  <option value="__new">New study set…</option>
                </select>
              ) : null}
              <Button
                variant="secondary"
                onClick={() => {
                  if (studySetId) openPicker();
                  navigateTo(AppMode.STUDY_HUB);
                }}
              >
                {studySetId ? 'All study sets' : 'All courses'}
              </Button>
            </div>
          }
        />
        {!(studySetId && activity === 'home') ? (
        <div className="flex flex-wrap gap-1.5 pb-4">
          {WORKSPACE_ACTIVITIES.map((item) => {
            const active = activity === item.id && item.status === 'ready';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleActivity(item.id, item.status)}
                aria-pressed={active}
                title={workspaceActivityPromise(item.id, item.promise, scopeNoun(studySetId, courseId))}
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
        ) : null}
      </div>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden px-4 md:px-6 pb-4 gap-4">
        <div className="flex flex-1 min-h-[18rem] lg:min-h-[32rem] gap-4 min-w-0 flex-col lg:flex-row">
        {!(studySetId && activity === 'home') ? (
        <aside className="w-full lg:w-72 shrink-0 flex flex-col min-h-0 lg:max-w-xs max-h-[min(62vh,36rem)] lg:max-h-none">
          <Card padding="md" className="flex-1 min-h-0 overflow-y-auto">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-label uppercase text-lantern-text-secondary">Materials</h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleNewNote()}
                  className="text-caption font-medium text-lantern-primary-text hover:underline"
                >
                  New note
                </button>
                <button
                  type="button"
                  onClick={() => setImportOpen(true)}
                  className="text-caption font-medium text-lantern-primary-text hover:underline"
                >
                  Import
                </button>
              </div>
            </div>
            <p className="text-caption text-lantern-text-secondary mb-3">
              {formatCourseMaterialCounts({
                notes: readingNotes.length,
                decks: courseDecks.length,
                tests: courseTests.length,
              })}
            </p>
            {studySetId ? (
              <div className="mb-4">
                <CoursePicker
                  value={studySet?.courseId ?? null}
                  compact
                  clearable
                  label="Course (optional)"
                  hint="File this set under a course if you want. You can leave it standalone."
                  onChange={(course) => {
                    if (!studySetId) return;
                    void updateSet(studySetId, { courseId: course?.id ?? null }).catch(() => {
                      showToast('Could not update the course on this set.', 'error');
                    });
                  }}
                />
              </div>
            ) : null}
            {courseId ? (
            <ClassOfficialMaterials
              courseId={courseId}
              embedded
              onOpenNote={(noteId) => {
                void reloadNotes().catch(() => undefined);
                void openNote(noteId);
                setActivity('notes');
              }}
            />
            ) : null}
            <MaterialGroup
              title={`Notes${readingNotes.length ? ` · ${readingNotes.length}` : ''}`}
              empty={scopedCopy('notesEmpty', roomNoun)}
              items={readingNotes.map((note) => ({
                id: note.id,
                label: note.title || 'Untitled note',
                feature: 'notes' as const,
                icon: 'document-text' as const,
                selected: selectedNote?.id === note.id,
                onClick: () => {
                  void openNote(note.id);
                  setActivity('notes');
                },
              }))}
            />
            <MaterialGroup
              title={`Decks${courseDecks.length ? ` · ${courseDecks.length}` : ''}`}
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
            {courseTests.length > 0 ? (
              <MaterialGroup
                title={`Tests · ${courseTests.length}`}
                empty={scopedCopy('testsEmpty', roomNoun)}
                items={courseTests.map((test) => ({
                  id: test.id,
                  label: test.title || 'Test',
                  feature: 'tests' as const,
                  icon: 'clipboard' as const,
                  selected: false,
                  onClick: () => onOpenTest(test.id),
                }))}
              />
            ) : null}
            {lectures.length > 0 ? (
              <MaterialGroup
                title={`Lectures · ${lectures.length}`}
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
            ) : null}
            {lessons.length > 0 ? (
              <MaterialGroup
                title={`Lessons · ${lessons.length}`}
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
            ) : null}
            {recaps.length > 0 ? (
              <MaterialGroup
                title={`Recaps · ${recaps.length}`}
                empty="Start a recap from a note"
                items={recaps.map((note) => ({
                  id: note.id,
                  label: note.title || 'Recap',
                  feature: 'ai' as const,
                  icon: 'headphones' as const,
                  selected: selectedNote?.id === note.id,
                  onClick: () => {
                    void openNote(note.id);
                    setActivity('recap');
                  },
                }))}
              />
            ) : null}
            {essays.length > 0 ? (
              <MaterialGroup
                title={`Essays · ${essays.length}`}
                empty="Paste a draft to get practice feedback"
                items={essays.map((note) => ({
                  id: note.id,
                  label: note.title || 'Essay',
                  feature: 'tests' as const,
                  icon: 'document' as const,
                  selected: selectedNote?.id === note.id,
                  onClick: () => {
                    void openNote(note.id);
                    setActivity('essay');
                  },
                }))}
              />
            ) : null}
            <button
              type="button"
              onClick={onOpenLibrary}
              className="mt-4 text-caption text-lantern-text-secondary hover:underline"
            >
              All materials in Library
            </button>
          </Card>
        </aside>
        ) : null}

        <section className="flex flex-1 min-w-0 min-h-[18rem] lg:min-h-[32rem]">
          {activity === 'add' && studySetId ? (
            <StudySetUpload
              studySetId={studySetId}
              courseId={courseId || undefined}
              onImport={(source) => {
                setImportSource(source ?? null);
                setImportOpen(true);
              }}
              onYoutube={async (url) => {
                const created = await notesApi.createNoteFromYoutube(url);
                const noteId = created.note?.id;
                if (noteId) {
                  await notesApi.updateNote(noteId, studySetNotePayload({ courseId, studySetId }));
                  await reloadNotes().catch(() => undefined);
                  void kickPlanGeneration();
                  void openNote(noteId);
                  go('notes', { noteId });
                }
              }}
              onPaste={async (title, body) => {
                const created = await useNotesStore.getState().createNote({
                  title,
                  body,
                  ...studySetNotePayload({ courseId, studySetId }),
                });
                await reloadNotes().catch(() => undefined);
                void kickPlanGeneration();
                await openNote(created.id);
                go('notes', { noteId: created.id });
              }}
              onAnki={async (text) => {
                const cards = parseCardExport(text);
                if (cards.length === 0) {
                  throw new Error('Paste Anki or Quizlet text: one card per line, front and back separated by a tab.');
                }
                await createDeckWithCards({
                  name: 'Imported cards',
                  studySetId,
                  cards: cards.map((card) => ({ type: 'BASIC' as const, front: card.front, back: card.back })),
                });
                void kickPlanGeneration();
                go('cards');
              }}
              onRecord={() => go('lecture')}
            />
          ) : activity === 'home' && studySetId ? (
            <StudySetHome
              setLabel={label}
              notes={homeMaterials}
              deckCount={courseDecks.length}
              testCount={courseTests.length}
              recommended={readingNotes[0] ?? notes[0] ?? null}
              studySet={studySet}
              planTopics={planTopics}
              planUnits={planUnits}
              exams={exams}
              planGenerating={planGenerating}
              onTool={handleHomeTool}
              onOpenNote={(noteId) => {
                const lecture = lectures.some((row) => row.id === noteId);
                void openNote(noteId);
                if (lecture) go('lecture');
                else go('notes', { noteId });
              }}
              onOpenRecommended={(kind: StudySetRecommendedKind) => {
                const recommendedId =
                  planTopics.find((topic) => topic.status === 'unseen')?.sourceNoteIds[0] ||
                  planTopics[0]?.sourceNoteIds[0] ||
                  readingNotes[0]?.id ||
                  notes[0]?.id;
                if (recommendedId && kind !== 'ask') void openNote(recommendedId);
                if (kind === 'ask') {
                  openSetChat(`Help me study ${label}. What should I do next in this set?`);
                  return;
                }
                if (kind === 'read') {
                  go('notes', { noteId: recommendedId });
                  return;
                }
                if (kind === 'quiz') {
                  setQuizLive(true);
                  go('quiz');
                  return;
                }
                if (kind === 'cards') {
                  go('cards');
                  return;
                }
                if (kind === 'recap') {
                  if (recaps.length === 0) setCreateKind('recap');
                  handleActivity('recap', 'ready');
                  return;
                }
                if (kind === 'play') {
                  handleActivity('play', 'ready');
                  return;
                }
                if (kind === 'test') {
                  handleActivity('test', 'ready');
                  return;
                }
                handleActivity('lesson', 'ready');
              }}
              onSkipTopic={(topicId) => {
                setPlanTopics((rows) => {
                  const base =
                    rows.length > 0 ? rows : topicsFromReadingNotes(studySetId, readingNotes).topics;
                  return base.map((row) => (row.id === topicId ? { ...row, status: 'covered' } : row));
                });
                void updateStudySetTopicStatus(studySetId, topicId, 'covered').catch(() => undefined);
              }}
              onOpenPlan={() => go('plan')}
              onOpenCalendar={() => go('calendar')}
              onAddSyllabus={() => {
                go('add');
                setImportSource(null);
                setImportOpen(true);
              }}
            />
          ) : activity === 'notes' && studioNote && noteInRoom(studioNote) && !isCalendarNote(studioNote) && !isEssayNote(studioNote) && !isLectureNote(studioNote) && !isLessonNote(studioNote) && !isRecapNote(studioNote) ? (
            <NotesStudio
              note={studioNote}
              sourceAttachment={walkable}
              theme={theme}
              turning={turning}
              turnIntoExisting={turnIntoExisting}
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
          ) : activity === 'quiz' && routePath?.createNew && studySetId ? (
            <CreateFromSource
              kind="quiz"
              notes={readingNotes}
              decks={courseDecks}
              studySetId={studySetId}
              onCancel={() => go('quiz')}
              onPickNote={(noteId, options) => {
                if (options?.questionCount) setQuizQuestionCount(options.questionCount);
                void openNote(noteId);
                setQuizLive(true);
                go('quiz');
              }}
              onPickScratch={() => {
                setQuizLive(true);
                go('quiz');
              }}
            />
          ) : activity === 'quiz' && studySetId && !routePath?.quizId && !quizSeed && !quizLive ? (
            <StudySetArtifactLibrary
              title="Quizzes"
              empty="Make a quiz from materials in this set. The first question previews on the card."
              createLabel="+ New"
              folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
              onOpenFolder={() => {
                openPicker();
                navigateTo(AppMode.STUDY_HUB);
              }}
              onCreate={() => go('quiz', { createNew: true })}
              onOpen={(quizId) => go('quiz', { quizId })}
              items={courseTests.map((test) => ({
                id: test.id,
                title: test.title || 'Quiz',
                preview: test.preview,
                feature: 'tests' as const,
                icon: 'clipboard' as const,
              }))}
            />
          ) : activity === 'quiz' ? (
            <AdaptiveQuiz
              courseId={courseId}
              theme={theme}
              notes={notes}
              selectedNoteId={
                selectedNote && !isCalendarNote(selectedNote) && !isEssayNote(selectedNote)
                  ? selectedNote.id
                  : undefined
              }
              testIds={courseTests.map((test) => test.id)}
              preferredTestId={routePath?.quizId}
              canWalkthrough={Boolean(walkable)}
              writing={writingQuiz}
              seedItems={quizSeed}
              onWriteQuestions={handleWriteQuizQuestions}
              onOpenNotes={() => setActivity('notes')}
              onOpenWalkthrough={() => handleActivity('walkthrough', 'ready')}
              onComplete={({ mastery, sourceNoteId }) => {
                if (!studySetId || !sourceNoteId) return;
                const topic = planTopics.find((row) => row.sourceNoteIds.includes(sourceNoteId));
                if (!topic) return;
                const status = mastery >= 80 ? 'mastered' : 'covered';
                setPlanTopics((rows) =>
                  rows.map((row) => (row.id === topic.id ? { ...row, status } : row))
                );
                void updateStudySetTopicStatus(studySetId, topic.id, status).catch(() => undefined);
              }}
            />
          ) : activity === 'lecture' ? (
            <LectureStudio
              courseId={courseId}
              studySetId={studySetId}
              theme={theme}
              note={
                selectedNote && (isLectureNote(selectedNote) || selectedNote.id === lectureNoteId)
                  ? selectedNote
                  : lectures.find((row) => row.id === lectureNoteId) || null
              }
              lectures={lectures}
              turning={turning}
              turnIntoExisting={turnIntoExisting}
              onTurnInto={(target) => void handleTurnInto(target)}
              onSmartNote={handleStudioSmartNote}
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
            />
          ) : activity === 'lesson' && createKind === 'lesson' && studySetId ? (
            <CreateFromSource
              kind="lesson"
              notes={readingNotes}
              decks={courseDecks}
              studySetId={studySetId}
              onCancel={() => {
                setCreateKind(null);
                go('lesson');
              }}
              onPickNote={(noteId) => {
                setCreateKind(null);
                void openNote(noteId);
                go('lesson');
              }}
              onPickScratch={() => {
                setCreateKind(null);
                go('lesson');
              }}
            />
          ) : activity === 'lesson' ? (
            <LessonStudio
              courseId={courseId}
              studySetId={studySetId}
              theme={theme}
              notes={notes}
              selectedNote={
                selectedNote && noteInRoom(selectedNote) && !isCalendarNote(selectedNote)
                  ? selectedNote
                  : null
              }
              turning={turning}
              turnIntoExisting={turnIntoExisting}
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
          ) : activity === 'recap' && createKind === 'recap' && studySetId ? (
            <CreateFromSource
              kind="recap"
              notes={readingNotes}
              decks={courseDecks}
              studySetId={studySetId}
              onCancel={() => {
                setCreateKind(null);
                go('recap');
              }}
              onPickNote={(noteId) => {
                setCreateKind(null);
                void openNote(noteId);
                go('recap');
              }}
              onPickScratch={() => {
                setCreateKind(null);
                go('recap');
              }}
            />
          ) : activity === 'recap' && studySetId && recaps.length > 0 && !(selectedNote && isRecapNote(selectedNote)) ? (
            <StudySetArtifactLibrary
              title="Audio recaps"
              empty="Generate a listen-through from a note in this set."
              createLabel="+ New"
              folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
              onOpenFolder={() => {
                openPicker();
                navigateTo(AppMode.STUDY_HUB);
              }}
              onCreate={() => setCreateKind('recap')}
              onOpen={(noteId) => {
                void openNote(noteId);
                go('recap');
              }}
              items={recaps.map((note) => ({
                id: note.id,
                title: note.title || 'Recap',
                preview: (note.body || '').replace(/<[^>]+>/g, '').slice(0, 120),
                feature: 'ai' as const,
                icon: 'headphones' as const,
              }))}
            />
          ) : activity === 'recap' ? (
            <RecapStudio
              courseId={courseId}
              studySetId={studySetId}
              theme={theme}
              notes={notes}
              selectedNote={
                selectedNote && noteInRoom(selectedNote) && !isCalendarNote(selectedNote)
                  ? selectedNote
                  : null
              }
              turning={turning}
              turnIntoExisting={turnIntoExisting}
              onTurnInto={(target) => void handleTurnInto(target)}
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
            />
          ) : activity === 'play' ? (
            <PlayStudio
              scope={scopeNoun(studySetId, courseId)}
              decks={courseDecks}
              flashcards={flashcards}
              onStartMatch={onStartMatch}
              onReviewMissed={(deck, cardIds) => onStartCram(deck, undefined, cardIds)}
            />
          ) : activity === 'essay' ? (
            <EssayStudio
              courseId={courseId}
              studySetId={studySetId}
              notes={notes}
              selectedNote={
                selectedNote && noteInRoom(selectedNote) && !isCalendarNote(selectedNote)
                  ? selectedNote
                  : null
              }
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
              onImportPhoto={() => setImportOpen(true)}
            />
          ) : activity === 'plan' && routePath?.activity === 'plan' && studySetId ? (
            <StudySetPlanPanel
              studySetId={studySetId}
              notes={readingNotes}
              mode={studySet?.mode || 'standard'}
              onModeChange={(mode) => {
                void updateSet(studySetId, { mode }).catch(() => undefined);
              }}
              onStart={(kind, noteId) => {
                if (noteId) void openNote(noteId);
                if (kind === 'read') go('read');
                else if (kind === 'quiz') {
                  setQuizLive(true);
                  go('quiz');
                }
                else if (kind === 'cards') go('cards');
                else handleActivity('lesson', 'ready');
              }}
            />
          ) : activity === 'plan' ? (
            <StudyCalendar
              courseId={courseId}
              studySetId={studySetId}
              courseLabel={label}
              notes={notes}
              calendarNotes={calendars}
              decks={courseDecks}
              topics={topics}
              onEditOutline={() => setOutlineOpen(true)}
              onOpenSession={(session) => void openCalendarSession(session)}
              onNoteReady={async (noteId) => {
                await openNote(noteId);
                void reloadNotes().catch(() => undefined);
              }}
            />
          ) : (
          <Card padding="lg" className="flex-1 min-h-0 overflow-y-auto">
            {activity === 'notes' && (
              <div className="space-y-3">
                <h2 className="text-heading">Notes</h2>
                {readingNotes.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">
                    {studySetId
                      ? 'Import your own material into this set. They stay listed here.'
                      : 'Import lecturer notes or your own material into this course. They stay listed here.'}
                  </p>
                ) : (
                  readingNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      onClick={() => {
                        void openNote(note.id);
                        setActivity('notes');
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-lantern-border text-left hover:bg-lantern-background-secondary"
                    >
                      <FeatureDisc feature="notes" icon={<AppIcon name="document-text" size={20} />} />
                      <span className="text-body font-semibold truncate">
                        {note.title || 'Untitled note'}
                      </span>
                    </button>
                  ))
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void handleNewNote()}>
                    New note
                  </Button>
                  <Button variant="secondary" onClick={() => setImportOpen(true)}>
                    {scopedCopy('importAction', roomNoun)}
                  </Button>
                </div>
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
                {routePath?.createNew && studySetId ? (
                  <CreateFromSource
                    kind="cards"
                    notes={readingNotes}
                    decks={courseDecks}
                    studySetId={studySetId}
                    onCancel={() => go('cards')}
                    onPickNote={(noteId) => {
                      void openNote(noteId);
                      void handleTurnInto('cards');
                    }}
                    onPickScratch={() => go('cards')}
                  />
                ) : (
                  <StudySetArtifactLibrary
                    title="Cards"
                    empty="Turn a note into flashcards, or import Anki / Quizlet into this set."
                    createLabel="+ New"
                    folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
                    onOpenFolder={() => {
                      openPicker();
                      navigateTo(AppMode.STUDY_HUB);
                    }}
                    onCreate={studySetId ? () => go('cards', { createNew: true }) : undefined}
                    onOpen={(deckId) => {
                      const deck = courseDecks.find((row) => row.id === deckId);
                      if (deck) onSelectDeck(deck);
                    }}
                    items={courseDecks.map((deck) => ({
                      id: deck.id,
                      title: deck.name,
                      meta: pluralize(flashcards.filter((card) => card.deckId === deck.id).length, 'card'),
                      feature: 'flashcards' as const,
                      icon: 'layers' as const,
                    }))}
                  />
                )}
              </div>
            )}
            {activity === 'test' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-heading">Test</h2>
                  <Button size="sm" onClick={() => (studySetId ? go('test', { createNew: true }) : onNewTest())}>
                    New test
                  </Button>
                </div>
                {courseTests.length === 0 ? (
                  <p className="text-body text-lantern-text-secondary">
                    {scopedCopy('testsFromDecks', roomNoun)}
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
          </Card>
          )}
        </section>
        </div>

        {companionRail ? (
        <aside className="flex w-full lg:w-96 xl:w-[28rem] 2xl:w-[32rem] h-96 lg:h-auto shrink-0 min-h-0">
          <div className="flex flex-1 min-h-0 flex-col rounded-lantern-xl border border-lantern-border overflow-hidden">
            {studySetId ? (
              <StudySetGuidedPrompts
                activity={
                  (routePath?.activity ??
                    (activity === 'add' || activity === 'home' ? activity : activity)) as StudySetPathActivity
                }
                onAsk={(message) => openSetChat(message)}
                onGo={(next) => go(next)}
              />
            ) : null}
            <div className="flex-1 min-h-0">
              <AICompanionPanel
                variant="rail"
                context={companionContext}
                onAction={onCompanionAction}
                theme={theme}
                // A citation chip in the docked rail opens the cited note in
                // the room's own Notes studio, the same way every other
                // "open this note" in this workspace does.
                onOpenNote={(noteId) => {
                  void openNote(noteId);
                  go('notes', { noteId });
                }}
                // The six targets, on whatever note the companion has
                // attached — the same handler, credits and ticks the studios
                // use, so nothing here is a second implementation.
                onTurnInto={(target, noteId) => void handleTurnInto(target, noteId)}
                // The same six targets again, but scoped to ONE answer: the
                // answer is filed here first, then run through the identical
                // path above.
                onTurnIntoMessage={(target, draft) => void handleTurnIntoMessage(target, draft)}
                turnIntoExisting={companionNote ? turnIntoExisting(companionNote.id) : undefined}
              />
            </div>
          </div>
        </aside>
        ) : (
          <AICompanionPanel
            variant="drawer"
            drawerMaxWidthClass="max-w-lg"
            context={companionContext}
            onAction={onCompanionAction}
            theme={theme}
            onTurnInto={(target, noteId) => void handleTurnInto(target, noteId)}
            onTurnIntoMessage={(target, draft) => void handleTurnIntoMessage(target, draft)}
            turnIntoExisting={companionNote ? turnIntoExisting(companionNote.id) : undefined}
          />
        )}
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
      <StudySetSettingsModal
        isOpen={settingsOpen}
        studySet={studySet}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => setSettingsOpen(false)}
        onDeleted={() => {
          setSettingsOpen(false);
          navigateTo(AppMode.STUDY_HUB);
        }}
      />
      <CreateStudySetModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={async (input) => {
          const created = await createSet(input);
          showToast('Study set created.', 'success');
          navigateTo(AppMode.STUDY_SET_WORKSPACE, { studySetId: created.id });
        }}
      />
      {importOpen && (
        <ImportAndStudyModal
          isOpen={importOpen}
          courseId={courseId || undefined}
          studySetId={studySetId}
          source={importSource}
          onClose={() => {
            setImportOpen(false);
            setImportSource(null);
          }}
          onComplete={() => {
            void reloadNotes()
              .then(() => {
                void kickPlanGeneration();
              })
              .catch(() => undefined);
          }}
          onOpenNote={(noteId) => {
            setImportOpen(false);
            setImportSource(null);
            void openNote(noteId);
            go('notes', { noteId });
          }}
        />
      )}
    </div>
  );
};

function applyPlanPayload(
  data: unknown,
  setUnits: (units: StudySetUnit[]) => void,
  setTopics: (topics: StudySetTopic[]) => void
) {
  const units = Array.isArray((data as { units?: StudySetUnit[] })?.units)
    ? (data as { units: StudySetUnit[] }).units
    : [];
  const topics = Array.isArray((data as { topics?: StudySetTopic[] })?.topics)
    ? (data as { topics: StudySetTopic[] }).topics
    : [];
  setUnits(units);
  setTopics(topics);
}

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
    icon: 'document-text' | 'layers' | 'clipboard' | 'mic' | 'school' | 'headphones' | 'document';
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
  studySetId?: string | null;
  sourceNoteId?: string | null;
  sourceDeckId?: string | null;
  preview?: string | null;
}

async function fetchWorkspaceTests(filter: {
  courseId?: string;
  studySetId?: string;
}): Promise<WorkspaceTestRow[]> {
  const params = new URLSearchParams({
    lean: '1',
    page: '1',
    limit: '100',
    sort: 'newest',
  });
  if (filter.courseId) params.set('courseId', filter.courseId);
  if (filter.studySetId) params.set('studySetId', filter.studySetId);
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
          null,
        studySetId:
          (typeof record.studySetId === 'string' && record.studySetId) ||
          (typeof config.studySetId === 'string' && config.studySetId) ||
          filter.studySetId ||
          null,
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
        preview: firstQuestionPreview(record.questions ?? session.questions ?? config.questions),
      },
    ];
  });
}
