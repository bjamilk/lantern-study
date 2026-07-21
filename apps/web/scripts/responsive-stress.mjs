/**
 * Content-stress + visual QA probes beyond simple document overflow.
 * Checks: long emails, overlapping fixed chrome, tiny tap targets, clipped dialogs,
 * verify-email truncation, landscape auth, dense marketplace chips.
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

function fail(entry) {
  failures.push(entry);
  console.log('FAIL', JSON.stringify(entry));
}
function ok(entry) {
  findings.push(entry);
  console.log('OK', JSON.stringify(entry));
}

async function dismiss(page) {
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Escape').catch(() => {});
    for (const label of [
      'Accept all',
      'Essential only',
      'Skip',
      'Skip for now',
      'Skip all',
      'Continue',
      'Got it',
      'Accept',
      'Not now',
      'Close',
      'Done',
      'Finish',
      'Get started',
    ]) {
      const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
      if (await b.isVisible().catch(() => false)) await b.click({ timeout: 800 }).catch(() => {});
    }
    await page.waitForTimeout(100);
  }
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.fill('#email', process.env.AUDIT_EMAIL);
  await page.fill('#password', process.env.AUDIT_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dashboard/, { timeout: 90000 });
  await page.waitForTimeout(1200);
  await dismiss(page);
  const profileTitle = page.getByRole('heading', { name: /complete your profile/i });
  if (await profileTitle.isVisible().catch(() => false)) {
    const stamp = Date.now().toString(36).slice(-6);
    await page.locator('#modalFirstName').fill('Responsive');
    await page.locator('#modalLastName').fill('Auditor');
    await page.locator('#modalUsername').fill(`rqa_${stamp}`);
    await page.waitForTimeout(900);
    await page.getByRole('button', { name: /save & continue/i }).click();
    await page.waitForTimeout(1000);
  }
  const skip = page.getByRole('button', { name: /skip for now/i }).first();
  if (await skip.isVisible().catch(() => false)) {
    await skip.click().catch(() => {});
    await page.waitForTimeout(400);
  }
  await dismiss(page);
}

const browser = await chromium.launch({ headless: true });

async function prepareStorage(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem('lantern_onboarding_complete', '1');
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
      localStorage.setItem('lantern_cookie_notice_v1', 'dismissed');
    } catch {
      /* ignore */
    }
  });
}

// ---- 1) Verify-email long address truncation / overflow ----
{
  const ctx = await browser.newContext();
  await prepareStorage(ctx);
  const page = await ctx.newPage();
  const longEmail = 'very.long.responsive.audit.address.that.should.not.clip@example.com';
  for (const w of [320, 360, 390]) {
    await page.setViewportSize({ width: w, height: 720 });
    await page.goto(`${BASE}/verify-email`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const emailInput = page.locator('#verifyEmail');
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(longEmail);
      await page.locator('#otpCode').click().catch(() => {});
      await page.waitForTimeout(300);
    }
    const metrics = await page.evaluate(() => {
      const display = document.querySelector('[data-testid="verify-email-display"]');
      const scrollW = document.documentElement.scrollWidth;
      const clientW = document.documentElement.clientWidth;
      let truncated = false;
      let shown = '';
      if (display) {
        truncated = display.scrollWidth > display.clientWidth + 2;
        shown = display.textContent || '';
      }
      return {
        overflowPx: scrollW - clientW,
        truncated,
        hasDisplay: !!display,
        shown,
        clientW,
      };
    });
    await page.screenshot({ path: path.join(OUT, `verify_email_${w}.png`) });
    if (metrics.overflowPx > 1) fail({ case: 'verify-email-doc-overflow', w, ...metrics });
    if (!metrics.hasDisplay) fail({ case: 'verify-email-display-missing', w, ...metrics });
    else if (metrics.truncated) fail({ case: 'verify-email-display-truncated', w, ...metrics });
    else if (!metrics.shown.includes('@example.com')) fail({ case: 'verify-email-incomplete', w, ...metrics });
    else ok({ case: 'verify-email-input', w, truncated: false });
  }
  await ctx.close();
}

// ---- 2) Signup phone row + long names at 320 ----
{
  const ctx = await browser.newContext();
  await prepareStorage(ctx);
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await page.fill('#firstName', 'Alexandria-Constantinople');
  await page.fill('#lastName', 'Okonkwo-Williams-Longname');
  await page.fill('#username', 'verylongusername_ok');
  await page.fill('#phone', '555123456789012');
  await page.fill('#email', 'long.name.responsive.audit.user@example.com');
  const m = await page.evaluate(() => {
    const d = document.documentElement;
    const phoneRow = document.querySelector('#phone')?.parentElement?.parentElement;
    const pr = phoneRow?.getBoundingClientRect();
    return {
      overflowPx: d.scrollWidth - d.clientWidth,
      phoneRight: pr ? Math.round(pr.right) : null,
      phoneW: pr ? Math.round(pr.width) : null,
      clientW: d.clientWidth,
    };
  });
  await page.screenshot({ path: path.join(OUT, 'signup_stress_320.png') });
  if (m.overflowPx > 1) fail({ case: 'signup-stress-overflow', ...m });
  if (m.phoneRight != null && m.phoneRight > m.clientW + 2) fail({ case: 'signup-phone-overflow', ...m });
  else ok({ case: 'signup-stress-320', ...m });
  await ctx.close();
}

const authedCtx = await browser.newContext();
await prepareStorage(authedCtx);
const page = await authedCtx.newPage();
await login(page);
console.log('AUTHED_URL', page.url());

