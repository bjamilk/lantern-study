/**
 * Deeper interactive responsive checks: modals, menus, settings tabs, dense pages.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.join(ROOT, 'tmp/responsive');
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
fs.mkdirSync(OUT, { recursive: true });

const failures = [];

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', process.env.AUDIT_EMAIL);
  await page.fill('#password', process.env.AUDIT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dashboard/, { timeout: 60000 });
  await page.waitForTimeout(1200);
  for (const label of ['Skip', 'Continue', 'Got it', 'Accept']) {
    const b = page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

async function dialogFitsViewport(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return { present: false };
    const r = dialog.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      present: true,
      fits:
        r.left >= -2 &&
        r.top >= -2 &&
        r.right <= vw + 2 &&
        r.bottom <= vh + 2 &&
        r.width <= vw + 2 &&
        r.height <= vh + 2,
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
      vw,
      vh,
    };
  });
}

async function docOverflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    return {
      overflow: d.scrollWidth - d.clientWidth,
      has: d.scrollWidth > d.clientWidth + 1,
    };
  });
}

function fail(entry) {
  failures.push(entry);
  console.log('FAIL', JSON.stringify(entry));
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await login(page);

const viewports = [
  { w: 320, h: 700 },
  { w: 390, h: 844 },
  { w: 768, h: 900 },
  { w: 1280, h: 800 },
];

for (const vp of viewports) {
  await page.setViewportSize({ width: vp.w, height: vp.h });

  // Bottom nav More menu on mobile
  if (vp.w < 768) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    for (const label of ['Accept all', 'Essential only', 'Skip for now', 'Got it', 'Skip all']) {
      const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    const profileTitle = page.getByRole('heading', { name: /complete your profile/i });
    if (await profileTitle.isVisible().catch(() => false)) {
      const stamp = Date.now().toString(36).slice(-6);
      await page.locator('#modalFirstName').fill('Responsive').catch(() => {});
      await page.locator('#modalLastName').fill('Auditor').catch(() => {});
      await page.locator('#modalUsername').fill(`rqa_${stamp}`).catch(() => {});
      await page.waitForTimeout(1200);
      const save = page.getByRole('button', { name: /save & continue/i });
      if (await save.isEnabled().catch(() => false)) await save.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    const more = page.locator('[aria-label="More"]').first();
    if (await more.isVisible().catch(() => false)) {
      await more.click({ force: true }).catch(() => {});
      await page.waitForTimeout(400);
      const menu = page.locator('[role="menu"], [data-radix-menu-content], .lantern-menu').first();
      const visible = await menu.isVisible().catch(() => false);
      const ov = await docOverflow(page);
      if (ov.has) fail({ case: 'more-menu-overflow', ...vp, overflow: ov.overflow });
      await page.screenshot({ path: path.join(OUT, `more_${vp.w}.png`) }).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});
      if (!visible) {
        const panelText = await page.locator('body').innerText();
        if (!/Settings|Budget|Marketplace|Offline/i.test(panelText)) {
          fail({ case: 'more-menu-empty', ...vp });
        }
      }
    } else {
      fail({ case: 'more-nav-missing', ...vp });
    }
  }

  // Settings modal via URL/hash not available — open from bottom nav More > Settings
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  if (vp.w < 768) {
    const more = page.getByRole('button', { name: /more/i }).first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      await page.waitForTimeout(300);
    }
  }
  const settingsBtn = page.getByRole('button', { name: /^settings$/i }).or(page.getByText(/^Settings$/)).first();
  if (await settingsBtn.isVisible().catch(() => false)) {
    await settingsBtn.click();
    await page.waitForTimeout(700);
    const fit = await dialogFitsViewport(page);
    if (fit.present && !fit.fits) {
      fail({ case: 'settings-modal-clip', ...vp, ...fit });
      await page.screenshot({ path: path.join(OUT, `settings_clip_${vp.w}.png`), fullPage: true });
    }
    // Horizontal tab rail shouldn't force page overflow
    const ov = await docOverflow(page);
    if (ov.has) fail({ case: 'settings-page-overflow', ...vp, overflow: ov.overflow });
    await page.keyboard.press('Escape').catch(() => {});
  }

  // Marketplace filters / chips
  await page.goto(`${BASE}/marketplace`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  let ov = await docOverflow(page);
  if (ov.has) fail({ case: 'marketplace-overflow', ...vp, overflow: ov.overflow });

  // Budget
  await page.goto(`${BASE}/budget`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ov = await docOverflow(page);
  if (ov.has) fail({ case: 'budget-overflow', ...vp, overflow: ov.overflow });

  // Chat
  await page.goto(`${BASE}/chat`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ov = await docOverflow(page);
  if (ov.has) fail({ case: 'chat-overflow', ...vp, overflow: ov.overflow });

  // Notes
  await page.goto(`${BASE}/notes`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ov = await docOverflow(page);
  if (ov.has) fail({ case: 'notes-overflow', ...vp, overflow: ov.overflow });

  // Admin (may 403/redirect)
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  ov = await docOverflow(page);
  if (ov.has) fail({ case: 'admin-overflow', ...vp, overflow: ov.overflow, path: page.url() });
}

// Hostile long title stress on login (email field)
await page.setViewportSize({ width: 320, height: 700 });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'verylongemailaddressforoverflowtesting.user.name.extra@example-institution.edu');
await page.fill('#password', 'x'.repeat(40));
let ov = await docOverflow(page);
if (ov.has) fail({ case: 'login-long-email-overflow', overflow: ov.overflow });
await page.screenshot({ path: path.join(OUT, 'login_long_email_320.png') });

// Landing at 320
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
ov = await docOverflow(page);
if (ov.has) fail({ case: 'landing-320-overflow', overflow: ov.overflow });
await page.screenshot({ path: path.join(OUT, 'landing_320.png') });

await browser.close();
fs.writeFileSync(path.join(OUT, 'deep-report.json'), JSON.stringify({ failures }, null, 2));
console.log(`Deep failures: ${failures.length}`);
process.exitCode = failures.length ? 1 : 0;
