import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import {
  STUDY_SET_HOME_PRIMARY_TOOL_IDS,
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
  studySetPlanProgress,
  testsFiledInCourse,
  testsFiledInStudySet,
  topicsInUnit,
  unitsForTopics,
  type StudySetTopic,
  type StudySetTopicStatus,
  type StudySetUnit,
  type TurnIntoTargetId,
  type WorkspaceActivityId,
} from '@lantern/shared';
import { normalizeFlashcardCount } from '@lantern/shared/utils';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, Card, DoorTile, doorTileColumnWidth, FeatureDisc, ScreenHeader, T } from '../../components/ui';
import { type AppIconName } from '../../components/ui/AppIcon';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { DOOR_TILE } from '../../theme';
import ImportAndStudyModal from '../../components/ImportAndStudyModal';
import { StudySetTimer } from '../../components/study/StudySetTimer';
import { confirmAsync } from '../../components/ui/appDialog';
import { ClassOfficialMaterials } from '../../components/classes/ClassOfficialMaterials';
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
import { useStudySetStore } from '../../stores/studySetStore';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { useCompanionStore } from '../../stores/companionStore';
import { touchWorkspaceRecent } from '../../utils/workspaceRecents';
import type { UserCourse } from '@lantern/shared/types';
import type { StudyNote } from '../../services/notes';

type Props = NativeStackScreenProps<StudyStackParamList, 'CourseRoom'>;

