import { test, expect } from '@playwright/test';

/**
 * Fast public-route smoke for Cloudflare PR preview URLs.
 * Set AUDIT_BASE_URL to the preview deployment (e.g. https://pr-12.lantern-study.pages.dev).
 */
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const WIDTHS = [390, 1280] as const;
const PUBLIC_ROUTES = ['/', '/login', '/privacy'] as const;

async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const metrics = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
    };
  });
  expect(
    metrics.scrollWidth,
    `horizontal overflow ${metrics.scrollWidth - metrics.clientWidth}px`
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test.describe('Preview smoke — public routes', () => {
  for (const width of WIDTHS) {
    for (const route of PUBLIC_ROUTES) {
      test(`${route} @ ${width}px loads without document overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        const response = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        expect(response?.ok() || response?.status() === 304).toBeTruthy();
        await page.waitForTimeout(400);
        await assertNoHorizontalOverflow(page);
      });
    }
  }

  test('API proxy responds via same-origin /api', async ({ request }) => {
    // /health is not under /api; session is a cheap authenticated probe (401 without cookies is OK).
    const res = await request.get(`${BASE}/api/v1/auth/session`);
    expect(res.status(), `proxy/upstream failure: ${res.status()}`).toBeLessThan(500);
  });
});

