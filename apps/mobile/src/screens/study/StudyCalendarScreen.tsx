import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CALENDAR_HOURS_CHOICES,
  EXAM_DATE_UNSUPPORTED_COPY,
  examDateSaveOutcome,
  playEmptyCopy,
  scopeNoun,
  DEFAULT_HOURS_PER_WEEK,
  WEEKDAY_LABELS,
  acceptStudyCalendar,
  calendarExamChanged,
  calendarSessionLabel,
  calendarMonthGrid,
  calendarMonthTitle,
  calendarSessionFeature,
  composeCalendarNoteBody,
  generateStudyCalendar,
  isCalendarNote,
  markCalendarSessionDone,
  newCalendarNoteTitle,
  studySetNotePayload,
  parseCalendarNoteBody,
  resolveCalendarStudioNote,
  resolveExamDate,
  sessionsOnDate,
  studioMaterials,
  studyCalendarBlocker,
  type StudyCalendarPlan,
  type StudyCalendarSession,
} from '@lantern/shared';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';
import type { StudyStackParamList } from '../../navigation/types';
import { Button, FeatureDisc, ScreenHeader, T } from '../../components/ui';
import { useTabBarClearance } from '../../components/layout/BottomTabBar';
import { useNotesStore } from '../../stores/notesStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useToastStore } from '../../stores/toastStore';
import { useStudySetStore } from '../../stores/studySetStore';
import {
  getCourseTopics,
  getMyActiveCourses,
  setMyCourseExamDate,
} from '../../services/academic';
import type { CourseTopic, UserCourse } from '@lantern/shared/types';
import { calendarNoTopicsCopy, calendarTopicsFor } from './studyCalendarTopics';
import { calendarViewFor } from './studyCalendarView';
// The tertiary-ink token, not a hex: the `placeholderTextColor` literals in
// these studios had drifted off the palette (one was still #94a3b8, which the
// UI-02 pass retired for failing AA on the warm page ground). The prop takes a
// colour and never a class, so the value comes from the theme hook rather than
// the light palette, which would pin the placeholder to light ink in dark mode.
import { useColors } from '../../theme';

type Props = NativeStackScreenProps<StudyStackParamList, 'StudyCalendar'>;

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function sessionChipClass(kind: StudyCalendarSession['kind']): string {
  return kind === 'cards'
    ? 'border-lantern-feature-flashcards-ink bg-lantern-feature-flashcards-tint'
    : 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint';
}

