import React, { useState } from 'react';
import { todayDateOnlyLocal, type UpcomingExam } from '@lantern/shared';
import { Button } from '../ui';
import { AppIcon } from '../ui/AppIcon';
import { ExamDateField } from './ExamDateField';

/** Is this exam already behind the student? Compared as calendar days, not ms. */
export function isPastExam(examDate: string, today: string): boolean {
  return Boolean(examDate) && examDate < today;
}

interface SetRoomFooterProps {
  studySetId: string;
  /** The set's own exam date, which `+ Add` writes. */
  examDate: string | null;
  /** Exams derived from the set's calendar notes, past ones included. */
  exams: readonly UpcomingExam[];
  onViewSchedule: () => void;
  onAddSyllabus: () => void;
}

/**
 * `Exam dates` and `Add your syllabus`, at the foot of EVERY set room.
 *
 * WHAT WAS WRONG. Both cards existed, but only inside `StudySetHome`'s `empty`
 * branch — so the moment a set had a single note they disappeared, which is
 * exactly backwards: an empty set has no exam worth naming and a full one does.
 * And the `Add exam` button in that empty state called `onOpenCalendar`, which
 * opens a calendar the set has no date field on. There was no reachable way to
 * set a study set's exam date from the room at all; the working control,
 * `ExamDateField`, was buried in the Plan tab.
 *
 * So `+ Add` discloses that same field right here, and a past exam is struck
 * through rather than dropped, because "the midterm was on the 6th" is
 * information and a silently shorter list is not.
 */
export const SetRoomFooter: React.FC<SetRoomFooterProps> = ({
  studySetId,
  examDate,
  exams,
  onViewSchedule,
  onAddSyllabus,
}) => {
  const [adding, setAdding] = useState(false);
  const today = todayDateOnlyLocal();

  // The set's own date is the one `+ Add` writes, so it belongs in the list
  // even when no calendar note mentions it. Dedupe by date — a set whose exam
  // was also written as a calendar note should appear once.
  const rows = [
    ...(examDate ? [{ title: 'Exam', examDate }] : []),
    ...exams.filter((exam) => exam.examDate !== examDate),
  ].sort((a, b) => a.examDate.localeCompare(b.examDate));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-heading text-lantern-text">Exam dates</h2>
          <button
            type="button"
            onClick={() => setAdding((value) => !value)}
            aria-expanded={adding}
            className="inline-flex min-h-[40px] items-center gap-1 text-caption font-medium text-lantern-text hover:underline"
          >
            <AppIcon name="add" size={16} />
            Add
          </button>
        </div>

        {rows.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {rows.map((exam) => {
              const past = isPastExam(exam.examDate, today);
              return (
                <li
                  key={`${exam.examDate}-${exam.title}`}
                  className={`flex items-center justify-between gap-2 text-caption ${
                    past ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'
                  }`}
                >
                  <span className="truncate">{exam.title}</span>
                  <span className="shrink-0 tabular-nums">{exam.examDate}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-caption text-lantern-text-secondary">
            Add an exam so the plan knows what it is working towards.
          </p>
        )}

        {adding ? (
          <div className="mt-3">
            <ExamDateField
              studySetId={studySetId}
              value={examDate}
              onSaved={(outcome) => {
                // Left open on `unsupported`: the field prints why the date did
                // not stick, and closing the panel would hide that sentence.
                if (outcome === 'saved') setAdding(false);
              }}
            />
          </div>
        ) : null}

        <Button size="sm" variant="secondary" className="mt-3" onClick={onViewSchedule}>
          View schedule
        </Button>
      </section>

      <section className="rounded-2xl border border-lantern-border bg-lantern-surface p-4">
        <h2 className="text-heading text-lantern-text">Add your syllabus</h2>
        <p className="mt-1 text-caption text-lantern-text-secondary">
          Tailor your study plan to your class schedule and priorities.
        </p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={onAddSyllabus}>
          Add syllabus
        </Button>
      </section>
    </div>
  );
};

export default SetRoomFooter;
