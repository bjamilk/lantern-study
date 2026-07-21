import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('tmp/responsive', { recursive: true });
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

async function dismiss() {
  for (const label of ['Skip for now', 'Skip', 'Continue', 'Got it', 'Accept', 'Close', 'Done', 'Get started']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {});
  }
  await page.keyboard.press('Escape').catch(() => {});
}

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.fill('#email', process.env.AUDIT_EMAIL);
await page.fill('#password', process.env.AUDIT_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 90000 });
await page.waitForTimeout(1500);
await dismiss();
await dismiss();

const failures = [];

for (const w of [320, 360, 390, 768, 1280]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  await dismiss();

  const overlap = await page.evaluate(() => {
    const badge = [...document.querySelectorAll('*')].find((el) =>
      /Resets in|AI Requests/i.test(el.textContent || '') && el.children.length < 8
    );
    const xp = [...document.querySelectorAll('*')].find((el) => /XP to next/i.test(el.textContent || ''));
    if (!badge || !xp) return { badge: !!badge, xp: !!xp, overlaps: false };
    const br = badge.getBoundingClientRect();
    const xr = xp.getBoundingClientRect();
    const overlaps = !(br.right < xr.left || br.left > xr.right || br.bottom < xr.top || br.top > xr.bottom);
    return {
      badge: true,
      xp: true,
      overlaps,
      badgeRect: { t: br.top, r: br.right, b: br.bottom, l: br.left },
      xpRect: { t: xr.top, r: xr.right, b: xr.bottom, l: xr.left },
      badgeInStrip: br.top < 80,
    };
  });

  const ok = w >= 768 || (overlap.badgeInStrip && !overlap.overlaps);
  console.log(w, JSON.stringify(overlap));
  if (!ok) failures.push({ w, overlap });
  await page.screenshot({ path: `tmp/responsive/verify_dashboard_${w}.png` });
}

// Budget + notes + marketplace quick overflow
for (const route of ['/budget', '/notes', '/marketplace', '/chat']) {
  for (const w of [320, 390, 1280]) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await dismiss();
    const ov = await page.evaluate(() => {
      const d = document.documentElement;
      return { overflow: d.scrollWidth - d.clientWidth };
    });
    if (ov.overflow > 1) {
      failures.push({ route, w, ...ov });
      console.log('OVERFLOW', route, w, ov.overflow);
    } else {
      console.log('ok', route, w);
    }
    await page.screenshot({ path: `tmp/responsive/verify_${route.replace(/\//g, '')}_${w}.png` });
  }
}

// Landing
await page.context().clearCookies();
for (const w of [320, 390, 768, 1440]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  console.log('landing', w, ov);
  if (ov > 1) failures.push({ route: '/', w, overflow: ov });
  await page.screenshot({ path: `tmp/responsive/verify_landing_${w}.png` });
}

console.log('FAILURES', failures.length, JSON.stringify(failures));
await browser.close();
process.exit(failures.length ? 1 : 0);
