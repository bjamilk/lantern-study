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
  testsFiledInCourse,
  testsFiledInStudySet,
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
  const studySet = useStudySetStore((s) => (studySetId ? s.resolveSet(studySetId) : null));
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
  const openCompanion = useCompanionStore((s) => s.open);
  const setActiveNoteContext = useCompanionStore((s) => s.setActiveNoteContext);
  const resetCompanionForScope = useCompanionStore((s) => s.resetForScope);

  useEffect(() => {
    void loadSets().catch(() => undefined);
  }, [loadSets]);

  useEffect(() => {
    if (studySetId) touchOpened(studySetId);
  }, [studySetId, touchOpened]);

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
      case 'cards':
        if (courseDecks.length === 0) {
          showToast(studySetId ? 'No decks in this set yet. Turn a note into cards.' : 'No decks in this course yet. Turn a note into cards.', 'info');
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
              <Pressable onPress={() => openCompanion()} accessibilityRole="button" accessibilityLabel="Ask">
                <T.Caption>Ask</T.Caption>
              </Pressable>
            </View>
          }
        />

        {studySetId ? (
          <SetHomeRecommended
            studySetId={studySetId}
            notes={studyNotes}
            lectures={lectures}
            skippedTopicIds={skippedTopicIds}
            showMore={showMoreRecommended}
            onShowMore={() => setShowMoreRecommended((value) => !value)}
            onSkip={(topicId) => setSkippedTopicIds((ids) => [...ids, topicId])}
            onAsk={() => openCompanion()}
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
                    openCompanion();
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
                    navigation.navigate('TestsList', { courseId, courseLabel: label })
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
          onPress={() => navigation.navigate('Library', { tab: 'notes' })}
        >
          All materials
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
  const derived = topicsFromReadingNotes(studySetId, notes);
  const topics = derived.topics.filter((topic) => !skippedTopicIds.includes(topic.id));
  const current = pickRecommendedTopic(topics);
  const empty = notes.length === 0 && lectures.length === 0 && derived.topics.length === 0;
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
