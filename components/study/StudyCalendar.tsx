import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CALENDAR_HOURS_CHOICES,
  DEFAULT_HOURS_PER_WEEK,
  WEEKDAY_LABELS,
  acceptStudyCalendar,
  calendarExamChanged,
  calendarKindLabel,
  calendarMonthGrid,
  calendarMonthTitle,
  calendarSessionFeature,
  composeCalendarNoteBody,
  generateStudyCalendar,
  newCalendarNoteTitle,
  parseCalendarNoteBody,
  resolveCalendarStudioNote,
  sessionsOnDate,
  studyCalendarBlocker,
  type StudyCalendarPlan,
  type StudyCalendarSession,
} from '@lantern/shared';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { formatDisplayDate } from '@lantern/shared/utils/displayDate';
import type { CourseTopic, Deck, StudyNote } from '../../types';
import { Button, Input } from '../ui';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG } from '../ui/featureClasses';
import { useAcademicStore } from '../../stores/academicStore';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';

interface StudyCalendarProps {
  courseId: string;
  courseLabel: string;
  notes: StudyNote[];
  calendarNotes: StudyNote[];
  decks: Deck[];
  topics: CourseTopic[];
  onEditOutline: () => void;
  onOpenSession: (session: StudyCalendarSession) => void;
  onNoteReady: (noteId: string) => Promise<void>;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

export const StudyCalendar: React.FC<StudyCalendarProps> = ({
  courseId,
  courseLabel,
  notes,
  calendarNotes,
  decks,
  topics,
  onEditOutline,
  onOpenSession,
  onNoteReady,
}) => {
  const myCourses = useAcademicStore((s) => s.myCourses);
  const updateMyCourse = useAcademicStore((s) => s.updateMyCourse);
  const createNote = useNotesStore((s) => s.createNote);
  const saveNote = useNotesStore((s) => s.saveNote);
  const showToast = useToastStore((s) => s.showToast);

  const enrolment = myCourses.find((row) => row.course.id === courseId);
  const examDate = enrolment?.examDate ?? null;

  const resumed = useMemo(() => {
    const decision = resolveCalendarStudioNote({
      calendars: calendarNotes,
      selectedNoteId: calendarNotes[0]?.id,
    });
    if (decision.action !== 'resume') return null;
    const note = calendarNotes.find((row) => row.id === decision.noteId);
    if (!note) return null;
    const parsed = parseCalendarNoteBody(note.body);
    return parsed ? { note, plan: parsed } : null;
  }, [calendarNotes]);

  const [plan, setPlan] = useState<StudyCalendarPlan | null>(resumed?.plan ?? null);
  const [planNoteId, setPlanNoteId] = useState<string | null>(resumed?.note.id ?? null);
  const [hoursPerWeek, setHoursPerWeek] = useState(
    resumed?.plan.hoursPerWeek || DEFAULT_HOURS_PER_WEEK
  );
  const [examDraft, setExamDraft] = useState(examDate || '');
  const [savingExam, setSavingExam] = useState(false);
  const [working, setWorking] = useState(false);
  const today = todayDateOnlyLocal();
  const todayDate = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, 1);
  const [view, setView] = useState({ year: todayDate.getFullYear(), month: todayDate.getMonth() });

  useEffect(() => {
    setExamDraft(examDate || '');
  }, [examDate]);

  useEffect(() => {
    if (!resumed) return;
    setPlan(resumed.plan);
    setPlanNoteId(resumed.note.id);
    setHoursPerWeek(resumed.plan.hoursPerWeek);
  }, [resumed?.note.id, resumed?.plan.examDate, resumed?.plan.acceptedAt]);

  const persist = useCallback(
    async (next: StudyCalendarPlan, noteId: string | null) => {
      const body = composeCalendarNoteBody(next);
      if (noteId) {
        await saveNote(noteId, { body });
        return noteId;
      }
      const created = await createNote({
        title: newCalendarNoteTitle(courseLabel),
        body,
        courseId,
      });
      await onNoteReady(created.id);
      setPlanNoteId(created.id);
      return created.id;
    },
    [courseId, courseLabel, createNote, onNoteReady, saveNote]
  );

  const blocker = studyCalendarBlocker({ examDate, today, topics });
  const grid = calendarMonthGrid(view.year, view.month);
  const examChanged = plan ? calendarExamChanged(plan, examDate) : false;

  const saveExamDate = async () => {
    const value = examDraft.trim();
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      showToast('Exam date must be YYYY-MM-DD.', 'error');
      return;
    }
    setSavingExam(true);
    try {
      await updateMyCourse(courseId, {
        examDate: value || null,
        academicYear: enrolment?.academicYear,
      });
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
      decks,
      notes,
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
    <div className="flex-1 min-h-0 overflow-y-auto rounded-lantern-xl border border-lantern-border bg-lantern-surface p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-heading">Plan</h2>
          <p className="text-body text-lantern-text-secondary mt-1">
            A week from the exam date and this course’s outline. Sessions open cards or quiz.
            Exam reminders still fire from the date you save here.
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onEditOutline}>
          Edit outline
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-caption text-lantern-text-secondary">Exam date</span>
          <div className="mt-1 flex gap-2">
            <Input
              type="date"
              value={examDraft}
              onChange={(event) => setExamDraft(event.target.value)}
              className="text-body flex-1"
            />
            <Button size="sm" variant="secondary" loading={savingExam} onClick={() => void saveExamDate()}>
              Save
            </Button>
          </div>
        </label>
        <div>
          <p className="text-caption text-lantern-text-secondary">Hours per week</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {CALENDAR_HOURS_CHOICES.map((hours) => (
              <button
                key={hours}
                type="button"
                onClick={() => setHoursPerWeek(hours)}
                aria-pressed={hoursPerWeek === hours}
                className={`min-h-[44px] rounded-full border px-3 text-caption font-medium ${
                  hoursPerWeek === hours
                    ? `${FEATURE_TINT_BG.tests} ${FEATURE_INK_TEXT.tests} border-transparent`
                    : 'border-lantern-border text-lantern-text-secondary'
                }`}
              >
                {hours} h
              </button>
            ))}
          </div>
        </div>
      </div>

