/**
 * The syllabus schedule a set carries, and the one validator that writes it.
 *
 * WHAT THIS IS. A student uploads a syllabus (PDF or .docx) to a study set.
 * The server extracts its text and asks the model, ONCE, for the schedule:
 * which weeks cover what, and which dates are exams. That answer is stored on
 * `study_sets.syllabus_summary` and read back by the set room.
 *
 * WHY IT IS HERE AND NOT IN THE ROUTE. Three codebases need the same shape:
 * the API writes it, and web and mobile both render it. More importantly, the
 * value being normalised is MODEL OUTPUT — the one input in this feature that
 * nothing upstream has checked. `aiService.extractJSON` is deliberately
 * tolerant (it will dig a JSON object out of a fenced code block), so what it
 * hands back is `any` with no guarantees at all: a week can be a string, the
 * whole `weeks` key can be missing, a title can be 40 KB of the model
 * restating the syllabus, and a date can be "Week 3" or "sometime in May".
 * Every one of those has to become either a sound value or nothing, and
 * "nothing" has to be distinguishable from "the model answered but found no
 * schedule" — which is a real, honest outcome for a one-page course outline.
 *
 * THE CAPS ARE THE POINT. This row is fetched with every set list. An
 * unbounded JSONB column filled from model output is a way to make a student's
 * set list slow forever with one bad upload, and no later reader can undo it.
 * So the caps are applied HERE, on the way in, not at render time:
 *   - 60 weeks (the SQL CHECK repeats this one, as the second wall)
 *   - 120 characters per title, 40 per exam label
 *   - 12 exam dates
 * A summary that overflows is TRUNCATED rather than rejected: a 62-week
 * document is a real syllabus, and losing its last two rows is a better answer
 * to the student than losing all 62.
 *
 * DATES. Only `YYYY-MM-DD` survives. The model is asked for that format and
 * mostly obliges, but "Week 3" and "TBD" arrive too, and a date that is not a
 * calendar day is worse than no date: it would be shown to a student as if it
 * were one, and `exam_date` is what the countdown and the reminders read.
 * There is no parsing of prose dates here on purpose — guessing whether
 * "3/4" is March 4th or April 3rd is exactly the kind of quiet wrongness this
 * whole file exists to keep out of the column.
 */

/** The hand-applied migration that adds the syllabus columns AND `exam_date`. */
export const STUDY_SET_SYLLABUS_MIGRATION = '20260918150000_study_set_syllabus_exam.sql';

/**
 * The one sentence a client may show when the columns are not there yet.
 * Present tense, no error code, and it names what the student was doing.
 */
export const SYLLABUS_UNSUPPORTED_MESSAGE =
  'Syllabus upload needs a server update — try again later';

/** What the file picker offers, and what the server enforces. Kept in step. */
export const SYLLABUS_ACCEPT = '.pdf,.docx';

/**
 * 25 MB — the same ceiling `assertPdfSize` and `assertDocumentSize` already
 * enforce for every other document in the app. Spelt here so the number under
 * the button is the number the server refuses at.
 */
export const MAX_SYLLABUS_BYTES = 25 * 1024 * 1024;

/** Caps. See the header: these are applied on the way IN, once. */
export const MAX_SYLLABUS_WEEKS = 60;
export const MAX_SYLLABUS_EXAM_DATES = 12;
export const MAX_SYLLABUS_TITLE_CHARS = 120;
export const MAX_SYLLABUS_EXAM_LABEL_CHARS = 40;

/** One row of the schedule. */
export interface SyllabusWeek {
  /** 1-based week number. Always present: a row the model gave no number to is dropped. */
  week: number;
  /** What that week covers, trimmed and capped. Never empty. */
  title: string;
  /** `YYYY-MM-DD`, or null when the syllabus gave none in a usable form. */
  date: string | null;
  /** "Midterm", "Final" — set only when this week IS an exam. */
  examLabel: string | null;
}

export interface SyllabusSummary {
  weeks: SyllabusWeek[];
  /** Every calendar date the syllabus named as an exam, ascending, deduped. */
  examDates: string[];
  /** When the extraction ran, ISO. */
  extractedAt: string;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a calendar day the rest of the app can use?
 *
 * The regex is not enough on its own: `2026-02-31` and `2026-13-01` both match
 * it and neither is a day. Round-tripping through `Date` catches both, and
 * `T00:00:00Z` keeps the check in UTC so a machine west of Greenwich does not
 * decide that a valid date is the day before.
 */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.toISOString().slice(0, 10) === value;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  // Collapse whitespace first: model output arrives with newlines in titles,
  // and a title that wraps mid-word in a 180px card is the visible symptom.
  const next = value.replace(/\s+/g, ' ').trim();
  if (!next) return null;
  return next.length > max ? `${next.slice(0, max - 1).trimEnd()}…` : next;
}

function cleanWeekNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const week = Math.trunc(n);
  // 0 and negatives are the model mis-reading a heading; above the cap is
  // either a page number it mistook for a week, or a document this feature is
  // not for.
  if (week < 1 || week > MAX_SYLLABUS_WEEKS) return null;
  return week;
}

