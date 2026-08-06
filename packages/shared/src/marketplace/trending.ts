/** 7-day marketplace Explore trending weights (integer kobo-safe math style). */
export const MARKETPLACE_TRENDING_VIEW_WEIGHT = 1;
export const MARKETPLACE_TRENDING_ORDER_WEIGHT = 25;

/** Jobs board trending weights. */
export const JOB_TRENDING_VIEW_WEIGHT = 1;
export const JOB_TRENDING_APPLICATION_WEIGHT = 10;
export const JOB_TRENDING_EXTERNAL_CLICK_WEIGHT = 5;
export const JOB_TRENDING_FAVORITE_WEIGHT = 2;

export function computeMarketplaceTrendingScore(input: {
  views7d: number;
  completedOrders7d: number;
}): number {
  const views = Math.max(0, Math.floor(input.views7d));
  const orders = Math.max(0, Math.floor(input.completedOrders7d));
  return (
    MARKETPLACE_TRENDING_VIEW_WEIGHT * views +
    MARKETPLACE_TRENDING_ORDER_WEIGHT * orders
  );
}

/** Decayed lifetime views: views_count / max(1, ageDays). */
export function computeJobViewComponent(
  viewsCount: number,
  ageDays: number
): number {
  const views = Math.max(0, Math.floor(viewsCount));
  const days = Math.max(1, Math.floor(ageDays));
  return Math.floor(views / days);
}

export function computeJobTrendingScore(input: {
  viewsComponent: number;
  applications7d: number;
  externalClicks7d: number;
  favorites7d: number;
}): number {
  return (
    JOB_TRENDING_VIEW_WEIGHT * Math.max(0, Math.floor(input.viewsComponent)) +
    JOB_TRENDING_APPLICATION_WEIGHT *
      Math.max(0, Math.floor(input.applications7d)) +
    JOB_TRENDING_EXTERNAL_CLICK_WEIGHT *
      Math.max(0, Math.floor(input.externalClicks7d)) +
    JOB_TRENDING_FAVORITE_WEIGHT * Math.max(0, Math.floor(input.favorites7d))
  );
}

/**
 * Feed ordering comparator: boosted/sponsored first, then score desc, then
 * created_at desc. Returns negative if `a` should appear before `b`.
 */
export function compareTrendingFeedItems(
  a: {
    pinned: boolean;
    score: number;
    createdAt: string | number | Date;
  },
  b: {
    pinned: boolean;
    score: number;
    createdAt: string | number | Date;
  }
): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  if (a.score !== b.score) return b.score - a.score;
  const aTime = new Date(a.createdAt).getTime();
  const bTime = new Date(b.createdAt).getTime();
  return bTime - aTime;
}
