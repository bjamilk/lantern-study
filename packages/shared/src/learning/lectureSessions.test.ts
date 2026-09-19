import {
  filterLectures,
  formatLectureRowStamp,
  groupLecturesByDay,
  lectureDayLabel,
} from './lectureSessions';

const NOW = new Date(2026, 8, 18, 18, 31); // 18 Sep 2026, local

describe('lecture list grouping', () => {
  it('names today, yesterday and an older weekday', () => {
    expect(lectureDayLabel(new Date(2026, 8, 18, 9, 0), NOW)).toBe('Today');
    expect(lectureDayLabel(new Date(2026, 8, 17, 23, 59), NOW)).toBe('Yesterday');
    expect(lectureDayLabel(new Date(2026, 8, 13, 9, 0), NOW)).toBe('Sunday, 13 Sep 2026');
  });

  it('groups newest day first and newest row first inside a day', () => {
    const groups = groupLecturesByDay(
      [
        { id: 'a', title: 'Old', createdAt: new Date(2026, 8, 13, 9, 0).toISOString() },
        { id: 'b', title: 'Morning', createdAt: new Date(2026, 8, 18, 9, 0).toISOString() },
        { id: 'c', title: 'Evening', createdAt: new Date(2026, 8, 18, 18, 0).toISOString() },
      ],
      NOW
    );
    expect(groups.map((group) => group.label)).toEqual(['Today', 'Sunday, 13 Sep 2026']);
    expect(groups[0].rows.map((row) => row.id)).toEqual(['c', 'b']);
  });

  it('keeps a dateless lecture rather than dropping it', () => {
    const groups = groupLecturesByDay([{ id: 'x', title: 'No date' }], NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Earlier');
  });

  it('stamps a row as d MMM yyyy, HH:mm', () => {
    expect(formatLectureRowStamp(new Date(2026, 8, 18, 6, 5).toISOString())).toBe(
      '18 Sep 2026, 06:05'
    );
    expect(formatLectureRowStamp(null)).toBe('');
  });

  it('searches by title, case-insensitively', () => {
    const rows = [
      { id: 'a', title: 'Organic chemistry' },
      { id: 'b', title: 'Linear algebra' },
    ];
    expect(filterLectures(rows, 'ALGEB').map((row) => row.id)).toEqual(['b']);
    expect(filterLectures(rows, '  ')).toHaveLength(2);
  });
});
