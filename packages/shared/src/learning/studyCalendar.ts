/**
 * Study calendar — Wave G of the academic replica.
 *
 * The Plan tab is the visible week: exam date + outline topics + hours become
 * sessions that open cards or quiz. Generation is local and free (exam
 * reminders already fire from `user_courses.exam_date` — this does not replace
 * them). Persist on a course note with a fence, same as lecture / lesson /
 * recap — no study_sessions table. Hide the note from Materials.
 */
import type { FeatureKey } from '../design';
import { parseDateOnlyLocal, toDateOnlyLocal, todayDateOnlyLocal } from '../utils/dateOnly';
import { formatDisplayDate } from '../utils/displayDate';
import { hasEnoughNoteStudyContent } from '../utils/noteStudyContent';

export type CalendarSessionKind = 'cards' | 'quiz';
export type CalendarSessionStatus = 'planned' | 'accepted' | 'done';

export const CALENDAR_FENCE = 'lantern-calendar';

export const CALENDAR_HOURS_CHOICES = [4, 7, 10] as const;
export const DEFAULT_HOURS_PER_WEEK = 7;
export const SESSION_HARD_CAP = 40;
export const SESSIONS_PER_WEEK_CAP = 5;
export const SESSION_MINUTES_MIN = 25;
export const SESSION_MINUTES_MAX = 90;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface StudyCalendarSession {
  id: string;
  /** Local calendar day `yyyy-mm-dd`. */
  date: string;
  topicId: string | null;
  topicTitle: string;
  kind: CalendarSessionKind;
  /** Deck id for cards, note id for quiz. Null = course-level quiz. */
  targetId: string | null;
  minutes: number;
  status: CalendarSessionStatus;
}

export interface StudyCalendarPlan {
  examDate: string;
  hoursPerWeek: number;
  sessions: StudyCalendarSession[];
  acceptedAt: string | null;
}

export type StudyCalendarBlocker = 'no_exam' | 'exam_passed' | 'no_topics';

export interface CalendarTopic {
  id: string;
  title: string;
}

export interface CalendarDeck {
  id: string;
  name: string;
  topicId?: string | null;
}

export interface CalendarNote {
  id: string;
  title?: string | null;
  body?: string | null;
  sourceType?: string | null;
  topicId?: string | null;
}

export interface CalendarMonthCell {
  date: string | null;
  inMonth: boolean;
}

export function newCalendarNoteTitle(courseLabel: string): string {
  const label = courseLabel.trim() || 'this course';
  return `Plan — ${label}`;
}

export function isCalendarNote(note: { title?: string | null; body?: string | null }): boolean {
  if (/^Plan — /.test(note.title ?? '')) return true;
  return (note.body ?? '').includes(CALENDAR_FENCE);
}

function isOtherStudioNote(note: { title?: string | null; body?: string | null }): boolean {
  const title = note.title ?? '';
  const body = note.body ?? '';
  if (/^Lesson — /.test(title) || body.includes('lantern-lesson')) return true;
  if (/^Recap — /.test(title) || body.includes('lantern-recap')) return true;
  return false;
}

/** Notes a quiz session can deep-link to. Studio notes are not study material. */
export function calendarQuizNotes<T extends CalendarNote>(notes: readonly T[]): T[] {
  return notes.filter(
    (note) =>
      !isCalendarNote(note) &&
      !isOtherStudioNote(note) &&
      hasEnoughNoteStudyContent({
        ...note,
        body: note.body ?? undefined,
        sourceType: note.sourceType ?? undefined,
      })
  );
}

export function clampHoursPerWeek(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_HOURS_PER_WEEK;
  return Math.min(20, Math.max(1, Math.round(value)));
}

export function sessionsPerWeek(hoursPerWeek: number): number {
  const hours = clampHoursPerWeek(hoursPerWeek);
  return Math.min(SESSIONS_PER_WEEK_CAP, Math.max(2, Math.round(hours / 1.5)));
}

export function sessionMinutesForHours(hoursPerWeek: number): number {
  const hours = clampHoursPerWeek(hoursPerWeek);
  const perWeek = sessionsPerWeek(hours);
  return Math.min(
    SESSION_MINUTES_MAX,
    Math.max(SESSION_MINUTES_MIN, Math.round((hours * 60) / perWeek))
  );
}

export function calendarKindLabel(kind: CalendarSessionKind): string {
  return kind === 'cards' ? 'Cards' : 'Quiz';
}

export function calendarSessionFeature(kind: CalendarSessionKind): FeatureKey {
  return kind === 'cards' ? 'flashcards' : 'tests';
}

export function studyCalendarBlocker(input: {
  examDate?: string | null;
  today?: string;
  topics: readonly unknown[];
}): StudyCalendarBlocker | null {
  const exam = (input.examDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exam)) return 'no_exam';
  const today = input.today || todayDateOnlyLocal();
  if (exam < today) return 'exam_passed';
  if (input.topics.length === 0) return 'no_topics';
  return null;
}

