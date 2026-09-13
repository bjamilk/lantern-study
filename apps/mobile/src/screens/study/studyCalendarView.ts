/**
 * What the study calendar screen renders, decided without a renderer.
 *
 * The screen used to gate the WHOLE month grid behind `plan` — the generated
 * schedule — so a set that already had a saved plan (topics, progress, an exam
 * date) but had never had a schedule generated opened on nothing but the setup
 * form: Edit outline / Exam date / Hours per week / Generate plan, and nothing
 * below the fold. A calendar screen that shows no calendar reads as broken, and
 * the exam date the student had already saved was invisible on it.
 *
 * The rule here is that the grid is unconditional. A calendar is a calendar
 * before it has sessions on it: with no schedule it still shows the month,
 * today, and the exam date as a chip. Setup does not replace the grid — it sits
 * in a compact card above it, and stays there once a schedule exists so the
 * outline, the date and the hours remain editable (that card owns `Generate
 * plan` / `Regenerate`).
 *
 * Pure on purpose so the three states can be tested without mounting anything.
 */

/** A date the grid marks for a reason other than a session. */
export interface CalendarChip {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Badge text, e.g. `EXAM`. */
  label: string;
  kind: 'exam';
  /** True when the date is already behind `today`, so the UI can mute it. */
  past: boolean;
}

/**
 * `sessions` — a generated schedule exists, so day cells carry session discs.
 * `exam-only` — no schedule yet; the grid still draws, carrying only chips.
 */
export type CalendarGridMode = 'sessions' | 'exam-only';

export interface CalendarView {
  /** Always true: setup is the only place to edit outline/date/hours. */
  showSetupCard: boolean;
  gridMode: CalendarGridMode;
  /** Deduped and date-sorted. */
  chips: CalendarChip[];
}

function isDateOnly(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export function calendarViewFor(input: {
  hasSchedule: boolean;
  examDates?: readonly (string | null | undefined)[] | null;
  today: string;
}): CalendarView {
  const seen = new Set<string>();
  const chips: CalendarChip[] = [];
  for (const raw of input.examDates ?? []) {
    if (!isDateOnly(raw)) continue;
    const date = raw.trim();
    if (seen.has(date)) continue;
    seen.add(date);
    chips.push({ date, label: 'EXAM', kind: 'exam', past: date < input.today });
  }
  chips.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return {
    showSetupCard: true,
    gridMode: input.hasSchedule ? 'sessions' : 'exam-only',
    chips,
  };
}
