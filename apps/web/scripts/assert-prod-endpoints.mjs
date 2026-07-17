/**
 * Fail production web builds that bake localhost API URLs.
 * Deployed web must use same-origin `/api` (Cloudflare Pages Function → Render)
 * so HttpOnly auth cookies stay first-party.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../../../dist');

const FORBIDDEN = [
  /__LANTERN_VITE_API_URL__\s*:\s*"https?:\/\/localhost/i,
  /__LANTERN_VITE_API_URL__\s*:\s*"https?:\/\/127\.0\.0\.1/i,
  /__LANTERN_VITE_SUPABASE_URL__\s*:\s*"https?:\/\/(localhost|127\.0\.0\.1)/i,
];

const REQUIRED = [
  /tiizkjhbrnaibaagmurl\.supabase\.co/,
];

if (!fs.existsSync(distDir)) {
  console.error(`[assert-prod-endpoints] Missing dist/ at ${distDir}`);
  process.exit(1);
}

const jsFiles = fs
  .readdirSync(distDir, { recursive: true })
  .map((f) => String(f))
  .filter((f) => f.endsWith('.js'))
  .map((f) => path.join(distDir, f));

let blob = '';
for (const file of jsFiles) {
  blob += fs.readFileSync(file, 'utf8');
}

const failures = [];
for (const re of FORBIDDEN) {
  if (re.test(blob)) {
    failures.push(`Forbidden pattern in bundle: ${re}`);
  }
}
for (const re of REQUIRED) {
  if (!re.test(blob)) {
    failures.push(`Required production endpoint missing from bundle: ${re}`);
  }
}

// Runtime resolveWebApiBaseUrl forces same-origin '' on deployed hosts even if
// onrender.com was baked in — either is acceptable for the build gate.
const hasCloudApi =
  /lantern-study-api\.onrender\.com/.test(blob) ||
  /__LANTERN_VITE_API_URL__\s*:\s*""/.test(blob) ||
  /__LANTERN_VITE_API_URL__\s*:\s*"https:\/\/(www\.)?lanternstudy\.com"/.test(blob);
if (!hasCloudApi) {
  failures.push(
    'Expected baked API URL to be onrender.com, lanternstudy.com, or empty (same-origin /api proxy)'
  );
}

if (failures.length) {
  console.error('[assert-prod-endpoints] Production web build is not phone-safe:\n');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nSet Cloudflare / build env to:');
  console.error('  VITE_API_URL=https://lantern-study-api.onrender.com  (runtime remaps to same-origin /api)');
  console.error('  VITE_SUPABASE_URL=https://tiizkjhbrnaibaagmurl.supabase.co');
  process.exit(1);
}

console.log('[assert-prod-endpoints] OK — Supabase present; API is cloud or same-origin proxy-ready.');