export function calendarExamChanged(plan: StudyCalendarPlan, examDate: string | null | undefined): boolean {
  const exam = (examDate ?? '').trim();
  return Boolean(exam) && exam !== plan.examDate;
}

function addDaysDateOnly(date: string, days: number): string {
  const next = parseDateOnlyLocal(date);
  next.setDate(next.getDate() + days);
  return toDateOnlyLocal(next);
}

function weekdayMon0(date: string): number {
  return (parseDateOnlyLocal(date).getDay() + 6) % 7;
}

function pickEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return [...items];
  const chosen = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    let idx =
      count === 1 ? 0 : Math.round((i * (items.length - 1)) / Math.max(1, count - 1));
    while (chosen.has(idx) && chosen.size < items.length) {
      idx = (idx + 1) % items.length;
    }
    chosen.add(idx);
  }
  return [...chosen]
    .sort((a, b) => a - b)
    .map((idx) => items[idx])
    .filter((row): row is T => row != null);
}

function studyDates(today: string, examDate: string, targetCount: number): string[] {
  const last = addDaysDateOnly(examDate, -1);
  const start = today <= last ? today : examDate;
  if (last < start) return [start];

  const spanDays = Math.max(
    1,
    Math.round(
      (parseDateOnlyLocal(examDate).getTime() - parseDateOnlyLocal(start).getTime()) / 86400000
    )
  );
  const includeWeekends = spanDays <= 10;
  const candidates: string[] = [];
  for (let cursor = start; cursor <= last; cursor = addDaysDateOnly(cursor, 1)) {
    const weekday = weekdayMon0(cursor);
    if (includeWeekends || weekday <= 4) candidates.push(cursor);
  }
  if (candidates.length === 0) return [start];
  return pickEvenly(candidates, Math.min(SESSION_HARD_CAP, Math.max(1, targetCount)));
}

function pickDeck(topicId: string | null, decks: readonly CalendarDeck[]): CalendarDeck | null {
  if (topicId) {
    const matched = decks.find((deck) => deck.topicId === topicId);
    if (matched) return matched;
  }
  return decks[0] ?? null;
}

function pickNote(topicId: string | null, notes: readonly CalendarNote[]): CalendarNote | null {
  const quizzable = calendarQuizNotes(notes);
  if (topicId) {
    const matched = quizzable.find((note) => note.topicId === topicId);
    if (matched) return matched;
  }
  return quizzable[0] ?? null;
}

function sessionKindFor(
  index: number,
  topicId: string | null,
  decks: readonly CalendarDeck[],
  notes: readonly CalendarNote[]
): CalendarSessionKind {
  const deck = pickDeck(topicId, decks);
  const note = pickNote(topicId, notes);
  if (deck && note) return index % 2 === 0 ? 'cards' : 'quiz';
  if (deck) return 'cards';
  return 'quiz';
}

export function generateStudyCalendar(input: {
  today?: string;
  examDate: string;
  hoursPerWeek?: number;
  topics: readonly CalendarTopic[];
  decks?: readonly CalendarDeck[];
  notes?: readonly CalendarNote[];
}): { ok: true; plan: StudyCalendarPlan } | { ok: false; reason: StudyCalendarBlocker } {
  const today = input.today || todayDateOnlyLocal();
  const hoursPerWeek = clampHoursPerWeek(input.hoursPerWeek ?? DEFAULT_HOURS_PER_WEEK);
  const reason = studyCalendarBlocker({
    examDate: input.examDate,
    today,
    topics: input.topics,
  });
  if (reason) return { ok: false, reason };
  const topics = input.topics.filter((topic) => topic.id && topic.title.trim());
  if (topics.length === 0) return { ok: false, reason: 'no_topics' };

  const decks = input.decks ?? [];
  const notes = input.notes ?? [];
  const examDate = input.examDate.trim();
  const spanDays = Math.max(
    1,
    Math.round(
      (parseDateOnlyLocal(examDate).getTime() - parseDateOnlyLocal(today).getTime()) / 86400000
    )
  );
  const weeks = Math.max(1, spanDays / 7);
  const targetCount = Math.min(
    SESSION_HARD_CAP,
    Math.max(topics.length, Math.round(sessionsPerWeek(hoursPerWeek) * weeks))
  );
  const dates = studyDates(today, examDate, targetCount);
  const minutes = sessionMinutesForHours(hoursPerWeek);
  const sessions: StudyCalendarSession[] = dates.map((date, index) => {
    const topic = topics[index % topics.length]!;
    const kind = sessionKindFor(index, topic.id, decks, notes);
    const deck = kind === 'cards' ? pickDeck(topic.id, decks) : null;
    const note = kind === 'quiz' ? pickNote(topic.id, notes) : null;
    return {
      id: `cal-${date}-${topic.id}-${kind}`,
      date,
      topicId: topic.id,
      topicTitle: topic.title.trim(),
      kind,
      targetId: kind === 'cards' ? deck?.id ?? null : note?.id ?? null,
      minutes,
      status: 'planned',
    };
  });

  return {
    ok: true,
    plan: {
      examDate,
      hoursPerWeek,
      sessions,
      acceptedAt: null,
    },
  };
}

