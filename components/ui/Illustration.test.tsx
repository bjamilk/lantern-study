import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  ILLUSTRATIONS,
  ILLUSTRATION_NAMES,
  illustrationViewBox,
  type IllustrationName,
} from '@lantern/shared/design';
import { Illustration } from './Illustration';
import { FEATURE_INK_TEXT, FEATURE_TINT_BG, FEATURE_TINT_FILL } from './featureClasses';

/**
 * The web half of §5.6's imagery rule.
 *
 * Lane A's suite guards the ASSETS — ten of them, on one viewBox, at stroke 2,
 * inside the square, under the byte budget. This suite guards what the web does
 * with them, which is a different set of ways to be wrong:
 *
 *   1. The renderer paints one filled shape and nothing else. A `fill` that
 *      crept onto a path would break "identical in both themes from one asset",
 *      because a literal colour does not follow `--color-feature-*`.
 *   2. The hue arrives as a CLASS, never a literal. Tailwind resolves the class
 *      through a CSS variable that `:root` and `.dark` define differently; a
 *      hex would pin the drawing to one theme.
 *   3. The tint class actually exists in the Tailwind theme, spelled the way
 *      the scanner will see it — the silent-failure mode this app already has a
 *      table for.
 *   4. Placement. Doors and empty states only, and no illustration twice on one
 *      screen. StudyFetch's one-dog-everywhere is the anti-pattern the rule
 *      exists to prevent, and it is a rule about SCREENS, so only a scan of the
 *      call sites can enforce it.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const render = (name: IllustrationName, feature: 'notes' | 'tests' = 'notes', size?: number) =>
  renderToStaticMarkup(<Illustration name={name} feature={feature} size={size} />);

describe('Illustration renderer', () => {
  it('draws every asset without throwing, on the shared crop of its own ink', () => {
    // Not the authored 96-square: `illustrationViewBox` crops each asset to its
    // ink bounds so the drawing fills the box the call site asked for, and it
    // is shared data so mobile frames the same ten drawings identically.
    for (const name of ILLUSTRATION_NAMES) {
      const html = render(name);
      expect(html, name).toContain(`viewBox="${illustrationViewBox(name)}"`);
      expect(html, name).not.toContain('viewBox="0 0 96 96"');
      expect(html, name).toContain('<svg');
    }
  });

  it('paints exactly one filled shape per asset: the ground ellipse', () => {
    for (const name of ILLUSTRATION_NAMES) {
      const html = render(name);
      expect(html.match(/<ellipse/g) ?? [], name).toHaveLength(1);
      // `fill="none"` on the path group is the only other fill in the markup.
      expect(html.match(/fill="/g) ?? [], name).toHaveLength(1);
      expect(html, name).toContain('fill="none"');
      expect(html, name).toContain('stroke="currentColor"');
      expect(html, name).toContain('stroke-width="2"');
    }
  });

  it('renders every path of the asset, in order', () => {
    for (const name of ILLUSTRATION_NAMES) {
      const html = render(name);
      const asset = ILLUSTRATIONS[name];
      expect(html.match(/<path /g) ?? [], name).toHaveLength(asset.paths.length);
      let cursor = 0;
      for (const d of asset.paths) {
        const at = html.indexOf(`d="${d.replace(/&/g, '&amp;')}"`, cursor);
        expect(at, `${name}: ${d}`).toBeGreaterThan(-1);
        cursor = at + 1;
      }
    }
  });

  it('carries no literal colour — the hue is a class, so both themes come from one asset', () => {
    for (const name of ILLUSTRATION_NAMES) {
      const html = render(name);
      expect(html, name).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(html, name).not.toMatch(/\brgba?\(/i);
      expect(html, name).toContain(FEATURE_INK_TEXT.notes);
      expect(html, name).toContain(FEATURE_TINT_FILL.notes);
    }
  });

  it('scales without re-authoring: only width and height move', () => {
    const small = render('notes-stack', 'notes', 44);
    const large = render('notes-stack', 'notes', 88);
    expect(small).toContain('width="44"');
    expect(large).toContain('width="88"');
    expect(small.replace(/(width|height)="44"/g, '$1="88"')).toBe(large);
  });

  it('is decorative unless it is given a name of its own', () => {
    expect(render('notes-stack')).toContain('aria-hidden="true"');
    const titled = renderToStaticMarkup(
      <Illustration name="notes-stack" feature="notes" title="Your library" />,
    );
    expect(titled).toContain('role="img"');
    expect(titled).toContain('aria-label="Your library"');
    expect(titled).not.toContain('aria-hidden');
  });
});

describe('feature tint fill table', () => {
  const tailwind = fs.readFileSync(path.join(ROOT, 'tailwind.config.js'), 'utf8');

  it('names a colour Tailwind actually defines, for every feature', () => {
    for (const [key, cls] of Object.entries(FEATURE_TINT_FILL)) {
      // `fill-lantern-feature-notes-tint` → the `'notes-tint':` entry under
      // `feature` in the config. A class Tailwind cannot resolve compiles to
      // nothing and fails silently, which is why this is asserted and not read.
      expect(cls, key).toBe(`fill-lantern-feature-${key}-tint`);
      expect(tailwind, key).toContain(`'${key}-tint':`);
      // Same token as the background table, so an illustration's ground and the
      // band it sits in can never drift apart.
      expect(FEATURE_TINT_BG[key as keyof typeof FEATURE_TINT_BG]).toBe(
        `bg-lantern-feature-${key}-tint`,
      );
    }
  });
});

// ── Placement (§5.6: "doors and empty states only") ────────────────────────

const SCAN_DIRS = ['components'];
const PRIMITIVES = new Set([
  'components/ui/Illustration.tsx',
  'components/ui/DoorTile.tsx',
  'components/ui/EmptyState.tsx',
  'components/ui/Illustration.test.tsx',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Every `illustration="…"` and `name="…"` on an `<Illustration>`, by file. */
