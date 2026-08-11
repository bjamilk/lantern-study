#!/usr/bin/env node
/**
 * CI gate: `npm audit` with a curated allowlist instead of a blanket pass/fail.
 *
 * `npm audit --audit-level=high` went permanently red because a handful of
 * high-severity advisories are upstream-blocked: their only fix is a major
 * upgrade we have deliberately ruled out (e.g. expo@57 would undo the
 * Reanimated 3 / Legacy Architecture downgrade). A blanket `|| true` would
 * hide NEW advisories, so instead:
 *
 *   - scripts/audit-allowlist.json lists the specific blocked GHSA ids, each
 *     with the reason and the major upgrade that unblocks it.
 *   - This script runs `npm audit --json`, collects every advisory at or above
 *     the configured fail level (high), and fails if any advisory is NOT on
 *     the allowlist. A new high/critical advisory therefore still breaks CI.
 *   - Allowlist entries that no longer show up are reported as stale so the
 *     list shrinks as upstream fixes land (stale entries warn, not fail, so a
 *     dependency fix cannot be blocked by its own allowlist entry).
 *
 * Run: node scripts/check-audit.mjs
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(root, 'scripts', 'audit-allowlist.json'), 'utf8'));

const LEVELS = ['info', 'low', 'moderate', 'high', 'critical'];
const failLevel = LEVELS.indexOf(config.failLevel ?? 'high');
if (failLevel === -1) {
  console.error(`Invalid failLevel "${config.failLevel}" in audit-allowlist.json`);
  process.exit(1);
}

// npm audit exits non-zero whenever vulnerabilities exist, so ignore the exit
// code and judge the parsed JSON instead.
const res = spawnSync('npm', ['audit', '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});
if (res.error) {
  console.error('Failed to spawn npm audit:', res.error.message);
  process.exit(1);
}

let audit;
try {
  audit = JSON.parse(res.stdout);
} catch {
  console.error('npm audit did not produce parseable JSON. stderr:\n' + res.stderr);
  process.exit(1);
}
if (audit.error) {
  console.error(`npm audit reported an error: ${audit.error.code ?? ''} ${audit.error.summary ?? ''}`);
  process.exit(1);
}
if (!audit.vulnerabilities || !audit.metadata) {
  console.error('Unexpected npm audit JSON shape (missing vulnerabilities/metadata).');
  process.exit(1);
}

// Collect the ROOT advisories (objects inside `via`) at or above the fail
// level. Transitive "depends on vulnerable versions of X" rows carry only
// string references, so gating on the root advisories covers every chain.
const found = new Map(); // GHSA id -> { name, title, severity }
for (const vuln of Object.values(audit.vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== 'object' || via === null) continue;
    if (LEVELS.indexOf(via.severity) < failLevel) continue;
    const id = String(via.url ?? '').split('/').pop() || `advisory-${via.source}`;
    found.set(id, { name: via.name, title: via.title, severity: via.severity });
  }
}

const allowed = new Map(config.allowlist.map((e) => [e.id, e]));
const unexpected = [...found].filter(([id]) => !allowed.has(id));
const stale = [...allowed.keys()].filter((id) => !found.has(id));

const counts = audit.metadata.vulnerabilities;
console.log(
  `npm audit: ${counts.total} total (critical:${counts.critical} high:${counts.high} ` +
    `moderate:${counts.moderate} low:${counts.low} info:${counts.info}); ` +
    `gating on ${LEVELS[failLevel]}+`
);
for (const [id, info] of found) {
  const entry = allowed.get(id);
  const status = entry ? 'allowlisted' : 'NEW      ';
  console.log(`  ${status}  ${id}  ${info.severity}  ${info.name}: ${info.title}`);
  if (entry) console.log(`               reason: ${entry.reason}\n               unblocked by: ${entry.unblockedBy}`);
}

if (stale.length > 0) {
  console.warn(
    `\nSTALE allowlist entries (advisory no longer reported — prune from scripts/audit-allowlist.json):`
  );
  for (const id of stale) console.warn(`  ${id} (${allowed.get(id).package})`);
}

if (unexpected.length > 0) {
  console.error(
    `\nAUDIT GATE FAILED — ${unexpected.length} ${LEVELS[failLevel]}+ advisor${
      unexpected.length === 1 ? 'y is' : 'ies are'
    } not on the allowlist:\n`
  );
  for (const [id, info] of unexpected) {
    console.error(`  ${id}  ${info.severity}  ${info.name}: ${info.title}`);
    console.error(`      https://github.com/advisories/${id}`);
  }
  console.error(
    '\nEither fix the dependency (preferred — see scripts/check-overrides.mjs for the\n' +
      'surgical lockfile procedure) or, if the fix is genuinely blocked on a forbidden\n' +
      'major upgrade, add the GHSA id to scripts/audit-allowlist.json with a reason\n' +
      'and the upgrade that unblocks it.\n'
  );
  process.exit(1);
}

console.log('\nAudit gate passed.');
