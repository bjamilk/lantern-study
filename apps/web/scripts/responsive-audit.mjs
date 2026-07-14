/**
 * Runtime responsive overflow probe for Lantern Study web.
 * Credentials: AUDIT_EMAIL / AUDIT_PASSWORD env (never commit).
 *
 * Usage:
 *   AUDIT_EMAIL=... AUDIT_PASSWORD=... node apps/web/scripts/responsive-audit.mjs
 *   AUDIT_BASE_URL=http://localhost:5173 AUDIT_PHASE=public|authed|all
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'tmp/responsive');
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:5173';
const PHASE = process.env.AUDIT_PHASE || 'all';
const WIDTHS = [320, 360, 375, 390, 414, 480, 768, 820, 1024, 1280, 1440, 1920];
const HEIGHT = 800;

const PUBLIC_ROUTES = [
  '/',
  '/welcome',
  '/login',
  '/signup',
  '/forgot-password',
  '/privacy',
  '/terms',
  '/cookies',
  '/marketplace',
];

const AUTHED_ROUTES = [
  '/dashboard',
  '/library',
  '/study',
  '/ai-tools',
  '/notes',
  '/flashcards',
  '/chat',
  '/marketplace',
  '/marketplace/my-listings',
  '/marketplace/inquiries',
  '/marketplace/orders',
  '/marketplace/seller/customers',
  '/budget',
  '/offline',
  '/admin',
  '/groups/new',
];

fs.mkdirSync(OUT_DIR, { recursive: true });

function overflowMetrics(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollW = Math.max(doc.scrollWidth, body?.scrollWidth || 0);
    const clientW = doc.clientWidth;
    const offenders = [];
    const all = document.querySelectorAll('body *');
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      // Element clearly past right edge of viewport
      if (rect.right > clientW + 2) {
        const tag = el.tagName.toLowerCase();
        const cls = (el.className && typeof el.className === 'string'
          ? el.className
          : ''
        ).slice(0, 80);
        offenders.push({
          tag,
          cls,
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        });
        if (offenders.length >= 8) break;
      }
    }
    return {
      scrollWidth: scrollW,
      clientWidth: clientW,
      overflowPx: scrollW - clientW,
      hasOverflow: scrollW > clientW + 1,
      offenders,
      title: document.title,
      path: location.pathname,
    };
  });
}

async function dismissNoise(page) {
  // Cookie banner / onboarding — best-effort dismiss
  for (const label of ['Accept', 'Got it', 'Continue', 'Skip', 'Not now', 'Close']) {
    const btn = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await dismissNoise(page);
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/dashboard|library|marketplace|study|notes|budget|chat/i, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await dismissNoise(page);
  // Skip onboarding if present
  for (const label of ['Skip', 'Get started', 'Continue', 'Done', 'Finish']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  const url = page.url();
  if (!/dashboard|library|study|marketplace|budget|notes|flashcards|chat|offline|admin/.test(url)) {
    // Force dashboard if still stuck on auth
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1000);
  }
}

async function probeRoutes(page, routes, widths, failures, tag) {
  for (const route of routes) {
    for (const width of widths) {
      await page.setViewportSize({ width, height: HEIGHT });
      const url = `${BASE}${route}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(700);
        await dismissNoise(page);
        const m = await overflowMetrics(page);
        if (m.hasOverflow) {
          const id = `${tag}_${route.replace(/\//g, '_') || 'root'}_${width}`;
          const shot = path.join(OUT_DIR, `${id}.png`);
          await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
          failures.push({
            tag,
            route,
            width,
            overflowPx: m.overflowPx,
            scrollWidth: m.scrollWidth,
            clientWidth: m.clientWidth,
            offenders: m.offenders,
            screenshot: shot,
            finalPath: m.path,
          });
          console.log(`FAIL ${tag} ${route} @${width} overflow=${m.overflowPx}px path=${m.path}`);
        } else {
          process.stdout.write('.');
        }
      } catch (err) {
        failures.push({
          tag,
          route,
          width,
          error: String(err?.message || err),
        });
        console.log(`ERROR ${tag} ${route} @${width}: ${err?.message || err}`);
      }
    }
  }
}

async function probeZoomAndShort(page, failures) {
  const samples = [
    { route: '/login', width: 390, height: 500 },
    { route: '/dashboard', width: 390, height: 500 },
    { route: '/marketplace', width: 390, height: 500 },
    { route: '/budget', width: 390, height: 500 },
  ];
  for (const s of samples) {
    await page.setViewportSize({ width: s.width, height: s.height });
    await page.goto(`${BASE}${s.route}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(600);
    await dismissNoise(page);
    const m = await overflowMetrics(page);
    if (m.hasOverflow) {
      failures.push({
        tag: 'short-height',
        route: s.route,
        width: s.width,
        height: s.height,
        overflowPx: m.overflowPx,
        offenders: m.offenders,
      });
      console.log(`FAIL short ${s.route} ${s.width}x${s.height} overflow=${m.overflowPx}`);
    }
  }

  // Approximate browser zoom by shrinking/expanding the layout viewport.
  for (const zoom of [0.8, 1.25, 1.5, 2]) {
    const width = Math.round(1280 / zoom);
    const height = Math.round(800 / zoom);
    await page.setViewportSize({ width, height });
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(500);
    await dismissNoise(page);
    const m = await overflowMetrics(page);
    if (m.hasOverflow && m.overflowPx > 8) {
      failures.push({
        tag: 'zoom',
        route: '/dashboard',
        width,
        height,
        zoom,
        overflowPx: m.overflowPx,
        offenders: m.offenders,
      });
      console.log(`FAIL zoom ${zoom} dashboard overflow=${m.overflowPx}`);
    }
  }
}

async function main() {
  const email = process.env.AUDIT_EMAIL;
  const password = process.env.AUDIT_PASSWORD;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const failures = [];

  console.log(`Base ${BASE} phase=${PHASE}`);

  if (PHASE === 'public' || PHASE === 'all') {
    console.log('\n== PUBLIC ==');
    await probeRoutes(page, PUBLIC_ROUTES, WIDTHS, failures, 'public');
  }

  if (PHASE === 'authed' || PHASE === 'all') {
    if (!email || !password) {
      console.error('AUDIT_EMAIL and AUDIT_PASSWORD required for authed phase');
      process.exitCode = 2;
    } else {
      console.log('\n== LOGIN ==');
      await login(page, email, password);
      console.log('Logged in URL:', page.url());
      console.log('\n== AUTHED ==');
      await probeRoutes(page, AUTHED_ROUTES, WIDTHS, failures, 'authed');
      console.log('\n== SHORT/ZOOM ==');
      await probeZoomAndShort(page, failures);
    }
  }

  await browser.close();

  const reportPath = path.join(OUT_DIR, 'report.json');
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        base: BASE,
        phase: PHASE,
        widths: WIDTHS,
        failureCount: failures.length,
        failures,
      },
      null,
      2
    )
  );
  console.log(`\n\nReport: ${reportPath}`);
  console.log(`Failures: ${failures.length}`);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