// ---- 3) Primary mobile nav tap targets + visibility ----
for (const w of [320, 360, 390, 414]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await dismiss(page);
  if (!/dashboard|library|study|notes|flashcards|chat|marketplace|budget/i.test(page.url())) {
    await login(page);
  }
  const nav = await page.evaluate(() => {
    const more = document.querySelector('[aria-label="More"]');
    const navRoot =
      more?.closest('nav') ||
      document.querySelector('[data-testid="bottom-nav"]') ||
      document.querySelector('nav');
    const buttons = [...(navRoot?.querySelectorAll('button, a') || [])].filter((el) => {
      const s = getComputedStyle(el);
      return s.display !== 'none' && s.visibility !== 'hidden';
    });
    const tiny = [];
    for (const el of buttons) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      if (r.width < 40 || r.height < 40) {
        tiny.push({
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    const moreR = more?.getBoundingClientRect();
    return {
      buttonCount: buttons.length,
      tiny,
      moreVisible: !!(more && moreR && moreR.height > 0),
      moreBottom: moreR ? Math.round(moreR.bottom) : null,
      vh: window.innerHeight,
    };
  });
  if (!nav.moreVisible) fail({ case: 'more-nav-missing', w, ...nav });
  else ok({ case: 'more-nav-visible', w, buttonCount: nav.buttonCount });
  // Soft fail only for severe tiny targets (<36)
  const severe = nav.tiny.filter((t) => t.w < 36 || t.h < 36);
  if (severe.length) fail({ case: 'nav-tiny-targets', w, severe });
}

// ---- 4) Fixed overlays covering mid-screen content ----
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await dismiss(page);
  const floats = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const bad = [];
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.position !== 'sticky') continue;
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 20 || r.height < 20) continue;
      // Mid-screen floaters (not top bar / bottom nav / cookie)
      const midY = r.top > vh * 0.25 && r.bottom < vh * 0.75;
      const midX = r.left > 8 && r.right < vw - 8;
      if (midY && midX && r.width < vw * 0.5) {
        bad.push({
          tag: el.tagName.toLowerCase(),
          cls: String(el.className || '').slice(0, 80),
          top: Math.round(r.top),
          left: Math.round(r.left),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    }
    return bad.slice(0, 8);
  });
  if (floats.length) fail({ case: 'mid-screen-fixed-floaters', floats });
  else ok({ case: 'no-mid-screen-floaters' });
}

// ---- 5) Settings dialog fit + tab rail ----
for (const w of [320, 390, 768, 1280]) {
  await page.setViewportSize({ width: w, height: w < 768 ? 720 : 800 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await dismiss(page);
  if (w < 768) {
    await page.locator('[aria-label="More"]').click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
  const settings = page.getByRole('menuitem', { name: /settings/i }).or(page.getByRole('button', { name: /^settings$/i }));
  if (await settings.first().isVisible().catch(() => false)) {
    await settings.first().click().catch(() => {});
    await page.waitForTimeout(700);
    const fit = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return { present: false };
      const r = dialog.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const tablist = dialog.querySelector('[role="tablist"]');
      const tr = tablist?.getBoundingClientRect();
      return {
        present: true,
        fits: r.left >= -4 && r.top >= -4 && r.right <= vw + 4 && r.bottom <= vh + 4,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tabWiderThanViewport: !!(tr && tr.width > vw + 2),
        rect: { w: Math.round(r.width), h: Math.round(r.height), t: Math.round(r.top), b: Math.round(r.bottom) },
        vw,
        vh,
      };
    });
    await page.screenshot({ path: path.join(OUT, `settings_${w}.png`) });
    if (!fit.present) fail({ case: 'settings-missing', w });
    else if (!fit.fits) fail({ case: 'settings-clip', w, ...fit });
    else if (fit.overflowX > 1) fail({ case: 'settings-doc-overflow', w, ...fit });
    else if (fit.tabWiderThanViewport) fail({ case: 'settings-tabs-wider', w, ...fit });
    else ok({ case: 'settings-ok', w });
    await page.keyboard.press('Escape').catch(() => {});
  } else if (w < 768) {
    fail({ case: 'settings-entry-missing', w });
  }
}

// ---- 6) Dense routes content stress (inject long title via DOM) ----
for (const route of ['/marketplace', '/budget', '/notes', '/flashcards', '/chat', '/admin']) {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await dismiss(page);
  await page.evaluate(() => {
    const h = document.querySelector('h1, h2');
    if (h) {
      h.textContent =
        'Extremely Long Page Title That Should Wrap Gracefully Without Causing Horizontal Overflow Or Overlap';
    }
    for (const el of document.querySelectorAll('button, a')) {
      if ((el.textContent || '').trim().length > 0 && (el.textContent || '').trim().length < 24) {
        // skip mutating real controls
      }
    }
  });
  const ov = await page.evaluate(() => {
    const d = document.documentElement;
    return { overflowPx: d.scrollWidth - d.clientWidth, path: location.pathname };
  });
  await page.screenshot({ path: path.join(OUT, `stress_${route.replace(/\//g, '_')}_360.png`) });
  if (ov.overflowPx > 2) fail({ case: 'long-title-overflow', route, ...ov });
  else ok({ case: 'long-title-ok', route, ...ov });
}

// ---- 7) Landscape short + zoom-like viewport ----
{
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(600);
  await dismiss(page);
  const ov = await page.evaluate(() => ({
    overflowPx: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  if (ov.overflowPx > 2) fail({ case: 'dashboard-landscape-overflow', ...ov });
  else ok({ case: 'dashboard-landscape-ok', ...ov });
}

await browser.close();

const report = {
  generatedAt: new Date().toISOString(),
  failureCount: failures.length,
  failures,
  okCount: findings.length,
};
fs.writeFileSync(path.join(OUT, 'stress-report.json'), JSON.stringify(report, null, 2));
console.log(`\nStress failures: ${failures.length}`);
process.exit(failures.length ? 1 : 0);
