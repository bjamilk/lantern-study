/**
 * The room a student works in: one screen serving BOTH a study set
 * (`studySetId`) and a bare course (`courseId`). Which one it is decides almost
 * everything below — a set room gets the segment row, the eleven door tiles and
 * the plan band; a course room draws the whole scroll with no filter (`show()`)
 * and the generic workspace activities instead.
 *
 * Exports `CourseRoomScreen` (default screen for the `CourseRoom` route in
 * StudyStackParamList). `SetHomeRecommended`, `MaterialTile` and `MaterialRow`
 * are file-local.
 *
 * Touches: studySetStore (sets, plans, opened/studied timestamps), notesStore,
 * flashcardStore, testStore, jobsStore (turn-into generation), companionStore
 * (scoped Ask + guided next topic), setRoomUiStore (remembered segment),
 * lectureRecordingStore, toastStore, authStore; services/academic
 * (getMyActiveCourses), services/ai, services/notes.
 *
 * Gotchas:
 * - PARAM INBOX, one way only. `route.params` is read WHOLE (not destructured)
 *   because the params object identity is the per-press ticket. The `segment`
 *   param is an inbox: seeded into local state on mount, adopted at most once
 *   per press via `adoptSegmentRequest`, and NEVER written back with
 *   setParams — writing it back is a render→params→render cycle and is what
 *   crash-looped build 205 with a maximum-update-depth error. What is on screen
 *   is published to setRoomUiStore instead, and the contextual row reads its
 *   active pill from that store, not from the route.
 * - The kebab must stay an `ActionSheet` (a Modal), not an inline Card in the
 *   ScrollView: an inline menu was dismissed by the touch before its row ran.
 *   ActionSheet also fires `onClose` before `onPress`, so a row handler must not
 *   depend on state that closing clears.
 * - Every tile count comes from data this screen already loaded; adding a count
 *   that needs a new fetch breaks the "nothing claimed that is not on screen"
 *   rule the counts were built on.
 * - `guidedNextTopic` must stay derived from the same `buildStudyPlanModel` the
 *   plan spine uses, or the Ask picker and the spine name different topics.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  STUDY_SET_HOME_TOOLS,
  STUDY_SET_RECOMMENDED_CARDS,
  WORKSPACE_ACTIVITIES,
  scopeNoun,
  workspaceActivityPromise,
  notePreviewText,
  pickRecommendedTopic,
  topicIndexLabel,
  topicsFromReadingNotes,
  WORKSPACE_LATER_COPY,
  TURN_INTO_TARGETS,
  formatTurnIntoCost,
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
  resolveLectureStudioNote,
  studySetLabel,
  resolveExamDate,
  testsFiledInCourse,
  testsFiledInStudySet,
  todayDateOnlyLocal,
  unitsForTopics,
  type StudySetTopic,
  type StudySetTopicStatus,
  type StudySetUnit,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
  scopedCopy,
} from '@lantern/shared';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { StudyStackParamList } from '../../navigation/types';
import {
  ActionSheet,
  type ActionSheetItem,
  Button,
  Card,
  DoorTile,
  doorTileColumnWidth,
  FeatureDisc,
  T,
} from '../../components/ui';
import { setRoomMenuRows } from '../../components/study/setRoomMenu';
import { AppIcon, type AppIconName } from '../../components/ui/AppIcon';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { tileSceneForTool } from '@lantern/shared/design';
import { DOOR_TILE, useTheme } from '../../theme';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { StudySetTimer } from '../../components/study/StudySetTimer';
import { SetRoomHeader } from '../../components/study/SetRoomHeader';
import { shareStudySet } from '../../components/study/shareStudySet';
import { SetRoomSegments } from '../../components/study/SetRoomSegments';
import { SetRoomTile } from '../../components/study/SetRoomTile';
import { StudyPlanPanel } from '../../components/study/StudyPlanPanel';
import {
  MaterialSortButton,
  ViewModeToggle,
  useMaterialSort,
  useViewMode,
} from '../../components/study/ViewModeToggle';
import { sortMaterials } from '../../components/study/viewMode';
import { formatShortDate } from '@lantern/shared/study/setPresentation';
import { guidedNextTopicFromPlan } from '@lantern/shared/study/planTimeline';
import {
  SET_ROOM_TILE_LABELS,
  SET_ROOM_TILE_ORDER,
  sectionHasBlock,
  tileCounts,
  isSetRoomSectionId,
  type SetRoomBlockId,
  type SetRoomSectionId,
} from '../../components/study/setRoomSections';
import {
  adoptSegmentRequest,
  initialSegment,
  readSegmentRequest,
} from '../../navigation/segmentParamSync';
import { useSetRoomUiStore } from '../../stores/setRoomUiStore';
import { confirmAsync } from '../../components/ui/appDialog';
import { ClassOfficialMaterials } from '../../components/classes/ClassOfficialMaterials';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useNotesStore } from '../../stores/notesStore';
import { useTestStore } from '../../stores/testStore';
import { useToastStore } from '../../stores/toastStore';
import { useAuthStore } from '../../stores/authStore';
import { useJobsStore } from '../../stores/jobsStore';
import { useStudyGoalsStore } from '../../stores/studyGoalsStore';
import { startFlashcardsFromNote, startTestFromNote } from './turnIntoJobs';
import { aiGenerateFlashcards } from '../../services/ai';
import { generateNoteQuiz } from '../../services/notes';
import { getMyActiveCourses } from '../../services/academic';
import { useStudySetStore } from '../../stores/studySetStore';
import { StudyWorkspaceBar } from './StudyWorkspaceBar';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { useCompanionStore } from '../../stores/companionStore';
import { buildStudyPlanModel } from '../../components/study/studyPlanPresentation';
import { touchWorkspaceRecent } from '../../utils/workspaceRecents';
import type { UserCourse } from '@lantern/shared/types';
import type { StudyNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'CourseRoom'>;

export function CourseRoomScreen({ navigation, route }: Props) {
  const {
    courseId: courseIdParam,
    studySetId,
    courseLabel,
  } = route.params;
  // The params object ITSELF is the per-press ticket (segmentParamSync.ts), so
  // it is read whole rather than destructured into a value that cannot tell two
  // presses of the same door apart.
  const routeParams = route.params;
  const loadSets = useStudySetStore((s) => s.loadSets);
  const updateSet = useStudySetStore((s) => s.updateSet);
  const touchOpened = useStudySetStore((s) => s.touchOpened);
  const touchSet = useStudySetStore((s) => s.touchSet);
  const removeSet = useStudySetStore((s) => s.removeSet);
  const loadPlan = useStudySetStore((s) => s.loadPlan);
  const savePlan = useStudySetStore((s) => s.savePlan);
  const setTopicStatus = useStudySetStore((s) => s.setTopicStatus);
  const plan = useStudySetStore((s) => (studySetId ? s.plans[studySetId] : undefined));
  const studySet = useStudySetStore((s) => (studySetId ? s.resolveSet(studySetId) : null));
  const [overflowOpen, setOverflowOpen] = useState(false);
  const courseId = studySet?.courseId || courseIdParam || '';
  const tabBarClearance = useTabBarClearance(16);
  // The door grid's column width, computed from the screen rather than from a
  // percentage class. `w-[47%]` looked like two up but left the gutter to
  // whatever `gap-2` happened to be, so the doors never landed on the measured
  // 28 px gutter and their heights were whatever their content measured — the
  // exact thing `doorTileLayout` exists to stop. The screen's own horizontal
  // padding is 16 here, not the door grid's 13, so it is what gets paid.
  const { width: screenWidth } = useWindowDimensions();
  const doorGutter = DOOR_TILE.gridGutter;
  const doorWidth = doorTileColumnWidth({
    screenWidth,
    columns: 2,
    pageMargin: 16,
    gutter: doorGutter,
  });
  const showToast = useToastStore((s) => s.showToast);
  const startJob = useJobsStore((s) => s.startJob);
  const loadNote = useNotesStore((s) => s.loadNote);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const decks = useFlashcardStore((s) => s.decks);
  const tests = useTestStore((s) => s.tests);
  const userId = useAuthStore((s) => s.user?.id);
  const [enrolment, setEnrolment] = useState<UserCourse | null>(null);
  const [activeCourses, setActiveCourses] = useState<UserCourse[]>([]);
  const [importOpen, setImportOpen] = useState(false);
  const lectureNoteId = useLectureRecordingStore((s) => s.noteId);
  const lectureStatus = useLectureRecordingStore((s) => s.status);
  const [showMoreRecommended, setShowMoreRecommended] = useState(false);
  // Which segment this set was last left on. A segment row that forgets sends
  // the student back to Overview every time they open a lecture and return,
  // which is the scroll it was built to remove.
  // …unless a door names one. `segment` is the set contextual row's Materials
  // param, and pressing it from INSIDE the room only merges params — the screen
  // is already focused, so nothing remounts. The param is an INBOX: seeded on
  // mount, adopted once per press, and never written back (writing it back is
  // what crash-looped build 205 — navigation/segmentParamSync.ts). What is on
  // screen is published to the store instead, which is where the row reads its
  // active pill.
  const [section, setSection] = useState<SetRoomSectionId>(() =>
    initialSegment(
      route.params.segment,
      isSetRoomSectionId,
      useSetRoomUiStore.getState().sectionFor(studySetId)
    )
  );
  // The mount's params are an ask already answered by the seed above.
  const adoptedTicket = useRef<unknown>(route.params);
  // …but the row reads the STORE, so a room pushed straight onto Materials has
  // to say so once, or its pill would light whatever the set was left on.
  useEffect(() => {
    useSetRoomUiStore.getState().setSection(studySetId, section);
    // Mount only: every later change has its own writer below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const seededSet = useRef(studySetId);
  useEffect(() => {
    if (seededSet.current === studySetId) return;
    seededSet.current = studySetId;
    setSection(useSetRoomUiStore.getState().sectionFor(studySetId));
  }, [studySetId]);
  // An explicit press overrides the memory, and is written INTO it, so leaving
  // and coming back lands on the segment the student last actually saw. The
  // store write is here and not inside the `setSection` updater: an updater
  // React may replay is no place to change the world.
  useEffect(() => {
    const adopted = adoptSegmentRequest({
      request: readSegmentRequest(routeParams, 'segment', isSetRoomSectionId),
      lastTicket: adoptedTicket.current,
      current: section,
    });
    if (!adopted) return;
    adoptedTicket.current = adopted.ticket;
    if (adopted.alreadyShown) return;
    setSection(adopted.segment);
    useSetRoomUiStore.getState().setSection(studySetId, adopted.segment);
  }, [routeParams, section, studySetId]);
  const onSelectSection = useCallback(
    (next: SetRoomSectionId) => {
      setSection(next);
      useSetRoomUiStore.getState().setSection(studySetId, next);
    },
    [studySetId]
  );
  // A COURSE room has no set and no segment row, so it still draws the whole
  // scroll: `show` is only a filter where there is something to filter by.
  const show = useCallback(
    (block: SetRoomBlockId) => (studySetId ? sectionHasBlock(section, block) : true),
    [studySetId, section]
  );
  const [skippedTopicIds, setSkippedTopicIds] = useState<string[]>([]);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const resetCompanionForScope = useCompanionStore((s) => s.resetForScope);

  useEffect(() => {
    void loadSets().catch(() => undefined);
  }, [loadSets]);

  useEffect(() => {
    if (!studySetId) return;
    // Two different memories, both needed. `touchOpened` is this phone's "open
    // this one next time"; `touchSet` is the server's "last studied", which no
    // mobile screen had ever posted — so a set a student only ever worked on
    // from their phone showed no study history anywhere.
    touchOpened(studySetId);
    void touchSet(studySetId);
    void loadPlan(studySetId);
  }, [studySetId, touchOpened, touchSet, loadPlan]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', () => {
      if (studySetId) useStudySetStore.getState().openPicker();
    });
    return unsub;
  }, [navigation, studySetId]);

  useEffect(() => {
    if (courseId) void touchWorkspaceRecent(courseId);
    void getMyActiveCourses().then((rows) => {
      setActiveCourses(rows);
      setEnrolment(rows.find((row) => row.course.id === courseId) ?? null);
    });
  }, [courseId]);

  useFocusEffect(
    useCallback(() => {
      void useNotesStore.getState().loadNotes().catch(() => undefined);
      if (userId) {
        void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
        void useTestStore.getState().fetchTests(userId).catch(() => undefined);
      }
    }, [userId])
  );

  const noteInRoom = (note: { courseId?: string | null; studySetId?: string | null } | null | undefined) => {
    if (!note) return false;
    return studySetId ? note.studySetId === studySetId : Boolean(courseId) && note.courseId === courseId;
  };

  // The attachment belongs to the room it was made in. It is persisted, so
  // without this a note attached in one set stayed stapled to every question
  // asked in the next one — across app restarts.
  useEffect(() => {
    resetCompanionForScope(studySetId ?? courseId ?? null);
  }, [courseId, studySetId, resetCompanionForScope]);

  useEffect(() => {
    if (!selectedNote || !noteInRoom(selectedNote)) return;
    void setActiveNoteContext({
      id: selectedNote.id,
      title: selectedNote.title || 'Untitled note',
      scopeId: studySetId ?? courseId ?? null,
    });
  }, [courseId, studySetId, selectedNote, setActiveNoteContext]);

  const label =
    studySetId
      ? studySetLabel(studySet || { title: courseLabel || '' })
      : courseLabel ||
        (enrolment ? courseWorkspaceLabel(enrolment.course) : 'Course');

  const courseNotes = useMemo(
    () => (studySetId ? materialsForStudySet(notes, studySetId) : materialsForCourse(notes, courseId)),
    [notes, courseId, studySetId]
  );
  const studyNotes = useMemo(
    () =>
      courseNotes.filter(
        (note) =>
          !isCalendarNote(note) &&
          !isLectureNote(note) &&
          !isLessonNote(note) &&
          !isRecapNote(note) &&
          !isEssayNote(note)
      ),
    [courseNotes]
  );
  const courseDecks = useMemo(
    () => (studySetId ? materialsForStudySet(decks, studySetId) : materialsForCourse(decks, courseId)),
    [decks, courseId, studySetId]
  );
  const lectures = useMemo(() => courseNotes.filter(isLectureNote), [courseNotes]);

  /**
   * The topic this set's plan says comes next, handed to the companion when
   * `Ask` opens from this room.
   *
   * Same rule, same module as the plan spine's `Continue` pill
   * (`buildStudyPlanModel`), so the Guided picker and the spine can never name
   * different topics for the same set. Null — no set, no topics, or a plan
   * whose every topic is mastered — means the picker offers `Start learning:`
   * rows only, rather than claiming progress that was never made.
   */
  const guidedNextTopic = useMemo(() => {
    if (!studySetId) return null;
    const planTopics = plan?.topics ?? [];
    const derived = planTopics.length > 0 ? null : topicsFromReadingNotes(studySetId, studyNotes);
    const topics = derived ? derived.topics : planTopics;
    if (topics.length === 0) return null;
    const model = buildStudyPlanModel({
      units: derived ? [derived.unit] : plan?.units ?? [],
      topics,
      materials: [...studyNotes, ...lectures].map((note) => ({
        id: note.id,
        title: note.title,
      })),
      mode: (studySet?.mode as 'cram' | 'standard' | 'comprehensive') ?? 'standard',
    });
    // The spine's own pick, then the shared guard and trim web uses.
    // The source NOTE's title travels too: the unit is a grouping, and a first
    // guided turn seeded with the grouping made the model reply with a menu of
    // the notes under it rather than teaching a step.
    const sourceNoteId = model.nextTopic?.sourceNoteId ?? null;
    return guidedNextTopicFromPlan(
      model.nextTopic,
      model.units.find((row) => row.holdsNext)?.title,
      sourceNoteId
        ? [...studyNotes, ...lectures].find((note) => note.id === sourceNoteId)?.title
        : null
    );
  }, [studySetId, plan?.topics, plan?.units, studyNotes, lectures, studySet?.mode]);
  // Grid or list, and the order, for the room's two browsable shelves. Grid is
  // the materials default and list the lectures default because that is the
  // shape each had before the toggle existed — a remembered control must not
  // change what a student who never touches it sees. The web keys the same two
  // surfaces the same way (components/study/viewMode.ts).
  const [materialsView, chooseMaterialsView] = useViewMode('setRoomMaterials', 'grid');
  const [materialsSort, chooseMaterialsSort] = useMaterialSort('setRoomMaterials', 'newest');
  const [lecturesView, chooseLecturesView] = useViewMode('setRoomLectures', 'list');
  const [lecturesSort, chooseLecturesSort] = useMaterialSort('setRoomLectures', 'newest');
  // Sorted BEFORE the cap, so `Recent materials` shows the eight the chosen
  // order puts first — capping first and sorting the survivors would label a
  // list `A–Z` while quietly having picked its eight rows by sync order.
  const recentMaterials = useMemo(
    () => sortMaterials([...lectures, ...studyNotes], materialsSort).slice(0, 8),
    [lectures, studyNotes, materialsSort]
  );
  const sortedLectures = useMemo(
    () => sortMaterials(lectures, lecturesSort),
    [lectures, lecturesSort]
  );
  const lessons = useMemo(() => courseNotes.filter(isLessonNote), [courseNotes]);
  const recaps = useMemo(() => courseNotes.filter(isRecapNote), [courseNotes]);
  const essays = useMemo(() => courseNotes.filter(isEssayNote), [courseNotes]);
  const noteIds = useMemo(() => new Set(courseNotes.map((n) => n.id)), [courseNotes]);
  const deckIds = useMemo(() => new Set(courseDecks.map((d) => d.id)), [courseDecks]);
  const courseTests = useMemo(() => {
    const rows = tests.map((test) => ({
      id: test.id,
      courseId: test.courseId,
      studySetId: undefined,
      sourceNoteId: test.sourceNoteId,
      sourceDeckId: undefined,
      deckId: test.deckId,
    }));
    return studySetId
      ? testsFiledInStudySet(rows, studySetId, noteIds, deckIds)
      : testsFiledInCourse(rows, courseId, noteIds, deckIds);
  }, [tests, courseId, studySetId, noteIds, deckIds]);

  /**
   * The kebab's rows, bound to this room's set.
   *
   * Built from `setRoomMenuRows()` so the identity and the order of the menu
   * are testable, and handed to the shared `ActionSheet` so the room's menu is
   * the same object as the hub card's — the one that has always worked.
   */
  const setRoomMenuItems: ActionSheetItem[] = useMemo(() => {
    if (!studySetId) return [];
    const run = (action: string) => {
      switch (action) {
        case 'settings':
          navigation.navigate('StudySetSettings', { studySetId });
          return;
        case 'add-materials':
          navigation.navigate('StudySetUpload', { studySetId, courseId, courseLabel: label });
          return;
        case 'library':
          navigation.navigate('StudySetLibrary', { studySetId, courseId, courseLabel: label });
          return;
        case 'delete':
          void (async () => {
            const ok = await confirmAsync(
              'Delete this set?',
              'Your notes, decks and tests stay — they are just no longer filed here.',
              { confirmLabel: 'Delete', destructive: true }
            );
            if (!ok) return;
            try {
              await removeSet(studySetId);
              showToast('Study set deleted.', 'success');
              navigation.navigate('StudyHub');
            } catch (error) {
              showToast(
                error instanceof Error ? error.message : 'Could not delete this set.',
                'error'
              );
            }
          })();
          return;
        default:
          return;
      }
    };
    return setRoomMenuRows().map((row) => ({
      label: row.label,
      icon: row.icon as AppIconName,
      destructive: row.destructive,
      onPress: () => run(row.action),
    }));
  }, [studySetId, courseId, label, navigation, removeSet, showToast]);

  // Every count on a tile comes from what this room has already loaded — no
  // new fetch, and nothing claimed that is not on screen somewhere below.
  const setTileCounts = useMemo(
    () =>
      tileCounts({
        materials: studyNotes.length,
        decks: courseDecks.length,
        lectures: lectures.length,
        tests: courseTests.length,
        lessons: lessons.length,
        recaps: recaps.length,
        essays: essays.length,
      }),
    [studyNotes.length, courseDecks.length, lectures.length, courseTests.length, lessons.length, recaps.length, essays.length]
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
      studySetId,
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
          selectedNote &&
          noteInRoom(selectedNote) &&
          !isCalendarNote(selectedNote) &&
          !isLectureNote(selectedNote) &&
          !isLessonNote(selectedNote) &&
          !isRecapNote(selectedNote) &&
          !isEssayNote(selectedNote)
            ? selectedNote
            : studyNotes[0];
        if (!note) {
          showToast('Import or create a note first.', 'info');
          return;
        }
        selectNote(note.id);
        navigation.navigate('NotesStudio', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      }
      case 'walkthrough': {
        const note = (selectedNote && noteInRoom(selectedNote) && !isCalendarNote(selectedNote)
          ? selectedNote
          : studyNotes.find((n) => n.attachments?.some(isWalkableAttachment))) as
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
          selectedNote &&
          noteInRoom(selectedNote) &&
          !isCalendarNote(selectedNote) &&
          !isEssayNote(selectedNote)
            ? selectedNote
            : studyNotes.find((row) => !isEssayNote(row));
        navigation.navigate('AdaptiveQuiz', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
          studySetId,
        });
        return;
      }
      // Inside a set, both doors open THIS set's shelf. They used to open the
      // global library and the global tests list — a student in one set tapped
      // Cards and got every deck they own (phone walk defect 14) — and the
      // Cards door did not even do that: with no decks it only raised a toast.
      case 'cards':
        if (studySetId) {
          navigation.navigate('StudySetLibrary', {
            studySetId,
            courseId,
            courseLabel: label,
            kind: 'cards',
          });
          return;
        }
        if (courseDecks.length === 0) {
          showToast(scopedCopy('decksEmpty', scopeNoun(studySetId, courseIdParam)), 'info');
          return;
        }
        navigation.navigate('Library', { tab: 'flashcards' });
        return;
      case 'test':
        if (studySetId) {
          navigation.navigate('StudySetLibrary', {
            studySetId,
            courseId,
            courseLabel: label,
            kind: 'tests',
          });
          return;
        }
        navigation.navigate('TestsList', { courseId, courseLabel: label });
        return;
      case 'lecture':
        openLectureStudio();
        return;
      case 'lesson': {
        const note =
          selectedNote && noteInRoom(selectedNote) && isLessonNote(selectedNote)
            ? selectedNote
            : courseNotes.find(isLessonNote);
        navigation.navigate('LessonStudio', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
          studySetId,
        });
        return;
      }
      case 'recap': {
        const note =
          selectedNote && noteInRoom(selectedNote) && isRecapNote(selectedNote)
            ? selectedNote
            : courseNotes.find(isRecapNote);
        navigation.navigate('RecapStudio', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
          studySetId,
        });
        return;
      }
      case 'play':
        navigation.navigate('PlayStudio', {
          courseId,
          courseLabel: label,
          studySetId,
        });
        return;
      case 'plan':
        navigation.navigate('StudyCalendar', {
          courseId,
          courseLabel: label,
          studySetId,
        });
        return;
      case 'essay': {
        const note =
          selectedNote && noteInRoom(selectedNote) && isEssayNote(selectedNote)
            ? selectedNote
            : courseNotes.find(isEssayNote);
        navigation.navigate('EssayStudio', {
          courseId,
          courseLabel: label,
          noteId: note?.id,
          studySetId,
        });
        return;
      }
      default:
        return;
    }
  };

  const turnInto = (target: TurnIntoTargetId, note: StudyNote) => {
    // Four of the six destinations are screens, not jobs: the studio's own
    // first request is what bills, so nothing is started here.
    switch (target) {
      case 'lesson':
        navigation.navigate('LessonStudio', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      case 'recap':
        navigation.navigate('RecapStudio', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      case 'essay':
        navigation.navigate('EssayStudio', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      case 'play':
        navigation.navigate('PlayStudio', { courseId, courseLabel: label, studySetId });
        return;
      case 'notes':
        navigation.navigate('NotesStudio', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      case 'quiz':
        navigation.navigate('AdaptiveQuiz', {
          courseId,
          courseLabel: label,
          noteId: note.id,
          studySetId,
        });
        return;
      default:
        break;
    }
    if (!hasEnoughNoteStudyContent(note)) {
      showToast('Add more study content to this note first.', 'info');
      return;
    }
    if (!userId) {
      showToast('Sign in to generate study materials.', 'error');
      return;
    }
    const scope = { userId, courseId: courseId || undefined, studySetId };
    if (target === 'cards') {
      startFlashcardsFromNote(note, scope, startJob);
      showToast(scopedCopy('buildingCards', scopeNoun(studySetId, courseIdParam)), 'info');
      return;
    }
    startTestFromNote(note, scope, startJob);
    showToast(scopedCopy('buildingTest', scopeNoun(studySetId, courseIdParam)), 'info');
  };

  const selectNote = useCallback(
    (noteId: string) => {
      void loadNote(noteId);
    },
    [loadNote]
  );

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <StudyWorkspaceBar
        active="study"
        onSelect={(section) => {
          if (section === 'library') navigation.navigate('Library', { tab: 'notes' });
        }}
      />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: tabBarClearance, paddingHorizontal: 16, paddingTop: 8 }}
      >
        {/* Title on its own line, actions on the next. `Ask Lantern` has left
            the header: the shell's bar carries the Ask door and the room keeps
            its own Ask tile, so this was the third of three doors to one
            place. See SetRoomHeader.tsx. */}
        <SetRoomHeader
          title={label}
          coverPath={studySet?.coverPath}
          // Only a SET room has art to draw; a course room passes nothing and
          // its header is unchanged.
          setId={studySetId}
          tileHue={studySet?.tileHue}
          tileGlyph={studySet?.tileGlyph}
          onShare={
            studySetId
              ? () => void shareStudySet({ setId: studySetId, title: label, visibility: studySet?.visibility })
              : undefined
          }
          subtitle={
            studySetId
              ? undefined
              : formatCourseMaterialCounts({
                  notes: studyNotes.length,
                  decks: courseDecks.length,
                  tests: courseTests.length,
                })
          }
          timer={studySetId ? <StudySetTimer studySetId={studySetId} /> : undefined}
          onAllSets={
            studySetId
              ? () => {
                  useStudySetStore.getState().openPicker();
                  navigation.navigate('StudyHub');
                }
              : undefined
          }
          onMore={studySetId ? () => setOverflowOpen((value) => !value) : undefined}
          moreExpanded={overflowOpen}
        />

        {studySetId ? <SetRoomSegments value={section} onChange={onSelectSection} /> : null}

        {studySetId ? (
          // The SAME sheet the hub card's kebab opens. It used to be an inline
          // Card rendered into this ScrollView, below the segment row, and on
          // device every touch inside it dismissed the menu without running
          // the row — `Set settings` 6/6 (SF5a, check 4). A Modal sits above
          // every overlay and outside every scroll container, and it is the
          // path the hub has been proving works all along. See setRoomMenu.ts.
          <ActionSheet
            visible={overflowOpen}
            title={label}
            items={setRoomMenuItems}
            onClose={() => setOverflowOpen(false)}
          />
        ) : null}

        {studySetId && (show('recommendedTiles') || show('planBand') || show('setupCards')) ? (
          <SetHomeRecommended
            showOverview={show('recommendedTiles')}
            showPlan={show('planBand')}
            showSetup={show('setupCards')}
            studySetId={studySetId}
            notes={studyNotes}
            lectures={lectures}
            planUnits={plan?.units ?? []}
            planTopics={plan?.topics ?? []}
            planLoaded={plan?.loaded ?? false}
            mode={(studySet?.mode as 'cram' | 'standard' | 'comprehensive') ?? 'standard'}
            onGeneratePlan={async () => {
              const built = topicsFromReadingNotes(studySetId, studyNotes);
              try {
                await savePlan(studySetId, {
                  units: [{ title: built.unit.title, position: built.unit.position }],
                  topics: built.topics.map((topic) => ({
                    unitIndex: 0,
                    title: topic.title,
                    position: topic.position,
                    status: topic.status,
                    sourceNoteIds: topic.sourceNoteIds,
                  })),
                });
                showToast('Study plan built from your materials.', 'success');
              } catch {
                showToast('Could not save the plan. Showing one built from your notes.', 'info');
              }
            }}
            onToggleTopic={(topicId, next) => {
              void setTopicStatus(studySetId, topicId, next).catch(() => {
                showToast('Could not save that topic. It has been put back.', 'error');
              });
            }}
            skippedTopicIds={skippedTopicIds}
            showMore={showMoreRecommended}
            onShowMore={() => setShowMoreRecommended((value) => !value)}
            onSkip={(topicId) => setSkippedTopicIds((ids) => [...ids, topicId])}
            onAsk={() =>
              useCompanionStore.getState().openForScope({
                scopeId: studySetId ?? courseId ?? null,
                label,
                // Guided opens on `Continue learning: <topic>` rather than a
                // list of cold starts, because this room knows its plan.
                guidedNextTopic,
              })
            }
            onRead={(noteId) => {
              selectNote(noteId);
              navigation.navigate('NotesStudio', {
                courseId,
                courseLabel: label,
                noteId,
                studySetId,
              });
            }}
            onQuiz={(noteId) => {
              selectNote(noteId);
              navigation.navigate('AdaptiveQuiz', {
                courseId,
                courseLabel: label,
                noteId,
                studySetId,
              });
            }}
            onOpenActivity={(activityId) => handleActivity(activityId, 'ready')}
            onAddSyllabus={() => setImportOpen(true)}
            onAddExam={() =>
              navigation.navigate('StudyCalendar', {
                courseId,
                courseLabel: label,
                studySetId,
              })
            }
            onViewSchedule={() =>
              navigation.navigate('StudyCalendar', {
                courseId,
                courseLabel: label,
                studySetId,
              })
            }
            examDate={resolveExamDate(studySet, enrolment)}
          />
        ) : null}

        {/* The set room's tools, in StudyFetch's own anatomy: a pastel panel
            with a black drawing over a white caption strip, two up, the label
            a NOUN, and a count pill on the footer so the set can be read at a
            glance (`Flashcards 2`, `Lectures 3`). Order and labels are
            setRoomSections.ts; the shared tool supplies the hue, the glyph and
            the destination. */}
        {studySetId && show('actionTiles') ? (
          <View className="flex-row flex-wrap mb-4" style={{ gap: doorGutter }}>
            {SET_ROOM_TILE_ORDER.map((tileId) => {
              const tool = STUDY_SET_HOME_TOOLS.find((row) => row.id === tileId);
              if (!tool) return null;
              const tileLabel = SET_ROOM_TILE_LABELS[tileId];
              return (
                <SetRoomTile
                  key={tileId}
                  feature={tool.feature}
                  icon={tool.icon as AppIconName}
                  // The door's own drawing, where the art set has one. All
                  // eleven tiles do; the lookup stays a lookup rather than a
                  // cast so a renamed tile id fails the coverage test instead
                  // of silently falling back to the glyph.
                  scene={tileSceneForTool(tileId)}
                  title={tileLabel}
                  count={setTileCounts[tileId]}
                  width={doorWidth}
                  // The promise line is not drawn — a tile is a place, and its
                  // noun plus its count is what a place says. It is not lost:
                  // a screen reader still hears it before the tile opens.
                  accessibilityLabel={[
                    tileLabel,
                    typeof setTileCounts[tileId] === 'number' ? `${setTileCounts[tileId]}` : '',
                    tool.promise,
                  ]
                    .filter(Boolean)
                    .join('. ')}
                  onPress={() => {
                    if (tileId === 'import') {
                      setImportOpen(true);
                      return;
                    }
                    if (tileId === 'ask') {
                      useCompanionStore.getState().openForScope({
                        scopeId: studySetId ?? courseId ?? null,
                        label,
                        guidedNextTopic,
                      });
                      return;
                    }
                    if (tool.activity) handleActivity(tool.activity, 'ready');
                  }}
                />
              );
            })}
          </View>
        ) : null}

        {!studySetId ? (
        <View
          className="flex-row flex-wrap mb-4"
          style={{ gap: doorGutter }}
        >
          {WORKSPACE_ACTIVITIES.map((item) => {
            const promise = workspaceActivityPromise(
              item.id,
              item.promise,
              scopeNoun(studySetId, courseId)
            );
            return (
              <DoorTile
                key={item.id}
                feature={item.feature}
                icon={item.icon as AppIconName}
                title={item.label}
                width={doorWidth}
                accessibilityLabel={[item.label, promise].filter(Boolean).join('. ')}
                onPress={() => handleActivity(item.id, item.status)}
              />
            );
          })}
        </View>
        ) : null}

        {studySetId && show('courseChips') ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Course (optional)
            </T.Caption>
            <View className="flex-row flex-wrap gap-2">
              <Pressable
                onPress={() => {
                  void updateSet(studySetId, { courseId: null }).catch(() => {
                    showToast('Could not update the course on this set.', 'error');
                  });
                }}
                className={`px-3 py-2 rounded-full border ${
                  !studySet?.courseId
                    ? 'border-lantern-primary bg-lantern-primary-background'
                    : 'border-lantern-border'
                }`}
              >
                <T.Caption>Standalone</T.Caption>
              </Pressable>
              {activeCourses.map((row) => (
                <Pressable
                  key={row.course.id}
                  onPress={() => {
                    void updateSet(studySetId, { courseId: row.course.id }).catch(() => {
                      showToast('Could not update the course on this set.', 'error');
                    });
                  }}
                  className={`px-3 py-2 rounded-full border ${
                    studySet?.courseId === row.course.id
                      ? 'border-lantern-primary bg-lantern-primary-background'
                      : 'border-lantern-border'
                  }`}
                >
                  <T.Caption>{courseWorkspaceLabel(row.course)}</T.Caption>
                </Pressable>
              ))}
            </View>
          </Card>
        ) : null}

        {courseId && show('classMaterials') ? (
        <ClassOfficialMaterials
          courseId={courseId}
          embedded
          onOpenNote={(noteId) => {
            void useNotesStore.getState().loadNotes().catch(() => undefined);
            selectNote(noteId);
            navigation.navigate('NotesStudio', {
              courseId,
              courseLabel: label,
              noteId,
              studySetId,
            });
          }}
        />
        ) : null}

        {show('recentMaterials') ? (
        <Card className="mb-3">
          <View className="flex-row items-center justify-between mb-2">
            <T.Caption tone="secondary" className="flex-1 mr-2">
              {studySetId ? 'Recent materials' : `Notes${studyNotes.length ? ` · ${studyNotes.length}` : ''}`}
            </T.Caption>
            {/* Controls only where there is something to arrange: a toggle over
                an empty-state sentence is a control that cannot do anything. */}
            {studySetId && recentMaterials.length > 0 ? (
              <View className="flex-row items-center gap-2">
                <MaterialSortButton
                  value={materialsSort}
                  onChange={chooseMaterialsSort}
                  label="recent materials"
                />
                <ViewModeToggle
                  value={materialsView}
                  onChange={chooseMaterialsView}
                  label="Recent materials"
                />
              </View>
            ) : null}
          </View>
          {(studySetId ? [...lectures, ...studyNotes] : studyNotes).length === 0 ? (
            <T.Body tone="secondary">{`${scopedCopy('notesEmpty', scopeNoun(studySetId, courseIdParam))}.`}</T.Body>
          ) : studySetId ? (
            <View className={materialsView === 'grid' ? 'gap-3' : undefined}>
              {recentMaterials.map((note, index) =>
                materialsView === 'grid' ? (
                  <MaterialTile
                    key={note.id}
                    title={note.title || (isLectureNote(note) ? 'Lecture' : 'Untitled note')}
                    preview={notePreviewText(note.body)}
                    lecture={isLectureNote(note)}
                    onPress={() => {
                      if (isLectureNote(note)) {
                        openLectureStudio(note.id);
                        return;
                      }
                      selectNote(note.id);
                      navigation.navigate('NotesStudio', {
                        courseId,
                        courseLabel: label,
                        noteId: note.id,
                        studySetId,
                      });
                    }}
                  />
                ) : (
                  <MaterialRow
                    key={note.id}
                    title={note.title || (isLectureNote(note) ? 'Lecture' : 'Untitled note')}
                    date={note.createdAt}
                    lecture={isLectureNote(note)}
                    divided={index > 0}
                    onPress={() => {
                      if (isLectureNote(note)) {
                        openLectureStudio(note.id);
                        return;
                      }
                      selectNote(note.id);
                      navigation.navigate('NotesStudio', {
                        courseId,
                        courseLabel: label,
                        noteId: note.id,
                        studySetId,
                      });
                    }}
                  />
                )
              )}
            </View>
          ) : (
            studyNotes.map((note, index) => (
              <View key={note.id} className={index > 0 ? 'border-t border-lantern-border' : undefined}>
                <Pressable
                  onPress={() => {
                    selectNote(note.id);
                    navigation.navigate('NotesStudio', {
                      courseId,
                      courseLabel: label,
                      noteId: note.id,
                      studySetId,
                    });
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
                      {`${target.label} · ${formatTurnIntoCost(target.id)}`}
                    </Button>
                  ))}
                </View>
              </View>
            ))
          )}
        </Card>
        ) : null}

        {show('decks') ? (
        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            Decks{courseDecks.length ? ` · ${courseDecks.length}` : ''}
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
        ) : null}

        {courseTests.length > 0 && show('tests') ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Tests · {courseTests.length}
            </T.Caption>
            {courseTests.map((test, index) => {
              const row = tests.find((t) => t.id === test.id);
              return (
                <Pressable
                  key={test.id}
                  onPress={() =>
                    // A test listed under THIS set must not drop the student
                    // into the global Tests screen (Available/History for every
                    // test they own). Inside a set the shelf is the set's.
                    studySetId
                      ? navigation.navigate('StudySetLibrary', {
                          studySetId,
                          courseId,
                          courseLabel: label,
                          kind: 'tests',
                        })
                      : navigation.navigate('TestsList', { courseId, courseLabel: label })
                  }
                  className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
                >
                  <T.Body numberOfLines={1}>{row?.name || 'Test'}</T.Body>
                </Pressable>
              );
            })}
          </Card>
        ) : null}

        {lectures.length > 0 && show('lectureList') ? (
          <Card className="mb-3">
            <View className="flex-row items-center justify-between mb-2">
              <T.Caption tone="secondary" className="flex-1 mr-2">
                Lectures · {lectures.length}
              </T.Caption>
              <View className="flex-row items-center gap-2">
                <MaterialSortButton
                  value={lecturesSort}
                  onChange={chooseLecturesSort}
                  label="lectures"
                />
                <ViewModeToggle
                  value={lecturesView}
                  onChange={chooseLecturesView}
                  label="Lectures"
                />
              </View>
            </View>
            {lecturesView === 'grid' ? (
              <View className="gap-3">
                {sortedLectures.map((note) => (
                  <MaterialTile
                    key={note.id}
                    title={note.title || 'Lecture'}
                    preview={notePreviewText(note.body)}
                    lecture
                    onPress={() => openLectureStudio(note.id)}
                  />
                ))}
              </View>
            ) : (
              sortedLectures.map((note, index) => (
                <MaterialRow
                  key={note.id}
                  title={note.title || 'Lecture'}
                  date={note.createdAt}
                  lecture
                  divided={index > 0}
                  onPress={() => openLectureStudio(note.id)}
                />
              ))
            )}
          </Card>
        ) : null}

        {lessons.length > 0 && show('lessons') ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Lessons · {lessons.length}
            </T.Caption>
            {lessons.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() =>
                  navigation.navigate('LessonStudio', {
                    courseId,
                    courseLabel: label,
                    noteId: note.id,
                    studySetId,
                  })
                }
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Lesson'}</T.Body>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {recaps.length > 0 && show('recaps') ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Recaps · {recaps.length}
            </T.Caption>
            {recaps.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() =>
                  navigation.navigate('RecapStudio', {
                    courseId,
                    courseLabel: label,
                    noteId: note.id,
                    studySetId,
                  })
                }
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Recap'}</T.Body>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {essays.length > 0 && show('essays') ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Essays · {essays.length}
            </T.Caption>
            {essays.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() =>
                  navigation.navigate('EssayStudio', {
                    courseId,
                    courseLabel: label,
                    noteId: note.id,
                    studySetId,
                  })
                }
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Essay'}</T.Body>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {/* The Lectures segment's own door: a list of recordings with no way
            to start one is a dead end, and `Start recording` otherwise lives
            only on the Practice segment's tile grid. */}
        {studySetId && show('record') ? (
          <Button className="mb-3" variant="secondary" onPress={() => openLectureStudio()}>
            Record a lecture
          </Button>
        ) : null}

        {show('import') ? (
        <Button className="mb-3" onPress={() => setImportOpen(true)}>
          {scopedCopy('importAction', scopeNoun(studySetId, courseIdParam))}
        </Button>
        ) : null}
        {show('everything') ? (
        <Button
          variant="ghost"
          onPress={() =>
            // "All materials" at the foot of a SET's room means everything in
            // this set, not the 29-note global library the student just walked
            // away from.
            studySetId
              ? navigation.navigate('StudySetLibrary', {
                  studySetId,
                  courseId,
                  courseLabel: label,
                  kind: 'notes',
                })
              : navigation.navigate('Library', { tab: 'notes' })
          }
        >
          {studySetId ? 'Everything in this set' : 'All materials'}
        </Button>
        ) : null}
      </ScrollView>

      <ImportAndStudyModal
        visible={importOpen}
        courseId={courseId || undefined}
        studySetId={studySetId}
        onClose={() => setImportOpen(false)}
        onOpenNote={(noteId) => {
          setImportOpen(false);
          navigation.navigate('NotesStudio', {
            courseId,
            courseLabel: label,
            noteId,
            studySetId,
          });
        }}
        onComplete={() => {
          void useNotesStore.getState().loadNotes().catch(() => undefined);
          if (userId) {
            void useFlashcardStore.getState().fetchDecks(userId).catch(() => undefined);
            void useTestStore.getState().fetchTests(userId).catch(() => undefined);
          }
        }}
      />
    </SafeAreaView>
  );
}

