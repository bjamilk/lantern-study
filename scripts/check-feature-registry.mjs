#!/usr/bin/env node
/**
 * Fails when a mobile release lands without touching the admin feature
 * registry.
 *
 * The registry (components/admin/productFeatures.ts) is hand-maintained and
 * powers Admin -> Features, which support and QA use as the record of what
 * shipped. Nothing derives it from git, so it only advances when someone writes
 * an entry — and it silently fell a month behind, leaving the Marketplace and
 * Platform filters empty while both had shipped work.
 *
 * The trigger is a change to `version` in apps/mobile/app.config.ts, which is
 * the project's release marker (and the OTA runtime fence). If that moved and
 * the registry did not, this fails and says so.
 *
 * Escape hatch for genuine no-op bumps (a rebuild with no user-visible change):
 * put [skip registry] in a commit message in the range.
 *
 * Usage:
 *   node scripts/check-feature-registry.mjs                  # vs origin/main
 *   node scripts/check-feature-registry.mjs --base <ref>
 */
import { execFileSync } from 'node:child_process';

const CONFIG_PATH = 'apps/mobile/app.config.ts';
const REGISTRY_PATH = 'components/admin/productFeatures.ts';
const SKIP_TOKEN = '[skip registry]';

function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      // Silence git's own stderr on the tolerated failures (a base ref that
      // does not exist after a force-push, say) — it reads as a broken build
      // in the CI log when it is a case this script handles deliberately.
      stdio: allowFail ? ['ignore', 'pipe', 'ignore'] : ['ignore', 'pipe', 'inherit'],
    }).trim();
  } catch (error) {
    if (allowFail) return null;
    throw error;
  }
}

function parseBase() {
  const index = process.argv.indexOf('--base');
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  return process.env.REGISTRY_CHECK_BASE || 'origin/main';
}

/** `version: '1.0.25'` — the release marker, not any other version field. */
function readVersion(ref) {
  const file = git(['show', `${ref}:${CONFIG_PATH}`], { allowFail: true });
  if (file === null) return null;
  const match = file.match(/^\s*version:\s*'([^']+)'/m);
  return match ? match[1] : null;
}

function readEntryIds(ref) {
  const file = git(['show', `${ref}:${REGISTRY_PATH}`], { allowFail: true });
  if (file === null) return null;
  return new Set([...file.matchAll(/^\s{4}id: '([^']+)'/gm)].map((m) => m[1]));
}

const base = parseBase();
const head = 'HEAD';

// A shallow clone has no base commit to compare against; skipping beats
// failing every run for a reason that has nothing to do with the registry.
if (git(['rev-parse', '--verify', base], { allowFail: true }) === null) {
  console.log(`[feature-registry] base ref "${base}" not available — skipping.`);
  process.exit(0);
}

const baseVersion = readVersion(base);
const headVersion = readVersion(head);

if (baseVersion === null || headVersion === null) {
  console.log('[feature-registry] could not read the mobile version on both sides — skipping.');
  process.exit(0);
}

if (baseVersion === headVersion) {
  console.log(`[feature-registry] mobile version unchanged (${headVersion}) — nothing to check.`);
  process.exit(0);
}

const messages = git(['log', '--format=%B', `${base}..${head}`], { allowFail: true }) || '';
if (messages.toLowerCase().includes(SKIP_TOKEN)) {
  console.log(`[feature-registry] "${SKIP_TOKEN}" found in the range — skipping.`);
  process.exit(0);
}

const baseIds = readEntryIds(base) ?? new Set();
const headIds = readEntryIds(head) ?? new Set();
const added = [...headIds].filter((id) => !baseIds.has(id));

const registryTouched =
  git(['diff', '--name-only', `${base}..${head}`, '--', REGISTRY_PATH], { allowFail: true }) || '';

if (added.length > 0) {
  console.log(
    `[feature-registry] OK — ${baseVersion} -> ${headVersion} adds ${added.length} entr${
      added.length === 1 ? 'y' : 'ies'
    }: ${added.join(', ')}`
  );
  process.exit(0);
}

if (registryTouched) {
  // An existing entry changed (status corrected, commit sha appended). That is
  // a deliberate registry update, so it counts.
  console.log(
    `[feature-registry] OK — ${baseVersion} -> ${headVersion} updates existing entries (no new ids).`
  );
  process.exit(0);
}

console.error(
  [
    '',
    `[feature-registry] FAILED — mobile version went ${baseVersion} -> ${headVersion}, but`,
    `${REGISTRY_PATH} was not touched.`,
    '',
    'Admin -> Features is the record support and QA read to find out what shipped.',
    'Nothing generates it, so a release without an entry makes it quietly wrong.',
    '',
    'Fix by doing one of:',
    `  1. Add an entry to PRODUCT_FEATURES in ${REGISTRY_PATH}`,
    '     (id, title, area, status, shippedAt, summary, details, howToUse,',
    '      surfaces, adminNotes, commits) — status may be "partial" if the',
    '      feature shipped incomplete; say what is missing in adminNotes.',
    '  2. Update an existing entry, if this release changed one.',
    `  3. If this bump genuinely ships nothing user-visible, put "${SKIP_TOKEN}"`,
    '     in a commit message.',
    '',
  ].join('\n')
);
process.exit(1);
