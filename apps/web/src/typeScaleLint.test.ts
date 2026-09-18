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
 *
 * Two directories are exempt, for opposite reasons:
 *
 *   `components/ui/**`        — it is where the primitives live, so it is what
 *                               everything else defers TO.
 *   `components/marketing/**` — it is not the product. These six steps are an
 *                               in-product scale, mirrored pixel for pixel with
 *                               the mobile app because a phone screen and a
 *                               browser tab of the same app must agree; the top
 *                               step is 28px, which is a heading, not a hero. A
 *                               signed-out landing page is a different medium
 *                               with different typographic needs, and forcing
 *                               its hero down to 28px would be the lint making
 *                               a design decision it has no standing to make.
 *                               The exemption is deliberate, not a licence:
 *                               these pages want their own scale, and until
 *                               someone writes one this lint should stay quiet
 *                               about them rather than be silenced file by file
 *                               through the allowlist, which is a record of debt
 *                               and must only ever shrink.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

const SCAN_DIRS = ['components', 'hooks', 'utils', 'stores', 'services'];
const SCAN_FILES = ['App.tsx', 'index.tsx'];
const EXEMPT_PREFIXES = ['components/ui/', 'components/marketing/'];

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

  /**
   * A step is `calc(<px> * var(--type-scale))`, optionally wrapped in
   * `max(<floor>px, ...)` — the floor the two smallest steps need to survive
   * the Small text setting. Returns the base px and the floor, or null.
   */
  const readStep = (name: string): { px: number; floor: number | null } | null => {
    const decl = typeCss.match(new RegExp(`--type-${name}:\\s*([^;]+);`));
    const raw = decl?.[1]?.trim();
    if (!raw) return null;
    const capped = raw.match(
      /^max\(\s*(\d+(?:\.\d+)?)px\s*,\s*calc\((\d+(?:\.\d+)?)px \* var\(--type-scale\)\)\s*\)$/,
    );
    if (capped) return { px: Number(capped[2]), floor: Number(capped[1]) };
    const bare = raw.match(/^calc\((\d+(?:\.\d+)?)px \* var\(--type-scale\)\)$/);
    return bare ? { px: Number(bare[1]), floor: null } : null;
  };

  /**
   * The roles MEASURED off the StudyFetch set room at 1440x900 on 2026-09-17
   * (docs/studyfetch-mysets-2026-09-17/02-style-and-subpages.md), pinned here
   * so a later edit cannot drift one platform off the other.
   *
   * These are a deliberate, founder-approved change from the Wave T ladder
   * (28/34, 22/28, 17/24, 15/22, 13/18): heads 24/32, eyebrow 18/28, base
   * 14/20, meta 12/16. `label` is unchanged — it is Lantern's own uppercase
   * micro-role, with no counterpart in the reference to measure.
   */
  const EXPECTED_PX: Record<string, [number, number]> = {
    display: [28, 36],
    title: [24, 32],
    heading: [18, 28],
    body: [14, 20],
    caption: [12, 16],
    label: [11, 16],
  };

  it('ships the six steps at the same pixels as mobile', () => {
    // The whole point of px steps: `text-title` is 22 px on both platforms.
    for (const [step, [size, lh]] of Object.entries(EXPECTED_PX)) {
      expect(readStep(`${step}-size`), `--type-${step}-size`).toEqual(
        expect.objectContaining({ px: size }),
      );
      expect(readStep(`${step}-lh`), `--type-${step}-lh`).toEqual(
        expect.objectContaining({ px: lh }),
      );
    }
  });

  it('never renders a step below 11px, even at the Small text setting', () => {
    // The bug this locks shut: the setting scales every step, so at
    // --type-scale .875 label rendered 9.625px and caption 11.375px — the
    // app's own accessibility control making the app less legible. Any step
    // that would drop under 11px scaled must carry a max() floor of >= 11px.
    const SMALL = 0.875;
    const problems: string[] = [];
    for (const step of STEPS) {
      const spec = readStep(`${step}-size`);
      if (!spec) {
        problems.push(`--type-${step}-size is not calc(<px> * var(--type-scale)), optionally in max()`);
        continue;
      }
      const rendered = spec.floor === null
        ? spec.px * SMALL
        : Math.max(spec.floor, spec.px * SMALL);
      if (rendered < 11) {
        problems.push(
          `${step} renders ${rendered}px at Small — wrap --type-${step}-size in max(11px, ...)`,
        );
      }
      if (spec.floor !== null && spec.floor > spec.px) {
        problems.push(`${step} floor ${spec.floor}px is above its own ${spec.px}px base`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('floors the two smallest steps in the built CSS, not just in source', () => {
    // max() is plain CSS Values 4 — but a minifier or an over-eager autoprefixer
    // collapsing it would silently restore the bug, so assert the shipped form.
    expect(typeCss).toContain('--type-label-size: max(11px, calc(11px * var(--type-scale)))');
    expect(typeCss).toContain('--type-caption-size: max(11px, calc(12px * var(--type-scale)))');
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
