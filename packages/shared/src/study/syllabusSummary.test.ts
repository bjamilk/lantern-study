import {
  MAX_SYLLABUS_EXAM_DATES,
  MAX_SYLLABUS_TITLE_CHARS,
  MAX_SYLLABUS_WEEKS,
  isCalendarDate,
  normalizeSyllabusSummary,
  readSyllabusSummary,
  suggestedExamDate,
  syllabusFoundLabel,
} from './syllabusSummary';

const AT = '2026-09-18T10:00:00.000Z';

describe('isCalendarDate', () => {
  it('accepts a real day and refuses a well-formed non-day', () => {
    expect(isCalendarDate('2026-11-02')).toBe(true);
    // Both match the regex; neither is a date. This is the case a bare
    // /^\d{4}-\d{2}-\d{2}$/ lets through.
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
  });

  it('refuses prose, partial dates and non-strings', () => {
    for (const value of ['Week 3', 'TBD', '2026-11', '11/02/2026', '', null, undefined, 42]) {
      expect(isCalendarDate(value)).toBe(false);
    }
  });
});

describe('normalizeSyllabusSummary', () => {
  it('reads a well-formed schedule and folds exam weeks into examDates', () => {
    const summary = normalizeSyllabusSummary(
      {
        weeks: [
          { week: 1, title: 'Cell structure', date: '2026-09-21' },
          { week: 7, title: 'Midterm exam', date: '2026-10-30', examLabel: 'Midterm' },
        ],
        examDates: ['2026-12-11'],
      },
      AT
    );
    expect(summary).not.toBeNull();
    expect(summary!.weeks).toHaveLength(2);
    expect(summary!.weeks[0]).toEqual({
      week: 1,
      title: 'Cell structure',
      date: '2026-09-21',
      examLabel: null,
    });
    // The model's own list AND the flagged week, merged and sorted.
    expect(summary!.examDates).toEqual(['2026-10-30', '2026-12-11']);
    expect(summary!.extractedAt).toBe(AT);
  });

  it('accepts a bare array and the `schedule` / `topic` / `weekNumber` aliases', () => {
    expect(normalizeSyllabusSummary({ schedule: [{ weekNumber: '2', topic: 'Genetics' }] }, AT))
      .toMatchObject({ weeks: [{ week: 2, title: 'Genetics', date: null, examLabel: null }] });
  });

  it('is null for anything that is not an object carrying rows', () => {
    for (const raw of [null, undefined, 'weeks', 42, [], { weeks: 'none' }, { weeks: [] }]) {
      expect(normalizeSyllabusSummary(raw, AT)).toBeNull();
    }
  });

  // THE MALFORMED-OUTPUT CASE. `extractJSON` is tolerant, so this is exactly
  // the shape a real model failure hands the route: the right outer key, and
  // rubbish inside it.
  it('drops unusable rows rather than storing them, and is null when none survive', () => {
    expect(
      normalizeSyllabusSummary(
        {
          weeks: [
            'Week 1: intro',
            null,
            [],
            { week: 1 },
            { title: 'No week number' },
            { week: 0, title: 'Zero' },
            { week: -3, title: 'Negative' },
            { week: 999, title: 'Page number mistaken for a week' },
            { week: 2, title: '   ' },
          ],
        },
        AT
      )
    ).toBeNull();
  });

  it('keeps the good rows out of a mixed-rubbish answer', () => {
    const summary = normalizeSyllabusSummary(
      { weeks: ['junk', { week: 3, title: 'Enzymes' }, { week: 'x', title: 'Dropped' }] },
      AT
    );
    expect(summary!.weeks).toEqual([{ week: 3, title: 'Enzymes', date: null, examLabel: null }]);
  });

  it('nulls a date that is not a calendar day instead of passing it through', () => {
    const summary = normalizeSyllabusSummary(
      { weeks: [{ week: 1, title: 'Intro', date: 'Week of Sept 21' }], examDates: ['soon', 'TBD'] },
      AT
    );
    expect(summary!.weeks[0].date).toBeNull();
    expect(summary!.examDates).toEqual([]);
  });

  it('collapses whitespace and truncates a runaway title', () => {
    const summary = normalizeSyllabusSummary(
      { weeks: [{ week: 1, title: `Intro\n  to\tcells ${'x'.repeat(400)}` }] },
      AT
    );
    const title = summary!.weeks[0].title;
    expect(title.length).toBe(MAX_SYLLABUS_TITLE_CHARS);
    expect(title.startsWith('Intro to cells ')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
  });

  it('caps the week count and the exam-date count', () => {
    const weeks = Array.from({ length: 200 }, (_, i) => ({
      week: i + 1,
      title: `Week ${i + 1}`,
      date: null,
    }));
    const examDates = Array.from({ length: 40 }, (_, i) => `2026-${String((i % 12) + 1).padStart(2, '0')}-0${(i % 9) + 1}`);
    const summary = normalizeSyllabusSummary({ weeks, examDates }, AT)!;
    expect(summary.weeks.length).toBe(MAX_SYLLABUS_WEEKS);
    expect(summary.examDates.length).toBeLessThanOrEqual(MAX_SYLLABUS_EXAM_DATES);
  });

  it('keeps the first of a duplicated week and sorts by week number', () => {
    const summary = normalizeSyllabusSummary(
      {
        weeks: [
          { week: 3, title: 'Lecture' },
          { week: 3, title: 'Lab' },
          { week: 1, title: 'Intro' },
        ],
      },
      AT
    )!;
    expect(summary.weeks.map((w) => [w.week, w.title])).toEqual([
      [1, 'Intro'],
      [3, 'Lecture'],
    ]);
  });
});

describe('readSyllabusSummary', () => {
  it('re-normalises a stored row and preserves its extraction time', () => {
    const stored = { weeks: [{ week: 1, title: 'Intro', date: null, examLabel: null }, { week: 0, title: 'bad' }], examDates: [], extractedAt: AT };
    const read = readSyllabusSummary(stored)!;
    expect(read.weeks).toHaveLength(1);
    expect(read.extractedAt).toBe(AT);
  });

  it('is null for a row that never held a summary', () => {
    expect(readSyllabusSummary(null)).toBeNull();
    expect(readSyllabusSummary('{}')).toBeNull();
  });
});

describe('suggestedExamDate', () => {
  const summary = normalizeSyllabusSummary(
    { weeks: [{ week: 1, title: 'Intro' }], examDates: ['2026-10-30', '2026-12-11'] },
    AT
  );

  it('picks the nearest date still ahead, not the first one listed', () => {
    expect(suggestedExamDate(summary, '2026-09-18')).toBe('2026-10-30');
    expect(suggestedExamDate(summary, '2026-11-01')).toBe('2026-12-11');
  });

  it('is null when every date has passed, rather than back-dating the set', () => {
    expect(suggestedExamDate(summary, '2027-01-01')).toBeNull();
    expect(suggestedExamDate(null, '2026-09-18')).toBeNull();
  });
});

describe('syllabusFoundLabel', () => {
  it('spells singular and plural, and says so when there are no exam dates', () => {
    expect(
      syllabusFoundLabel(normalizeSyllabusSummary({ weeks: [{ week: 1, title: 'A' }] }, AT))
    ).toBe('Found 1 week · no exam dates');
    expect(
      syllabusFoundLabel(
        normalizeSyllabusSummary(
          { weeks: [{ week: 1, title: 'A' }, { week: 2, title: 'B' }], examDates: ['2026-10-30'] },
          AT
        )
      )
    ).toBe('Found 2 weeks · 1 exam date');
  });

  it('says nothing was found rather than printing zeroes', () => {
    expect(syllabusFoundLabel(null)).toBe('No schedule found in that file.');
  });
});
