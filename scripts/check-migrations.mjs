#!/usr/bin/env node
/**
 * Migration lint.
 *
 * 208 files in supabase/migrations are applied BY HAND against the linked
 * Supabase project. Nothing replays them, so a migration that fails halfway —
 * or that lands with a timestamp older than one already applied — diverges the
 * remote from the repo silently. These three rules are what make a hand-applied
 * set survivable:
 *
 *   1. Idempotent statements only. Every CREATE/DROP must carry IF NOT EXISTS /
 *      IF EXISTS (or be a CREATE OR REPLACE), so re-running a partially applied
 *      file is safe rather than an error cascade.
 *   2. No destructive statement (DROP TABLE / TRUNCATE / DELETE FROM) without an
 *      explicit `-- destructive: approved` marker in the file. The marker is the
 *      reviewer's signature, not a formality: it is the line CODEOWNERS review
 *      exists to catch.
 *   3. The filename timestamp must be newer than every migration already on the
 *      base branch. An out-of-order timestamp applies fine locally and then
 *      never applies on a machine that has already run a later file.
 *
 * Usage:
 *   node scripts/check-migrations.mjs                    # diff against origin/main
 *   MIGRATION_CHECK_BASE=origin/main node scripts/...    # explicit base
 *   node scripts/check-migrations.mjs --all              # lint every migration
 *
 * Exits 0 when clean, 1 with a per-file explanation otherwise. When the base ref
 * is not fetched (a shallow clone), it reports and exits 0 rather than inventing
 * a verdict — CI checks out with fetch-depth: 0 so that path is a local-only
 * convenience.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const BASE = process.env.MIGRATION_CHECK_BASE || 'origin/main';
const LINT_ALL = process.argv.includes('--all');

const DESTRUCTIVE_MARKER = /--\s*destructive:\s*approved/i;

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return null;
  }
}

/**
 * Strip line comments, block comments and single-quoted string literals so a
 * rule never fires on prose in a comment or on a policy body that merely
 * mentions 'delete'. Dollar-quoted function bodies are kept: a DROP TABLE
 * inside a plpgsql body is every bit as destructive as one at top level.
 */
function strip(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Rules that require an idempotency guard. Each: what to match, what to demand. */
const IDEMPOTENCY_RULES = [
  {
    name: 'CREATE TABLE',
    find: /\bcreate\s+(?:unlogged\s+|temp\s+|temporary\s+)?table\s+(?!if\s+not\s+exists\b)/gi,
    want: 'CREATE TABLE IF NOT EXISTS',
  },
  {
    name: 'CREATE INDEX',
    find: /\bcreate\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?!if\s+not\s+exists\b)/gi,
    want: 'CREATE INDEX IF NOT EXISTS',
  },
  { name: 'CREATE SCHEMA', find: /\bcreate\s+schema\s+(?!if\s+not\s+exists\b)/gi, want: 'CREATE SCHEMA IF NOT EXISTS' },
  {
    name: 'CREATE TRIGGER',
    find: /\bcreate\s+(?:or\s+replace\s+)?trigger\s+(?!if\s+not\s+exists\b)/gi,
    want: 'CREATE OR REPLACE TRIGGER, or DROP TRIGGER IF EXISTS first',
    // A preceding DROP TRIGGER IF EXISTS makes a plain CREATE TRIGGER re-runnable.
    satisfiedBy: /\bdrop\s+trigger\s+if\s+exists\b/i,
  },
  {
    name: 'CREATE POLICY',
    find: /\bcreate\s+policy\b/gi,
    want: 'DROP POLICY IF EXISTS … before CREATE POLICY',
    satisfiedBy: /\bdrop\s+policy\s+if\s+exists\b/i,
  },
  {
    name: 'CREATE FUNCTION',
    find: /\bcreate\s+function\b/gi,
    want: 'CREATE OR REPLACE FUNCTION',
    satisfiedBy: /\bdrop\s+function\s+if\s+exists\b/i,
  },
  { name: 'CREATE VIEW', find: /\bcreate\s+view\b/gi, want: 'CREATE OR REPLACE VIEW', satisfiedBy: /\bdrop\s+view\s+if\s+exists\b/i },
  { name: 'DROP TABLE', find: /\bdrop\s+table\s+(?!if\s+exists\b)/gi, want: 'DROP TABLE IF EXISTS' },
  { name: 'DROP INDEX', find: /\bdrop\s+index\s+(?:concurrently\s+)?(?!if\s+exists\b)/gi, want: 'DROP INDEX IF EXISTS' },
  { name: 'DROP POLICY', find: /\bdrop\s+policy\s+(?!if\s+exists\b)/gi, want: 'DROP POLICY IF EXISTS' },
  { name: 'DROP TRIGGER', find: /\bdrop\s+trigger\s+(?!if\s+exists\b)/gi, want: 'DROP TRIGGER IF EXISTS' },
  { name: 'DROP FUNCTION', find: /\bdrop\s+function\s+(?!if\s+exists\b)/gi, want: 'DROP FUNCTION IF EXISTS' },
  { name: 'ADD COLUMN', find: /\badd\s+column\s+(?!if\s+not\s+exists\b)/gi, want: 'ADD COLUMN IF NOT EXISTS' },
  { name: 'DROP COLUMN', find: /\bdrop\s+column\s+(?!if\s+exists\b)/gi, want: 'DROP COLUMN IF EXISTS' },
];

