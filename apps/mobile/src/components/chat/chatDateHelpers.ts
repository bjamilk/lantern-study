export function formatChatDateLabel(isoDate: string): string {
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

export function isDifferentChatDay(a: string, b: string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return true;
  return (
    da.getFullYear() !== db.getFullYear() ||
    da.getMonth() !== db.getMonth() ||
    da.getDate() !== db.getDate()
  );
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
