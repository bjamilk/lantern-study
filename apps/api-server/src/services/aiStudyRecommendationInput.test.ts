import {
  STUDY_DAYS_WEEK_MAX,
  normalizeStudyPerformanceData,
} from './aiStudyRecommendationInput';

const scores = [{ topic: 'Anatomy', score: 42, date: '2026-08-22' }];

describe('normalizeStudyPerformanceData', () => {
  it('rejects a missing / non-object body', () => {
    expect(normalizeStudyPerformanceData(undefined)).toEqual({ ok: false, error: 'Performance data required.' });
    expect(normalizeStudyPerformanceData('nope').ok).toBe(false);
    expect(normalizeStudyPerformanceData([]).ok).toBe(false);
  });

  it('accepts the new contract and keeps studyDaysThisWeek', () => {
    const result = normalizeStudyPerformanceData({
      recentScores: scores,
      flashcardAccuracy: [{ topic: 'Deck A', correctRate: 0.25 }],
      studyDaysThisWeek: 4,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        recentScores: scores,
        flashcardAccuracy: [{ topic: 'Deck A', correctRate: 0.25 }],
        studyDaysThisWeek: 4,
      },
    });
  });

  it('accepts the legacy studyHoursThisWeek (old builds sent their day streak) and caps it at 7', () => {
    const result = normalizeStudyPerformanceData({ recentScores: scores, flashcardAccuracy: [], studyHoursThisWeek: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.studyDaysThisWeek).toBe(STUDY_DAYS_WEEK_MAX);
    expect('studyHoursThisWeek' in result.data).toBe(false);
  });

  it('prefers studyDaysThisWeek when both names are present', () => {
    const result = normalizeStudyPerformanceData({ recentScores: scores, studyDaysThisWeek: 2, studyHoursThisWeek: 6 });
    expect(result.ok && result.data.studyDaysThisWeek).toBe(2);
  });

  it('requires one of the day fields', () => {
    const result = normalizeStudyPerformanceData({ recentScores: scores });
    expect(result).toEqual({ ok: false, error: 'performanceData.studyDaysThisWeek is required.' });
  });

  it('omits flashcardAccuracy when absent or empty instead of inventing one', () => {
    for (const body of [
      { recentScores: scores, studyDaysThisWeek: 1 },
      { recentScores: scores, studyDaysThisWeek: 1, flashcardAccuracy: [] },
      { recentScores: scores, studyDaysThisWeek: 1, flashcardAccuracy: null },
      { recentScores: scores, studyDaysThisWeek: 1, flashcardAccuracy: [{ topic: '', correctRate: 0.5 }] },
    ]) {
      const result = normalizeStudyPerformanceData(body);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data).toStrictEqual({ recentScores: scores, studyDaysThisWeek: 1 });
    }
  });

  it('rejects a non-array flashcardAccuracy and a non-array recentScores', () => {
    expect(normalizeStudyPerformanceData({ recentScores: scores, studyDaysThisWeek: 1, flashcardAccuracy: 'lots' }).ok).toBe(false);
    expect(normalizeStudyPerformanceData({ recentScores: { a: 1 }, studyDaysThisWeek: 1 }).ok).toBe(false);
  });

  it('clamps ranges and drops malformed rows', () => {
    const result = normalizeStudyPerformanceData({
      recentScores: [
        { topic: 'Physio', score: 140, date: '2026-08-22' },
        { topic: '   ', score: 50, date: '2026-08-22' },
        { topic: 'Histo', score: 'NaN' },
        null,
      ],
      flashcardAccuracy: [{ topic: 'Deck', correctRate: 7 }, { topic: 'Deck2', correctRate: -1 }],
      studyDaysThisWeek: -3,
    });
    expect(result).toEqual({
      ok: true,
      data: {
        recentScores: [{ topic: 'Physio', score: 100, date: '2026-08-22' }],
        flashcardAccuracy: [
          { topic: 'Deck', correctRate: 1 },
          { topic: 'Deck2', correctRate: 0 },
        ],
        studyDaysThisWeek: 0,
      },
    });
  });
});
