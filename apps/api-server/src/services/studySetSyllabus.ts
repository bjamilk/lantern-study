/**
 * "Sync with your class" — reading an uploaded syllabus onto a study set.
 *
 * Purpose: a student uploads their course syllabus (PDF or .docx) to a set.
 * The file becomes an ordinary NOTE of that set, its text is read with the
 * extractors #135 already built, and ONE model call turns it into a schedule
 * stored on `study_sets.syllabus_summary`. If the syllabus names an exam date
 * and the set has none, the set gets one.
 *
 * Exports: `syllabusFileKind` (pure, tested — which extractor a filename
 * chooses, and the refusal message when it is neither), and
 * `getStudySetSyllabusService`, the process singleton the route calls.
 *
 * What it touches: `study_sets.syllabus_note_id` / `syllabus_summary` /
 * `exam_date` through `StudySetsService.setSyllabus` (never directly), `notes`
 * through `dataLayer.notes.createNote`, and the extractors in `noteFiles.ts`.
 * It creates NO table of its own — the syllabus is a note, which is what makes
 * this one migration of three nullable columns rather than a new object.
 *
 * Ownership: `setId` is proved to be the caller's by `StudySetsService.get`,
 * which `getSyllabus`/`setSyllabus` both open with, before anything is written.
 * The service-role client bypasses RLS, so that is the access control.
 *
 * ## The credit rule, which is the thing to read before changing this file
 *
 * One upload costs ONE AI use — `AI_FEATURE_CREDIT_COST`, charged as the
 * `generate_questions` feature by `aiRateLimitForFeature` BEFORE the handler
 * runs, exactly as the unit pre-assessment charges. There is no separate
 * syllabus price because there is no separate meter: one `chatCompletion` at
 * one model call is the same unit of work `generate_questions` already prices.
 *
 * That charge happens before this service is entered, so every path out of
 * here has to answer "was an AI call made?":
 *
 *   - refused before the model ran (bad file, too big, no readable text,
 *     migration missing) -> the ROUTE refunds. No call was made.
 *   - the model threw (every provider exhausted) -> the ROUTE refunds. No
 *     answer came back.
 *   - the model answered and found no schedule -> NO refund. The work was
 *     done and "this document has no week-by-week schedule" is a real answer
 *     to a real question; the file is still filed as a note. Refunding here
 *     would make a one-page outline a free retry loop against the provider.
 *
 * The migration check is first and is why the route puts its capability gate
 * BEFORE the rate-limit middleware rather than inside the handler: this is the
 * only path in the app that spends a credit before it stores anything, so
 * refusing an unapplied migration has to happen before the meter, not after.
 */
import {
  MAX_SYLLABUS_BYTES,
  normalizeSyllabusSummary,
  suggestedExamDate,
  syllabusFoundLabel,
  type SyllabusSummary,
} from '@lantern/shared/study/syllabusSummary';
import { todayDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import { PublicError } from '../utils/safeError';
import { extractSyllabusSchedule } from './aiService';
import {
  assertValidOfficeZip,
  buildDocumentStudyText,
  extractDocumentTextFromBuffer,
  extractPdfTextDetailsFromBuffer,
} from './noteFiles';
import { StudySetSyllabusMissingError, getStudySetsService } from './studySets';
import { logger } from '../utils/logger';
import type { DataLayer } from './data';

function fail(message: string): never {
  throw new PublicError(message);
}

/** Raised when the model produced nothing at all, so the route can refund. */
export class SyllabusGenerationFailedError extends Error {
  constructor() {
    super('Lantern could not read a schedule from that syllabus. Please try again.');
    this.name = 'SyllabusGenerationFailedError';
  }
}

export type SyllabusFileKind = 'pdf' | 'docx';

/**
 * Which extractor this filename chooses.
 *
 * `.pdf` and `.docx` only, which is what the reference's picker offers minus
 * the legacy `.doc` it also lists and cannot actually read. `.doc` gets its own
 * sentence rather than the generic one, because "Document must be a .pdf or
 * .docx file" does not tell somebody holding a .doc what to DO — the same
 * split `assertDocumentFileName` already makes for the Word import.
 */
export function syllabusFileKind(fileName: string): SyllabusFileKind {
  const name = String(fileName || '').trim().toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.doc')) {
    fail('Legacy .doc files are not supported. Open it in Word and save as .docx, then upload again.');
  }
  fail('A syllabus must be a .pdf or .docx file.');
}

/** The note a syllabus becomes. Titled so it is findable in the materials list. */
function syllabusNoteTitle(fileName: string): string {
  const base = String(fileName || '').replace(/\.(pdf|docx)$/i, '').trim();
  return base ? `Syllabus — ${base}`.slice(0, 200) : 'Syllabus';
}

export interface SyllabusUploadResult {
  noteId: string;
  summary: SyllabusSummary | null;
  /** "Found 12 weeks · 2 exam dates" — the line the clients show. */
  foundLabel: string;
  /** The set's exam date AFTER this upload, whether or not this upload set it. */
  examDate: string | null;
  /** True only when this upload is what put the date there. */
  examDateApplied: boolean;
}

export class StudySetSyllabusService {
  constructor(private readonly data: DataLayer) {}