/**
 * Turn whatever the model returned into a summary, or null.
 *
 * `null` means "there is no schedule here" and is a legitimate answer the
 * caller must handle — it is NOT an error. An empty `weeks` list is never
 * stored: a summary with nothing in it would light the "syllabus added" state
 * in both clients over a row that tells the student nothing, which is the
 * dead-door pattern this codebase keeps finding and deleting.
 */
export function normalizeSyllabusSummary(
  raw: unknown,
  extractedAt: string = new Date().toISOString()
): SyllabusSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  // The model is asked for `{ weeks: [...] }` but sometimes answers with the
  // bare array. Both are accepted; nothing else is.
  const rawWeeks = Array.isArray(record.weeks)
    ? record.weeks
    : Array.isArray(record.schedule)
      ? record.schedule
      : null;
  if (!rawWeeks) return null;

  const weeks: SyllabusWeek[] = [];
  const seenWeeks = new Set<number>();
  for (const entry of rawWeeks) {
    if (weeks.length >= MAX_SYLLABUS_WEEKS) break;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    const week = cleanWeekNumber(row.week ?? row.weekNumber);
    const title = cleanText(row.title ?? row.topic, MAX_SYLLABUS_TITLE_CHARS);
    // A row needs BOTH to be worth a line in the UI. A week with no title is a
    // blank row; a title with no week cannot be ordered against the others.
    if (week === null || !title) continue;
    // Models repeat rows when a syllabus lists a week twice (lecture + lab).
    // First one wins, so the order the document gave is preserved.
    if (seenWeeks.has(week)) continue;
    seenWeeks.add(week);
    const examLabel = cleanText(row.examLabel ?? row.exam, MAX_SYLLABUS_EXAM_LABEL_CHARS);
    weeks.push({
      week,
      title,
      date: isCalendarDate(row.date) ? row.date : null,
      examLabel: examLabel ?? null,
    });
  }
  if (weeks.length === 0) return null;
  weeks.sort((a, b) => a.week - b.week);

  // Exam dates come from two places — the model's own `examDates` list and any
  // week it flagged as an exam. Both are folded together, because a syllabus
  // that says "Week 7: Midterm (Oct 14)" populates one or the other depending
  // on how the model reads it, and a student should not get a different answer
  // for the same document.
  const examDates = new Set<string>();
  const rawExamDates = Array.isArray(record.examDates) ? record.examDates : [];
  for (const value of rawExamDates) {
    if (isCalendarDate(value)) examDates.add(value);
  }
  for (const row of weeks) {
    if (row.examLabel && row.date) examDates.add(row.date);
  }

  return {
    weeks,
    examDates: [...examDates].sort().slice(0, MAX_SYLLABUS_EXAM_DATES),
    extractedAt:
      typeof extractedAt === 'string' && extractedAt ? extractedAt : new Date().toISOString(),
  };
}

/**
 * Read a summary back off a stored row.
 *
 * Re-normalised rather than trusted: the column can hold anything written
 * before a cap changed, or by hand, and the SQL CHECK only guarantees the
 * outer shape. `extractedAt` is preserved when the stored row has one, so a
 * re-read does not keep restamping the extraction time.
 */
export function readSyllabusSummary(raw: unknown): SyllabusSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const stored = (raw as Record<string, unknown>).extractedAt;
  return normalizeSyllabusSummary(
    raw,
    typeof stored === 'string' && stored ? stored : new Date().toISOString()
  );
}

/**
 * The exam date a freshly-read syllabus should put on the set.
 *
 * The NEAREST one that has not already passed — a syllabus names the midterm
 * and the final, and the date a student needs on the set header in week 3 is
 * the midterm. A syllabus whose every date is behind `today` (last year's
 * document, or an upload after the final) yields null rather than back-dating
 * the set: a countdown reading "-40 days" is worse than no countdown.
 *
 * The caller decides whether to APPLY it — the rule in the route is "only if
 * the set has no date yet", so a date the student typed is never overwritten
 * by a document.
 */
export function suggestedExamDate(
  summary: SyllabusSummary | null,
  today: string
): string | null {
  if (!summary) return null;
  for (const date of summary.examDates) {
    if (date >= today) return date;
  }
  return null;
}

/**
 * "Found 12 weeks · 2 exam dates" — the one line shown after an upload.
 *
 * Singular and plural both spelt out: "1 weeks" is the kind of detail that
 * makes a screen read as unfinished. A summary with no exam dates says so
 * rather than printing "0 exam dates", because the student's next question is
 * "so should I add one?" and the card's Exam dates block answers it.
 */
export function syllabusFoundLabel(summary: SyllabusSummary | null): string {
  if (!summary || summary.weeks.length === 0) return 'No schedule found in that file.';
  const weeks = `Found ${summary.weeks.length} ${summary.weeks.length === 1 ? 'week' : 'weeks'}`;
  if (summary.examDates.length === 0) return `${weeks} · no exam dates`;
  const count = summary.examDates.length;
  return `${weeks} · ${count} exam ${count === 1 ? 'date' : 'dates'}`;
}
