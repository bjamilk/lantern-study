import React, { useState } from 'react';
import { todayDateOnlyLocal, type UpcomingExam } from '@lantern/shared';
import { ExamDateField } from './ExamDateField';

/** Is this exam already behind the student? Compared as calendar days, not ms. */
export function isPastExam(examDate: string, today: string): boolean {
  return Boolean(examDate) && examDate < today;
}

interface SetRoomFooterProps {
  studySetId: string;
  /** The set's own exam date, which `Add exam` writes. */
  examDate: string | null;
  /** Exams derived from the set's calendar notes, past ones included. */
  exams: readonly UpcomingExam[];
  onViewSchedule: () => void;
  onAddSyllabus: () => void;
}

/**
 * Exam + syllabus, as one quiet line at the foot of set home.
 *
 * Two equal cards here used to sit above the fold and compete with the three
 * recommended doors. The dates still have to be reachable — they disappeared
 * entirely when this lived only on an empty set — but they are setup, not the
 * next study action. Schedule and syllabus stay one tap away; the field itself
 * only opens when the student asks to add or edit a date.
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

  // The set's own date is the one `Add exam` writes, so it belongs in the list
  // even when no calendar note mentions it. Dedupe by date — a set whose exam
  // was also written as a calendar note should appear once.
  const rows = [
    ...(examDate ? [{ title: 'Exam', examDate }] : []),
    ...exams.filter((exam) => exam.examDate !== examDate),
  ].sort((a, b) => a.examDate.localeCompare(b.examDate));
  const next = rows.find((exam) => !isPastExam(exam.examDate, today)) ?? rows[0];
  const nextPast = next ? isPastExam(next.examDate, today) : false;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p
          className={`min-w-0 truncate text-caption ${
            nextPast ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text-secondary'
          }`}
        >
          {next ? (
            <>
              <span className={nextPast ? '' : 'text-lantern-text'}>{next.title}</span>
              <span className="tabular-nums"> · {next.examDate}</span>
            </>
          ) : (
            'No exam date yet'
          )}
        </p>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
          className="min-h-[36px] text-caption font-medium text-lantern-text hover:underline"
        >
          {examDate ? 'Edit exam' : 'Add exam'}
        </button>
        <button
          type="button"
          onClick={onViewSchedule}
          className="min-h-[36px] text-caption font-medium text-lantern-text hover:underline"
        >
          Schedule
        </button>
        <button
          type="button"
          onClick={onAddSyllabus}
          className="min-h-[36px] text-caption font-medium text-lantern-text hover:underline"
        >
          Add syllabus
        </button>
      </div>

      {adding ? (
        <div className="mt-2 max-w-sm">
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
    </div>
  );
};

export default SetRoomFooter;
