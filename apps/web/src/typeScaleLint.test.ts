import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { MIGRATED_FILES, TYPE_SCALE_ALLOWLIST } from '../../../design/typeScaleAllowlist';

/**
 * Type-scale lint.
 *
 * The web app has one type scale: six steps, one role each, declared as
 * `text-display` … `text-label` in tailwind.config.js and mirrored pixel for
 * pixel in apps/mobile/tailwind.config.js. Everything else that sets a size is
 * a violation:
 *
 *   1. `text-[13px]`      — an arbitrary px size. These were the five sizes
 *                           (15, 13, 11, 10, 9) that sat off the ladder AND
 *                           ignored the app's own text-size setting, because
 *                           that setting only ever moved the root font-size.
 *   2. `text-sm` etc.     — Tailwind's default ramp. Still generated, so old
 *                           code compiles, but it carries no role, which is how
 *                           `h1` ended up at four different sizes.
 *   3. `fontSize:`        — an inline style, invisible to both of the above.
 *
 * This is a ratchet, not a wall: `design/typeScaleAllowlist.ts` records what
 * each file had when Wave T landed. A file may not gain violations, an unlisted
 * file may not have any, and a file that has been migrated may not regress.
 * `components/ui/**` is exempt — it is where the primitives live.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const SCAN_DIRS = ['components', 'hooks', 'utils', 'stores', 'services'];
const SCAN_FILES = ['App.tsx', 'index.tsx'];
const EXEMPT_PREFIXES = ['components/ui/'];

const PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'arbitrary px size', re: /(?<![\w-])text-\[\d+(?:\.\d+)?px\]/g },
  { name: 'bare Tailwind step', re: /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g },
  { name: 'inline fontSize', re: /(?<![\w.])fontSize\s*:/g },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function scan(): Map<string, number> {
  const files = [
    ...SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d))),
    ...SCAN_FILES.map((f) => path.join(ROOT, f)),
  ];
  const counts = new Map<string, number>();
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const src = fs.readFileSync(abs, 'utf8');
    let n = 0;
    for (const { re } of PATTERNS) n += (src.match(re) || []).length;
    if (n > 0) counts.set(rel, n);
  }
  return counts;
}

const counts = scan();

describe('type scale', () => {
  it('finds source to scan (the scan is not silently empty)', () => {
    // Without this, a moved directory would turn every assertion below into a
    // pass on zero files — the failure mode that makes source-scan lints lie.
    expect(fs.existsSync(path.join(ROOT, 'components/DashboardScreen.tsx'))).toBe(true);
    expect(counts.size).toBeGreaterThan(50);
  });

  it('adds no off-scale text size to a file that had none', () => {
    const unlisted = [...counts.keys()]
      .filter((f) => !(f in TYPE_SCALE_ALLOWLIST))
      .sort();
    expect(
      unlisted,
      'These files set a text size outside the six steps (text-display … text-label). '
        + 'Use a step, or a primitive from components/ui/Text.',
    ).toEqual([]);
  });

  it('adds no off-scale text size to a file that already had some', () => {
    const grown = [...counts.entries()]
      .filter(([file, n]) => file in TYPE_SCALE_ALLOWLIST && n > (TYPE_SCALE_ALLOWLIST[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} (allowed ${TYPE_SCALE_ALLOWLIST[file] ?? 0})`)
      .sort();
    expect(grown, 'Off-scale text sizes may only go down. Migrate, do not add.').toEqual([]);
  });

  it('keeps the allowlist honest — no entry for a file that is already clean', () => {
    // A stale entry is a licence to regress, so the allowlist has to shrink
    // when a screen is migrated.
    const stale = Object.keys(TYPE_SCALE_ALLOWLIST)
      .filter((f) => !counts.has(f))
      .sort();
    expect(
      stale,
      'These files no longer violate. Delete their entries from design/typeScaleAllowlist.ts.',
    ).toEqual([]);
  });

  it('keeps the Wave T screens on the scale', () => {
    const regressed = MIGRATED_FILES.filter(
      (f) => (counts.get(f) ?? 0) !== (TYPE_SCALE_ALLOWLIST[f] ?? 0),
    ).map((f) => `${f}: ${counts.get(f) ?? 0} (expected ${TYPE_SCALE_ALLOWLIST[f] ?? 0})`);
    expect(regressed).toEqual([]);
  });
});

describe('type scale tokens', () => {
  const tailwindConfig = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');
  const typeCss = fs.readFileSync(path.join(ROOT, 'design/type.css'), 'utf8');
  const STEPS = ['display', 'title', 'heading', 'body', 'caption', 'label'] as const;

  it.each(STEPS)('declares the %s step in Tailwind', (step) => {
    expect(tailwindConfig).toContain(`${step}: ['var(--type-${step}-size)'`);
  });

  it.each(STEPS)('backs the %s step with a CSS variable', (step) => {
    expect(typeCss).toContain(`--type-${step}-size:`);
    expect(typeCss).toContain(`--type-${step}-lh:`);
  });

  it('ships the six steps at the same pixels as mobile', () => {
    // The whole point of px steps: `text-title` is 22 px on both platforms.
    const expected: Record<string, [number, number]> = {
      display: [28, 34],
      title: [22, 28],
      heading: [17, 24],
      body: [15, 22],
      caption: [13, 18],
      label: [11, 16],
    };
    for (const [step, [size, lh]] of Object.entries(expected)) {
      expect(typeCss).toContain(`--type-${step}-size: calc(${size}px * var(--type-scale))`);
      expect(typeCss).toContain(`--type-${step}-lh: calc(${lh}px * var(--type-scale))`);
    }
  });

  it('lets the app text-size setting scale every step', () => {
    // The setting used to move the root font-size, which reached rem sizes only
    // — px steps would have frozen it. It moves --type-scale instead.
    expect(typeCss).toContain(':root.font-size-small');
    expect(typeCss).toContain(':root.font-size-large');
    expect(typeCss).toMatch(/:root\.font-size-small\s*\{\s*--type-scale:/);
    expect(typeCss).toMatch(/:root\.font-size-large\s*\{\s*--type-scale:/);
  });

  it('loads the tokens after index.css so they win', () => {
    const entry = fs.readFileSync(path.join(ROOT, 'index.tsx'), 'utf8');
    expect(entry.indexOf("'./design/type.css'")).toBeGreaterThan(entry.indexOf("'./index.css'"));
  });
});
