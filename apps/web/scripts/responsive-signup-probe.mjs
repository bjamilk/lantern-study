/**
 * Create a temporary audit account via signup UI.
 * Writes credentials to tmp/responsive/audit-creds.local.json (gitignored).
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

const stamp = Date.now().toString(36);
const email = process.env.AUDIT_EMAIL || `responsive.audit.${stamp}@mailinator.com`;
const password = process.env.AUDIT_PASSWORD || 'AuditTest!23456Aa';
const username = `rqa_${stamp}`.slice(0, 20);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 390, height: 844 });

async function dismiss() {
  for (const label of ['Accept', 'Got it', 'Continue', 'Skip', 'Not now', 'Close']) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(200);
    }
  }
}

await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(1000);
await dismiss();

await page.fill('#firstName', 'Responsive');
await page.fill('#lastName', 'Auditor');
await page.fill('#username', username);
await page.fill('#phone', '5551234567');
await page.fill('#email', email);
await page.fill('#password', password);
await page.fill('#confirmPassword', password);

// Wait for username availability check
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, 'signup_before_submit.png') });

const errBefore = await page.locator('#auth-form-error, .text-red-500, [role="alert"]').allTextContents().catch(() => []);
console.log('ERR_BEFORE', errBefore);

await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(5000);
await dismiss();

const url = page.url();
const alerts = await page.locator('#auth-form-error, [role="alert"]').allTextContents().catch(() => []);
console.log('AFTER_SIGNUP_URL', url);
console.log('ALERTS', alerts);
const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 900);
console.log('BODY_SNIP', body);
await page.screenshot({ path: path.join(OUT, 'signup_after_submit.png') });

const loggedIn = /dashboard|library|study|notes|marketplace|budget|chat|flashcards|offline|admin/i.test(url);
const verify = /verify/i.test(url) || /verify|check your email|confirm/i.test(body);
const credPath = path.join(OUT, 'audit-creds.local.json');
fs.writeFileSync(credPath, JSON.stringify({ email, password, username, url, loggedIn, verify, alerts }, null, 2));
console.log('Wrote', credPath, { loggedIn, verify });

await browser.close();
process.exit(loggedIn || verify ? 0 : 1);
