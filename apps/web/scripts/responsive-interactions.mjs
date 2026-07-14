import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = 'http://localhost:5173';
const failures = [];

async function dismissBlockingOverlays(page) {
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(150);
    for (const label of ['Skip', 'Continue', 'Accept', 'Got it', 'Not now', 'Close', 'Done', 'Finish', 'Save']) {
      const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(200);
      }
    }
    const blocking = page.locator('[role="presentation"].fixed.inset-0, [role="dialog"]');
    if (!(await blocking.first().isVisible().catch(() => false))) break;
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', process.env.AUDIT_EMAIL);
  await page.fill('#password', process.env.AUDIT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await dismissBlockingOverlays(page);
}

async function fits(page, sel = '[role="dialog"], [role="menu"]') {
  return page.evaluate((selector) => {
    const el = document.querySelector(selector);
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      present: true,
      fits: r.left >= -4 && r.top >= -4 && r.right <= vw + 4 && r.bottom <= vh + 4,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height },
      vw,
      vh,
    };
  }, sel);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await login(page);

for (const w of [320, 360, 390, 414]) {
  await page.setViewportSize({ width: w, height: 720 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);

  const more = page.locator('[aria-label="More"]');
  await more.click();
  await page.waitForTimeout(400);
  let m = await fits(page, '[role="menu"]');
  if (!m.present) {
    failures.push({ case: 'more-menu-missing', w });
  } else if (!m.fits) {
    failures.push({ case: 'more-menu-clip', w, ...m });
    await page.screenshot({ path: `tmp/responsive/more_clip_${w}.png` });
  }
  // Open settings from menu
  const settingsItem = page.getByRole('menuitem', { name: /settings/i }).or(page.getByText('Settings', { exact: true }));
  if (await settingsItem.first().isVisible().catch(() => false)) {
    await settingsItem.first().click({ force: false, timeout: 10000 });
    await page.waitForTimeout(700);
    m = await fits(page, '[role="dialog"]');
    if (m.present && !m.fits) {
      failures.push({ case: 'settings-dialog-clip', w, ...m });
      await page.screenshot({ path: `tmp/responsive/settings_clip_${w}.png` });
    }
    if (m.overflowX > 1) failures.push({ case: 'settings-doc-overflow', w, overflowX: m.overflowX });
    // Try scrolling settings tab rail
    const tabs = page.locator('[role="tablist"], .overflow-x-auto').first();
    if (await tabs.isVisible().catch(() => false)) {
      const tabBox = await tabs.boundingBox();
      if (tabBox && tabBox.width > w + 2) {
        failures.push({ case: 'settings-tabs-wider-than-viewport', w, tabWidth: tabBox.width });
      }
    }
    await page.keyboard.press('Escape');
  } else {
    failures.push({ case: 'settings-menuitem-missing', w });
    await page.keyboard.press('Escape');
  }
}

// Auth form landscape short — fresh context so an existing session does not redirect away
{
  const landCtx = await browser.newContext();
  const landPage = await landCtx.newPage();
  await landPage.setViewportSize({ width: 740, height: 360 });
  await landPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await landPage.waitForTimeout(600);
  const loginOv = await landPage.evaluate(() => ({
    overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (loginOv.overflowX > 1) failures.push({ case: 'login-landscape-x', ...loginOv });
  const submit = landPage.locator('button[type="submit"]');
  if (await submit.count()) {
    await submit.scrollIntoViewIfNeeded().catch(() => {});
    const submitBox = await submit.boundingBox();
    const submitReachable =
      !!submitBox && submitBox.y < 360 && submitBox.y + submitBox.height > 0;
    if (!submitReachable) {
      failures.push({ case: 'login-landscape-submit-unreachable', ...loginOv, submitBox });
    }
  } else {
    failures.push({ case: 'login-landscape-missing-submit' });
  }
  await landPage.screenshot({ path: 'tmp/responsive/login_landscape_short.png', fullPage: true });
  await landCtx.close();
}

// Marketplace create listing modal
await page.setViewportSize({ width: 360, height: 740 });
await page.goto(`${BASE}/marketplace/new`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const listingFit = await fits(page, '[role="dialog"]');
if (listingFit.present && !listingFit.fits) {
  failures.push({ case: 'create-listing-modal-clip', ...listingFit });
  await page.screenshot({ path: 'tmp/responsive/create_listing_360.png' });
}

fs.writeFileSync('tmp/responsive/interactions-report.json', JSON.stringify({ failures }, null, 2));
console.log(JSON.stringify({ count: failures.length, failures }, null, 2));
await browser.close();
process.exitCode = failures.length ? 1 : 0;
