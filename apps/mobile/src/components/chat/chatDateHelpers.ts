/**
 * A message timestamp as any of the shapes the chat stores hand back: an ISO
 * string, epoch millis, a `Date`, or `null` for a row whose time never landed.
 */
export type ChatTimestamp = string | number | Date | null | undefined;

export function formatChatDateLabel(isoDate: ChatTimestamp): string {
  // `new Date(null)` is the epoch, not an error — guard the empty cases before
  // they format as "Thu 1 Jan 1970".
  if (isoDate == null) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMessageDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (startOfToday.getTime() - startOfMessageDay.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export function isDifferentChatDay(a: ChatTimestamp, b: ChatTimestamp): boolean {
  if (a == null || b == null) return true;
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return true;
  return (
    da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate()
  );
}

/**
 * Pure planner over a message list in DISPLAY order (oldest → newest). Returns a
 * parallel array whose entry `i` is the day-separator label to render ABOVE
 * message `i`, or `null` when message `i` sits on the same calendar day as
 * message `i - 1`.
 *
 * The first message always carries its day's label, so a thread never opens
 * with clock times and no date — the bug that made a DM read 3:56 PM → 4:32 PM
 * → 2:17 PM → 5:01 AM as if it ran backwards, when those times actually sat on
 * three different days. A timestamp that cannot be parsed yields no separator
 * (and never throws), so one bad row cannot break the run.
 */
export function planDateSeparators(
  timestamps: readonly ChatTimestamp[]
): (string | null)[] {
  return timestamps.map((current, index) => {
    if (index === 0) return formatChatDateLabel(current) || null;
    return isDifferentChatDay(timestamps[index - 1], current)
      ? formatChatDateLabel(current) || null
      : null;
  });
}

export function getQuestionTypeLabel(type?: string): string {
  switch (type) {
    case 'MULTIPLE_CHOICE_SINGLE':
      return 'Multiple Choice';
    case 'MULTIPLE_CHOICE_MULTIPLE':
      return 'Multi-Select';
    case 'TRUE_FALSE':
      return 'True / False';
    case 'FILL_IN_THE_BLANK':
      return 'Fill in the Blank';
    case 'MATCHING':
      return 'Matching';
    case 'DIAGRAM_LABELING':
      return 'Diagram';
    default:
      return 'Question';
  }
}
