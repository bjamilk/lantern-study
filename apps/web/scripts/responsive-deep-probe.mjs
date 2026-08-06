/**
 * Deeper responsive probe: public + interactive overlays, short heights, landscape.
 * Writes tmp/responsive/deep-report.json
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'tmp/responsive');
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
fs.mkdirSync(OUT_DIR, { recursive: true });

const WIDTHS = [320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280, 1440, 1920];

async function metrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const clientW = doc.clientWidth;
    const clientH = doc.clientHeight;
    const scrollW = Math.max(doc.scrollWidth, document.body?.scrollWidth || 0);
    const offenders = [];
    const tinyTaps = [];
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.right > clientW + 2) {
        offenders.push({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          text: (el.textContent || '').trim().slice(0, 40),
        });
        if (offenders.length >= 12) break;
      }
    }
    for (const el of document.querySelectorAll('button, a, [role="button"], input, select, textarea')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.width < 40 || rect.height < 40) {
        // Ignore pure text links inside paragraphs for this probe
        const tag = el.tagName.toLowerCase();
        if (tag === 'a' && !el.getAttribute('role') && rect.height < 24) continue;
        tinyTaps.push({
          tag,
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 40),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
        if (tinyTaps.length >= 10) break;
      }
    }
    return {
      path: location.pathname,
      clientW,
      clientH,
      scrollW,
      overflowPx: scrollW - clientW,
      hasOverflow: scrollW > clientW + 1,
      offenders,
      tinyTaps,
    };
  });
}

async function dismiss(page) {
  for (const label of ['Accept all', 'Essential only', 'Got it', 'Skip', 'Not now', 'Close']) {
    const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(150);
    }
  }
}

async function probe(page, route, width, height, failures, tag, interact) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch((e) => {
    failures.push({ tag, route, width, height, error: String(e.message || e) });
  });
  await page.waitForTimeout(500);
  await dismiss(page);
  if (interact) await interact(page).catch(() => {});
  await page.waitForTimeout(300);
  const m = await metrics(page);
  if (m.hasOverflow) {
    const id = `${tag}_${route.replace(/\//g, '_') || 'root'}_${width}x${height}`;
    const shot = path.join(OUT_DIR, `${id}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    failures.push({ tag, route, width, height, ...m, screenshot: shot });
    console.log(`FAIL ${tag} ${route} @${width}x${height} overflow=${m.overflowPx}`);
  } else {
    process.stdout.write('.');
  }
  // Tiny taps are recorded as advisories, not hard fails (many intentional icon buttons use padding)
  if (m.tinyTaps?.length && width <= 414) {
    failures.push({
      tag: 'tiny-tap-advisory',
      route,
      width,
      height,
      tinyTaps: m.tinyTaps,
      severity: 'advisory',
    });
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const failures = [];
  console.log(`Deep probe base=${BASE}`);

  const routes = [
    '/',
    '/welcome',
    '/login',
    '/signup',
    '/forgot-password',
    '/verify-email',
    '/privacy',
    '/terms',
    '/cookies',
    '/marketplace',
  ];

  for (const route of routes) {
    for (const width of WIDTHS) {
      await probe(page, route, width, 800, failures, 'public', null);
    }
    // short height + landscape
    await probe(page, route, 390, 500, failures, 'short', null);
    await probe(page, route, 740, 360, failures, 'landscape', null);
  }

  // Interactive: long email on login/signup/verify
  const longEmail = 'very.long.responsive.audit.address.that.should.not.clip@example.com';
  for (const width of [320, 360, 390]) {
    await probe(page, '/login', width, 800, failures, 'long-email-login', async (p) => {
      await p.fill('#email', longEmail).catch(() => {});
      await p.fill('#password', 'Password123!').catch(() => {});
    });
    await probe(page, '/signup', width, 800, failures, 'long-email-signup', async (p) => {
      const email = p.locator('input[type="email"], #email, #signupEmail').first();
      await email.fill(longEmail).catch(() => {});
    });
    await probe(page, '/verify-email', width, 720, failures, 'long-email-verify', async (p) => {
      await p.fill('#verifyEmail', longEmail).catch(() => {});
    });
  }

  // Marketplace: open filters if present
  for (const width of [320, 390, 768, 1280]) {
    await probe(page, '/marketplace', width, 800, failures, 'marketplace-filters', async (p) => {
      const filterBtn = p.getByRole('button', { name: /filter/i }).first();
      if (await filterBtn.isVisible().catch(() => false)) await filterBtn.click().catch(() => {});
    });
  }

  await browser.close();
  const hard = failures.filter((f) => f.severity !== 'advisory' && (f.hasOverflow || f.error));
  const advisories = failures.filter((f) => f.severity === 'advisory');
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    hardFailureCount: hard.length,
    advisoryCount: advisories.length,
    hard,
    advisories: advisories.slice(0, 40),
  };
  fs.writeFileSync(path.join(OUT_DIR, 'deep-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nHard failures: ${hard.length}; advisories: ${advisories.length}`);
  console.log(`Report: ${path.join(OUT_DIR, 'deep-report.json')}`);
  if (hard.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
