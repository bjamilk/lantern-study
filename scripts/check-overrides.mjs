#!/usr/bin/env node
/**
 * Fail when a declared npm `override` is not actually what got installed.
 *
 * npm applies overrides while building the dependency tree. If an existing
 * lockfile already satisfies a dependency, `npm install` reports "up to date"
 * and silently leaves the old version in place — so a security override can sit
 * in package.json for months while the vulnerable version stays installed.
 *
 * That is not hypothetical here. All three of these were declared and none were
 * applied:
 *   jws            ^4.0.1     -> 4.0.0 installed
 *   path-to-regexp ^8.4.2     -> 8.3.0 installed
 *   lodash         ^4.17.24   -> 4.17.21 installed, and 4.17.24 was never
 *                               published at all, so the range was unsatisfiable
 *
 * Run: node scripts/check-overrides.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const overrides = pkg.overrides ?? {};

/**
 * Scoped overrides such as { metro: { ws: "^7.5.11" } } deliberately pin a
 * different version *underneath* one parent. Those copies must not be judged
 * against the root-level range, so record them as exemptions.
 */
const exemptions = new Map(); // package -> [parent, ...]
for (const [parent, spec] of Object.entries(overrides)) {
  if (typeof spec === 'string') continue;
  for (const child of Object.keys(spec)) {
    if (!exemptions.has(child)) exemptions.set(child, []);
    exemptions.get(child).push(parent);
  }
}

/**
 * Walk node_modules trees collecting every installed copy of `name`.
 * Scope directories (@scope) are expanded so that @types/ws is recorded as
 * "@types/ws" and never mistaken for "ws".
 */
function collect(nmDir, name, out = []) {
  if (!existsSync(nmDir)) return out;
  let entries;
  try {
    entries = readdirSync(nmDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === '.bin' || entry.name === '.package-lock.json') continue;

    if (entry.name.startsWith('@')) {
      const scopeDir = join(nmDir, entry.name);
      let subs = [];
      try {
        subs = readdirSync(scopeDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const sub of subs) {
        if (!sub.isDirectory() && !sub.isSymbolicLink()) continue;
        const full = join(scopeDir, sub.name);
        record(`${entry.name}/${sub.name}`, full, name, out);
        collect(join(full, 'node_modules'), name, out);
      }
      continue;
    }

    const full = join(nmDir, entry.name);
    record(entry.name, full, name, out);
    collect(join(full, 'node_modules'), name, out);
  }
  return out;
}

function record(pkgName, full, wanted, out) {
  if (pkgName !== wanted) return;
  const manifest = join(full, 'package.json');
  if (!existsSync(manifest)) return;
  try {
    const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
    if (version) out.push({ version, path: relative(root, full) });
  } catch {
    /* unreadable manifest — ignore */
  }
}

/**
 * Copies that knowingly sit outside their override range. Keep this list short and
 * justified — each entry must state why the override's security intent is still met.
 * Re-check an entry whenever `npm audit` starts reporting the package.
 */
const ACCEPTED = [
  {
    pkg: 'minimatch',
    pathIncludes: 'api-server/node_modules/minimatch',
    reason: 'eslint pins minimatch 3.x internally; 3.1.5 is the patched release and npm audit does not flag it',
  },
  {
    pkg: 'brace-expansion',
    pathIncludes: 'api-server/node_modules/brace-expansion',
    reason: 'same eslint dependency chain; 1.1.18 is patched and unflagged by npm audit',
  },
];

const isAccepted = (pkg, path) =>
  ACCEPTED.some((a) => a.pkg === pkg && path.includes(a.pathIncludes));

const failures = [];
const rows = [];

for (const [name, spec] of Object.entries(overrides)) {
  if (typeof spec !== 'string') {
    rows.push({ status: 'scoped', name, spec: Object.keys(spec).map((k) => `${k}=${spec[k]}`).join(' ') });
    continue;
  }

  const exemptParents = exemptions.get(name) ?? [];
  const installed = collect(join(root, 'node_modules'), name).filter(
    (i) => !exemptParents.some((p) => i.path.includes(`node_modules/${p}/`))
  );

  if (installed.length === 0) {
    rows.push({ status: 'absent', name, spec });
    continue;
  }

  const bad = installed.filter(
    (i) => !semver.satisfies(i.version, spec, { includePrerelease: true }) && !isAccepted(name, i.path)
  );
  const waived = installed.some(
    (i) => !semver.satisfies(i.version, spec, { includePrerelease: true }) && isAccepted(name, i.path)
  );
  rows.push({ status: bad.length ? 'FAIL' : waived ? 'ok*' : 'ok', name, spec });
  if (bad.length) failures.push({ name, spec, bad });
}

const width = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log(`  ${r.status.padEnd(6)} ${r.name.padEnd(width)}  ${r.spec}`);

if (failures.length > 0) {
  console.error('\nOVERRIDE CHECK FAILED — declared but not installed:\n');
  for (const f of failures) {
    console.error(`  ${f.name} declares ${f.spec}`);
    for (const b of f.bad) console.error(`      ${b.version}  ${b.path}`);
  }
  console.error(
    '\nnpm keeps whatever the lockfile already satisfies, so adding an override is\n' +
      'not enough on its own. To force re-resolution:\n' +
      '  npm update <package>\n' +
      'Also confirm the range is publishable — an override pinning a version that\n' +
      'was never released silently does nothing.\n'
  );
  process.exit(1);
}

console.log('\nOverride check passed.');