function callSites(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (PRIMITIVES.has(rel)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const names = [
      ...[...src.matchAll(/\billustration="([a-z-]+)"/g)].map((m) => m[1]),
      ...[...src.matchAll(/<Illustration\s+name="([a-z-]+)"/g)].map((m) => m[1]),
    ];
    if (names.length) found.set(rel, names);
  }
  return found;
}

describe('illustration placement', () => {
  const sites = callSites();

  it('uses only mapped names', () => {
    for (const [file, names] of sites) {
      for (const name of names) {
        expect(ILLUSTRATION_NAMES, `${file}: ${name}`).toContain(name);
      }
    }
  });

  it('never repeats one illustration inside a screen', () => {
    // The rule that makes a spot illustration mean something: on any one
    // screen a drawing appears at most once. Twice on a screen and it has
    // stopped naming a place and become wallpaper.
    for (const [file, names] of sites) {
      expect(new Set(names).size, `${file} repeats an illustration`).toBe(names.length);
    }
  });

  it('is wired on every surface this wave claimed, and on no others', () => {
    // Change this table when a door or empty state gains or loses its art —
    // deliberately, in the diff, rather than by an illustration quietly
    // spreading to a screen that is neither a door nor an empty state.
    expect(Object.fromEntries([...sites].sort())).toEqual({
      'components/AICompanionPanel.tsx': ['sparkles-book'],
      'components/CourseReadinessCard.tsx': ['readiness-ring'],
      'components/dashboard/HomeQuickActions.tsx': ['import-tray', 'cards-fan', 'mic-wave'],
      'components/DiscoverScreen.tsx': ['campus-hall'],
      'components/NotesScreen.tsx': ['notes-stack'],
      'components/OfflineModeScreen.tsx': ['download-phone'],
      'components/TestsHomeScreen.tsx': ['test-sheet', 'empty-inbox'],
    });
  });

  it('gives all ten a home on the web', () => {
    const used = new Set([...sites.values()].flat());
    expect([...ILLUSTRATION_NAMES].filter((n) => !used.has(n))).toEqual([]);
  });
});