const DESTRUCTIVE_RULES = [
  { name: 'DROP TABLE', find: /\bdrop\s+table\b/i },
  { name: 'TRUNCATE', find: /\btruncate\b/i },
  { name: 'DELETE FROM', find: /\bdelete\s+from\b/i },
  { name: 'DROP COLUMN', find: /\bdrop\s+column\b/i },
  { name: 'DROP SCHEMA', find: /\bdrop\s+schema\b/i },
];

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function lintFile(relPath, raw) {
  const problems = [];
  const sql = strip(raw);
  const approved = DESTRUCTIVE_MARKER.test(raw);

  for (const rule of IDEMPOTENCY_RULES) {
    rule.find.lastIndex = 0;
    let m;
    while ((m = rule.find.exec(sql)) !== null) {
      if (rule.satisfiedBy && rule.satisfiedBy.test(sql)) break;
      problems.push(`line ${lineOf(sql, m.index)}: ${rule.name} is not idempotent — use ${rule.want}`);
      if (!rule.find.global) break;
    }
  }

  if (!approved) {
    for (const rule of DESTRUCTIVE_RULES) {
      const m = rule.find.exec(sql);
      if (m) {
        problems.push(
          `line ${lineOf(sql, m.index)}: ${rule.name} is destructive — add a "-- destructive: approved" comment to this file if that is intended`,
        );
      }
    }
  }

  return problems.map((p) => `${relPath}: ${p}`);
}

function timestampOf(fileName) {
  const m = /^(\d{8,14})_/.exec(path.basename(fileName));
  return m ? m[1] : null;
}

function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.log('No supabase/migrations directory; nothing to lint.');
    return 0;
  }

  const onDisk = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql'));

  let changed;
  let baseNewest = null;

  if (LINT_ALL) {
    changed = onDisk.map((f) => path.posix.join('supabase/migrations', f));
  } else {
    const baseSha = tryGit(['rev-parse', '--verify', `${BASE}^{commit}`]);
    if (!baseSha) {
      console.log(`Base ref "${BASE}" is not available locally (shallow clone?). Skipping migration lint.`);
      console.log('CI checks out with fetch-depth: 0, where this always runs.');
      return 0;
    }
    const mergeBase = tryGit(['merge-base', baseSha, 'HEAD']) || baseSha;
    const diff = tryGit(['diff', '--name-only', '--diff-filter=ACMR', mergeBase, '--', 'supabase/migrations']) ?? '';
    // `git diff` lists tracked changes only. A brand-new migration is untracked
    // until it is added, and locally that is exactly when you want the lint —
    // before committing it, not after CI rejects the PR.
    const untracked = tryGit(['ls-files', '--others', '--exclude-standard', '--', 'supabase/migrations']) ?? '';
    changed = [...new Set([...diff.split('\n'), ...untracked.split('\n')])].filter((l) => l.trim().endsWith('.sql'));

    const baseList = tryGit(['ls-tree', '--name-only', `${mergeBase}`, 'supabase/migrations/']) ?? '';
    const baseNames = baseList
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.endsWith('.sql'))
      // A file changed in this PR is "ours", not part of the base high-water mark.
      .filter((l) => !changed.includes(l));
    baseNewest = baseNames.map(timestampOf).filter(Boolean).sort().pop() || null;
  }

  if (changed.length === 0) {
    console.log(`No migrations added or changed against ${BASE}. Nothing to lint.`);
    return 0;
  }

  const failures = [];
  for (const rel of changed) {
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) continue; // deleted in the working tree
    const raw = readFileSync(abs, 'utf8');
    failures.push(...lintFile(rel, raw));

    const ts = timestampOf(rel);
    if (!ts) {
      failures.push(`${rel}: filename must start with a timestamp, e.g. 20260915120000_what_it_does.sql`);
    } else if (baseNewest && ts <= baseNewest) {
      failures.push(
        `${rel}: timestamp ${ts} is not newer than the newest migration on ${BASE} (${baseNewest}). ` +
          'Rename the file with a later timestamp — an out-of-order migration never applies on a machine that already ran a later one.',
      );
    }
  }

  console.log(`Linted ${changed.length} migration file(s) against ${BASE}:`);
  for (const rel of changed) console.log(`  ${rel}`);

  if (failures.length > 0) {
    console.error('\nMIGRATION LINT FAILED:');
    for (const f of failures) console.error(`  ${f}`);
    console.error('\nSee docs/PIPELINE.md § Migrations for the rules and how to satisfy them.');
    return 1;
  }

  console.log('Migration lint passed.');
  return 0;
}

process.exit(main());