  /**
   * Read an uploaded syllabus onto a set.
   *
   * Order is deliberate: refuse the file on its shape and size BEFORE decoding
   * or parsing it, extract text before creating anything, and create the note
   * before the model call — so a student whose provider call fails still has
   * their document filed as a material rather than having uploaded into a hole.
   */
  async upload(
    userId: string,
    setId: string,
    input: { fileName: string; base64Data: string; today?: string }
  ): Promise<SyllabusUploadResult> {
    const sets = getStudySetsService(this.data);
    // Proves the set is this caller's, and throws StudySetSyllabusMissingError
    // when 20260918150000 is unapplied — before any parsing or model call.
    const current = await sets.getSyllabus(userId, setId);
    if (!current.supported) {
      // getSyllabus degrades rather than throwing on a read. The route's gate
      // has already refused this case; this is the belt to that braces, for a
      // probe that flipped between the gate and here.
      throw new StudySetSyllabusMissingError();
    }

    const fileName = String(input.fileName || '').trim();
    const kind = syllabusFileKind(fileName);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(String(input.base64Data || ''), 'base64');
    } catch {
      fail('That file could not be read. Please re-upload it.');
    }
    if (buffer.length === 0) fail('That file is empty. Please re-upload it.');
    // Checked here rather than left to `assertPdfSize`/`assertDocumentSize` so
    // both kinds refuse at ONE number, which is the number the clients print
    // under the button (`MAX_SYLLABUS_BYTES`).
    if (buffer.length > MAX_SYLLABUS_BYTES) {
      fail(`A syllabus must be under ${Math.floor(MAX_SYLLABUS_BYTES / (1024 * 1024))} MB.`);
    }

    let text = '';
    if (kind === 'docx') {
      // Catches a .docx that is really a renamed something-else, and a
      // truncated upload, before officeparser is handed it.
      assertValidOfficeZip(buffer, fileName);
      const extracted = await extractDocumentTextFromBuffer(buffer, fileName);
      text = buildDocumentStudyText(fileName, extracted.text).studyText;
    } else {
      const details = await extractPdfTextDetailsFromBuffer(buffer);
      text = details.text || '';
    }

    // A scanned syllabus is the common real failure here: a photographed
    // course outline is a PDF with no text layer at all. Say what to do about
    // it rather than reporting an empty schedule, and refuse BEFORE the model
    // call so the route refunds.
    if (text.trim().length < 40) {
      fail(
        `Lantern could not read any text from “${fileName}”. If it is a scan, the schedule has to be typed in by hand — add your exam dates instead.`
      );
    }

    // The note is created BEFORE the model call on purpose: the document is
    // the student's and belongs in their set whatever the provider does next.
    const note = await this.data.notes.createNote(userId, {
      title: syllabusNoteTitle(fileName),
      body: text,
      studySetId: setId,
      // An existing, allowed `source_type` value — reusing it is what keeps
      // this feature to three nullable columns and no CHECK change.
      sourceType: 'import',
    });
    const noteId = String((note as { id?: unknown })?.id || '');
    if (!noteId) fail('The syllabus could not be filed in this set. Please try again.');

    let summary: SyllabusSummary | null = null;
    try {
      const { raw, provider } = await extractSyllabusSchedule(text);
      summary = normalizeSyllabusSummary(raw);
      logger.info('syllabus schedule extracted', {
        userId,
        setId,
        noteId,
        provider,
        weeks: summary?.weeks.length ?? 0,
        examDates: summary?.examDates.length ?? 0,
      });
    } catch (error) {
      // Every provider is down or exhausted. The note stays — the student's
      // document is filed — but no answer came back, so the route refunds and
      // the student can retry without having paid.
      logger.warn('syllabus schedule extraction failed', {
        userId,
        setId,
        noteId,
        error: error instanceof Error ? error.message : 'unknown',
      });
      throw new SyllabusGenerationFailedError();
    }

    // Only fill a date the set does not have. A date the student typed is
    // never overwritten by a document — that is the whole reason this reads
    // the set's current date rather than always writing.
    const today = input.today || todayDateOnlyLocal();
    const setRow = await getStudySetsService(this.data).get(userId, setId);
    const existingExam = typeof setRow.examDate === 'string' && setRow.examDate.trim()
      ? setRow.examDate.trim()
      : null;
    const suggested = existingExam ? null : suggestedExamDate(summary, today);

    const stored = await sets.setSyllabus(userId, setId, {
      noteId,
      summary,
      ...(suggested ? { examDate: suggested } : {}),
    });

    return {
      noteId,
      summary: stored.summary,
      foundLabel: syllabusFoundLabel(stored.summary),
      examDate: stored.examDate,
      examDateApplied: Boolean(suggested) && stored.examDate === suggested,
    };
  }

  /**
   * Unlink the syllabus — the card's Undo.
   *
   * Clears the columns and DELETES the note it created, because the student's
   * intent when they press Undo on "Found 12 weeks" is that the upload did not
   * happen. The exam date is deliberately left alone: by the time Undo is
   * pressed the student has seen the date and may have kept it on purpose, and
   * silently clearing a date they are counting on is the worse mistake.
   */
  async clear(userId: string, setId: string): Promise<void> {
    const sets = getStudySetsService(this.data);
    const current = await sets.getSyllabus(userId, setId);
    await sets.setSyllabus(userId, setId, { noteId: null, summary: null });
    if (current.noteId) {
      // The FK is ON DELETE SET NULL, so the column is already cleared above
      // and this cannot orphan the set. A note the student has since deleted
      // themselves is not an error.
      await this.data.notes.deleteNote(userId, current.noteId).catch(() => undefined);
    }
  }
}

let singleton: StudySetSyllabusService | null = null;

export function getStudySetSyllabusService(data: DataLayer): StudySetSyllabusService {
  if (!singleton) singleton = new StudySetSyllabusService(data);
  return singleton;
}

/** Test hook: drop the singleton so a fresh DataLayer is picked up. */
export function __resetStudySetSyllabusServiceForTests(): void {
  singleton = null;
}
