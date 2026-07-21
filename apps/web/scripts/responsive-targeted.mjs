/**
 * Targeted responsive repro: More nav, budget, notes, chat, landing, modals.
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
const findings = [];

function note(entry) {
  findings.push(entry);
  console.log(entry.ok ? 'OK' : 'FAIL', JSON.stringify(entry));
  if (!entry.ok) failures.push(entry);
}

async function dismiss(page) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    for (const label of ['Skip', 'Continue', 'Got it', 'Accept', 'Not now', 'Close', 'Done', 'Finish']) {
      const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
    }
    await page.waitForTimeout(120);
  }
}

async function overflow(page) {
  return page.evaluate(() => {
    const d = document.documentElement;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.right > d.clientWidth + 2) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 100),
          right: Math.round(r.right),
          w: Math.round(r.width),
        });
        if (offenders.length >= 6) break;
      }
    }
    return {
      overflowPx: d.scrollWidth - d.clientWidth,
      has: d.scrollWidth > d.clientWidth + 1,
      offenders,
      bodyTextSample: (document.body?.innerText || '').slice(0, 200),
    };
  });
}

async function dialogFit(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[role="dialog"], [role="menu"]');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    return {
      present: true,
      role: el.getAttribute('role'),
      fits: r.left >= -4 && r.top >= -4 && r.right <= vw + 4 && r.bottom <= vh + 4,
      rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
      vw,
      vh,
    };
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

// Warm Vite
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(1000);

await page.fill('#email', process.env.AUDIT_EMAIL);
await page.fill('#password', process.env.AUDIT_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/dashboard/, { timeout: 90000 });
await page.waitForTimeout(1500);
await dismiss(page);

const widths = [320, 360, 375, 390, 414, 480, 768, 1024, 1280, 1920];
const routes = [
  '/dashboard',
  '/library',
  '/notes',
  '/flashcards',
  '/chat',
  '/budget',
  '/marketplace',
  '/study',
  '/ai-tools',
  '/offline',
];

for (const width of widths) {
  await page.setViewportSize({ width, height: 800 });
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(500);
    await dismiss(page);
    const m = await overflow(page);
    note({
      ok: !m.has,
      case: 'route-overflow',
      route,
      width,
      overflowPx: m.overflowPx,
      offenders: m.offenders,
    });
    if (m.has) {
      await page.screenshot({ path: path.join(OUT, `overflow_${route.replace(/\//g, '_')}_${width}.png`), fullPage: true }).catch(() => {});
    }
  }

  // Mobile shell checks
  if (width < 768) {
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await dismiss(page);

    const more = page.locator('[aria-label="More"]');
    const moreVisible = await more.isVisible().catch(() => false);
    note({ ok: moreVisible, case: 'more-button-visible', width });

    if (moreVisible) {
      await more.click();
      await page.waitForTimeout(400);
      const menu = await dialogFit(page);
      note({ ok: menu.present && menu.fits, case: 'more-menu-fit', width, menu });
      const settings = page.getByRole('menuitem', { name: /settings/i });
      const settingsVisible = await settings.isVisible().catch(() => false);
      note({ ok: settingsVisible, case: 'settings-menuitem', width });
      if (settingsVisible) {
        await settings.click();
        await page.waitForTimeout(600);
        const dlg = await dialogFit(page);
        note({ ok: dlg.present && dlg.fits, case: 'settings-dialog-fit', width, dlg });
        await page.keyboard.press('Escape');
      } else {
        await page.keyboard.press('Escape');
      }
    }

    // Bottom nav clearance: content not covered permanently (pb check)
    const covered = await page.evaluate(() => {
      const nav = document.querySelector('nav.md\\:hidden, nav.fixed.bottom-0');
      if (!nav) return { nav: false };
      const main = document.querySelector('main') || document.querySelector('[class*="overflow-y"]');
      if (!main) return { nav: true, main: false };
      const nr = nav.getBoundingClientRect();
      const mr = main.getBoundingClientRect();
      return {
        nav: true,
        main: true,
        mainBottom: mr.bottom,
        navTop: nr.top,
        overlaps: mr.bottom > nr.top + 8,
        navHeight: nr.height,
      };
    });
    note({ ok: covered.nav === true, case: 'bottom-nav-present', width, covered });
  }
}

// Short landscape auth
await page.setViewportSize({ width: 740, height: 360 });
await context.clearCookies();
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(500);
const submit = page.locator('button[type="submit"]');
await submit.scrollIntoViewIfNeeded().catch(() => {});
const submitBox = await submit.boundingBox();
note({
  ok: !!submitBox && submitBox.y + submitBox.height <= 360 + 40,
  case: 'login-landscape-submit-reachable',
  submitBox,
});

// Landing at 320
await page.setViewportSize({ width: 320, height: 700 });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const land = await overflow(page);
note({ ok: !land.has, case: 'landing-320-overflow', overflowPx: land.overflowPx, offenders: land.offenders });

await page.setViewportSize({ width: 1920, height: 900 });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
const landWide = await overflow(page);
note({ ok: !landWide.has, case: 'landing-1920-overflow', overflowPx: landWide.overflowPx });

fs.writeFileSync(path.join(OUT, 'targeted-report.json'), JSON.stringify({ findings, failures }, null, 2));
console.log(`\nFailures: ${failures.length}`);
await browser.close();
process.exit(failures.length ? 1 : 0);
