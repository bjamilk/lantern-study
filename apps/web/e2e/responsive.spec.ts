import { test, expect } from '@playwright/test';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const WIDTHS = [320, 390, 768, 1280, 1920] as const;

const PUBLIC_ROUTES = ['/', '/login', '/signup', '/marketplace', '/privacy'];

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

test.describe('Responsive smoke — public routes', () => {
  for (const width of WIDTHS) {
    for (const route of PUBLIC_ROUTES) {
      test(`${route} @ ${width}px has no document overflow`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(400);
        await assertNoHorizontalOverflow(page);
      });
    }
  }
});

test.describe('Responsive smoke — auth + shell (credentials)', () => {
  test.skip(!process.env.AUDIT_EMAIL || !process.env.AUDIT_PASSWORD, 'Set AUDIT_EMAIL / AUDIT_PASSWORD');

  test('login then dashboard/marketplace/budget at key widths', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`);
    await page.fill('#email', process.env.AUDIT_EMAIL!);
    await page.fill('#password', process.env.AUDIT_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/dashboard/, { timeout: 60000 });
    for (const label of ['Skip', 'Continue', 'Accept', 'Got it', 'Close']) {
      const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of ['/dashboard', '/marketplace', '/budget', '/library']) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        await assertNoHorizontalOverflow(page);
      }
    }

    // Mobile More menu must be clickable (portal fix regression)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(600);
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('[aria-label="More"]').click({ timeout: 10000 });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /settings/i })).toBeVisible();

    // AI usage badge must not float mid-screen over dashboard content
    await page.keyboard.press('Escape').catch(() => {});
    const midFloat = page.locator('div.fixed.top-1\\/2.right-3');
    await expect(midFloat).toHaveCount(0);
  });
});
