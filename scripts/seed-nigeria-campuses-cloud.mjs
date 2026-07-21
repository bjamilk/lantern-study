#!/usr/bin/env node
/**
 * Upsert Nigerian marketplace campuses to Supabase Cloud via PostgREST.
 * Used when `supabase db push` cannot run due to migration history mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadEnv(filePath) {
  const out = {};
  if (!fs.existsSync(filePath)) return out;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = {
  ...loadEnv(path.join(repoRoot, '.env.resend')),
  ...loadEnv(path.join(repoRoot, 'apps/api-server/.env')),
};

const url = (env.SUPABASE_URL || '').replace(/\/$/, '');
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const src = fs.readFileSync(
  path.join(repoRoot, 'packages/shared/src/marketplace/campuses.ts'),
  'utf8'
);
const rows = [];
const re =
  /\{\s*name:\s*"([^"]+)",\s*city:\s*"([^"]+)",\s*state:\s*"([^"]+)",\s*country_code:\s*'NG',\s*slug:\s*"([^"]+)"\s*\}/g;
let match;
while ((match = re.exec(src))) {
  rows.push({
    name: match[1],
    city: match[2],
    state: match[3],
    country_code: 'NG',
    slug: match[4],
    active: true,
  });
}

if (rows.length < 50) {
  console.error(`Parsed too few campuses (${rows.length}); aborting.`);
  process.exit(1);
}

console.log(`Upserting ${rows.length} campuses to ${url}...`);

async function upsertBatch(batch) {
  const res = await fetch(`${url}/rest/v1/marketplace_campuses?on_conflict=slug`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(batch),
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
}

for (let i = 0; i < rows.length; i += 50) {
  await upsertBatch(rows.slice(i, i + 50));
  process.stdout.write('.');
}

const countRes = await fetch(
  `${url}/rest/v1/marketplace_campuses?country_code=eq.NG&select=slug`,
  {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  }
);
console.log(`\nNG campus content-range: ${countRes.headers.get('content-range')}`);

const otherRes = await fetch(
  `${url}/rest/v1/marketplace_campuses?slug=eq.other-city-nigeria&select=name,slug`,
  {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }
);
const other = await otherRes.json();
console.log('Other city row:', other);
console.log('Done.');
