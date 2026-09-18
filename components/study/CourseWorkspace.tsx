/**
 * The study ROOM: one screen that hosts every studio for a study set (or, in the
 * older shape, a course) — notes, cards, quiz, test, lecture, lesson, recap,
 * essay, play, plan/calendar, walkthrough — plus the docked AI companion.
 *
 * Exports:
 *  - `CourseWorkspace` (named + default) — the room.
 *  - module-local `LecturesGroup`, `MaterialGroup`, `applyPlanPayload`,
 *    `fetchWorkspaceTests`, `lectureAddedLabel`.
 * Touches:
 *  - stores: `studySetStore` (sets, folders, resolveSet, updateSet/createSet,
 *    touchOpened, openPicker), `notesStore` (notes + `selectedNote`, createNote),
 *    `flashcardStore`, `testStore`, `academicStore`, `companionStore` (attach note,
 *    open with message, `resetForScope`), `studyResumeStore.recordActivity`,
 *    `lectureRecordingStore`, `toastStore`, `authStore`.
 *  - services: `notes` (fetch/create/generateNoteQuiz), `ai`
 *    (`aiGenerateFromTopic`, `aiGenerateQuestions`), `academic`
 *    (`fetchStudySetPlan`, `replaceStudySetPlan`, `updateStudySetTopicStatus`,
 *    `fetchCourseTopics`), plus a direct `GET /api/v1/tests` (`fetchWorkspaceTests`).
 *  - `runAiJob` for every credit-spending generation.
 * Gotchas:
 *  - TWO navigation models. With a `studySetId` the room is ROUTED: `go()` builds a
 *    path and calls `navigateTo`, and `routePath` drives `activity` back. Without one
 *    (course room) `go()` just does `setActivity`. Code that calls `setActivity`
 *    directly inside a set room changes the pane WITHOUT changing the URL.
 *  - The note-handler layer acts on `notesStore.selectedNote`, so any "do X to note
 *    N" must open N first and wait for it to land — that is what `pendingTurnInto`
 *    exists for. Running in the same tick generates from the PREVIOUS note.
 *  - `notes` here is the union of the store's notes and this room's own fetch,
 *    de-duplicated by id, then filtered to the set/course.
 *  - The companion is scoped by `studySetId ?? courseId`; scoping by course alone
 *    let a note attached in one set follow the student into the next.
 *  - Colours come from the `dark` class and the feature token maps
 *    (`FEATURE_TINT_BG` / `FEATURE_INK_TEXT`); `theme` is passed down only because
 *    the studios and the companion take it as a prop.
 */
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
  isSetRoomFocus,
  resumeKindFromActivity,
  upcomingExamsFromNotes,
  workspaceActivityFromPath,
  type AdaptiveQuizItem,
  type StudyCalendarSession,
  type StudySetHomeTool,
  type StudySetRecommendedKind,
  type StudySetUnit,
  pickRecommendedTopic,
  studySetPlanProgress,
  topicsFromReadingNotes,
  type StudySetPath,
  type StudySetPathActivity,
  type MessageNoteDraft,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
  type CreateFromSourceKind,
  type CreateFromSourceOptions,
  type TopicBrief,
  questionsToAdaptiveItems,
  studyTestDoor,
  TEST_SITTING_PRESETS,
  type StudyUploadSource,
} from '@lantern/shared';
import { AI_CREDIT_COSTS, getSmartNotesCreditCost } from '@lantern/shared/utils/aiCredits';
import { pluralize } from '@lantern/shared/utils/plural';
import type { CompanionAction, CompanionUserContext, Deck, StudyNote } from '../../types';
import { AppMode } from '../../types';
import { AppIcon } from '../ui/AppIcon';
import { Button, Card, FeatureDisc, ScreenHeader, Menu, MenuTrigger, MenuContent } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import AICompanionPanel from '../AICompanionPanel';
import WalkthroughScreen from '../walkthrough/WalkthroughScreen';
import { ManageOutlineModal } from '../academic/ManageOutlineModal';
import ImportAndStudyModal from '../ImportAndStudyModal';
import { ClassOfficialMaterials } from '../classes/ClassOfficialMaterials';
import { CoverMenuItems, CoverPickerDialog } from '../ui/CoverPicker';
import { coverErrorMessage } from '../ui/coverPickerModel';
import { canEditCover, removeCover } from '../../stores/coverActions';
import { NotesStudio } from './NotesStudio';
import { AdaptiveQuiz } from './AdaptiveQuiz';
import { LectureStudio } from './LectureStudio';
import { LessonStudio } from './LessonStudio';
import { RecapStudio } from './RecapStudio';
import { StudyCalendar } from './StudyCalendar';
import { EssayStudio } from './EssayStudio';
import { PlayStudio } from './PlayStudio';
import { SetRoomFooter } from './SetRoomFooter';
import { StudySetHome } from './StudySetHome';
import CreateStudySetModal from './CreateStudySetModal';
import { StudySetSettingsModal } from './StudySetSettingsModal';
import { StudySetTimer } from './StudySetTimer';
import { StudySetUpload } from './StudySetUpload';
import { CreateFromSource } from './CreateFromSource';
import { NoteRoomRow } from './NoteRoomRow';
import { StudySetPlanPanel } from './StudySetPlanPanel';
import { SetRoomHeader, type SetRoomHeaderMenuItem } from './SetRoomHeader';
import { SetRoomTopBar } from './SetRoomTopBar';
import { SetRoomFocusBar } from './SetRoomFocusBar';
import { shareStudySet } from './shareStudySet';
import { StudySetArtifactLibrary } from './StudySetArtifactLibrary';
import { StudyWorkspaceBar } from './StudyWorkspaceBar';
import { MaterialSortMenu, ViewModeToggle, useMaterialSort, useViewMode } from './ViewModeToggle';
import { sortMaterials } from './viewMode';
import { formatShortDate } from '@lantern/shared/study/setPresentation';
import { guidedNextTopicFromPlan } from '@lantern/shared/study/planTimeline';
import type { GuidedStartTopic } from '@lantern/shared/api';
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
import { useFocusSidebarCollapse } from '../../hooks/useFocusSidebarCollapse';
import { useCompanionRail } from '../../hooks/useCompanionRail';
import { CompanionRailButton } from './CompanionRailButton';
import { runAiJob } from '../../stores/aiJobRunner';
import { touchWorkspaceRecent } from '../../utils/workspaceRecents';
import * as notesApi from '../../services/notes';
import { aiGenerateFromTopic, aiGenerateQuestions } from '../../services/ai';
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
  const setsLoaded = useStudySetStore((s) => s.loaded);
  const setsLoadError = useStudySetStore((s) => s.loadError);
  const studySet = useStudySetStore((s) => (studySetId ? s.resolveSet(studySetId) : null));
  const courseId = studySet?.courseId || courseIdProp || '';
  type RoomActivity = WorkspaceActivityId | 'home' | 'add';

  const storeNotes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const decks = useFlashcardStore((s) => s.decks);
  const flashcards = useFlashcardStore((s) => s.flashcards);
  const testResults = useTestStore((s) => s.testResults);

  // --- Room state. Three groups: what is showing (`activity`, `createKind`,
  // the modal flags), what has been fetched for THIS room (`fetchedNotes`,
  // `fetchedTests`, `topics`, the plan), and in-flight work (`turning`,
  // `writingQuiz`, `planGenerating`, `pendingTurnInto`).
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
  const [importSource, setImportSource] = useState<StudyUploadSource | null>(null);
  const [createKind, setCreateKind] = useState<CreateFromSourceKind | null>(null);
  const [createOptions, setCreateOptions] = useState<CreateFromSourceOptions | null>(null);
  const [testPreset, setTestPreset] = useState<(typeof TEST_SITTING_PRESETS)[number]['id'] | null>(null);
  const [quizLive, setQuizLive] = useState(false);
  // The in-set deck tiles carry the same ⋮ as the Library deck cards: which
  // tile's menu is open, and which deck the cover picker is editing (held
  // here, not in the menu, which unmounts the moment an item is chosen).
  const [deckMenuId, setDeckMenuId] = useState<string | null>(null);
  const [coverDeck, setCoverDeck] = useState<Deck | null>(null);
  const [noteMenuId, setNoteMenuId] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<StudyNote | null>(null);
  const recordActivity = useStudyResumeStore((s) => s.recordActivity);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStatus = useLectureRecordingStore((s) => s.status);

  // Room-scoped refetches. Both are called ad hoc after anything that files new
  // material, because the stores are library-wide and do not know about this
  // room's filter.
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

  // Opening a set is what makes it "last opened" for Home and the switcher.
  useEffect(() => {
    if (!studySetId) return;
    touchOpened(studySetId);
  }, [studySetId, touchOpened]);

  // Load this set's stored plan (units + topics). Driven by `studySetId`;
  // `cancelled` stops a slow response from a previous set overwriting the new
  // one's plan. A failure empties the plan rather than keeping the old set's.
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

  // URL → pane. This is the ROUTED half of the two navigation models: the path's
  // activity becomes `activity`, and `?createNew` opens that activity's creation
  // wizard. Leaving a creatable activity clears `createKind`, so backing out of a
  // wizard does not leave it armed for the next visit.
  // Driven by `routePath.activity` / `routePath.createNew` only.
  useEffect(() => {
    if (!routePath) return;
    setActivity(workspaceActivityFromPath(routePath.activity));
    if (routePath.createNew) {
      const next = workspaceActivityFromPath(routePath.activity);
      if (
        next === 'quiz' ||
        next === 'cards' ||
        next === 'recap' ||
        next === 'lesson' ||
        next === 'play' ||
        next === 'essay' ||
        next === 'test' ||
        next === 'notes'
      ) {
        setCreateKind(next);
      }
    } else if (
      routePath.activity !== 'quiz' &&
      routePath.activity !== 'cards' &&
      routePath.activity !== 'recap' &&
      routePath.activity !== 'lesson' &&
      routePath.activity !== 'play' &&
      routePath.activity !== 'essay' &&
      routePath.activity !== 'notes'
    ) {
      setCreateKind(null);
    }
  }, [routePath?.activity, routePath?.createNew]);

  // Entering a room: record it as recent, shut the companion, and re-scope it.
  // Driven by `courseId` + `studySetId` — a change of either is a change of room.
  useEffect(() => {
    if (courseId) touchWorkspaceRecent(courseId);
    closeCompanion();
    // The attachment belongs to the room it was made in. Watching `courseId`
    // alone let a note attached in one course-less set stay stapled to every
    // question asked in the next one, so the set id leads here.
    resetCompanionForScope(studySetId ?? courseId ?? null);
    void loadMyCourses();
  }, [courseId, studySetId, loadMyCourses, closeCompanion, resetCompanionForScope]);

  // The room's own data load: notes, tests, and (course rooms only) the course
  // outline. Re-runs when the room changes, since `reloadNotes`/`reloadTests` are
  // memoised on exactly `courseId` + `studySetId`.
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

  // THE navigation primitive for this room. In a set room it builds the path,
  // stamps a resume row (so Home can offer "continue"), and navigates — the URL
  // is the state. In a course room there is no route, so it falls back to local
  // `activity`. Prefer `go()` over `setActivity()` in a set room: bare
  // `setActivity` moves the pane while the URL keeps pointing at the old one.
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

  // --- The room's material, derived once and sliced by kind below. The store's
  // notes and this room's fetch are merged by id (the fetch wins, being later in
  // the spread) and then filtered to the set or course. Every `notes`-shaped list
  // further down — lectures, lessons, recaps, essays, readingNotes — is a slice of
  // this, so a note can never appear in two groups.
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
  /**
   * The ⋮ on an in-set deck tile. Same entries and same owner rule as the
   * Library deck card: the cover route refuses anyone but the owner, and
   * ownership is the deck's `userId` — a deck I shared out is still mine.
   */
  const renderDeckTileMenu = (deckId: string) => {
    const deck = courseDecks.find((row) => row.id === deckId);
    if (!deck || !canEditCover(deck.userId, currentUserId)) return null;
    return (
      <Menu
        open={deckMenuId === deck.id}
        onOpenChange={(open) => setDeckMenuId(open ? deck.id : null)}
      >
        <MenuTrigger
          aria-label={`Deck options for ${deck.name}`}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-lantern-surface/90 p-1.5 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
        >
          <AppIcon name="ellipsis-vertical" size={16} />
        </MenuTrigger>
        <MenuContent align="end" className="w-48">
          <CoverMenuItems
            hasCover={Boolean(deck.coverPath)}
            onChoose={() => setCoverDeck(deck)}
            onRemove={() => void handleRemoveDeckCover(deck)}
          />
        </MenuContent>
      </Menu>
    );
  };

  const handleRemoveDeckCover = async (deck: Deck) => {
    try {
      await removeCover('deck', deck.id);
    } catch (err) {
      showToast(coverErrorMessage(err).message, 'error');
    }
  };

  const handleRemoveNoteCover = async (noteId: string) => {
    try {
      await removeCover('note', noteId);
    } catch (err) {
      showToast(coverErrorMessage(err).message, 'error');
    }
  };

  /**
   * The ⋮ on an in-room note row. Until now `Add cover` for a note existed only
   * in the Library list and the note editor's header, so a student who lived in
   * the room never met it. Same owner rule as the Library's note menu: the
   * cover route refuses an editor, and a menu item that always 403s is worse
   * than no item.
   */
  const renderNoteRowMenu = (note: StudyNote) => {
    if (note.accessRole && note.accessRole !== 'owner') return null;
    return (
      <Menu
        open={noteMenuId === note.id}
        onOpenChange={(open) => setNoteMenuId(open ? note.id : null)}
      >
        <MenuTrigger
          aria-label={`Note options for ${note.title || 'Untitled note'}`}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-lantern-surface/90 p-1.5 text-lantern-text-secondary hover:bg-lantern-background-secondary hover:text-lantern-text"
        >
          <AppIcon name="ellipsis-vertical" size={16} />
        </MenuTrigger>
        <MenuContent align="end" className="w-48">
          <CoverMenuItems
            hasCover={Boolean(note.coverPath)}
            onChoose={() => {
              setNoteMenuId(null);
              setCoverNote(note);
            }}
            onRemove={() => {
              setNoteMenuId(null);
              void handleRemoveNoteCover(note.id);
            }}
          />
        </MenuContent>
      </Menu>
    );
  };

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
  /**
   * The header's chip strip. Counted from the stored plan where there is one,
   * and from the topics a set's own notes imply where there is not, so a set
   * with materials and no server plan still reads as something with a shape
   * rather than as a bare title.
   */
  const roomProgress = useMemo(() => {
    if (!studySetId) return null;
    const rows =
      planTopics.length > 0 ? planTopics : topicsFromReadingNotes(studySetId, readingNotes).topics;
    return rows.length > 0 ? studySetPlanProgress(rows) : null;
  }, [planTopics, readingNotes, studySetId]);
  /**
   * The topic the Guided picker may offer to CONTINUE — the plan's next one,
   * by the same rule the plan spine's `Continue` pill uses
   * (`pickRecommendedTopic`), so the two surfaces can never name different
   * topics for the same set.
   *
   * Null is a real answer: no set in scope, no plan, or a plan whose every
   * topic is mastered means the picker offers `Start learning:` rows only,
   * rather than a `Continue` that claims progress the student has not made.
   */
  const guidedNextTopic = useMemo(() => {
    if (!studySetId) return null;
    const rows =
      planTopics.length > 0 ? planTopics : topicsFromReadingNotes(studySetId, readingNotes).topics;
    // The pick is the spine's own; everything after it — the mastered guard,
    // the trim, the unit lookup — is shared with mobile.
    const next = pickRecommendedTopic(rows, studySet?.mode || 'standard');
    // The SOURCE note's own title, not the unit's. A unit is a grouping
    // ("Imported Notes"), and a first guided turn that named only the grouping
    // made the model answer with a menu of the notes inside it instead of
    // teaching (AH release smoke 1.0.57, observation B).
    const sourceNoteId = next?.sourceNoteIds?.find(Boolean) ?? null;
    return guidedNextTopicFromPlan(
      next,
      next ? planUnits.find((row) => row.id === next.unitId)?.title : null,
      sourceNoteId ? notes.find((row) => row.id === sourceNoteId)?.title : null
    );
  }, [planTopics, planUnits, readingNotes, studySetId, studySet?.mode, notes]);

  /**
   * The topics the Guided picker may offer as COLD STARTS.
   *
   * This used to go unpassed, so the picker's only row was `Continue
   * learning:` and a set with more than one topic offered no way to start any
   * of the others (AH release smoke 1.0.58). The rows go over as plan rows —
   * the picker itself drops the `Continue` topic and anything MASTERED, and
   * keeps covered topics, which a student may well want walked again.
   */
  const guidedTopics = useMemo<GuidedStartTopic[]>(() => {
    if (!studySetId) return [];
    const rows =
      planTopics.length > 0 ? planTopics : topicsFromReadingNotes(studySetId, readingNotes).topics;
    return rows.map((topic) => {
      const sourceNoteId = topic.sourceNoteIds?.find(Boolean) ?? null;
      return {
        title: topic.title,
        status: topic.status,
        unit: planUnits.find((row) => row.id === topic.unitId)?.title ?? null,
        sourceNoteId,
        sourceTitle: sourceNoteId ? notes.find((row) => row.id === sourceNoteId)?.title ?? null : null,
      };
    });
  }, [planTopics, planUnits, readingNotes, studySetId, notes]);
  // One-shot steer into the Lecture studio when a recording is running and its
  // note belongs to this room — so returning to the room lands on the recording
  // rather than on whatever pane was last open. The ref makes it once per room,
  // so the student can navigate away again.
  // FIXED (F9): the reset effect watched `courseId` ONLY. Study sets commonly
  // have no course, so moving between them never re-armed the steer and, after
  // one steer anywhere, no other set would jump to its running recording. The
  // room's identity is the set OR the course, whichever it has, so the reset
  // now watches both.
  const steeredToLecture = useRef(false);
  useEffect(() => {
    steeredToLecture.current = false;
  }, [courseId, studySetId]);
  useEffect(() => {
    if (steeredToLecture.current) return;
    if (lectureStatus === 'idle' || !lectureNoteId) return;
    if (!notes.some((row) => row.id === lectureNoteId)) return;
    setActivity('lecture');
    steeredToLecture.current = true;
  }, [courseId, studySetId, lectureNoteId, lectureStatus, notes]);
  const noteIds = useMemo(() => new Set(notes.map((n) => n.id)), [notes]);
  const deckIds = useMemo(() => new Set(courseDecks.map((d) => d.id)), [courseDecks]);
  // Tests in this room, from two sources merged by id: the lean `/tests` fetch
  // and locally completed attempts in `testStore`. Filing is decided by the
  // shared `testsFiledIn*` rules, which also count a test as "in this room" when
  // its SOURCE note or deck is — hence the id sets above.
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
        studyDoor: result.session.config?.studyDoor,
        attemptKind: result.session.config?.attemptKind,
        mode: result.session.config?.mode,
      })),
    ]) {
      byId.set(row.id, row);
    }
    const rows = [...byId.values()];
    return studySetId
      ? testsFiledInStudySet(rows, studySetId, noteIds, deckIds)
      : testsFiledInCourse(rows, courseId, noteIds, deckIds);
  }, [fetchedTests, testResults, courseId, studySetId, noteIds, deckIds]);

  // Opening a note does two things at once: it becomes the store's
  // `selectedNote` (which is what every studio and note handler reads) and it
  // becomes the companion's attached note, stamped with THIS room's scope.
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

  // A `?noteId` in the path opens that note. Driven by `routePath.noteId`.
  useEffect(() => {
    if (routePath?.noteId) void openNote(routePath.noteId);
  }, [routePath?.noteId, openNote]);

  // Four sibling effects, one per note-backed studio (lecture / lesson / recap /
  // essay). Each asks the shared `resolve*StudioNote` rule what to do on entering
  // that studio and acts ONLY on a 'resume' decision — a 'create' decision is the
  // studio's own job, not this component's. Driven by `activity` plus that
  // studio's list; the `selectedNote?.id` guard stops a re-open loop.
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

  /**
   * FOCUS: a studio is open in a SET room, so the chrome collapses to one bar.
   *
   * Course rooms are deliberately excluded — they still need the activity chip
   * strip and the Materials column, neither of which a set room draws any more.
   * `focusActivity` is the same answer narrowed to a studio id, so the bar can
   * take a `WorkspaceActivityId` without a cast: `home` and `add` are not FOCUS
   * by definition, and TypeScript should get to see that rather than be told.
   *
   * Declared HERE, above `openSetChat`, because the companion rail's remembered
   * state is per surface and this is which surface we are on.
   */
  const focusMode = Boolean(studySetId) && isSetRoomFocus(activity, routePath);
  const focusActivity: WorkspaceActivityId | null =
    focusMode && activity !== 'home' && activity !== 'add' ? activity : null;

  /**
   * How much room the AI companion gets, measured off the row below rather than
   * off the window — see `hooks/useCompanionRail` and issue #105. The three
   * modes render three different things (a docked panel, a 48px rail, or
   * nothing but the header's Chat button), so this is state, not a CSS
   * breakpoint.
   */
  const rail = useCompanionRail(focusMode ? 'focus' : 'home');

  /**
   * A counter the docked panel watches so an "Ask Lantern" moves focus into the
   * composer even when the panel was already open. Opening the companion is
   * what focuses it otherwise, and a panel that never closed never opens.
   */
  const [companionFocusTick, setCompanionFocusTick] = useState(0);

  /**
   * Open the companion on this set — from a tool tile, a header button, the
   * focus bar, anywhere.
   *
   * It EXPANDS the rail without remembering: the student asking one question is
   * not the student choosing to study beside a chat panel, and writing the
   * preference here would quietly undo a collapse they meant. Where the room
   * cannot dock, `expand()` leaves the rail collapsed and the open below
   * becomes the overlay sheet instead.
   */
  const openSetChat = (message?: string) => {
    rail.expand();
    setCompanionFocusTick((tick) => tick + 1);
    if (message) useCompanionStore.getState().openWithMessage(message);
    else useCompanionStore.getState().open();
  };

  /** The student's own expand, from the collapsed rail. This one is a choice. */
  const expandCompanionRail = () => {
    rail.expand({ remember: true });
    setCompanionFocusTick((tick) => tick + 1);
    useCompanionStore.getState().open();
  };

  /** The student's own collapse, from the panel header. So is this one. */
  const collapseCompanionRail = () => {
    rail.collapse();
    useCompanionStore.getState().close();
  };

  /**
   * When the docked panel goes away — the student collapsed it, or the room
   * narrowed past the point where it fits — put the companion away with it.
   *
   * Without this a window drag would turn an open docked panel into a sheet
   * thrown over the studio, since the overlay is the same store flag. A cleanup
   * rather than a comparison of the previous mode: the only thing that has to
   * be true is that nothing is left open behind a rail.
   */
  useEffect(() => {
    if (rail.mode !== 'docked') return;
    return () => {
      useCompanionStore.getState().close();
    };
  }, [rail.mode]);

  // Build this set's plan from its own reading notes, once, and persist it.
  // Guarded three ways: no set, a plan already in state, or a run in flight. It
  // re-checks the server first because another surface may have written a plan
  // since this room loaded. A failure is swallowed — the room keeps using the
  // locally derived topics, which is why every topic read below falls back to
  // `topicsFromReadingNotes`.
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

  // Set-home tool tiles. A tool whose kind has NOTHING made yet jumps straight
  // to its creation wizard; otherwise it opens the activity's library.
  const handleHomeTool = (tool: StudySetHomeTool) => {
    if (tool.id === 'import') {
      go('add');
      return;
    }
    if (tool.id === 'ask') {
      openSetChat(`Help me study ${label}. What should I do next in this set?`);
      return;
    }
    if (tool.id === 'recap' && recaps.length === 0) {
      go('recap', { createNew: true });
      return;
    }
    if (tool.id === 'lesson' && lessons.length === 0) {
      go('lesson', { createNew: true });
      return;
    }
    if (tool.id === 'play' && courseDecks.length === 0) {
      go('play', { createNew: true });
      return;
    }
    if (tool.activity) handleActivity(tool.activity, 'ready');
  };

  /**
   * File one chat answer as a note in THIS room, then run the ordinary
   * turn-into on it.
   *
   * Saving first is not a detour: the studios open on a note, the
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

  const fileTopicNotes = async (brief: TopicBrief): Promise<StudyNote[]> => {
    const generated = await aiGenerateFromTopic(brief.title, {
      subject: brief.subject,
      level: brief.level,
      studySetId,
    });
    const created: StudyNote[] = [];
    for (const draft of generated.notes) {
      const note = await useNotesStore.getState().createNote({
        title: draft.title,
        body: draft.body,
        sourceType: 'typed',
        ...studySetNotePayload({ courseId, studySetId }),
      });
      created.push(note);
    }
    await reloadNotes().catch(() => undefined);
    void kickPlanGeneration();
    if (created[0]) await openNote(created[0].id);
    showToast(`${created.length} notes filed in this ${roomNoun}.`, 'success');
    return created;
  };

  // "Generate from a topic": file the AI-written notes first, then continue into
  // whatever the student actually asked for. Every branch ends in either a `go()`
  // or a `handleTurnInto`, so the topic path and the pick-a-note path converge on
  // the same generation code (and the same credit charge).
  const handleCreateFromTopic = async (
    brief: TopicBrief,
    kind: CreateFromSourceKind,
    options?: CreateFromSourceOptions
  ) => {
    try {
      const created = await fileTopicNotes(brief);
      const first = created[0];
      if (!first) return;
      setCreateKind(null);
      if (kind === 'materials' || kind === 'notes') {
        go('notes', { noteId: first.id });
        return;
      }
      if (kind === 'cards') {
        const count = options?.questionCount || 10;
        if (!currentUserId) {
          showToast('Sign in to generate study materials.', 'error');
          return;
        }
        setTurning(true);
        try {
          await noteHandlers.handleCreateFlashcardDeckFromNote(count);
          showToast(`Deck saved in this ${roomNoun}.`, 'success');
          go('cards');
        } catch (error) {
          showToast(error instanceof Error ? error.message : 'Could not generate that.', 'error');
        } finally {
          setTurning(false);
        }
        return;
      }
      if (kind === 'quiz') {
        if (options?.questionCount) setQuizQuestionCount(options.questionCount);
        await handleTurnInto('quiz', first.id);
        return;
      }
      if (kind === 'test') {
        await handleTurnInto('test', first.id);
        return;
      }
      if (kind === 'play') {
        await handleTurnInto('cards', first.id);
        go('play');
        return;
      }
      go(kind === 'lesson' ? 'lesson' : kind === 'recap' ? 'recap' : kind === 'essay' ? 'essay' : 'notes', {
        noteId: first.id,
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not generate from that topic.', 'error');
    }
  };

  // Quiz written from existing cards. The 50-character floor is a pre-flight
  // check: too little text would spend a credit on a request that cannot produce
  // usable questions.
  const handleQuizFromDecks = async (ids: string[], options?: CreateFromSourceOptions) => {
    const cards = flashcards.filter((card) => ids.includes(card.deckId));
    const text = cards
      .map((card) => `${card.front || ''}\n${card.back || ''}`)
      .join('\n\n')
      .trim();
    if (text.length < 50) {
      showToast('Those decks need more cards first.', 'info');
      return;
    }
    try {
      const generated = await aiGenerateQuestions(text, {
        count: options?.questionCount || 20,
        questionTypes: ['multiple_choice'],
        subject: options?.focus || options?.title,
      });
      const items = questionsToAdaptiveItems(generated.questions);
      if (items.length === 0) {
        showToast('Could not write questions from those cards.', 'error');
        return;
      }
      setQuizSeed(items);
      setQuizLive(true);
      setCreateKind(null);
      go('quiz');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not write a quiz from those cards.', 'error');
    }
  };

  // The activity chip strip's handler: navigate, then make sure the pane has a
  // sensible note to open on. A 'later' chip only explains itself and changes
  // nothing. The per-activity blocks below repeat the `resolve*StudioNote` rules
  // used by the effects above, because a chip click can land on a studio the
  // room is ALREADY standing in, where no effect would re-run.
  const handleActivity = (id: WorkspaceActivityId, status: 'ready' | 'later') => {
    if (status === 'later') {
      showToast(WORKSPACE_LATER_COPY, 'info');
      return;
    }
    if (id === 'notes') {
      // The note this lands on goes in the URL rather than only in the store.
      // FOCUS is read off the path (`isSetRoomFocus`), so a notes room opened
      // with the id left behind would draw the set home's chrome over an open
      // note — and Back/refresh would lose the note as well.
      const current = useNotesStore.getState().selectedNote;
      const wrongKind =
        current &&
        (isCalendarNote(current) ||
          isEssayNote(current) ||
          isLectureNote(current) ||
          isLessonNote(current) ||
          isRecapNote(current));
      const keepCurrent = Boolean(current && !wrongKind && noteInRoom(current));
      const target = keepCurrent ? current?.id : readingNotes[0]?.id;
      go('notes', target ? { noteId: target } : {});
      if (target && target !== current?.id) void openNote(target);
      return;
    }
    go(id);
    if (id === 'quiz') {
      setQuizSeed(null);
      setQuizLive(false);
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
  const turnIntoExisting = useCallback(
    (noteId: string): Partial<Record<TurnIntoTargetId, boolean>> => ({
      test: courseTests.some(
        (row) => row.sourceNoteId === noteId && studyTestDoor(row) === 'test'
      ),
      quiz: courseTests.some(
        (row) => row.sourceNoteId === noteId && studyTestDoor(row) === 'quiz'
      ),
      lesson: lessons.some((row) => (row.body || '').includes(noteId)),
      recap: recaps.some((row) => (row.body || '').includes(noteId)),
      essay: essays.some((row) => (row.body || '').includes(noteId)),
      notes: readingNotes.some((row) => row.id === noteId),
      play: courseDecks.length > 0,
    }),
    [courseDecks.length, courseTests, essays, lessons, readingNotes, recaps]
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
    // Studios are places, not jobs. Opening them IS the action.
    if (target === 'lesson' || target === 'recap' || target === 'essay' || target === 'play' || target === 'notes') {
      go(target, target === 'play' ? {} : { noteId: note.id });
      return;
    }
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    // From here on a credit is spent. Each target runs the same work twice over:
    // directly when there is no AI-job user (tests, signed-out edge), or wrapped
    // in `runAiJob` — which owns the progress UI, the credit cost and the
    // "back to this room" target. `turning` is released in `finally` so a failed
    // generation does not leave the studio's buttons disabled.
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
      } else if (target === 'quiz') {
        const run = async () => noteHandlers.handleStartNoteQuiz(undefined, undefined, { studyDoor: 'quiz' });
        if (!aiJobUserId) {
          const result = await run();
          if (!result) throw new Error('Could not write a quiz from this note.');
        } else {
          await runAiJob(
            {
              userId: aiJobUserId,
              kind: 'quiz',
              title,
              stages: ['Reading your note', 'Writing questions', 'Opening the quiz'],
              creditCost: AI_CREDIT_COSTS.generate_questions,
              target: { path: workspacePath, label: studySetId ? 'Back to set' : 'Back to course' },
            },
            async (report, hooks) => {
              report(1);
              const result = await noteHandlers.handleStartNoteQuiz(undefined, hooks, { studyDoor: 'quiz' });
              report(2);
              if (!result) throw new Error('Could not write a quiz from this note.');
              return result;
            }
          );
        }
        setQuizLive(true);
        setActivity('quiz');
        go('quiz');
      } else {
        const run = async () =>
          noteHandlers.handleStartNoteQuiz(undefined, undefined, {
            studyDoor: 'test',
            sittingPreset: testPreset ?? undefined,
          });
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
              const result = await noteHandlers.handleStartNoteQuiz(undefined, hooks, {
                studyDoor: 'test',
                sittingPreset: testPreset ?? undefined,
              });
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

  // Quiz questions for the adaptive quiz pane. Both guards THROW rather than
  // toast: the caller is the quiz component, which shows the message in place.
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

  // `selectedNote` comes from a single-note load that can omit attachments, so
  // both `walkable` and `studioNote` fall back to this room's copy of the note
  // for them — without it the Walkthrough door reads as "no document attached"
  // on a note that plainly has one.
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

  /** The fallback line for a set with materials but no topics yet. */
  const roomCounts = formatCourseMaterialCounts({
    notes: homeMaterials.length,
    decks: courseDecks.length,
    tests: courseTests.length,
  });

  /**
   * The kebab. It holds the room's NAVIGATION — the things that take you out of
   * where you are — while the controls beside the title hold the things you do
   * while you stay. `Set home` was a button in the header that only existed
   * while you were not on it, which is a control that appears and disappears
   * depending on where you are; in a menu that is simply a row.
   */
  // The left nav chrome steps aside at lg+ while a studio is open — BOTH the
  // sidebar rail and the chats flyout column beside it, which defaults to open
  // and is a further 320px — and comes back when the student leaves, unless
  // they reopened it themselves in the meantime, which the hook remembers per
  // panel. See hooks/useFocusSidebarCollapse.
  useFocusSidebarCollapse(focusMode);

  /**
   * The set room's header, as an OBJECT rather than as chrome — identity tile,
   * serif name, gear, and the stats row carrying the plan's counts and its
   * progress. `ScreenHeader` (for a course room) can only draw a title and a
   * button row, which is why a set used to read as a page rather than as a
   * thing the student owns.
   *
   * Hoisted to a const because it is rendered in TWO places and must stay one
   * element: above the scroller for a studio (where it is the compact header),
   * and INSIDE the scroller on home, so it scrolls away exactly as the
   * reference's does. Pinned, it ate ~90px of every scrolled view — a set's
   * name and its topic counts are not something you need in front of you while
   * you read the eighth material card.
   */
  const setHeader = studySetId ? (
        <SetRoomHeader
          setId={studySetId}
          title={label}
          coverPath={studySet?.coverPath}
          tileHue={studySet?.tileHue}
          tileGlyph={studySet?.tileGlyph}
          progress={activity === 'home' ? roomProgress : null}
          counts={activity === 'home' ? roomCounts : undefined}
          visibility={studySet?.visibility}
          variant={activity === 'home' ? 'home' : 'compact'}
          mode={studySet?.mode ?? null}
          // `mode` is already an end-to-end field — the plan's own
          // `pickRecommendedTopic` reads it and the settings screen writes
          // it — so Mode needed no migration and no new column: it is the
          // SAME store action, surfaced where a student stands.
          onSelectMode={
            studySet
              ? (next) => {
                  void updateSet(studySetId, { mode: next }).catch(() => undefined);
                }
              : undefined
          }
          onOpenSettings={() => setSettingsOpen(true)}
          // The timer, Chat and the kebab moved UP into `SetRoomTopBar`:
          // they are actions on the ROOM, and leaving them here made the
          // set's own name carry a toolbar. The header is now the set as an
          // object — tile, title, gear, stats — and nothing else.
          menu={[]}
        />
  ) : null;

  const roomMenu: SetRoomHeaderMenuItem[] = studySetId
    ? [
        ...(activity !== 'home'
          ? [{ id: 'home', label: 'Set home', onSelect: () => go('home') }]
          : []),
        {
          id: 'share',
          label: 'Share set',
          onSelect: () =>
            void shareStudySet({
              setId: studySetId,
              title: label,
              visibility: studySet?.visibility,
            }),
        },
        { id: 'plan', label: 'Full study plan', onSelect: () => go('plan') },
        { id: 'materials', label: 'All materials', onSelect: () => onOpenLibrary() },
        {
          id: 'all-sets',
          label: 'All study sets',
          onSelect: () => {
            openPicker();
            navigateTo(AppMode.STUDY_HUB);
          },
        },
      ]
    : [];

  const renderWizard = (kind: CreateFromSourceKind) => (
    <CreateFromSource
      kind={kind}
      notes={readingNotes}
      decks={courseDecks}
      studySetId={studySetId}
      onCancel={() => {
        setCreateKind(null);
        setCreateOptions(null);
        go(kind === 'materials' || kind === 'notes' ? 'notes' : kind === 'play' ? 'play' : kind);
      }}
      onPickNote={(noteId, options) => {
        setCreateOptions(options ?? null);
        if (options?.questionCount) setQuizQuestionCount(options.questionCount);
        setCreateKind(null);
        void openNote(noteId);
        if (kind === 'cards') void handleTurnInto('cards', noteId);
        else if (kind === 'quiz') {
          setQuizLive(true);
          go('quiz');
        } else if (kind === 'test') void handleTurnInto('test', noteId);
        else if (kind === 'play') go('play');
        else if (kind === 'materials' || kind === 'notes') go('notes', { noteId });
        else go(kind, { noteId });
      }}
      onPickTopic={(brief, options) => {
        setCreateOptions(options ?? null);
        void handleCreateFromTopic(brief, kind, options);
      }}
      onPickScratch={() => {
        setCreateKind(null);
        if (kind === 'quiz') {
          setQuizLive(true);
          go('quiz');
        } else if (kind === 'test') onNewTest();
        else if (kind === 'notes' || kind === 'materials') void handleNewNote();
        else if (kind === 'cards') go('cards');
        else if (kind === 'play') go('play');
        else go(kind);
      }}
      onPickDecks={(ids, options) => void handleQuizFromDecks(ids, options)}
    />
  );

  const quizRows = courseTests.filter((row) => studyTestDoor(row) === 'quiz');
  const testRows = courseTests.filter((row) => studyTestDoor(row) === 'test');
  const notesRoomOpen =
    activity === 'notes' &&
    Boolean(studioNote && noteInRoom(studioNote) && !isCalendarNote(studioNote) && !isEssayNote(studioNote) && !isLectureNote(studioNote) && !isLessonNote(studioNote) && !isRecapNote(studioNote));

  // A set id whose set is not in the store yet is not the same as a set that does
  // not exist: while `loaded` is false and there is no error it is still opening,
  // and only once the list has settled (or failed) is "could not open" true.
  const setMissing = Boolean(studySetId && !studySet);
  const setOpening = setMissing && !setsLoaded && !setsLoadError;
  const setUnavailable = setMissing && (Boolean(setsLoadError) || setsLoaded);

  if (setOpening || setUnavailable) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
        <StudyWorkspaceBar
          active="study"
          onSelect={(section) => {
            if (section === 'library') onOpenLibrary();
          }}
        />
        <div className="flex flex-1 min-h-0 flex-col items-center justify-center px-6 text-center">
          {setOpening ? (
            <div role="status" aria-label="Opening this set">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-lantern-primary/30 border-t-lantern-primary" />
              <span className="sr-only">Opening this set…</span>
            </div>
          ) : (
            <>
              <p className="text-heading text-lantern-text">Could not open this set</p>
              <p className="mt-1 max-w-md text-body text-lantern-text-secondary">
                {/too many requests/i.test(setsLoadError ?? '')
                  ? 'The app asked for your sets too quickly. Wait a moment and try again.'
                  : 'This set is not in your library, or it failed to load.'}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => {
                    void loadSets({ force: true }).catch(() => undefined);
                  }}
                >
                  Try again
                </Button>
                <Button variant="secondary" onClick={() => navigateTo(AppMode.STUDY_HUB)}>
                  Back to Study
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-lantern-background text-lantern-text">
      {/* Study/Library. A tab bar is a choice between two PLACES, and a student
          inside a quiz has already chosen one — so it is drawn on the set home
          and nowhere else. The focus bar's Back button is the way out. */}
      {focusActivity ? null : studySetId ? (
        // The set room's own top bar: where you are, and what you can do to
        // the whole set. It replaces the Study/Library tab row INSIDE a set —
        // a tab row that switches destination is a strange thing to leave in
        // a room the student has already entered, and Library is still two
        // clicks away (the kebab's `All materials`, the rail's `View all`).
        <SetRoomTopBar
          setName={label}
          onOpenStudy={() => {
            openPicker();
            navigateTo(AppMode.STUDY_HUB);
          }}
          onShare={() =>
            void shareStudySet({
              setId: studySetId,
              title: label,
              visibility: studySet?.visibility,
            })
          }
          timer={<StudySetTimer setId={studySetId} />}
          // Only where there is no rail at all — the rail's own Chat row is
          // the control whenever a rail exists (#126).
          {...(rail.mode === 'none' ? { onOpenChat: () => openSetChat() } : {})}
          menu={roomMenu}
        />
      ) : (
        <StudyWorkspaceBar
          active="study"
          onSelect={(section) => {
            if (section === 'library') onOpenLibrary();
          }}
        />
      )}
      {/* Room layout, and THE ELEMENT THE COMPANION IS MEASURED AGAINST: its
          width is what the room actually has, after the shell's sidebar and
          chats flyout have taken theirs. `rail.rowRef` observes it; nothing
          here reads the viewport (issue #105).
          Laid out as a row whenever the companion is beside the studio, and as
          a column when it is not — the drawer is fixed-position, so a room with
          no rail is exactly the single-column room it always was.
          `min-h-0` + `min-w-0` repeat down every level of this nesting on
          purpose: each is a flex child that must be allowed to shrink, or the
          inner scrollers stop scrolling and the panes spill.
          The header block is `shrink-0` — it clips, and a clipping element in a
          flex column is crushed vertically as the content beside it grows unless
          it refuses to shrink. */}
      <div
        ref={rail.rowRef}
        className={`flex-1 flex min-h-0 overflow-hidden ${
          rail.mode === 'none' ? 'flex-col' : 'flex-row'
        }`}
      >
        {/* THE MEASURED CONTENT COLUMN. The reference holds set home to 728px
            inside a 976px main column with 24px gutters — a line of body copy
            at 14px stops being one at about 90 characters, and an 790px-wide
            wall of 40px pills is what made Lantern's room read as a dashboard.
            `items-center` + `max-w` on the two children rather than a wrapper
            div, so the documented min-h-0 / shrink-0 chain below is untouched.
            Only on set HOME: a studio (quiz, notes, the plan timeline) wants
            every pixel the room has. */}
        <div
          className={`flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden px-4 md:px-6 ${
            focusActivity ? 'pt-0' : 'pt-4'
          } ${activity === 'home' && studySetId ? 'items-center' : ''}`}
        >
        <div className={`shrink-0 ${activity === 'home' && studySetId ? 'w-full max-w-[728px]' : ''}`}>
        {focusActivity && studySetId ? (
          // The bleed puts the bar's hairline against the window edge while the
          // studio below keeps the room's gutter. Negative margin only — no new
          // flex child, so the documented min-h-0 / shrink-0 chain is untouched.
          <div className="-mx-4 md:-mx-6 mb-2 px-2 md:px-4">
            <SetRoomFocusBar
              setId={studySetId}
              setName={label}
              coverPath={studySet?.coverPath}
              tileHue={studySet?.tileHue}
              tileGlyph={studySet?.tileGlyph}
              activity={focusActivity}
              onBack={() => go('home')}
              onActivity={handleActivity}
              onOpenSettings={() => setSettingsOpen(true)}
              menu={roomMenu}
              timer={<StudySetTimer setId={studySetId} />}
              // Only where there is no rail at all. A collapsed rail already
              // carries this button, 48px to the right, and two chat buttons on
              // one bar is the header the focus bar replaced.
              {...(rail.mode === 'none' ? { onOpenChat: () => openSetChat() } : {})}
            />
          </div>
        ) : studySetId ? (
          // On HOME the header is rendered INSIDE the scroller instead (see
          // `setHeader` and the `header` prop below): it is the set as an
          // object, not chrome, and the reference scrolls it away. Only the
          // 52px top bar is pinned. Here it is the compact header a studio
          // wears, which does belong above the scroll.
          activity === 'home' ? null : setHeader
        ) : (
          <ScreenHeader
            title={label}
            subtitle="Notes, cards, tests and lectures in one room"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                {rail.mode === 'none' ? (
                  <Button variant="secondary" onClick={() => openSetChat()} aria-label="Chat">
                    <AppIcon name="chatbubbles" size={16} />
                    <span className="ml-1.5">Chat</span>
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => navigateTo(AppMode.STUDY_HUB)}>
                  All courses
                </Button>
              </div>
            }
          />
        )}
        {/* Activity chips. Hidden on a study set: the set rail already
            names every door, and repeating them here is what crushed the
            quiz / cards / notes pane. Course rooms still need the strip. */}
        {!studySetId ? (
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

        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            activity === 'home' && studySetId ? 'w-full max-w-[728px]' : ''
          }`}
        >
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden lg:flex-row">
        {/* Materials column. Hidden on a study set — the set rail already
            holds Upload and the materials tree — and while a note is open
            in the Notes studio. Course rooms still need this column.
            `shrink-0` protects its width beside the studio; the
            `max-h-[min(62vh,36rem)]` cap applies only while stacked. */}
        {!studySetId && !notesRoomOpen ? (
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
              <LecturesGroup
                lectures={lectures}
                selectedId={selectedNote?.id ?? null}
                onOpen={(noteId) => {
                  void openNote(noteId);
                  setActivity('lecture');
                }}
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

        {/* THE PANE. One long ternary chain, and the ORDER is the logic — each
            studio is preceded by (a) its creation wizard when `?createNew` is
            set, and (b) its "library" list when the studio has no note to open
            on. Reordering these arms changes which screen a route lands on.
            The final `else` is the plain Card that hosts the list-only
            activities (notes / cards / test / walkthrough placeholder). */}
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {activity === 'add' && studySetId ? (
            <StudySetUpload
              studySetId={studySetId}
              courseId={courseId || undefined}
              onImport={(source) => {
                if (source === 'lecture') {
                  go('lecture', { createNew: true });
                  return;
                }
                setImportSource(source ?? null);
                setImportOpen(true);
              }}
              onRecord={() => go('lecture', { createNew: true })}
            />
          ) : activity === 'home' && studySetId ? (
            <StudySetHome
              setLabel={label}
              notes={homeMaterials}
              decks={courseDecks}
              deckCount={courseDecks.length}
              testCount={courseTests.length}
              recommended={readingNotes[0] ?? notes[0] ?? null}
              studySet={studySet}
              planTopics={planTopics}
              planUnits={planUnits}
              planGenerating={planGenerating}
              renderNoteMenu={renderNoteRowMenu}
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
              onOpenDeck={(deckId) => {
                const deck = courseDecks.find((row) => row.id === deckId);
                if (deck) onSelectDeck(deck);
              }}
              onOpenPlan={() => go('plan')}
              onOpenLibrary={onOpenLibrary}
              header={setHeader}
              onGenerateFromTopic={(brief) => void handleCreateFromTopic(brief, 'materials')}
              footer={
                <SetRoomFooter
                  studySetId={studySetId}
                  examDate={studySet?.examDate ?? null}
                  exams={exams}
                  onViewSchedule={() => go('calendar')}
                  onAddSyllabus={() => {
                    go('add');
                    setImportSource(null);
                    setImportOpen(true);
                  }}
                />
              }
            />
          ) : activity === 'notes' && routePath?.createNew && studySetId ? (
            renderWizard('notes')
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
            renderWizard('quiz')
          ) : activity === 'quiz' && studySetId && !routePath?.quizId && !quizSeed && !quizLive ? (
            <StudySetArtifactLibrary
              title="Quizzes"
              empty="Make a quiz from materials or flashcards in this set."
              createLabel="+ New"
              folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
              onOpenFolder={() => {
                openPicker();
                navigateTo(AppMode.STUDY_HUB);
              }}
              onCreate={() => go('quiz', { createNew: true })}
              onOpen={(quizId) => go('quiz', { quizId })}
              items={quizRows.map((test) => ({
                id: test.id,
                title: test.title || 'Quiz',
                preview: test.preview,
                feature: 'tests' as const,
                icon: 'help-circle' as const,
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
              testIds={quizRows.map((test) => test.id)}
              preferredTestId={routePath?.quizId}
              canWalkthrough={Boolean(walkable)}
              writing={writingQuiz}
              seedItems={quizSeed}
              onWriteQuestions={handleWriteQuizQuestions}
              onOpenNotes={() => setActivity('notes')}
              onOpenWalkthrough={() => handleActivity('walkthrough', 'ready')}
              // Finishing a quiz writes mastery back onto the plan topic the
              // source note belongs to — optimistically in local state, then to
              // the server. 80% is the mastered threshold; anything lower is
              // 'covered' (seen, not done). A failed write is ignored: the next
              // plan fetch is the source of truth.
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
          ) : activity === 'lecture' &&
            studySetId &&
            lectureStatus === 'idle' &&
            !(selectedNote && isLectureNote(selectedNote)) &&
            !routePath?.noteId &&
            !routePath?.createNew ? (
            <StudySetArtifactLibrary
              title="Lectures"
              empty="Record a lecture or open one you already filed."
              createLabel="+ New"
              onCreate={() => go('lecture', { createNew: true })}
              onOpen={(noteId) => {
                void openNote(noteId);
                go('lecture', { noteId });
              }}
              items={lectures.map((note) => ({
                id: note.id,
                title: note.title || 'Lecture',
                preview: note.body,
                feature: 'notes' as const,
                icon: 'mic' as const,
              }))}
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
          ) : activity === 'lesson' && (createKind === 'lesson' || routePath?.createNew) && studySetId ? (
            renderWizard('lesson')
          ) : activity === 'lesson' && studySetId && !(selectedNote && isLessonNote(selectedNote)) && !routePath?.noteId ? (
            <StudySetArtifactLibrary
              title="Tutor"
              empty="Start a tutor session from a note or a topic."
              createLabel="+ New"
              onCreate={() => go('lesson', { createNew: true })}
              onOpen={(noteId) => {
                void openNote(noteId);
                go('lesson', { noteId });
              }}
              items={lessons.map((note) => ({
                id: note.id,
                title: note.title || 'Lesson',
                preview: note.body,
                feature: 'ai' as const,
                icon: 'school' as const,
              }))}
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
              initialMode={createOptions?.lessonMode}
            />
          ) : activity === 'recap' && (createKind === 'recap' || routePath?.createNew) && studySetId ? (
            renderWizard('recap')
          ) : activity === 'recap' && studySetId && !(selectedNote && isRecapNote(selectedNote)) && !routePath?.noteId ? (
            <StudySetArtifactLibrary
              title="Audio recaps"
              empty="Generate a listen-through from a note in this set."
              createLabel="+ New"
              folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
              onOpenFolder={() => {
                openPicker();
                navigateTo(AppMode.STUDY_HUB);
              }}
              onCreate={() => go('recap', { createNew: true })}
              onOpen={(noteId) => {
                void openNote(noteId);
                go('recap', { noteId });
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
              initialStyle={createOptions?.recapStyle}
              initialLength={createOptions?.recapLength}
            />
          ) : activity === 'play' && (createKind === 'play' || routePath?.createNew) && studySetId ? (
            renderWizard('play')
          ) : activity === 'play' ? (
            <PlayStudio
              scope={scopeNoun(studySetId, courseId)}
              decks={courseDecks}
              flashcards={flashcards}
              onStartMatch={onStartMatch}
              onReviewMissed={(deck, cardIds) => onStartCram(deck, undefined, cardIds)}
              onCreateNew={studySetId ? () => go('play', { createNew: true }) : undefined}
            />
          ) : activity === 'essay' && (createKind === 'essay' || routePath?.createNew) && studySetId ? (
            renderWizard('essay')
          ) : activity === 'essay' && studySetId && !(selectedNote && isEssayNote(selectedNote)) && !routePath?.noteId ? (
            <StudySetArtifactLibrary
              title="Essay"
              empty="Grade a draft from a note or paste."
              createLabel="+ New"
              onCreate={() => go('essay', { createNew: true })}
              onOpen={(noteId) => {
                void openNote(noteId);
                go('essay', { noteId });
              }}
              items={essays.map((note) => ({
                id: note.id,
                title: note.title || 'Essay',
                preview: note.body,
                feature: 'tests' as const,
                icon: 'document' as const,
              }))}
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
              initialRubric={createOptions?.rubricText}
            />
          ) : activity === 'plan' && routePath?.activity === 'plan' && studySetId ? (
            <StudySetPlanPanel
              studySetId={studySetId}
              notes={readingNotes}
              mode={studySet?.mode || 'standard'}
              onModeChange={(mode) => {
                void updateSet(studySetId, { mode }).catch(() => undefined);
              }}
              onOpenSettings={() => setSettingsOpen(true)}
              onStart={(kind, noteId) => {
                if (noteId) void openNote(noteId);
                // The kind IS the chip. It used to be `read`, a path the room
                // maps onto the Walkthrough chip, so Continue lit Walkthrough
                // over "Select a note with a PDF or slides attached."; each
                // kind now goes to its own route and the lit chip matches.
                if (kind === 'notes') go('notes', noteId ? { noteId } : {});
                else if (kind === 'walkthrough') go('walkthrough');
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
                <StudySetArtifactLibrary
                    title="Notes"
                    empty={
                      studySetId
                        ? 'Import material or generate notes from a topic.'
                        : 'Import lecturer notes or your own material into this course.'
                    }
                    createLabel="+ New"
                    folders={folders.map((folder) => ({ id: folder.id, title: folder.title }))}
                    onOpenFolder={() => {
                      openPicker();
                      navigateTo(AppMode.STUDY_HUB);
                    }}
                    onCreate={studySetId ? () => go('notes', { createNew: true }) : () => void handleNewNote()}
                    onOpen={(noteId) => {
                      void openNote(noteId);
                      go('notes', { noteId });
                    }}
                    renderItemMenu={(item) => {
                      const note = readingNotes.find((row) => row.id === item.id);
                      return note ? renderNoteRowMenu(note) : null;
                    }}
                    items={readingNotes.map((note) => ({
                      id: note.id,
                      title: note.title || 'Untitled note',
                      preview: note.body,
                      feature: 'notes' as const,
                      icon: 'document-text' as const,
                    }))}
                  />
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
                  renderWizard('cards')
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
                    renderItemMenu={(item) => renderDeckTileMenu(item.id)}
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
                {routePath?.createNew && studySetId ? (
                  <div className="space-y-4">
                    {renderWizard('test')}
                    <div>
                      <p className="text-caption text-lantern-text-secondary mb-2">Sitting</p>
                      <div className="flex flex-wrap gap-2">
                        {TEST_SITTING_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            aria-pressed={testPreset === preset.id}
                            title={preset.promise}
                            onClick={() => setTestPreset(preset.id)}
                            className={`min-h-[44px] rounded-full border px-3 text-caption ${
                              testPreset === preset.id
                                ? 'border-lantern-text font-semibold'
                                : 'border-lantern-border text-lantern-text-secondary'
                            }`}
                          >
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <StudySetArtifactLibrary
                    title="Test"
                    empty={scopedCopy('testsFromDecks', roomNoun)}
                    createLabel="+ New"
                    onCreate={() => (studySetId ? go('test', { createNew: true }) : onNewTest())}
                    onOpen={(testId) => onOpenTest(testId)}
                    items={testRows.map((test) => ({
                      id: test.id,
                      title: test.title || 'Test',
                      preview: test.preview,
                      feature: 'tests' as const,
                      icon: 'clipboard' as const,
                    }))}
                  />
                )}
              </div>
            )}
          </Card>
          )}
        </section>
        </div>
        </div>
        </div>

        {rail.mode === 'docked' ? (
        <aside className={`flex ${rail.dockWidthClass} min-h-0 shrink-0 self-stretch`}>
          <div className="flex flex-1 min-h-0 flex-col overflow-hidden border-l border-lantern-border">
            <div className="flex-1 min-h-0 overflow-hidden">
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
                // Turn Into, on whatever note the companion has
                // attached — the same handler, credits and ticks the studios
                // use, so nothing here is a second implementation.
                onTurnInto={(target, noteId) => void handleTurnInto(target, noteId)}
                // The same targets again, but scoped to ONE answer: the
                // answer is filed here first, then run through the identical
                // path above.
                onTurnIntoMessage={(target, draft) => void handleTurnIntoMessage(target, draft)}
                turnIntoExisting={companionNote ? turnIntoExisting(companionNote.id) : undefined}
                // The set's own next topic, so Guided opens on `Continue
                // learning: <topic>` instead of a list of cold starts.
                guidedNextTopic={guidedNextTopic}
                // The rest of the plan, so the picker can offer a cold start
                // on any topic that is not the Continue row.
                guidedTopics={guidedTopics}
                // The close control on a docked rail COLLAPSES it rather than
                // shutting the companion — the difference the student feels is
                // that the 48px rail is still there to press. Until this, the
                // room never passed `closable` at all and a docked panel could
                // not be dismissed by any means.
                closable
                onClose={collapseCompanionRail}
                closeLabel="Collapse Lantern AI"
                focusComposerSignal={companionFocusTick}
              />
            </div>
          </div>
        </aside>
        ) : (
          <>
            {rail.mode === 'collapsed' ? (
              <CompanionRailButton
                onExpand={expandCompanionRail}
                hasAttachment={Boolean(companionNote)}
              />
            ) : null}
            {/* The overlay, and — below the rail's own minimum — the only
                companion the room has. A scrim at every width, because here it
                really is modal over the studio. */}
            <AICompanionPanel
              variant="drawer"
              drawerMaxWidthClass="max-w-lg"
              drawerBackdropClassName="bg-black/40"
              context={companionContext}
              onAction={onCompanionAction}
              theme={theme}
              onTurnInto={(target, noteId) => void handleTurnInto(target, noteId)}
              onTurnIntoMessage={(target, draft) => void handleTurnIntoMessage(target, draft)}
              turnIntoExisting={companionNote ? turnIntoExisting(companionNote.id) : undefined}
              guidedNextTopic={guidedNextTopic}
              guidedTopics={guidedTopics}
            />
          </>
        )}
      </div>

      {/* Room-level dialogs. The cover pickers are held HERE rather than inside
          the row menus, which unmount the moment an item is chosen. */}
      {coverNote ? (
        <CoverPickerDialog
          open
          kind="note"
          id={coverNote.id}
          hasCover={Boolean(coverNote.coverPath)}
          onClose={() => setCoverNote(null)}
        />
      ) : null}
      {coverDeck ? (
        <CoverPickerDialog
          open
          kind="deck"
          id={coverDeck.id}
          hasCover={Boolean(coverDeck.coverPath)}
          onClose={() => setCoverDeck(null)}
        />
      ) : null}
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
          onRecordLecture={() => {
            setImportOpen(false);
            setImportSource(null);
            go('lecture', { createNew: true });
          }}
          onGenerateFromTopic={async (brief) => {
            setImportOpen(false);
            setImportSource(null);
            await handleCreateFromTopic(brief, 'materials');
          }}
        />
      )}
    </div>
  );
};

