/**
 * The source scan behind the Wave T type-scale lint.
 *
 * Kept apart from the test so the test file stays about the RULE, and so the
 * same scan can be reused by a future codemod. Pure Node — it reads the tree
 * with fs, imports nothing from the app, and is never bundled into the app
 * (nothing under src/ imports it except the test).
 */
import fs from 'fs';
import path from 'path';

/**
 * Where raw sizes are legitimate: the primitives that DEFINE the scale.
 * Everything else migrates to `text-body`/`<T.Body>` or earns an allowlist row.
 */
export const EXEMPT_PREFIXES = ['src/components/ui/', 'src/design/'];

const FONT_SIZE = /\bfontSize:\s*\d+(?:\.\d+)?/g;
const ARBITRARY_CLASS = /\btext-\[\d+(?:\.\d+)?px\]/g;
const BARE_CLASS = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/g;

export interface ScanResult {
  /** Repo-relative posix path → number of raw-size occurrences in that file. */
  counts: Record<string, number>;
  total: number;
}

function isSource(file: string): boolean {
  if (!/\.(ts|tsx)$/.test(file)) return false;
  // The scan measures shipped screens, not the specs that describe them.
  return !/\.(test|spec)\.tsx?$/.test(file);
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__snapshots__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (isSource(entry.name)) {
      out.push(full);
    }
  }
}

export function countRawSizes(source: string): number {
  return (
    (source.match(FONT_SIZE)?.length ?? 0) +
    (source.match(ARBITRARY_CLASS)?.length ?? 0) +
    (source.match(BARE_CLASS)?.length ?? 0)
  );
}

/** `srcRoot` is an absolute path to apps/mobile/src. */
export function scanRawSizes(srcRoot: string): ScanResult {
  const files: string[] = [];
  walk(srcRoot, files);
  const counts: Record<string, number> = {};
  let total = 0;
  for (const file of files.sort()) {
    const rel = `src/${path.relative(srcRoot, file).split(path.sep).join('/')}`;
    if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const n = countRawSizes(fs.readFileSync(file, 'utf8'));
    if (n > 0) {
      counts[rel] = n;
      total += n;
    }
  }
  return { counts, total };
}
