import { calendarViewFor } from './studyCalendarView';

const TODAY = '2026-09-13';

describe('calendarViewFor', () => {
  it('draws the grid with an exam chip when a set has a date but no schedule', () => {
    const view = calendarViewFor({
      hasSchedule: false,
      examDates: ['2026-11-20'],
      today: TODAY,
    });
    expect(view.gridMode).toBe('exam-only');
    expect(view.showSetupCard).toBe(true);
    expect(view.chips).toEqual([{ date: '2026-11-20', label: 'EXAM', kind: 'exam', past: false }]);
  });

  it('switches the grid to sessions once a schedule exists, keeping setup available', () => {
    const view = calendarViewFor({
      hasSchedule: true,
      examDates: ['2026-11-20'],
      today: TODAY,
    });
    expect(view.gridMode).toBe('sessions');
    expect(view.showSetupCard).toBe(true);
    expect(view.chips).toHaveLength(1);
  });

  it('still draws the grid with no exam and no schedule', () => {
    const view = calendarViewFor({
      hasSchedule: false,
      examDates: [],
      today: TODAY,
    });
    expect(view.gridMode).toBe('exam-only');
    expect(view.showSetupCard).toBe(true);
    expect(view.chips).toEqual([]);
    expect(calendarViewFor({ hasSchedule: false, today: TODAY }).chips).toEqual([]);
  });

  it('drops junk dates, dedupes, sorts, and marks a past exam', () => {
    const view = calendarViewFor({
      hasSchedule: false,
      examDates: ['2026-11-20', null, '', 'soon', undefined, '2026-11-20', '2026-01-04'],
      today: TODAY,
    });
    expect(view.chips.map((chip) => chip.date)).toEqual(['2026-01-04', '2026-11-20']);
    expect(view.chips[0]!.past).toBe(true);
    expect(view.chips[1]!.past).toBe(false);
  });
});
