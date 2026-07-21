import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
fs.mkdirSync('tmp/responsive', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.fill('#email', process.env.AUDIT_EMAIL);
await page.fill('#password', process.env.AUDIT_PASSWORD);
await page.locator('button[type="submit"]').click();
await page.waitForURL(/dashboard/, { timeout: 90000 });
await page.waitForTimeout(2000);

for (let i = 0; i < 10; i++) {
  await page.keyboard.press('Escape').catch(() => {});
  for (const label of [
    'Skip',
    'Skip for now',
    'Continue',
    'Got it',
    'Accept',
    'Not now',
    'Close',
    'Done',
    'Finish',
    'Get started',
    "Don't show again",
  ]) {
    const b = page.getByRole('button', { name: new RegExp(`^${label}$`, 'i') }).first();
    if (await b.isVisible().catch(() => false)) await b.click({ timeout: 800 }).catch(() => {});
  }
  await page.waitForTimeout(150);
}

await page.screenshot({ path: 'tmp/responsive/nav_diag_390.png', fullPage: true });

const diag = await page.evaluate(() => {
  const more = document.querySelector('[aria-label="More"]');
  const allNav = [...document.querySelectorAll('nav')].map((n) => {
    const r = n.getBoundingClientRect();
    const s = getComputedStyle(n);
    return {
      cls: String(n.className || '').slice(0, 120),
      display: s.display,
      visibility: s.visibility,
      position: s.position,
      z: s.zIndex,
      rect: {
        t: Math.round(r.top),
        b: Math.round(r.bottom),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
      text: (n.innerText || '').slice(0, 80).replace(/\s+/g, ' '),
    };
  });
  const fixed = [...document.querySelectorAll('body *')]
    .filter((el) => getComputedStyle(el).position === 'fixed')
    .map((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || '').slice(0, 100),
        display: s.display,
        z: s.zIndex,
        rect: {
          t: Math.round(r.top),
          b: Math.round(r.bottom),
          l: Math.round(r.left),
          w: Math.round(r.width),
          h: Math.round(r.height),
        },
        aria: el.getAttribute('aria-label'),
      };
    })
    .filter((x) => x.rect.h > 10 && x.display !== 'none')
    .slice(0, 25);

  const sidebar = document.querySelector('aside');
  const sideR = sidebar?.getBoundingClientRect();
  const sideS = sidebar ? getComputedStyle(sidebar) : null;

  return {
    morePresent: !!more,
    moreDisplay: more ? getComputedStyle(more).display : null,
    moreRect: more
      ? (() => {
          const r = more.getBoundingClientRect();
          return {
            t: Math.round(r.top),
            b: Math.round(r.bottom),
            w: Math.round(r.width),
            h: Math.round(r.height),
          };
        })()
      : null,
    navs: allNav,
    fixed,
    sidebar: sidebar
      ? {
          display: sideS.display,
          cls: String(sidebar.className || '').slice(0, 120),
          rect: sideR
            ? {
                t: Math.round(sideR.top),
                w: Math.round(sideR.width),
                h: Math.round(sideR.height),
              }
            : null,
        }
      : null,
    htmlWidth: document.documentElement.clientWidth,
    dialogs: [...document.querySelectorAll('[role="dialog"], [role="presentation"]')].map((el) => ({
      role: el.getAttribute('role'),
      cls: String(el.className || '').slice(0, 80),
      text: (el.textContent || '').slice(0, 80).replace(/\s+/g, ' '),
    })),
  };
});

fs.writeFileSync('tmp/responsive/nav_diag.json', JSON.stringify(diag, null, 2));
console.log(JSON.stringify(diag, null, 2));
await browser.close();