export function acceptStudyCalendar(plan: StudyCalendarPlan, acceptedAt?: string): StudyCalendarPlan {
  return {
    ...plan,
    acceptedAt: acceptedAt || new Date().toISOString(),
    sessions: plan.sessions.map((session) =>
      session.status === 'planned' ? { ...session, status: 'accepted' } : session
    ),
  };
}

export function markCalendarSessionDone(plan: StudyCalendarPlan, sessionId: string): StudyCalendarPlan {
  return {
    ...plan,
    sessions: plan.sessions.map((session) =>
      session.id === sessionId ? { ...session, status: 'done' } : session
    ),
  };
}

export function sessionsOnDate(
  plan: StudyCalendarPlan | null | undefined,
  date: string
): StudyCalendarSession[] {
  if (!plan) return [];
  return plan.sessions.filter((session) => session.date === date);
}

export function calendarMonthTitle(year: number, monthIndex: number): string {
  const stamp = toDateOnlyLocal(new Date(year, monthIndex, 1));
  return formatDisplayDate(stamp).replace(/^\d+\s/, '');
}

/** Six-week Monday-start grid for one local month. */
export function calendarMonthGrid(year: number, monthIndex: number): CalendarMonthCell[] {
  const first = new Date(year, monthIndex, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells: CalendarMonthCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = i - startOffset + 1;
    if (day < 1 || day > daysInMonth) {
      cells.push({ date: null, inMonth: false });
    } else {
      cells.push({
        date: toDateOnlyLocal(new Date(year, monthIndex, day)),
        inMonth: true,
      });
    }
  }
  return cells;
}

export function composeCalendarNoteBody(plan: StudyCalendarPlan): string {
  const snapshot = {
    examDate: plan.examDate,
    hoursPerWeek: plan.hoursPerWeek,
    sessions: plan.sessions,
    acceptedAt: plan.acceptedAt,
  };
  return `Study calendar · exam ${plan.examDate}\n\n\`\`\`${CALENDAR_FENCE}\n${JSON.stringify(snapshot)}\n\`\`\`\n`;
}

function isSessionKind(value: unknown): value is CalendarSessionKind {
  return value === 'cards' || value === 'quiz';
}

function isSessionStatus(value: unknown): value is CalendarSessionStatus {
  return value === 'planned' || value === 'accepted' || value === 'done';
}

export function parseCalendarNoteBody(body: string | null | undefined): StudyCalendarPlan | null {
  if (!body) return null;
  const fenced = body.match(new RegExp('```' + CALENDAR_FENCE + '\\s*([\\s\\S]*?)```'));
  const raw = fenced?.[1]?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StudyCalendarPlan>;
    if (typeof parsed.examDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.examDate)) {
      return null;
    }
    if (!Array.isArray(parsed.sessions)) return null;
    const sessions = parsed.sessions.filter((row): row is StudyCalendarSession => {
      if (!row || typeof row !== 'object') return false;
      return (
        typeof row.id === 'string' &&
        typeof row.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
        (row.topicId === null || typeof row.topicId === 'string') &&
        typeof row.topicTitle === 'string' &&
        isSessionKind(row.kind) &&
        (row.targetId === null || typeof row.targetId === 'string') &&
        typeof row.minutes === 'number' &&
        isSessionStatus(row.status)
      );
    });
    return {
      examDate: parsed.examDate,
      hoursPerWeek: clampHoursPerWeek(Number(parsed.hoursPerWeek) || DEFAULT_HOURS_PER_WEEK),
      sessions,
      acceptedAt: typeof parsed.acceptedAt === 'string' ? parsed.acceptedAt : null,
    };
  } catch {
    return null;
  }
}

export type CalendarStudioDecision = { action: 'resume'; noteId: string } | { action: 'start' };

export function resolveCalendarStudioNote(input: {
  calendars: readonly { id: string }[];
  selectedNoteId?: string | null;
}): CalendarStudioDecision {
  if (input.selectedNoteId && input.calendars.some((row) => row.id === input.selectedNoteId)) {
    return { action: 'resume', noteId: input.selectedNoteId };
  }
  const first = input.calendars[0];
  if (first) return { action: 'resume', noteId: first.id };
  return { action: 'start' };
}
