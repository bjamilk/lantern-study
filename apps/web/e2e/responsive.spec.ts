import { test, expect } from '@playwright/test';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const WIDTHS = [320, 360, 390, 414, 768, 820, 1024, 1280, 1440, 1920] as const;

const PUBLIC_ROUTES = ['/', '/login', '/signup', '/marketplace', '/privacy'];

async function assertMarketplaceCategoriesReachable(page: import('@playwright/test').Page) {
  const group = page.getByRole('radiogroup', { name: /marketplace category/i });
  if (!(await group.isVisible().catch(() => false))) return;
  const metrics = await group.evaluate((el) => {
    const chips = [...el.querySelectorAll('button')];
    const outsides = chips.filter((c) => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.right > window.innerWidth + 1;
    }).length;
    return {
      overflowX: getComputedStyle(el).overflowX,
      canScroll: el.scrollWidth > el.clientWidth + 2,
      outsides,
    };
  });
  // Chips may extend past the viewport only when the strip itself scrolls.
  if (metrics.outsides > 0) {
    expect(metrics.canScroll, 'category strip must scroll when chips overflow').toBe(true);
    expect(['auto', 'scroll']).toContain(metrics.overflowX);
    await group.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect
      .poll(async () =>
        group.evaluate((el) => {
          const last = [...el.querySelectorAll('button')].at(-1);
          if (!last) return false;
          const chip = last.getBoundingClientRect();
          const port = el.getBoundingClientRect();
          return (
            el.scrollLeft > 0 &&
            chip.width > 0 &&
            chip.right <= port.right + 2 &&
            chip.left >= port.left - 2
          );
        })
      )
      .toBe(true);
  }
}

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
    test.setTimeout(180_000);
    await page.addInitScript(() => {
      try {
        localStorage.setItem('lantern_onboarding_complete', '1');
        localStorage.setItem('lantern_cookie_prefs_v2', JSON.stringify({
          necessary: true,
          functional: false,
          analytics: false,
          advertising: false,
          updatedAt: new Date().toISOString(),
        }));
        localStorage.setItem('lantern_cookie_notice_v1', 'dismissed');
      } catch {
        /* ignore */
      }
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/login`);
    await page.fill('#email', process.env.AUDIT_EMAIL!);
    await page.fill('#password', process.env.AUDIT_PASSWORD!);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/dashboard/, { timeout: 60000 });
    await page.waitForTimeout(1200);
    // First-run chrome: cookies, profile completion, onboarding
    for (let i = 0; i < 10; i++) {
      for (const label of ['Accept all', 'Essential only', 'Skip all', 'Got it', 'Skip for now']) {
        const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
        if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
      }
      const profileTitle = page.getByRole('heading', { name: /complete your profile/i });
      if (await profileTitle.isVisible().catch(() => false)) {
        const stamp = Date.now().toString(36).slice(-6);
        await page.locator('#modalFirstName').fill('Responsive');
        await page.locator('#modalLastName').fill('Auditor');
        await page.locator('#modalUsername').fill(`rqa_${stamp}`);
        await page.waitForTimeout(1200);
        const saveBtn = page.getByRole('button', { name: /save & continue/i });
        if (await saveBtn.isEnabled().catch(() => false)) {
          await saveBtn.click();
          await page.waitForTimeout(1000);
        } else {
          // Availability probe can flap; submit via form requestSubmit once fields are filled.
          await page.locator('form').filter({ has: page.locator('#modalUsername') }).evaluate((form) => {
            (form as HTMLFormElement).requestSubmit();
          });
          await page.waitForTimeout(1000);
        }
      }
      const skip = page.getByRole('button', { name: /skip for now/i }).first();
      if (await skip.isVisible().catch(() => false)) await skip.click().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      const blocking = page.locator('[role="presentation"].fixed.inset-0');
      if (!(await blocking.first().isVisible().catch(() => false))) break;
      await page.waitForTimeout(250);
    }

    // Route hydration and lazy screen loading must not remount the persistent desktop sidebar.
    await page.setViewportSize({ width: 1280, height: 420 });
    await page.goto(`${BASE}/dashboard`);
    const sidebarScroller = page.getByTestId('desktop-sidebar-scroll');
    await expect(sidebarScroller).toBeVisible();
    const maxSidebarScroll = await sidebarScroller.evaluate(
      (el) => el.scrollHeight - el.clientHeight
    );
    expect(maxSidebarScroll).toBeGreaterThan(20);
    await sidebarScroller.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const sidebarScrollBeforeNavigation = await sidebarScroller.evaluate((el) => el.scrollTop);
    await page.getByRole('button', { name: /^Explore$/ }).evaluate((button) => {
      (button as HTMLButtonElement).click();
    });
    await page.waitForURL(/\/marketplace$/);
    await expect(sidebarScroller).toBeVisible();
    await page.waitForTimeout(500);
    const sidebarScrollAfterNavigation = await sidebarScroller.evaluate((el) => el.scrollTop);
    expect(sidebarScrollAfterNavigation).toBeGreaterThanOrEqual(sidebarScrollBeforeNavigation - 2);

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const route of [
        '/dashboard',
        '/marketplace',
        '/marketplace/my-listings',
        '/budget',
        '/library',
      ]) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(500);
        await assertNoHorizontalOverflow(page);
      }
    }

    // Compact marketplace workspace: listings dominate viewport; seller inventory landmark present
    for (const width of [390, 768, 820, 1280] as const) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE}/marketplace`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      await expect(page.getByRole('navigation', { name: /marketplace workspace/i })).toBeVisible();
      await expect(page.getByTestId('marketplace-listings').first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
      await assertMarketplaceCategoriesReachable(page);

      await page.goto(`${BASE}/marketplace/my-listings`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      await expect(page.getByRole('navigation', { name: /marketplace workspace/i })).toBeVisible();
      await expect(page.getByTestId('seller-inventory')).toBeVisible();
      await assertNoHorizontalOverflow(page);
    }

    // Budget category pickers stay readable on narrow phones
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const addExpense = page.getByRole('button', { name: /add expense/i }).first();
    if (await addExpense.isVisible().catch(() => false)) {
      await addExpense.click();
      await page.waitForTimeout(400);
      const fontSizes = await page.locator('[role="group"][aria-label="Expense category"] button span').evaluateAll((nodes) =>
        nodes
          .map((n) => parseFloat(getComputedStyle(n).fontSize))
          .filter((n) => Number.isFinite(n) && n > 0)
      );
      expect(fontSizes.length).toBeGreaterThan(0);
      expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(11);
      await assertNoHorizontalOverflow(page);
      await page.keyboard.press('Escape');
    }

    // Short-height seller dashboard should not force horizontal overflow
    await page.setViewportSize({ width: 390, height: 500 });
    await page.goto(`${BASE}/marketplace/my-listings`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await assertNoHorizontalOverflow(page);

    // Mobile More menu must be clickable (portal fix regression)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/dashboard`);
    await page.waitForTimeout(800);
    const skipAgain = page.getByRole('button', { name: /skip for now/i }).first();
    if (await skipAgain.isVisible().catch(() => false)) await skipAgain.click().catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await page.locator('[aria-label="More"]').click({ timeout: 15000 });
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /settings/i })).toBeVisible();

    // AI usage badge must not float mid-screen over dashboard content
    await page.keyboard.press('Escape').catch(() => {});
    const midFloat = page.locator('div.fixed.top-1\\/2.right-3');
    await expect(midFloat).toHaveCount(0);
  });
});