function SetHomeRecommended({
  showOverview,
  showPlan,
  showSetup,
  studySetId,
  notes,
  lectures,
  planUnits,
  planTopics,
  planLoaded,
  mode,
  onGeneratePlan,
  onToggleTopic,
  skippedTopicIds,
  showMore,
  onShowMore,
  onSkip,
  onAsk,
  onRead,
  onQuiz,
  onOpenActivity,
  onAddSyllabus,
  onAddExam,
  onViewSchedule,
  examDate,
}: {
  /** Draw the topic band, the recommendation tiles and Show more. */
  showOverview: boolean;
  /** Draw the study-plan band — units, topics and the tick. */
  showPlan: boolean;
  /** Draw the syllabus/exam starter pair an empty set has instead. */
  showSetup: boolean;
  studySetId: string;
  notes: StudyNote[];
  lectures: StudyNote[];
  planUnits: StudySetUnit[];
  planTopics: StudySetTopic[];
  /** True only once the server has answered — "no plan" is not "not asked". */
  planLoaded: boolean;
  mode: 'cram' | 'standard' | 'comprehensive';
  onGeneratePlan: () => Promise<void>;
  onToggleTopic: (topicId: string, next: StudySetTopicStatus) => void;
  skippedTopicIds: string[];
  showMore: boolean;
  onShowMore: () => void;
  onSkip: (topicId: string) => void;
  onAsk: () => void;
  onRead: (noteId: string) => void;
  onQuiz: (noteId: string) => void;
  onOpenActivity: (id: WorkspaceActivityId) => void;
  onAddSyllabus: () => void;
  onAddExam: () => void;
  /** The Details sheet's `View schedule` — the study calendar for this set. */
  onViewSchedule: () => void;
  /** `YYYY-MM-DD`, resolved off the set then its course. */
  examDate: string | null;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const doorGutter = DOOR_TILE.gridGutter;
  const doorWidth = doorTileColumnWidth({
    screenWidth,
    columns: 2,
    pageMargin: 16,
    gutter: doorGutter,
  });

  // The plan the SERVER holds is the plan. Topics derived from note titles are
  // a fallback for a set that has never had one saved — they used to be the
  // only thing the phone ever showed, which is why a topic ticked off on a
  // laptop was untickable here and unticked on the next render.
  const derived = topicsFromReadingNotes(studySetId, notes);
  const usingServerPlan = planTopics.length > 0;
  const allTopics = usingServerPlan ? planTopics : derived.topics;
  const units = usingServerPlan ? unitsForTopics(planUnits, planTopics) : [derived.unit];
  // Both kinds of material, so a flat plan can name its units after the note or
  // lecture each topic was read out of (studyPlanPresentation.planUnitsAndTopics).
  // `sourceType` rides along so a `Sources:` chip can draw the material's own
  // glyph rather than calling every material a note.
  const planMaterials = useMemo(
    () =>
      [...notes, ...lectures].map((note) => ({
        id: note.id,
        title: note.title,
        sourceType: note.sourceType ?? null,
      })),
    [notes, lectures]
  );
  const topics = allTopics.filter((topic) => !skippedTopicIds.includes(topic.id));
  const current = pickRecommendedTopic(topics, mode);
  const empty = notes.length === 0 && lectures.length === 0 && allTopics.length === 0;
  const cards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => showMore || card.primary);

  if (empty) {
    // An empty set still has a Plan segment, and that segment's `Details` sheet
    // is the ONLY route to the study calendar. Returning null here left a set
    // with no materials unable to reach its own schedule at all — the calendar
    // renders a grid and a setup card for exactly this case, and nothing could
    // open it (device pass SF3, check 2). The setup cards and the panel are now
    // gated separately, so each segment draws what it owns.
    if (!showSetup && !showPlan) return null;
    return (
      <View className="mb-4 gap-3">
        {showPlan ? (
          <StudyPlanPanel
            units={planUnits}
            topics={allTopics}
            materials={planMaterials}
            mode={mode}
            planLoaded={planLoaded}
            usingServerPlan={usingServerPlan}
            canBuildPlan={notes.length > 0}
            onGeneratePlan={onGeneratePlan}
            onToggleTopic={() => undefined}
            onContinue={() => onAsk()}
            onAddSyllabus={onAddSyllabus}
            onAddExam={onAddExam}
            onViewSchedule={onViewSchedule}
            examDate={examDate}
            today={todayDateOnlyLocal()}
          />
        ) : null}
        {showSetup ? (
        <>
        <Card>
          <T.Body>Add your syllabus</T.Body>
          <T.Caption tone="secondary" className="mt-1">
            Import a syllabus or notes so this set can build a plan.
          </T.Caption>
          <Button size="sm" className="mt-3" onPress={onAddSyllabus}>
            Add syllabus
          </Button>
        </Card>
        <Card>
          <T.Body>Exam dates</T.Body>
          <T.Caption tone="secondary" className="mt-1">
            Add an exam so the calendar can group what to study.
          </T.Caption>
          <Button size="sm" variant="secondary" className="mt-3" onPress={onAddExam}>
            Add exam
          </Button>
        </Card>
        </>
        ) : null}
      </View>
    );
  }

  if (!current) return null;

  return (
    <View className="mb-4">
      {showOverview ? (
      <>
      <T.Caption tone="secondary">{topicIndexLabel(topics, current)}</T.Caption>
      <T.Title className="mt-1 mb-3">{current.title}</T.Title>
      {/* The recommended next steps, as DOORS two up rather than as a
          full-width stack. The eyebrow ("Because you read…") is what made each
          of these a full-width card; it now rides in the accessible name, so
          the row of doors stays scannable and the reason is still announced. */}
      <View className="flex-row flex-wrap" style={{ gap: doorGutter }}>
        {cards.map((card) => (
          <DoorTile
            key={card.id}
            feature={card.feature}
            icon={card.icon as AppIconName}
            // The same drawing the Practice tiles below use for the same
            // tool. `read` has no scene in the approved art set (web's `notes`
            // door has none either), so it keeps its glyph — the lookup stays
            // a lookup rather than a cast, so a renamed card id fails the
            // mapping test instead of silently losing its picture.
            scene={tileSceneForTool(card.id)}
            title={card.label}
            width={doorWidth}
            accessibilityLabel={[card.eyebrow, card.label].filter(Boolean).join('. ')}
            onPress={() => {
              const noteId = current.sourceNoteIds[0];
              if (card.id === 'ask') onAsk();
              else if (card.id === 'read' && noteId) onRead(noteId);
              else if (card.id === 'quiz' && noteId) onQuiz(noteId);
              else if (card.id === 'cards') onOpenActivity('cards');
              else if (card.id === 'lesson') onOpenActivity('lesson');
              else if (card.id === 'recap') onOpenActivity('recap');
              else if (card.id === 'play') onOpenActivity('play');
              else if (card.id === 'test') onOpenActivity('test');
            }}
          />
        ))}
      </View>
      <View className="flex-row items-center justify-between mt-2">
        <Pressable onPress={onShowMore} accessibilityRole="button">
          <T.Caption>{showMore ? 'Show less' : 'Show more'}</T.Caption>
        </Pressable>
        <Pressable onPress={() => onSkip(current.id)} accessibilityRole="button">
          <T.Caption>Skip topic</T.Caption>
        </Pressable>
      </View>
      </>
      ) : null}

      {/* The plan itself. The spine, the rings and the Details sheet live in
          components/study/StudyPlanPanel.tsx — this screen only says which
          topic a `Continue` opens and where the exam flow is. */}
      {showPlan ? (
        <StudyPlanPanel
          units={planUnits}
          topics={allTopics}
          materials={planMaterials}
          mode={mode}
          planLoaded={planLoaded}
          usingServerPlan={usingServerPlan}
          canBuildPlan={notes.length > 0}
          onGeneratePlan={onGeneratePlan}
          onToggleTopic={(topicId, next) => {
            // A derived topic has no server row to tick, so the tap is a no-op
            // rather than a write that fails — the panel still offers "Save as
            // my study plan", which is the thing that makes ticking work.
            if (!usingServerPlan) return;
            onToggleTopic(topicId, next);
          }}
          onContinue={(topic) => {
            if (topic.sourceNoteId) onRead(topic.sourceNoteId);
            else onAsk();
          }}
          // A chip opens its material in the studio, the same door `Continue`
          // opens for reading. The chip only exists for a material this screen
          // resolved, so there is no missing-note branch to write.
          onOpenSource={(source) => onRead(source.id)}
          onAddSyllabus={onAddSyllabus}
          onAddExam={onAddExam}
          onViewSchedule={onViewSchedule}
          examDate={examDate}
          today={todayDateOnlyLocal()}
        />
      ) : null}
    </View>
  );
}

