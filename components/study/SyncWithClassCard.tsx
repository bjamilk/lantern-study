import React, { useRef, useState } from 'react';
import {
  MAX_SYLLABUS_BYTES,
  SYLLABUS_ACCEPT,
  formatCreditCost,
  type StudySetSyllabusResponse,
  type SyllabusSummary,
} from '@lantern/shared';
import { AI_FEATURE_CREDIT_COST } from '@lantern/shared/utils/aiCredits';
import { AppIcon } from '../ui/AppIcon';
import { Headline } from '../ui/Headline';
import { ExamDateField } from './ExamDateField';

/**
 * "Sync with your class" — the first landing in an empty study set.
 *
 * WHY THIS EXISTS. The reference does not drop a student into the set room
 * after they create a set. It shows one dashed card asking for the two facts
 * that make everything after it sharper: WHEN the exam is, and WHICH topics
 * belong to it. Lantern dropped them straight into an empty room whose
 * `Add syllabus` button navigated to the generic upload page — a soft dead
 * door, since nothing in the app knew what a syllabus was.
 *
 * WHAT IT IS NOT. It is not a wall. The reference's own card is dismissable in
 * effect (its "Skip and Upload Documents" leaves for the upload page), and a
 * student who has no syllabus to hand — most students, most of the time —
 * must be able to get past it in one click and never see it again for this
 * set. `Skip for now` is that click, and it is remembered per set. The own-way
 * grid and every other door stay on the page underneath either way: this card
 * sits ABOVE them, it does not replace them.
 *
 * THE PRICE IS ON THE BUTTON. Uploading a syllabus costs one AI use, and
 * Lantern's rule everywhere else is that a student reads the cost before they
 * spend it, not after. That is the one place this deviates from the reference,
 * which prices nothing.
 *
 * DEGRADATION. The parent renders this only when the server said `supported`.
 * 20260918150000 is hand-applied, so before it lands the card is simply not
 * there — rather than an upload button that answers 503.
 */

/** The 32px pill with a 44px hit target, as everywhere else in this room. */
const PILL =
  "relative inline-flex h-8 shrink-0 items-center justify-center rounded-full border border-lantern-border bg-lantern-surface px-3 text-body font-medium text-lantern-text after:absolute after:-inset-1.5 after:content-[''] hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40";

/** The reference's black full-width primary. 40px here, not 32: it is the CTA. */
const PRIMARY =
  'inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-lantern-ink px-4 text-body font-semibold text-lantern-surface hover:opacity-90 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40';

/** The white outlined secondary beneath it, same height. */
const SECONDARY =
  'inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-lantern-border bg-lantern-surface px-4 text-body font-medium text-lantern-text hover:border-lantern-text-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40';

export interface SyncWithClassCardProps {
  studySetId: string;
  /** The set's own exam date, or null. */
  examDate: string | null;
  /** What the server holds today. `supported` is checked by the PARENT. */
  syllabus: StudySetSyllabusResponse | null;
  /** Upload a file. Resolves to the line the card then shows. */
  onUploadSyllabus: (file: File) => Promise<void>;
  /** Undo — unlink the syllabus and delete its note. */
  onUndoSyllabus: () => Promise<void>;
  /** "Skip and upload materials" — the upload page. */
  onSkipToMaterials: () => void;
  /** Remembered per set, so this card never returns for it. */
  onSkipForNow: () => void;
  /** The line to show after an upload: "Found 12 weeks · 2 exam dates". */
  foundLabel?: string | null;
  /** A refusal from the server, shown inline rather than as a toast. */
  error?: string | null;
  uploading?: boolean;
  onExamDateSaved?: (value: string | null) => void;
}