export function StudyCalendarScreen({ navigation, route }: Props) {
  const colors = useColors();
  const { courseId, courseLabel, studySetId } = route.params;
  const tabBarClearance = useTabBarClearance(16);
  const notes = useNotesStore((s) => s.notes);
  const selectedNote = useNotesStore((s) => s.selectedNote);
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const loadNote = useNotesStore((s) => s.loadNote);
  const decks = useFlashcardStore((s) => s.decks);
  const showToast = useToastStore((s) => s.showToast);

  const studySets = useStudySetStore((s) => s.sets);
  const updateStudySet = useStudySetStore((s) => s.updateSet);
  const loadStudySets = useStudySetStore((s) => s.loadSets);
  // The set's plan, as the SERVER holds it — the same one the room's Plan
  // segment renders. A set-scoped calendar has no course outline to fall back
  // on (a set need not belong to a course at all), so this is its syllabus.
  const loadPlan = useStudySetStore((s) => s.loadPlan);
  const savedSetPlan = useStudySetStore((s) => (studySetId ? s.plans[studySetId] : undefined));
  const studySet = studySetId ? studySets.find((row) => row.id === studySetId) ?? null : null;

  // Scope by the set first: a course-less set's materials report a null course
  // id, so `materialsForCourse(notes, undefined)` matched nothing.
  const courseNotes = useMemo(
    () => studioMaterials(notes, { studySetId, courseId }),
    [notes, courseId, studySetId]
  );
  const calendars = useMemo(() => courseNotes.filter(isCalendarNote), [courseNotes]);
  const studyNotes = useMemo(
    () => courseNotes.filter((note) => !isCalendarNote(note)),
    [courseNotes]
  );
  const courseDecks = useMemo(
    () => studioMaterials(decks, { studySetId, courseId }),
    [decks, courseId, studySetId]
  );

  const [enrolment, setEnrolment] = useState<UserCourse | null>(null);
  const [courseTopics, setCourseTopics] = useState<CourseTopic[]>([]);
  const [plan, setPlan] = useState<StudyCalendarPlan | null>(null);
  const [planNoteId, setPlanNoteId] = useState<string | null>(null);
  const [hoursPerWeek, setHoursPerWeek] = useState(DEFAULT_HOURS_PER_WEEK);
  const [examDraft, setExamDraft] = useState('');
  const [savingExam, setSavingExam] = useState(false);
  const [working, setWorking] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const today = todayDateOnlyLocal();
  const todayMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const [view, setView] = useState({
    year: todayMonth.getFullYear(),
    month: todayMonth.getMonth(),
  });

  const examDate = resolveExamDate(studySet, enrolment);
  const label = courseLabel || (enrolment ? enrolment.course.code : 'Course');

  useEffect(() => {
    if (!courseId) {
      setEnrolment(null);
      setCourseTopics([]);
      return;
    }
    void getMyActiveCourses().then((rows) => {
      const row = rows.find((item) => item.course.id === courseId) ?? null;
      setEnrolment(row);
    });
    void getCourseTopics(courseId)
      .then((rows) => setCourseTopics(Array.isArray(rows) ? rows : []))
      .catch(() => setCourseTopics([]));
  }, [courseId]);

  useEffect(() => {
    setExamDraft(examDate || '');
  }, [examDate]);

  // The screen can be entered directly (deep link, contextual bar), so the set
  // list is not guaranteed to be loaded yet.
  useEffect(() => {
    if (!studySetId) return;
    void loadStudySets().catch(() => undefined);
    void loadPlan(studySetId).catch(() => undefined);
  }, [loadPlan, loadStudySets, studySetId]);

  useEffect(() => {
    const decision = resolveCalendarStudioNote({
      calendars,
      selectedNoteId: selectedNote?.id,
    });
    if (decision.action !== 'resume') return;
    const note =
      selectedNote && selectedNote.id === decision.noteId
        ? selectedNote
        : calendars.find((row) => row.id === decision.noteId);
    if (!note) return;
    const parsed = parseCalendarNoteBody(note.body);
    if (!parsed) return;
    setPlan(parsed);
    setPlanNoteId(note.id);
    setHoursPerWeek(parsed.hoursPerWeek);
  }, [calendars, selectedNote]);

  const persist = useCallback(
    async (next: StudyCalendarPlan, noteId: string | null) => {
      const body = composeCalendarNoteBody(next);
      if (noteId) {
        await saveNote(noteId, { body });
        return noteId;
      }
      const created = await createNote({
        title: newCalendarNoteTitle(label),
        body,
        ...studySetNotePayload({ courseId, studySetId }),
      });
      setPlanNoteId(created.id);
      await loadNote(created.id);
      return created.id;
    },
    [courseId, createNote, label, loadNote, saveNote, studySetId]
  );

  const scope = scopeNoun(studySetId, courseId);
  const topics = useMemo(
    () =>
      calendarTopicsFor({
        studySetId,
        courseId,
        setPlanTopics: savedSetPlan?.topics,
        courseTopics,
      }),
    [studySetId, courseId, savedSetPlan?.topics, courseTopics]
  );
  const blocker = studyCalendarBlocker({ examDate, today, topics });
  const grid = calendarMonthGrid(view.year, view.month);
  // The grid is unconditional: a set with a saved plan but no generated
  // schedule used to land on the setup form alone, with its exam date nowhere
  // on screen. `exam-only` still draws the month, today and the exam chip.
  const calendarView = calendarViewFor({
    hasSchedule: Boolean(plan),
    examDates: [examDate],
    today,
  });
  const chipFor = (date: string | null) =>
    date ? calendarView.chips.find((chip) => chip.date === date) : undefined;
  const examChanged = plan ? calendarExamChanged(plan, examDate) : false;
  const daySessions = selectedDate && plan ? sessionsOnDate(plan, selectedDate) : [];

  const openSession = (session: StudyCalendarSession) => {
    if (plan && session.status !== 'done' && planNoteId) {
      const next = markCalendarSessionDone(plan, session.id);
      setPlan(next);
      void persist(next, planNoteId).catch(() => undefined);
    }
    if (session.kind === 'cards') {
      const deck = courseDecks.find((row) => row.id === session.targetId) || courseDecks[0];
      if (!deck) {
        showToast(playEmptyCopy(scopeNoun(studySetId, courseId)), 'info');
        return;
      }
      navigation.navigate('CramSession', { deckId: deck.id, deckName: deck.name });
      return;
    }
    navigation.navigate('AdaptiveQuiz', {
      courseId,
      courseLabel: label,
      noteId: session.targetId || undefined,
    });
  };

  const saveExamDate = async () => {
    const value = examDraft.trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      showToast('Exam date must be YYYY-MM-DD.', 'error');
      return;
    }
    setSavingExam(true);
    try {
      // The set is the primary container, so a set-scoped plan writes the set's
      // own date. A course room has no set and writes the enrolment, which is
      // what exam reminders read.
      if (studySetId) {
        const updated = await updateStudySet(studySetId, { examDate: value || null });
        // A 200 is not evidence: the production API can answer without storing
        // the date, so the returned row has to echo it back.
        if (examDateSaveOutcome(value || null, updated) === 'unsupported') {
          showToast(EXAM_DATE_UNSUPPORTED_COPY, 'info');
          return;
        }
        showToast(value ? 'Exam date saved.' : 'Exam date cleared.', 'success');
        return;
      }
      if (!courseId) {
        showToast('Open this plan from a study set or a course to save a date.', 'info');
        return;
      }
      const row = await setMyCourseExamDate(courseId, value || null, enrolment?.academicYear);
      setEnrolment(row);
      showToast(value ? 'Exam date saved. Reminders still use this date.' : 'Exam date cleared.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the exam date.', 'error');
    } finally {
      setSavingExam(false);
    }
  };

  const generate = async () => {
    if (!examDate) {
      showToast('Set an exam date first.', 'info');
      return;
    }
    const result = generateStudyCalendar({
      today,
      examDate,
      hoursPerWeek,
      topics: topics.map((topic) => ({ id: topic.id, title: topic.title })),
      decks: courseDecks,
      notes: studyNotes,
    });
    if (!result.ok) {
      if (result.reason === 'no_topics') showToast('Add topics so the week has something to study.', 'info');
      else if (result.reason === 'exam_passed') showToast('This exam date has passed. Update it first.', 'info');
      else showToast('Set an exam date first.', 'info');
      return;
    }
    setWorking(true);
    try {
      await persist(result.plan, planNoteId);
      setPlan(result.plan);
      const first = result.plan.sessions[0]?.date;
      if (first) {
        setSelectedDate(first);
        setView({
          year: Number(first.slice(0, 4)),
          month: Number(first.slice(5, 7)) - 1,
        });
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save that plan.', 'error');
    } finally {
      setWorking(false);
    }
  };

  const accept = async () => {
    if (!plan) return;
    setWorking(true);
    try {
      const next = acceptStudyCalendar(plan);
      await persist(next, planNoteId);
      setPlan(next);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not accept that plan.', 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-lantern-background" edges={['top']}>
      <ScreenHeader title={label} onBack={() => navigation.goBack()} />
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ padding: 16, paddingBottom: tabBarClearance, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <T.Heading>Plan</T.Heading>
        <T.Body tone="secondary">
          A week from the exam date and this {scope}’s outline. Sessions open cards or quiz. Exam
          reminders still fire from the date you save here.
        </T.Body>

        {/* Setup is a compact card ABOVE the grid, never a replacement for it. */}
        {calendarView.showSetupCard ? (
        <View className="gap-2 rounded-2xl border border-lantern-border p-3">
        <T.Label tone="secondary">SETUP</T.Label>
        <Button
          variant="secondary"
          onPress={() =>
            navigation.navigate('Library', {
              manageOutlineCourseId: courseId,
              manageOutlineCourseLabel: label,
            })
          }
        >
          Edit outline
        </Button>

        <T.Caption tone="secondary">Exam date</T.Caption>
        <TextInput
          value={examDraft}
          onChangeText={setExamDraft}
          placeholder="YYYY-MM-DD"
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-[44px] rounded-xl border border-lantern-border px-3 text-body text-lantern-text"
        />
        <Button size="sm" variant="secondary" loading={savingExam} onPress={() => void saveExamDate()}>
          Save exam date
        </Button>

        <T.Caption tone="secondary">Hours per week</T.Caption>
        <View className="flex-row flex-wrap gap-2">
          {CALENDAR_HOURS_CHOICES.map((hours) => (
            <Pressable
              key={hours}
              onPress={() => setHoursPerWeek(hours)}
              className={`min-h-[44px] rounded-full border px-3 py-2 ${
                hoursPerWeek === hours
                  ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                  : 'border-lantern-border'
              }`}
            >
              <T.Caption>{hours} h</T.Caption>
            </Pressable>
          ))}
        </View>

        {blocker === 'no_exam' ? (
          <T.Body tone="secondary">Set an exam date to lay out the week.</T.Body>
        ) : null}
        {blocker === 'exam_passed' ? (
          <T.Body tone="secondary">This exam date has passed. Update it, then generate.</T.Body>
        ) : null}
        {blocker === 'no_topics' ? (
          <T.Body tone="secondary">{calendarNoTopicsCopy(scope)}</T.Body>
        ) : null}
        {examChanged ? (
          <T.Caption tone="secondary">Exam date changed since this plan was built. Regenerate to match.</T.Caption>
        ) : null}

        <Button disabled={Boolean(blocker) || working} onPress={() => void generate()}>
          {plan ? 'Regenerate' : 'Generate plan'}
        </Button>
        {plan && !plan.acceptedAt ? (
          <Button variant="secondary" disabled={working} onPress={() => void accept()}>
            Accept
          </Button>
        ) : null}
        {plan?.acceptedAt ? <T.Caption tone="secondary">Plan accepted.</T.Caption> : null}
        </View>
        ) : null}

        <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() => setView((current) => shiftMonth(current.year, current.month, -1))}
                className="min-h-[44px] min-w-[44px] items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel="Previous month"
              >
                <T.Body tone="secondary">‹</T.Body>
              </Pressable>
              <T.Heading>{calendarMonthTitle(view.year, view.month)}</T.Heading>
              <Pressable
                onPress={() => setView((current) => shiftMonth(current.year, current.month, 1))}
                className="min-h-[44px] min-w-[44px] items-center justify-center"
                accessibilityRole="button"
                accessibilityLabel="Next month"
              >
                <T.Body tone="secondary">›</T.Body>
              </Pressable>
            </View>
            <View className="flex-row">
              {WEEKDAY_LABELS.map((weekday) => (
                <View key={weekday} className="flex-1 items-center py-1">
                  <T.Label tone="tertiary">{weekday}</T.Label>
                </View>
              ))}
            </View>
            {Array.from({ length: 6 }, (_, week) => (
              <View key={week} className="flex-row">
                {grid.slice(week * 7, week * 7 + 7).map((cell, index) => {
                  const daySessions = plan && cell.date ? sessionsOnDate(plan, cell.date) : [];
                  const isToday = cell.date === today;
                  const examChip = chipFor(cell.date);
                  const selected = cell.date === selectedDate;
                  return (
                    <Pressable
                      key={cell.date || `empty-${week}-${index}`}
                      disabled={!cell.date}
                      onPress={() => cell.date && setSelectedDate(cell.date)}
                      className={`flex-1 min-h-[44px] items-center justify-center rounded-md ${
                        selected
                          ? 'bg-lantern-background-secondary'
                          : examChip
                            ? 'bg-lantern-feature-tests-tint'
                            : isToday
                              ? 'border border-lantern-border'
                              : ''
                      }`}
                    >
                      {cell.date ? (
                        <>
                          <T.Caption>{Number(cell.date.slice(8, 10))}</T.Caption>
                          {examChip ? (
                            <View className="mt-0.5 rounded-full border border-lantern-feature-tests-ink bg-lantern-feature-tests-tint px-1">
                              <T.Label>{examChip.label}</T.Label>
                            </View>
                          ) : null}
                          {daySessions.length > 0 ? (
                            <View className="mt-0.5">
                              <FeatureDisc
                                feature={calendarSessionFeature(daySessions[0]!.kind)}
                                icon={daySessions[0]!.kind === 'cards' ? 'layers' : 'help-circle'}
                                size={24}
                              />
                            </View>
                          ) : null}
                        </>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}
            {examDate ? (
              <T.Caption tone="secondary">
                Exam {formatDisplayDate(examDate)}
                {plan ? (plan.acceptedAt ? ' · accepted' : ' · draft') : ' · no schedule yet'}
              </T.Caption>
            ) : null}
            {calendarView.gridMode === 'exam-only' ? (
              <T.Caption tone="secondary">
                No sessions on this calendar yet. Generate a plan above to fill the weeks.
              </T.Caption>
            ) : null}
            {selectedDate ? (
              <View className="gap-2">
                <T.Label tone="secondary">{formatDisplayDate(selectedDate) || selectedDate}</T.Label>
                {daySessions.length === 0 ? (
                  <T.Body tone="secondary">No session this day.</T.Body>
                ) : (
                  daySessions.map((session) => (
                    <Pressable
                      key={session.id}
                      onPress={() => openSession(session)}
                      className={`min-h-[44px] rounded-xl border px-3 py-2 ${sessionChipClass(session.kind)}`}
                    >
                      <T.Body>{calendarSessionLabel(session)}</T.Body>
                      <T.Caption tone="secondary">{session.minutes} min</T.Caption>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
        </View>

        {calendars.length > 1 ? (
          <View className="gap-2">
            <T.Label tone="secondary">SAVED PLANS</T.Label>
            {calendars.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => {
                  const parsed = parseCalendarNoteBody(note.body);
                  if (!parsed) return;
                  setPlan(parsed);
                  setPlanNoteId(note.id);
                  setHoursPerWeek(parsed.hoursPerWeek);
                  void loadNote(note.id);
                }}
                className={`min-h-[44px] rounded-xl border px-3 py-2 ${
                  note.id === planNoteId
                    ? 'border-lantern-feature-tests-ink bg-lantern-feature-tests-tint'
                    : 'border-lantern-border'
                }`}
              >
                <T.Body>{note.title || 'Plan'}</T.Body>
              </Pressable>
            ))}
          </View>
        ) : null}

        {topics.length > 0 ? (
          <View className="gap-1">
            <T.Label tone="secondary">OUTLINE</T.Label>
            {topics.map((topic) => (
              <T.Body key={topic.id}>{topic.title}</T.Body>
            ))}
          </View>
        ) : null}

        {plan && courseDecks.length === 0 ? (
          <T.Caption tone="secondary">
            {`File a deck in this ${scopeNoun(studySetId, courseId)} so card sessions can open it. Quiz sessions still run from notes.`}
          </T.Caption>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default StudyCalendarScreen;
