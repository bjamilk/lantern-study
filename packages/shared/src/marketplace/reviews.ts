/**
 * Review presentation helpers shared by the API (/full reviewSummary), web and
 * mobile (ratings histogram + review sorting). One source of truth so the
 * three surfaces can never disagree on an average.
 */

export type ReviewSortOption = 'top' | 'recent' | 'rating_high' | 'rating_low';

export interface ReviewLike {
  rating: number;
  created_at?: string;
  helpfulCount?: number;
}

export interface MarketplaceReviewSummary {
  /** Mean rating rounded to 1 decimal, or null with no reviews. */
  average: number | null;
  count: number;
  /** histogram[0] = 1-star count … histogram[4] = 5-star count. */
  histogram: [number, number, number, number, number];
}

const EMPTY_HISTOGRAM: [number, number, number, number, number] = [0, 0, 0, 0, 0];

function clampRating(rating: unknown): number | null {
  const value = Number(rating);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return null;
  return rounded;
}

export function computeMarketplaceReviewSummary(
  reviews: ReadonlyArray<ReviewLike> | null | undefined,
): MarketplaceReviewSummary {
  const histogram = [...EMPTY_HISTOGRAM] as [number, number, number, number, number];
  let total = 0;
  let count = 0;
  for (const review of reviews ?? []) {
    const rating = clampRating(review?.rating);
    if (rating === null) continue;
    histogram[rating - 1] += 1;
    total += rating;
    count += 1;
  }
  return {
    average: count > 0 ? Math.round((total / count) * 10) / 10 : null,
    count,
    histogram,
  };
}

/** Share of reviews at each star, 0–100 integers (for histogram bar widths). */
export function reviewHistogramPercentages(
  summary: MarketplaceReviewSummary,
): [number, number, number, number, number] {
  if (summary.count === 0) return [...EMPTY_HISTOGRAM] as [number, number, number, number, number];
  return summary.histogram.map((n) =>
    Math.round((n / summary.count) * 100),
  ) as [number, number, number, number, number];
}

function createdAtMs(review: ReviewLike): number {
  const time = review.created_at ? new Date(review.created_at).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Sort a review list for display. Never mutates the input.
 * 'top' = most-helpful first (recency tiebreak), matching the
 * "Top reviews" default readers expect from large marketplaces.
 */
export function sortMarketplaceReviews<T extends ReviewLike>(
  reviews: ReadonlyArray<T>,
  sort: ReviewSortOption,
): T[] {
  const sorted = [...reviews];
  switch (sort) {
    case 'top':
      sorted.sort(
        (a, b) =>
          (b.helpfulCount ?? 0) - (a.helpfulCount ?? 0) || createdAtMs(b) - createdAtMs(a),
      );
      break;
    case 'rating_high':
      sorted.sort((a, b) => b.rating - a.rating || createdAtMs(b) - createdAtMs(a));
      break;
    case 'rating_low':
      sorted.sort((a, b) => a.rating - b.rating || createdAtMs(b) - createdAtMs(a));
      break;
    case 'recent':
    default:
      sorted.sort((a, b) => createdAtMs(b) - createdAtMs(a));
      break;
  }
  return sorted;
}

export const REVIEW_SORT_LABELS: Record<ReviewSortOption, string> = {
  top: 'Top reviews',
  recent: 'Most recent',
  rating_high: 'Highest rating',
  rating_low: 'Lowest rating',
};

/** Star-bucket filter (1–5); null = show all reviews. */
export function filterReviewsByStar<T extends ReviewLike>(
  reviews: ReadonlyArray<T>,
  star: number | null,
): T[] {
  if (star === null) return [...reviews];
  return reviews.filter((review) => clampRating(review.rating) === star);
}