/** The weeks list, once a syllabus has been read. Capped in the UI as well. */
const SyllabusWeeks: React.FC<{ summary: SyllabusSummary }> = ({ summary }) => {
  const [expanded, setExpanded] = useState(false);
  // Six is what fits above the fold beside the exam block. The rest are one
  // click away rather than a 60-row wall in a card meant to be skimmed.
  const shown = expanded ? summary.weeks : summary.weeks.slice(0, 6);
  return (
    <div className="mt-3">
      <ul className="divide-y divide-lantern-border overflow-hidden rounded-xl border border-lantern-border bg-lantern-surface">
        {shown.map((week) => (
          <li key={week.week} className="flex items-center gap-2 px-3 py-2">
            <span className="w-12 shrink-0 text-caption tabular-nums text-lantern-text-secondary">
              Wk {week.week}
            </span>
            <span className="min-w-0 flex-1 truncate text-body text-lantern-text">{week.title}</span>
            {week.examLabel ? (
              <span className="shrink-0 rounded-full bg-lantern-feature-ai-tint/40 px-2 py-0.5 text-caption text-lantern-text">
                {week.examLabel}
              </span>
            ) : null}
            {week.date ? (
              <span className="shrink-0 text-caption tabular-nums text-lantern-text-secondary">
                {week.date}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {summary.weeks.length > 6 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className={`${PILL} mt-2`}
        >
          {expanded ? 'Show less' : `Show all ${summary.weeks.length} weeks`}
        </button>
      ) : null}
    </div>
  );
};

export const SyncWithClassCard: React.FC<SyncWithClassCardProps> = ({
  studySetId,
  examDate,
  syllabus,
  onUploadSyllabus,
  onUndoSyllabus,
  onSkipToMaterials,
  onSkipForNow,
  foundLabel,
  error,
  uploading,
  onExamDateSaved,
}) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [addingExam, setAddingExam] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const summary = syllabus?.summary ?? null;
  const hasSyllabus = Boolean(syllabus?.noteId);

  const pick = () => {
    setLocalError(null);
    fileRef.current?.click();
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately, so picking the SAME file twice after a failure still
    // fires a change event. Without this a student who fixes nothing and
    // retries gets no response at all, which reads as the button being dead.
    event.target.value = '';
    if (!file) return;
    const name = file.name.toLowerCase();
    // Checked here as well as on the server: a refusal a student reads before
    // a 20 MB upload is a better refusal than the same sentence after it.
    if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
      setLocalError('A syllabus must be a .pdf or .docx file.');
      return;
    }
    if (file.size > MAX_SYLLABUS_BYTES) {
      setLocalError(`That file is over ${Math.floor(MAX_SYLLABUS_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    setLocalError(null);
    void onUploadSyllabus(file);
  };

  const shownError = localError || error || null;

  return (
    <section
      data-testid="sync-with-class"
      aria-labelledby="sync-with-class-heading"
      className="rounded-2xl border-2 border-dashed border-lantern-border bg-lantern-surface p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Headline
          accent="your class"
          feature="sets"
          size="title"
          as="h2"
          className="!mb-0"
        >
          Sync with your class
        </Headline>
        {/* Never a wall: one click and this set never shows the card again. */}
        <button
          type="button"
          onClick={onSkipForNow}
          className="relative text-caption text-lantern-text-secondary underline-offset-2 after:absolute after:-inset-3 after:content-[''] hover:text-lantern-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lantern-ink/40"
        >
          Skip for now
        </button>
      </div>
      <p id="sync-with-class-heading" className="mt-1 text-body text-lantern-text-secondary">
        Upload your syllabus and Lantern will work out which topics belong to which exam, or add
        your exam dates by hand.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept={SYLLABUS_ACCEPT}
        onChange={onFile}
        className="hidden"
        // Labelled for the assistive-tech path: the visible control is the
        // button below, and an unlabelled file input is a nameless field.
        aria-label="Choose a syllabus file"
      />

      <div className="mt-4 space-y-2">
        <button type="button" onClick={pick} disabled={uploading} className={PRIMARY}>
          {uploading ? (
            'Reading your syllabus…'
          ) : (
            <>
              <AppIcon name="upload" size={16} aria-hidden />
              Upload syllabus
              {/* The price, before it is spent. */}
              <span className="text-caption font-normal opacity-80">
                · {formatCreditCost(AI_FEATURE_CREDIT_COST)}
              </span>
            </>
          )}
        </button>
        <button type="button" onClick={onSkipToMaterials} className={SECONDARY}>
          Skip and upload materials
        </button>
      </div>

      {shownError ? (
        <p role="alert" className="mt-2 text-caption text-lantern-error">
          {shownError}
        </p>
      ) : null}

      {/* The extraction result, inline, with an Undo beside it — not a toast
          that is gone before the student has read the number. */}
      {foundLabel ? (
        <div
          data-testid="sync-with-class-result"
          className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-lantern-background-secondary px-3 py-2"
        >
          <span className="text-body text-lantern-text">{foundLabel}</span>
          <button type="button" onClick={() => void onUndoSyllabus()} className={PILL}>
            Undo
          </button>
        </div>
      ) : null}

      {summary ? <SyllabusWeeks summary={summary} /> : null}

      {/* The two cards, side by side as measured, stacking at phone width. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-lantern-border p-4">
          <h3 className="flex items-center gap-1.5 text-heading text-lantern-text">
            Add your syllabus
            <span
              // The reference's ⓘ, which there has no tooltip at all. Lantern's
              // carries the sentence, because an unlabelled icon is decoration.
              title="Lantern reads the week-by-week schedule and any exam dates out of the document. The file is filed in this set as a note you can open."
              aria-label="Lantern reads the week-by-week schedule and any exam dates out of the document. The file is filed in this set as a note you can open."
              className="text-lantern-text-tertiary"
            >
              <AppIcon name="information-circle" size={14} aria-hidden />
            </span>
          </h3>
          <p className="mt-1 text-caption text-lantern-text-secondary">
            Tailor your study plan to your class schedule and priorities.
          </p>
          <button type="button" onClick={pick} disabled={uploading} className={`${PILL} mt-3`}>
            <AppIcon name="add" size={14} aria-hidden className="mr-1" />
            {hasSyllabus ? 'Replace syllabus' : 'Add syllabus'}
          </button>
        </div>

        <div className="rounded-xl border border-lantern-border p-4">
          <h3 className="text-heading text-lantern-text">Exam dates</h3>
          <p className="mt-1 text-caption text-lantern-text-secondary">
            Make sure you are studying what you need to before your exams.
          </p>
          {examDate ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-body tabular-nums text-lantern-text">{examDate}</span>
              <button
                type="button"
                onClick={() => setAddingExam((value) => !value)}
                aria-expanded={addingExam}
                className={PILL}
              >
                Change
              </button>
              <button
                type="button"
                // Clearing is the same field with an empty value, so the
                // "did the server actually store it" check applies to the
                // clear as well — which is exactly where a cheerful 200 over
                // an unapplied migration used to lie.
                onClick={() => setAddingExam(true)}
                className={PILL}
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAddingExam((value) => !value)}
              aria-expanded={addingExam}
              className={`${PILL} mt-3`}
            >
              <AppIcon name="add" size={14} aria-hidden className="mr-1" />
              Add exam
            </button>
          )}
          {addingExam ? (
            <div className="mt-3">
              <ExamDateField
                studySetId={studySetId}
                value={examDate}
                onSaved={(outcome, value) => {
                  // Left open on `unsupported`: the field prints why the date
                  // did not stick, and closing would hide that sentence.
                  if (outcome === 'saved') setAddingExam(false);
                  onExamDateSaved?.(value);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

export default SyncWithClassCard;
