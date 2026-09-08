import { formatNoteUpdatedLabel } from './notesFormat';

describe('formatNoteUpdatedLabel', () => {
  it('renders a day/month/year, never M/D/YYYY', () => {
    const out = formatNoteUpdatedLabel('2026-09-07T13:24:00.000Z');
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/^\d{1,2}\/\d{1,2}\/\d{4}$/);
    expect(out).toContain('2026');
  });

  it('accepts a Date instance', () => {
    const out = formatNoteUpdatedLabel(new Date(2026, 8, 7));
    expect(out).toContain('2026');
    expect(out).toContain('7');
  });

  it('returns null for a missing stamp so the line hides', () => {
    expect(formatNoteUpdatedLabel(null)).toBeNull();
    expect(formatNoteUpdatedLabel(undefined)).toBeNull();
    expect(formatNoteUpdatedLabel('')).toBeNull();
  });

  it('returns null for an unparseable stamp instead of "Invalid Date"', () => {
    expect(formatNoteUpdatedLabel('not a date')).toBeNull();
  });
});