function MaterialTile({
  title,
  preview,
  lecture,
  onPress,
}: {
  title: string;
  preview: string;
  lecture: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="rounded-2xl border border-lantern-border overflow-hidden">
      <View className={`min-h-[88px] px-3 py-3 ${lecture ? 'bg-lantern-feature-recording-tint' : 'bg-lantern-background-secondary'}`}>
        {lecture ? (
          <FeatureDisc feature="recording" icon="mic" size={40} />
        ) : (
          <T.Caption tone="secondary" numberOfLines={4}>
            {preview || 'Untitled note'}
          </T.Caption>
        )}
      </View>
      <View className="px-3 py-2">
        <T.Body numberOfLines={1}>{title}</T.Body>
      </View>
    </Pressable>
  );
}

/**
 * One material as a row: a glyph that says WHAT it is, the title, the date.
 *
 * The date is the reason list mode exists. The old lecture list was titles
 * alone, so a set with twenty recordings called `Lecture` — which is what an
 * unnamed recording is called — was twenty identical rows. `formatShortDate`
 * writes `2 Sep` rather than `9/2/2026`, because this shares one line with a
 * title that has already been given every pixel it can have.
 */
function MaterialRow({
  title,
  date,
  lecture,
  divided,
  onPress,
}: {
  title: string;
  date?: string | null;
  lecture: boolean;
  /** Draw the hairline above — every row but the first. */
  divided: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  // A row with an unreadable date shows no date rather than `Invalid Date` —
  // the title is the thing the student came for either way.
  const parsed = date ? new Date(date) : null;
  const when = parsed && Number.isFinite(parsed.getTime()) ? formatShortDate(parsed) : '';
  return (
    <Pressable
      onPress={onPress}
      className={`flex-row items-center gap-2 py-3 ${divided ? 'border-t border-lantern-border' : ''}`}
      accessibilityRole="button"
      // The glyph is decorative, so the KIND rides in the name instead — a
      // reader must not have to guess whether a row is a note or a recording.
      accessibilityLabel={[lecture ? 'Lecture' : 'Note', title, when].filter(Boolean).join(', ')}
    >
      <AppIcon
        name={lecture ? 'mic' : 'document-text'}
        size={16}
        color={colors.textSecondary}
        importantForAccessibility="no"
      />
      <T.Body numberOfLines={1} className="flex-1" importantForAccessibility="no">
        {title}
      </T.Body>
      {when ? (
        <T.Caption tone="secondary" importantForAccessibility="no">
          {when}
        </T.Caption>
      ) : null}
    </Pressable>
  );
}

export default CourseRoomScreen;