export function CourseRoomScreen({ navigation, route }: Props) {
  const { courseId: courseIdParam, studySetId, courseLabel } = route.params;
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
          showToast('No decks in this course yet. Turn a note into cards.', 'info');
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
            courseId: courseId || undefined,
            studySetId,
          });
          return { artifact: ref, resultCount: saved };
        },
      });
      showToast(studySetId ? 'Building flashcards for this set…' : 'Building flashcards for this course…', 'info');
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
          courseId: courseId || undefined,
          studySetId,
        });
        return { artifact: ref, resultCount: saved };
      },
    });
    showToast(studySetId ? 'Building a practice test for this set…' : 'Building a practice test for this course…', 'info');
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
        <ScreenHeader
          title={label}
          subtitle={
            studySetId
              ? undefined
              : formatCourseMaterialCounts({
                  notes: studyNotes.length,
                  decks: courseDecks.length,
                  tests: courseTests.length,
                })
          }
          right={
            <View className="flex-row items-center gap-3">
              {studySetId ? <StudySetTimer studySetId={studySetId} /> : null}
              {studySetId ? (
                <Pressable
                  onPress={() => {
                    useStudySetStore.getState().openPicker();
                    navigation.navigate('StudyHub');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="All study sets"
                >
                  <T.Caption>All sets</T.Caption>
                </Pressable>
              ) : null}
              <Pressable onPress={() => useCompanionStore.getState().openForScope({ scopeId: studySetId ?? courseId ?? null, label })} accessibilityRole="button" accessibilityLabel="Ask">
                <T.Caption>Ask</T.Caption>
              </Pressable>
              {studySetId ? (
                <Pressable
                  onPress={() => setOverflowOpen((value) => !value)}
                  accessibilityRole="button"
                  accessibilityLabel="More set actions"
                  accessibilityState={{ expanded: overflowOpen }}
                >
                  <T.Caption>More</T.Caption>
                </Pressable>
              ) : null}
            </View>
          }
        />

        {studySetId && overflowOpen ? (
          <Card className="mb-3">
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                navigation.navigate('StudySetSettings', { studySetId });
              }}
              accessibilityRole="button"
              className="py-3"
            >
              <T.Body>Set settings</T.Body>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                navigation.navigate('StudySetUpload', { studySetId, courseId, courseLabel: label });
              }}
              accessibilityRole="button"
              className="py-3 border-t border-lantern-border"
            >
              <T.Body>Add materials</T.Body>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
                navigation.navigate('StudySetLibrary', { studySetId, courseId, courseLabel: label });
              }}
              accessibilityRole="button"
              className="py-3 border-t border-lantern-border"
            >
              <T.Body>Everything in this set</T.Body>
            </Pressable>
            <Pressable
              onPress={() => {
                setOverflowOpen(false);
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
              }}
              accessibilityRole="button"
              className="py-3 border-t border-lantern-border"
            >
              <T.Body className="text-lantern-error">Delete set</T.Body>
            </Pressable>
          </Card>
        ) : null}

        {studySetId ? (
          <SetHomeRecommended
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
            onAsk={() => useCompanionStore.getState().openForScope({ scopeId: studySetId ?? courseId ?? null, label })}
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
          />
        ) : null}

        {/* The set room's tools, as DOORS (founder direction 2026-09-11): a
            pastel panel with a black drawing over a white caption strip, two
            up, rather than the old white boxes with a 32 dp mark in the
            corner. The promise line each tool carries is not drawn — a door's
            picture is its promise — but it is not lost either: it goes into
            the accessible name, so a screen reader still hears what the tool
            will do before it is opened. */}
        <View
          className="flex-row flex-wrap mb-4"
          style={{ gap: doorGutter }}
        >
          {(studySetId
            ? STUDY_SET_HOME_TOOLS.filter((tool) => STUDY_SET_HOME_PRIMARY_TOOL_IDS.includes(tool.id))
            : WORKSPACE_ACTIVITIES
          ).map((item) => {
            const promise =
              'promise' in item
                ? 'status' in item
                  ? workspaceActivityPromise(item.id, item.promise, scopeNoun(studySetId, courseId))
                  : item.promise
                : '';
            return (
              <DoorTile
                key={item.id}
                feature={item.feature}
                icon={item.icon as AppIconName}
                title={item.label}
                width={doorWidth}
                accessibilityLabel={[item.label, promise].filter(Boolean).join('. ')}
                onPress={() => {
                  if ('activity' in item && item.id === 'import') {
                    setImportOpen(true);
                    return;
                  }
                  if ('activity' in item && item.id === 'ask') {
                    useCompanionStore.getState().openForScope({ scopeId: studySetId ?? courseId ?? null, label });
                    return;
                  }
                  if ('activity' in item && item.activity) {
                    handleActivity(item.activity, 'ready');
                    return;
                  }
                  if ('status' in item) handleActivity(item.id, item.status);
                }}
              />
            );
          })}
        </View>

        {studySetId ? (
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

        {courseId ? (
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

        <Card className="mb-3">
          <T.Caption tone="secondary" className="mb-2">
            {studySetId ? 'Recent materials' : `Notes${studyNotes.length ? ` · ${studyNotes.length}` : ''}`}
          </T.Caption>
          {(studySetId ? [...lectures, ...studyNotes] : studyNotes).length === 0 ? (
            <T.Body tone="secondary">{studySetId ? 'No notes in this set yet.' : 'No notes in this course yet.'}</T.Body>
          ) : studySetId ? (
            <View className="gap-3">
              {[...lectures, ...studyNotes].slice(0, 8).map((note) => (
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
              ))}
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

        {courseTests.length > 0 ? (
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

        {lectures.length > 0 ? (
          <Card className="mb-3">
            <T.Caption tone="secondary" className="mb-2">
              Lectures · {lectures.length}
            </T.Caption>
            {lectures.map((note, index) => (
              <Pressable
                key={note.id}
                onPress={() => openLectureStudio(note.id)}
                className={`py-3 ${index > 0 ? 'border-t border-lantern-border' : ''}`}
              >
                <T.Body numberOfLines={1}>{note.title || 'Lecture'}</T.Body>
              </Pressable>
            ))}
          </Card>
        ) : null}

        {lessons.length > 0 ? (
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

        {recaps.length > 0 ? (
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

        {essays.length > 0 ? (
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

        <Button className="mb-3" onPress={() => setImportOpen(true)}>
          {studySetId ? 'Import into this set' : 'Import into this course'}
        </Button>
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
}: {
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
}) {
  const { width: screenWidth } = useWindowDimensions();
  const doorGutter = DOOR_TILE.gridGutter;
  const doorWidth = doorTileColumnWidth({
    screenWidth,
    columns: 2,
    pageMargin: 16,
    gutter: doorGutter,
  });
  const [generating, setGenerating] = useState(false);
  const [openUnitId, setOpenUnitId] = useState<string | null>(null);

  // The plan the SERVER holds is the plan. Topics derived from note titles are
  // a fallback for a set that has never had one saved — they used to be the
  // only thing the phone ever showed, which is why a topic ticked off on a
  // laptop was untickable here and unticked on the next render.
  const derived = topicsFromReadingNotes(studySetId, notes);
  const usingServerPlan = planTopics.length > 0;
  const allTopics = usingServerPlan ? planTopics : derived.topics;
  const units = usingServerPlan ? unitsForTopics(planUnits, planTopics) : [derived.unit];
  const topics = allTopics.filter((topic) => !skippedTopicIds.includes(topic.id));
  const current = pickRecommendedTopic(topics, mode);
  const progress = studySetPlanProgress(allTopics);
  const empty = notes.length === 0 && lectures.length === 0 && allTopics.length === 0;
  const cards = STUDY_SET_RECOMMENDED_CARDS.filter((card) => showMore || card.primary);

  if (empty) {
    return (
      <View className="mb-4 gap-3">
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
      </View>
    );
  }

  if (!current) return null;

  return (
    <View className="mb-4">
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

      {/* The plan itself: units that open, topics that tick, and the tick
          goes to the server. Web has had this since the set room shipped. */}
      <Card className="mt-3">
        <View className="flex-row items-center justify-between mb-2">
          <T.Caption tone="secondary">Study plan</T.Caption>
          <T.Caption tone="tertiary">
            {progress.topics} topics · {progress.covered} covered · {progress.mastered} mastered
          </T.Caption>
        </View>

        {!usingServerPlan ? (
          <View className="mb-3">
            <T.Caption tone="secondary">
              {planLoaded
                ? 'These topics are read off your notes. Save them as a plan to tick them off on every device.'
                : 'Showing topics read off your notes — your saved plan has not loaded yet.'}
            </T.Caption>
            {planLoaded ? (
              <Button
                size="sm"
                className="mt-2"
                disabled={generating || notes.length === 0}
                onPress={() => {
                  setGenerating(true);
                  void onGeneratePlan().finally(() => setGenerating(false));
                }}
              >
                {generating ? 'Building…' : 'Save as my study plan'}
              </Button>
            ) : null}
          </View>
        ) : null}

        {units.map((unit, index) => {
          const unitTopics = topicsInUnit(allTopics, unit.id);
          const expanded = openUnitId === null ? index === 0 : openUnitId === unit.id;
          return (
            <View key={unit.id} className={index > 0 ? 'border-t border-lantern-border pt-2 mt-2' : ''}>
              <Pressable
                onPress={() => setOpenUnitId(expanded ? '' : unit.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                className="py-2"
              >
                <T.Body>{`${String(index + 1).padStart(2, '0')} ${unit.title}`}</T.Body>
                <T.Caption tone="secondary">
                  {unitTopics.length} topics · {expanded ? 'Hide' : 'Show'}
                </T.Caption>
              </Pressable>
              {expanded
                ? unitTopics.map((topic) => (
                    <Pressable
                      key={topic.id}
                      onPress={() => {
                        if (!usingServerPlan) return;
                        const next: StudySetTopicStatus =
                          topic.status === 'unseen'
                            ? 'covered'
                            : topic.status === 'covered'
                              ? 'mastered'
                              : 'unseen';
                        onToggleTopic(topic.id, next);
                      }}
                      disabled={!usingServerPlan}
                      accessibilityRole="button"
                      accessibilityLabel={`${topic.title}. ${topic.status}${
                        usingServerPlan ? '. Tap to change' : ''
                      }`}
                      className="flex-row items-center gap-3 py-2 pl-2"
                    >
                      <View
                        className={`h-5 w-5 rounded-md border items-center justify-center ${
                          topic.status === 'unseen'
                            ? 'border-lantern-border'
                            : 'border-lantern-primary bg-lantern-primary-background'
                        }`}
                      >
                        {topic.status === 'mastered' ? <T.Caption>★</T.Caption> : null}
                        {topic.status === 'covered' ? <T.Caption>✓</T.Caption> : null}
                      </View>
                      <View className="flex-1">
                        <T.Body numberOfLines={1}>{topic.title}</T.Body>
                        <T.Caption tone="secondary">{topic.status}</T.Caption>
                      </View>
                    </Pressable>
                  ))
                : null}
            </View>
          );
        })}
      </Card>
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

export default CourseRoomScreen;