// Tolerant reader for a plan payload: anything that is not an array becomes an
// empty list, so a shape change or an error body cannot crash the room.
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

/** `2 Sep`, or nothing rather than `Invalid Date`. */
function lectureAddedLabel(iso?: string | null): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(time) ? formatShortDate(new Date(time)) : '';
}

/**
 * The lectures group — the one material group that can be re-ordered and
 * re-shaped.
 *
 * It is split out of `MaterialGroup` rather than folded into it because the six
 * other groups genuinely are label-only lists and adding a toggle to each would
 * put six identical controls down one narrow column. Lectures are the group
 * that grows without bound — a term of recordings is fifty rows all called
 * `Lecture 12` — so this is the one that needs a date to tell them apart and an
 * order to find them in.
 *
 * The list is the default: it is the shape this group has always had, so the
 * control costs nothing to anyone who ignores it.
 */
function LecturesGroup({
  lectures,
  selectedId,
  onOpen,
}: {
  lectures: ReadonlyArray<{ id: string; title?: string | null; createdAt?: string | null }>;
  selectedId: string | null;
  onOpen: (noteId: string) => void;
}) {
  const [view, setView] = useViewMode('setRoomLectures', 'list');
  const [sort, setSort] = useMaterialSort('setRoomLectures', 'newest');
  const ordered = useMemo(() => sortMaterials(lectures, sort), [lectures, sort]);

  return (
    <div className="mb-4">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-label text-lantern-text-secondary">{`Lectures · ${lectures.length}`}</h3>
        <div className="flex items-center gap-2">
          <MaterialSortMenu value={sort} onChange={setSort} label="lectures" />
          <ViewModeToggle value={view} onChange={setView} label="Lectures" />
        </div>
      </div>
      {view === 'list' ? (
        <ul className="space-y-0.5">
          {ordered.map((item) => {
            const added = lectureAddedLabel(item.createdAt);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className={`w-full flex items-center gap-2 p-2 rounded-lg text-left ${
                    item.id === selectedId
                      ? 'bg-lantern-background-secondary'
                      : 'hover:bg-lantern-background-secondary'
                  }`}
                >
                  <FeatureDisc
                    feature="recording"
                    icon={<AppIcon name="mic" size={14} />}
                    size={24}
                  />
                  <span className="text-body truncate flex-1 min-w-0">
                    {item.title || 'Lecture'}
                  </span>
                  {added ? (
                    <span className="shrink-0 text-caption text-lantern-text-tertiary">{added}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {ordered.map((item) => {
            const added = lectureAddedLabel(item.createdAt);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onOpen(item.id)}
                  className={`flex h-full w-full flex-col items-start gap-1.5 rounded-lg border p-2 text-left ${
                    item.id === selectedId
                      ? 'border-lantern-text bg-lantern-background-secondary'
                      : 'border-lantern-border hover:bg-lantern-background-secondary'
                  }`}
                >
                  <FeatureDisc
                    feature="recording"
                    icon={<AppIcon name="mic" size={14} />}
                    size={24}
                  />
                  <span className="text-body line-clamp-2 w-full">{item.title || 'Lecture'}</span>
                  {added ? (
                    <span className="text-caption text-lantern-text-tertiary">{added}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
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
  studyDoor?: string | null;
  attemptKind?: string | null;
  mode?: string | null;
}

/**
 * The room's test list, straight from `/api/v1/tests` (lean, first 100, newest
 * first) rather than through a store, because no store holds tests filtered by
 * room.
 *
 * A 401/403 goes through `handleApiAuthFailure` ONCE and the request is retried;
 * if that does not recover, an empty list is returned rather than throwing — a
 * failed test list must not take the whole room down. Every field is read
 * defensively from three possible shapes (row, `config`, `session.config`)
 * because rows come from more than one generation of the API.
 */
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
        studyDoor:
          (typeof config.studyDoor === 'string' && config.studyDoor) ||
          (typeof sessionConfig.studyDoor === 'string' && sessionConfig.studyDoor) ||
          null,
        attemptKind:
          (typeof config.attemptKind === 'string' && config.attemptKind) ||
          (typeof sessionConfig.attemptKind === 'string' && sessionConfig.attemptKind) ||
          null,
        mode:
          (typeof config.mode === 'string' && config.mode) ||
          (typeof sessionConfig.mode === 'string' && sessionConfig.mode) ||
          (typeof record.mode === 'string' && record.mode) ||
          null,
      },
    ];
  });
}
