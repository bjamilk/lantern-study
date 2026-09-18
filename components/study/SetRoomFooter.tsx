import React, { useState } from 'react';
import { todayDateOnlyLocal, type UpcomingExam } from '@lantern/shared';
import { AppIcon } from '../ui/AppIcon';
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
 * A 32px pill with a 44px hit target. Same rule as the rest of this wave: the
 * reference's controls are 32px tall and growing them would be a different
 * design, so the extra 12px is a transparent pseudo-element.
 */
const PILL =
  "relative inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40";

/**
 * Exam dates + syllabus, as the measured aside at the foot of set home.
 *
 * WHAT CHANGED (2026-09-17). This was one quiet line naming only the NEXT
 * exam, with four underlined text links after it. Two things were wrong with
 * that. A student with a midterm and a final could see only one of them, and
 * the other was reachable from nowhere in this room. And an underlined word is
 * the one anatomy on this page that does not say "this is a control" —
 * everything else here is a pill.
 *
 * It is now the reference's shape: a heading with `Add` beside it, one row per
 * exam carrying its own `View` and `Edit`, then `View schedule` and a
 * full-width `Add syllabus`. It still sits at the FOOT and still scrolls with
 * the home rather than being pinned: these are setup, not the next study
 * action, and two equal cards above the fold is what used to compete with the
 * three recommended doors.
 *
 * `Edit` appears only on the set's OWN date. The other rows come from calendar
 * notes, which this screen cannot write — an Edit that silently did nothing
 * would be worse than no Edit.
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

  return (
    <aside data-testid="set-room-exams" aria-label="Exam dates and syllabus">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-title text-lantern-text">Exam dates</h2>
        {/* Always `Add` with a plus, as measured — 75×32. It used to read
            `Edit exam` once a date existed, which is the per-row 28×28 Edit's
            job now; the header action is how you add ANOTHER date, and a
            student with a midterm saved could not see that it was still the
            way to add the final. It opens the same exam-date editor. */}
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
          aria-label="Add an exam date"
          className={`${PILL} gap-1.5`}
        >
          <AppIcon name="add" size={16} aria-hidden />
          Add
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-caption text-lantern-text-secondary">No exam date yet.</p>
      ) : (
        <ul className="divide-y divide-lantern-border overflow-hidden rounded-xl border border-lantern-border bg-lantern-surface">
          {rows.map((row) => {
            const past = isPastExam(row.examDate, today);
            // Only the set's own date is writable from here; see the header.
            const ownRow = row.examDate === examDate;
            return (
              <li key={`${row.title}-${row.examDate}`} className="flex items-center gap-2 px-3 py-2">
                <span
                  className={`min-w-0 flex-1 truncate text-body ${
                    past ? 'text-lantern-text-tertiary line-through' : 'text-lantern-text'
                  }`}
                >
                  {row.title}
                  <span className="tabular-nums text-lantern-text-secondary"> · {row.examDate}</span>
                </span>
                <button type="button" onClick={onViewSchedule} className={PILL}>
                  View
                </button>
                {ownRow ? (
                  <button
                    type="button"
                    onClick={() => setAdding(true)}
                    aria-label={`Edit ${row.title}`}
                    // 28×28 as measured, with the 44px target behind it.
                    className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lantern-text-secondary after:absolute after:-inset-2 after:content-[''] hover:bg-lantern-background-secondary hover:text-lantern-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
                  >
                    <AppIcon name="pencil" size={16} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

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

      <div className="mt-3 space-y-2">
        <button type="button" onClick={onViewSchedule} className={PILL}>
          View schedule
        </button>
        {/* Full-width, as measured: it is the one thing on this aside a
            student with no plan yet is actually meant to do. */}
        <button
          type="button"
          onClick={onAddSyllabus}
          className={`${PILL} flex w-full after:-inset-y-1.5 after:inset-x-0`}
        >
          Add syllabus
        </button>
      </div>
    </aside>
  );
};

export default SetRoomFooter;
