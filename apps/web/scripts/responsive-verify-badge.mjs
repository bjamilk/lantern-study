import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function dismissNoise() {
  for (let i = 0; i < 6; i++) {
    for (const label of [
      'Skip for now',
      'Skip',
      'Continue',
      'Got it',
      'Accept',
      'Close',
      'Done',
      'Get started',
      'Not now',
    ]) {
      const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(200);
  }
}

await page.setViewportSize({ width: 360, height: 800 });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.fill('#email', process.env.AUDIT_EMAIL);
await page.fill('#password', process.env.AUDIT_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 90000 });
await page.waitForTimeout(1500);
await dismissNoise();
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await dismissNoise();

const info = await page.evaluate(() => {
  const midFloat = [...document.querySelectorAll('div')].find((el) => {
    const cls = String(el.className || '');
    return cls.includes('fixed') && cls.includes('top-1/2') && cls.includes('right-3');
  });
  const resets = [...document.querySelectorAll('p, span, div')].find(
    (el) => /Resets in/i.test(el.textContent || '') && (el.textContent || '').length < 40
  );
  const xp = [...document.querySelectorAll('p, span, div')].find(
    (el) => /XP to next/i.test(el.textContent || '') && (el.textContent || '').length < 40
  );
  const rr = resets?.getBoundingClientRect();
  const xr = xp?.getBoundingClientRect();
  const overlaps =
    !!rr &&
    !!xr &&
    !(rr.right < xr.left || rr.left > xr.right || rr.bottom < xr.top || rr.top > xr.bottom);
  return {
    midFloatPresent: !!midFloat,
    resetsTop: rr ? Math.round(rr.top) : null,
    xpTop: xr ? Math.round(xr.top) : null,
    overlaps,
    inTopStrip: rr ? rr.top < 64 : null,
  };
});

console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: 'tmp/responsive/after_badge_fix_360.png' });

// Cookie banner vs bottom nav
await page.evaluate(() => localStorage.removeItem('lantern_cookie_notice_v1'));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await dismissNoise();
const cookie = await page.evaluate(() => {
  const banner = document.querySelector('[aria-label="Cookie notice"]');
  const nav = document.querySelector('nav.fixed.bottom-0, nav.md\\:hidden');
  if (!banner || !nav) return { banner: !!banner, nav: !!nav };
  const br = banner.getBoundingClientRect();
  const nr = nav.getBoundingClientRect();
  return {
    banner: true,
    nav: true,
    bannerBottom: Math.round(br.bottom),
    navTop: Math.round(nr.top),
    coversNav: br.bottom > nr.top + 4,
    bannerTop: Math.round(br.top),
  };
});
console.log('cookie', JSON.stringify(cookie));
await page.screenshot({ path: 'tmp/responsive/cookie_vs_nav_360.png' });

await browser.close();
process.exit(info.midFloatPresent || info.overlaps || cookie.coversNav ? 1 : 0);