      {blocker === 'no_exam' ? (
        <p className="text-body text-lantern-text-secondary">Set an exam date to lay out the week.</p>
      ) : null}
      {blocker === 'exam_passed' ? (
        <p className="text-body text-lantern-text-secondary">This exam date has passed. Update it, then generate.</p>
      ) : null}
      {blocker === 'no_topics' ? (
        <p className="text-body text-lantern-text-secondary">
          Add topics so this course has a syllabus to study against.
        </p>
      ) : null}
      {examChanged ? (
        <p className="text-caption text-lantern-text-secondary">
          Exam date changed since this plan was built. Regenerate to match.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={Boolean(blocker) || working} onClick={() => void generate()}>
          {plan ? 'Regenerate' : 'Generate plan'}
        </Button>
        {plan && !plan.acceptedAt ? (
          <Button variant="secondary" disabled={working} onClick={() => void accept()}>
            Accept
          </Button>
        ) : null}
        {plan?.acceptedAt ? (
          <p className="text-caption text-lantern-text-secondary self-center">Plan accepted.</p>
        ) : null}
      </div>

      {plan ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              className="min-h-[44px] min-w-[44px] text-body text-lantern-text-secondary"
              onClick={() => setView((current) => shiftMonth(current.year, current.month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <h3 className="text-heading">{calendarMonthTitle(view.year, view.month)}</h3>
            <button
              type="button"
              className="min-h-[44px] min-w-[44px] text-body text-lantern-text-secondary"
              onClick={() => setView((current) => shiftMonth(current.year, current.month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="text-label text-lantern-text-tertiary text-center py-1">
                {label}
              </div>
            ))}
            {grid.map((cell, index) => {
              const daySessions = cell.date ? sessionsOnDate(plan, cell.date) : [];
              const isToday = cell.date === today;
              const isExam = cell.date === examDate;
              return (
                <div
                  key={cell.date || `empty-${index}`}
                  className={`min-h-[72px] rounded-lg border p-1 ${
                    !cell.inMonth
                      ? 'border-transparent'
                      : isExam
                        ? `${FEATURE_TINT_BG.tests} border-transparent`
                        : 'border-lantern-border'
                  }`}
                >
                  {cell.date ? (
                    <>
                      <p
                        className={`text-caption ${
                          isToday ? 'font-semibold text-lantern-text' : 'text-lantern-text-secondary'
                        }`}
                      >
                        {Number(cell.date.slice(8, 10))}
                      </p>
                      <div className="mt-1 flex flex-col gap-0.5">
                        {daySessions.map((session) => {
                          const feature = calendarSessionFeature(session.kind);
                          return (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => onOpenSession(session)}
                              className={`w-full min-h-[44px] rounded-md px-1 text-left ${FEATURE_TINT_BG[feature]} ${FEATURE_INK_TEXT[feature]}`}
                            >
                              <span className="text-label block truncate">
                                {calendarKindLabel(session.kind)} · {session.topicTitle}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
          {examDate ? (
            <p className="text-caption text-lantern-text-secondary">
              Exam {formatDisplayDate(examDate)}
              {plan.acceptedAt ? ' · accepted' : ' · draft'}
            </p>
          ) : null}
        </div>
      ) : null}

      {topics.length > 0 ? (
        <div>
          <h3 className="text-label uppercase text-lantern-text-secondary mb-1">Outline</h3>
          <ol className="space-y-1">
            {topics.map((topic) => (
              <li key={topic.id} className="text-body">
                {topic.title}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {calendarNotes.length > 1 ? (
        <div className="space-y-2">
          <h3 className="text-label uppercase text-lantern-text-secondary">Saved plans</h3>
          {calendarNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => {
                const parsed = parseCalendarNoteBody(note.body);
                if (!parsed) return;
                setPlan(parsed);
                setPlanNoteId(note.id);
                setHoursPerWeek(parsed.hoursPerWeek);
                void onNoteReady(note.id);
              }}
              className={`w-full min-h-[44px] rounded-xl border px-3 text-left text-body ${
                note.id === planNoteId
                  ? 'border-transparent bg-lantern-background-secondary'
                  : 'border-lantern-border hover:bg-lantern-background-secondary'
              }`}
            >
              {note.title || 'Plan'}
            </button>
          ))}
        </div>
      ) : null}

      {plan && decks.length === 0 ? (
        <p className="text-caption text-lantern-text-secondary">
          File a deck in this course so card sessions can open it. Quiz sessions still run from notes.
        </p>
      ) : null}
    </div>
  );
};

export default StudyCalendar;
