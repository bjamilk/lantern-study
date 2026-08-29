import {
  computeMarketplaceReviewSummary,
  filterReviewsByStar,
  reviewHistogramPercentages,
  sortMarketplaceReviews,
} from './reviews';

describe('computeMarketplaceReviewSummary', () => {
  it('returns an empty summary for no reviews', () => {
    expect(computeMarketplaceReviewSummary([])).toEqual({
      average: null,
      count: 0,
      histogram: [0, 0, 0, 0, 0],
    });
    expect(computeMarketplaceReviewSummary(undefined).count).toBe(0);
  });

  it('buckets ratings and rounds the average to 1 decimal', () => {
    const summary = computeMarketplaceReviewSummary([
      { rating: 5 },
      { rating: 5 },
      { rating: 4 },
      { rating: 2 },
    ]);
    expect(summary.count).toBe(4);
    expect(summary.histogram).toEqual([0, 1, 0, 1, 2]);
    expect(summary.average).toBe(4); // 16/4
    expect(
      computeMarketplaceReviewSummary([{ rating: 5 }, { rating: 4 }, { rating: 4 }]).average,
    ).toBe(4.3); // 13/3 = 4.333…
  });

  it('ignores out-of-range and malformed ratings instead of corrupting buckets', () => {
    const summary = computeMarketplaceReviewSummary([
      { rating: 0 },
      { rating: 6 },
      { rating: Number.NaN },
      { rating: '5' as unknown as number },
      { rating: 3 },
    ]);
    expect(summary.count).toBe(2); // '5' coerces cleanly, 3 counts
    expect(summary.histogram).toEqual([0, 0, 1, 0, 1]);
  });

  it('produces integer percentages that reflect bucket shares', () => {
    const summary = computeMarketplaceReviewSummary([
      { rating: 5 },
      { rating: 5 },
      { rating: 1 },
    ]);
    expect(reviewHistogramPercentages(summary)).toEqual([33, 0, 0, 0, 67]);
    expect(reviewHistogramPercentages(computeMarketplaceReviewSummary([]))).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});

describe('sortMarketplaceReviews', () => {
  const reviews = [
    { id: 'a', rating: 3, created_at: '2026-08-01T00:00:00Z', helpfulCount: 2 },
    { id: 'b', rating: 5, created_at: '2026-08-10T00:00:00Z', helpfulCount: 0 },
    { id: 'c', rating: 4, created_at: '2026-08-05T00:00:00Z', helpfulCount: 2 },
    { id: 'd', rating: 1, created_at: '2026-08-08T00:00:00Z' },
  ];

  it('sorts top by helpful votes with recency as the tiebreak', () => {
    expect(sortMarketplaceReviews(reviews, 'top').map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });

  it('sorts recent by created_at desc', () => {
    expect(sortMarketplaceReviews(reviews, 'recent').map((r) => r.id)).toEqual([
      'b',
      'd',
      'c',
      'a',
    ]);
  });

  it('sorts by rating in both directions', () => {
    expect(sortMarketplaceReviews(reviews, 'rating_high').map((r) => r.id)).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
    expect(sortMarketplaceReviews(reviews, 'rating_low').map((r) => r.id)).toEqual([
      'd',
      'a',
      'c',
      'b',
    ]);
  });

  it('does not mutate the input list', () => {
    const input = [...reviews];
    sortMarketplaceReviews(input, 'top');
    expect(input.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('filterReviewsByStar', () => {
  const reviews = [{ rating: 5 }, { rating: 4 }, { rating: 5 }, { rating: 1 }];

  it('filters to one star bucket and passes through on null', () => {
    expect(filterReviewsByStar(reviews, 5)).toHaveLength(2);
    expect(filterReviewsByStar(reviews, 3)).toHaveLength(0);
    expect(filterReviewsByStar(reviews, null)).toHaveLength(4);
  });
});
