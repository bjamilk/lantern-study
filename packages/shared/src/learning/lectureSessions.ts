/**
 * The lectures LIST: how its rows are grouped and stamped.
 *
 * The reference's sessions list is one column of rows under day headings —
 * "Today", "Sunday, Sep 13" — rather than a grid of cards, and that is what the
 * founder asked for: a lecture is an EVENT, and events read as a diary. A card
 * grid sorts by nothing a student remembers; "which Tuesday was that" is the
 * question this page exists to answer.
 *
 * Pure, so the web list and the phone's list group identically and the grouping
 * can be tested without rendering anything. `now` is injected for the same
 * reason: a test that depends on the machine clock is a test that fails at
 * midnight (see the quest-date fix in #150).
 */

export interface LectureListRow {
  id: string;
  title: string;
  /** ISO timestamp. A row with no date sorts last, under "Earlier". */
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LectureListGroup<T extends LectureListRow = LectureListRow> {
  /** Stable key: the local calendar day, or `unknown`. */
  key: string;
  label: string;
  rows: T[];
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** `18 Sep 2026, 18:31` — the caption under a row's title. */
export function formatLectureRowStamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${hours}:${minutes}`;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

/** "Today" / "Yesterday" / "Sunday, 13 Sep 2026". */
export function lectureDayLabel(date: Date, now: Date): string {
  const key = dayKey(date);
  if (key === dayKey(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === dayKey(yesterday)) return 'Yesterday';
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** The date a row is filed under: when it was recorded, else when it changed. */
export function lectureRowDate(row: LectureListRow): Date | null {
  const raw = row.createdAt || row.updatedAt || null;
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Newest day first, newest row first within a day.
 *
 * A row with no usable date is not dropped — a lecture the student can see in
 * the room must be reachable from the list — it is grouped under "Earlier",
 * last.
 */
export function groupLecturesByDay<T extends LectureListRow>(
  rows: readonly T[],
  now: Date = new Date()
): LectureListGroup<T>[] {
  const groups = new Map<string, { at: number; label: string; rows: T[] }>();
  for (const row of rows ?? []) {
    const date = lectureRowDate(row);
    const key = date ? dayKey(date) : 'unknown';
    const label = date ? lectureDayLabel(date, now) : 'Earlier';
    const at = date ? date.getTime() : -Infinity;
    const group = groups.get(key);
    if (group) {
      group.rows.push(row);
      group.at = Math.max(group.at, at);
    } else {
      groups.set(key, { at, label, rows: [row] });
    }
  }
  return [...groups.entries()]
    .sort((a, b) => b[1].at - a[1].at)
    .map(([key, group]) => ({
      key,
      label: group.label,
      rows: [...group.rows].sort(
        (a, b) => (lectureRowDate(b)?.getTime() ?? 0) - (lectureRowDate(a)?.getTime() ?? 0)
      ),
    }));
}

/** Case-insensitive title search. An empty query returns everything. */
export function filterLectures<T extends LectureListRow>(
  rows: readonly T[],
  query: string
): T[] {
  const needle = (query ?? '').trim().toLowerCase();
  if (!needle) return [...(rows ?? [])];
  return (rows ?? []).filter((row) => (row.title ?? '').toLowerCase().includes(needle));
}
