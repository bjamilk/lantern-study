#!/usr/bin/env node
/**
 * Ratcheting type-check gate for the web app's ROOT-LEVEL source graph.
 *
 * Why: vite.config.ts sets the web app's `root` to the REPO ROOT, so App.tsx,
 * components/, hooks/, stores/, services/, utils/ and design-system/ are the
 * real inputs of the shipped bundle — but apps/web/tsconfig.json `include`s
 * only `src`, and `vite build` strips types without checking them. That whole
 * graph was type-checked by nothing, in the build or in CI, and it had accrued
 * 800-odd errors plus at least one real bug (utils/appNavigation.ts read
 * `selectedNote` off the UI store, which has no such field).
 *
 * Fixing 800 errors in one pull request is not reviewable, and widening
 * apps/web/tsconfig.json would fail every build and every deploy. So this
 * script freezes the known set in scripts/web-typecheck-baseline.json and
 * fails on anything that is not in it. The baseline may only shrink.
 *
 * It fails in BOTH directions on purpose:
 *   - a NEW error, or MORE of an error already known, fails the build;
 *   - FEWER errors than the baseline also fails, with a one-line `--update`
 *     instruction, so a gain is banked in the baseline instead of quietly
 *     leaving room for the next regression to slip in under the old count.
 *
 * An error's key is `file + TS code + the first 200 chars of the message` —
 * deliberately NOT the line/column, so moving code around does not churn the
 * baseline and does not need a rebaseline commit to stay green.
 *
 * Usage:
 *   node scripts/check-web-typecheck.mjs            # verify against baseline
 *   node scripts/check-web-typecheck.mjs --update   # rewrite the baseline
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = 'apps/web/tsconfig.typecheck.json';
const BASELINE_PATH = path.join(REPO_ROOT, 'scripts', 'web-typecheck-baseline.json');
const MESSAGE_KEY_LENGTH = 200;
const UPDATE = process.argv.includes('--update');

/**
 * `path/to/file.ts(12,34): error TS2532: Object is possibly 'undefined'.`
 * Continuation lines of a multi-line diagnostic are indented and do not match,
 * which is what we want: the first line already identifies the diagnostic.
 */
const ERROR_LINE = /^(?<file>[^(\s][^(]*)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): (?<message>.*)$/;

function runTsc() {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      PROJECT,
      '--noEmit',
      '--pretty',
      'false',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) {
    console.error(`check-web-typecheck: could not run tsc: ${result.error.message}`);
    process.exit(2);
  }
  return `${result.stdout || ''}${result.stderr || ''}`;
}

/** @returns {Map<string, number>} key -> how many times it occurred */
function collect(output) {
  const counts = new Map();
  for (const rawLine of output.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(rawLine);
    if (!match) continue;
    const { file, code, message } = match.groups;
    // Normalise separators so a Windows checkout produces the same keys.
    const key = `${file.split(path.sep).join('/')} ${code} ${message.slice(0, MESSAGE_KEY_LENGTH)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function total(counts) {
  let sum = 0;
  for (const n of counts.values()) sum += n;
  return sum;
}

function toBaseline(counts) {
  const errors = {};
  for (const key of [...counts.keys()].sort()) errors[key] = counts.get(key);
  return {
    '//': 'Frozen set of pre-existing type errors in the web app root graph. See scripts/check-web-typecheck.mjs. This file may only shrink: fix errors, then run `node scripts/check-web-typecheck.mjs --update`.',
    project: PROJECT,
    total: total(counts),
    fileCount: new Set([...counts.keys()].map((k) => k.split(' ')[0])).size,
    errors,
  };
}

const output = runTsc();
// tsc exits non-zero simply because errors exist, so the exit code says
// nothing; a crash shows up as output that parses to no diagnostics at all.
const current = collect(output);
// A genuinely clean run prints nothing at all; output that parses to no
// diagnostic means tsc failed to start or the project file is broken.
if (current.size === 0 && output.trim() !== '') {
  console.error(`check-web-typecheck: tsc produced no parseable diagnostics. Raw output:\n${output}`);
  process.exit(2);
}

if (UPDATE) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(current), null, 2)}\n`);
  console.log(
    `check-web-typecheck: baseline updated — ${total(current)} errors across ${
      new Set([...current.keys()].map((k) => k.split(' ')[0])).size
    } files.`,
  );
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error(
    `check-web-typecheck: no baseline at scripts/web-typecheck-baseline.json.\n` +
      `  Create it with: node scripts/check-web-typecheck.mjs --update`,
  );
  process.exit(2);
}

/** @type {{errors: Record<string, number>}} */
const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
const expected = new Map(Object.entries(baseline.errors ?? {}));

const added = [];
for (const [key, count] of current) {
  const allowed = expected.get(key) ?? 0;
  if (count > allowed) added.push({ key, count, allowed });
}
const removed = [];
for (const [key, allowed] of expected) {
  const count = current.get(key) ?? 0;
  if (count < allowed) removed.push({ key, count, allowed });
}

const UPDATE_HINT = 'run `node scripts/check-web-typecheck.mjs --update` and commit scripts/web-typecheck-baseline.json.';

if (added.length > 0) {
  console.error(
    `check-web-typecheck: ${added.length} new type error${added.length === 1 ? '' : 's'} in the web app root graph ` +
      `(project ${PROJECT}).\n`,
  );
  for (const { key, count, allowed } of added) {
    const suffix = allowed === 0 ? '' : ` (baseline allows ${allowed}, found ${count})`;
    console.error(`  NEW  ${key}${suffix}`);
  }
  console.error(
    `\nThis graph is not compiled by \`npm run build\` — that is exactly why this gate exists.\n` +
      `Fix the error above. If it is genuinely pre-existing and you can show why, ${UPDATE_HINT}`,
  );
  process.exit(1);
}

if (removed.length > 0) {
  const fixed = removed.reduce((sum, r) => sum + (r.allowed - r.count), 0);
  console.error(
    `check-web-typecheck: ${fixed} baseline error${fixed === 1 ? '' : 's'} no longer occur${fixed === 1 ? 's' : ''} ` +
      `(${total(current)} now, baseline says ${total(expected)}). Good — but the baseline must move down with it, ` +
      `or the slack left behind hides the next regression.\n`,
  );
  for (const { key, count, allowed } of removed.slice(0, 20)) {
    console.error(`  FIXED  ${key} (was ${allowed}, now ${count})`);
  }
  if (removed.length > 20) console.error(`  … and ${removed.length - 20} more.`);
  console.error(`\nBank it: ${UPDATE_HINT}`);
  process.exit(1);
}

console.log(
  `check-web-typecheck: OK — ${total(current)} known errors across ${baseline.fileCount ?? '?'} files, ` +
    `exactly matching scripts/web-typecheck-baseline.json.`,
);
process.exit(0);