test.describe('Responsive — verify email long address', () => {
  for (const width of [320, 390] as const) {
    test(`verify-email wraps long address @ ${width}px`, async ({ page }) => {
      const longEmail = 'very.long.responsive.audit.address.that.should.not.clip@example.com';
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${BASE}/verify-email`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(400);
      const input = page.locator('#verifyEmail');
      await expect(input).toBeVisible({ timeout: 10000 });
      await input.fill(longEmail);
      await page.waitForTimeout(300);
      await assertNoHorizontalOverflow(page);
      const display = page.locator('[data-testid="verify-email-display"]');
      await expect(display).toBeVisible({ timeout: 5000 });
      await expect(display).toContainText(longEmail);
      const truncated = await display.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
      expect(truncated).toBe(false);
    });
  }
});

test.describe('Responsive — cookie banner height', () => {
  test('cookie notice stays compact on 360px', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('lantern_cookie_prefs_v2');
        localStorage.removeItem('lantern_cookie_notice_v1');
      } catch {
        /* ignore */
      }
    });
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const banner = page.getByRole('region', { name: /cookie notice/i });
    if (await banner.isVisible().catch(() => false)) {
      const box = await banner.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.height).toBeLessThanOrEqual(220);
      await assertNoHorizontalOverflow(page);
    }
  });
});

test.describe('Responsive — marketplace category strip (guest)', () => {
  for (const width of [768, 820, 1024] as const) {
    test(`category chips reachable @ ${width}px`, async ({ page }) => {
      await page.addInitScript(() => {
        try {
          localStorage.setItem('lantern_cookie_notice_v1', 'dismissed');
          localStorage.setItem(
            'lantern_cookie_prefs_v2',
            JSON.stringify({
              necessary: true,
              functional: false,
              analytics: false,
              advertising: false,
              updatedAt: new Date().toISOString(),
            })
          );
        } catch {
          /* ignore */
        }
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${BASE}/marketplace`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      await assertNoHorizontalOverflow(page);
      await assertMarketplaceCategoriesReachable(page);
    });
  }
});

test.describe('Responsive — landscape / short height public', () => {
  for (const [width, height] of [
    [844, 390],
    [1024, 500],
    [320, 568],
  ] as const) {
    test(`public shell ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      for (const route of ['/', '/login', '/marketplace'] as const) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(350);
        await assertNoHorizontalOverflow(page);
      }
    });
  }
});
