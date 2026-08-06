import {
  compareTrendingFeedItems,
  computeJobTrendingScore,
  computeJobViewComponent,
  computeMarketplaceTrendingScore,
} from './trending';

describe('marketplace trending scores', () => {
  it('weights completed orders above views', () => {
    const quietPopular = computeMarketplaceTrendingScore({
      views7d: 40,
      completedOrders7d: 0,
    });
    const purchased = computeMarketplaceTrendingScore({
      views7d: 5,
      completedOrders7d: 2,
    });
    expect(purchased).toBeGreaterThan(quietPopular);
    expect(purchased).toBe(5 + 50);
  });

  it('floors non-integer inputs', () => {
    expect(
      computeMarketplaceTrendingScore({ views7d: 1.9, completedOrders7d: 1.2 })
    ).toBe(1 + 25);
  });
});

describe('job trending scores', () => {
  it('decays lifetime views by age days', () => {
    expect(computeJobViewComponent(100, 10)).toBe(10);
    expect(computeJobViewComponent(100, 0)).toBe(100);
  });

  it('ranks application-heavy posts above view-only peers', () => {
    const viewsOnly = computeJobTrendingScore({
      viewsComponent: 20,
      applications7d: 0,
      externalClicks7d: 0,
      favorites7d: 0,
    });
    const applied = computeJobTrendingScore({
      viewsComponent: 2,
      applications7d: 3,
      externalClicks7d: 0,
      favorites7d: 0,
    });
    expect(applied).toBeGreaterThan(viewsOnly);
  });
});

describe('compareTrendingFeedItems', () => {
  it('keeps pinned items above higher scores', () => {
    const pinned = {
      pinned: true,
      score: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const hot = {
      pinned: false,
      score: 999,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    expect(compareTrendingFeedItems(pinned, hot)).toBeLessThan(0);
  });

  it('breaks score ties by newer createdAt', () => {
    const older = {
      pinned: false,
      score: 10,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const newer = {
      pinned: false,
      score: 10,
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    expect(compareTrendingFeedItems(newer, older)).toBeLessThan(0);
  });

  it('orders equal sponsored peers by applications via score', () => {
    const lowApps = {
      pinned: true,
      score: computeJobTrendingScore({
        viewsComponent: 1,
        applications7d: 1,
        externalClicks7d: 0,
        favorites7d: 0,
      }),
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    const highApps = {
      pinned: true,
      score: computeJobTrendingScore({
        viewsComponent: 1,
        applications7d: 5,
        externalClicks7d: 0,
        favorites7d: 0,
      }),
      createdAt: '2026-08-01T00:00:00.000Z',
    };
    expect(compareTrendingFeedItems(highApps, lowApps)).toBeLessThan(0);
  });
});
