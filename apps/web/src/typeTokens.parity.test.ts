import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { type as typeSteps, typeStack } from '@lantern/shared/design';

/**
 * The measured type system, pinned.
 *
 * `typeScaleLint.test.ts` already pins each step's PIXELS. This file pins the
 * other three things the 2026-09-17 StudyFetch measurement fixed, because each
 * of them regressed silently once before:
 *
 *   1. WEIGHT. The heads were 700 and the reference measures 500. A 700 serif
 *      at 24px is a poster, and nothing in Tailwind warns when a step's weight
 *      drifts — the tuple simply supplies a different default.
 *   2. TRACKING. Every step but `label` is `0`. The old ladder ran -0.02em /
 *      -0.011em and `body {}` in index.css tightened everything the steps do
 *      not own on top of that; three places had to agree and did not.
 *   3. THE FACES. `--font-sans` must lead with Inter and the three shipped
 *      weights must actually exist on disk, which is the exact failure mode
 *      `displayFont.test.tsx` was written for on the Bitter side: a family
 *      named in CSS whose files were never fetched looks like a working
 *      change and renders as system-ui.
 *
 * Source of truth is packages/shared/src/design/tokens.ts, which mobile
 * mirrors; `npm run design:contrast` fails if design/type.css disagrees with
 * it, so asserting the tokens here covers the CSS by transitivity.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const indexCss = fs.readFileSync(path.join(ROOT, 'index.css'), 'utf8');

/** step -> [weight, tracking], measured 2026-09-17 at 1440x900. */
const MEASURED: Record<string, [string, string]> = {
  display: ['500', '0'],
  title: ['500', '0'],
  heading: ['500', '0'],
  body: ['400', '0'],
  caption: ['400', '0'],
  // Lantern's own uppercase micro-role: the reference has no counterpart, and
  // 11px uppercase with normal tracking is the case positive tracking is for.
  label: ['600', '0.04em'],
};

describe('measured type tokens', () => {
  it.each(Object.entries(MEASURED))(
    'sets %s at the measured weight and tracking',
    (step, [weight, tracking]) => {
      const token = typeSteps[step as keyof typeof typeSteps];
      expect(token.fontWeight).toBe(weight);
      expect(token.letterSpacing).toBe(tracking);
    },
  );

  it('tracks nothing negatively — the reference is letter-spacing: normal', () => {
    for (const token of Object.values(typeSteps)) {
      expect(token.letterSpacingPx).toBeGreaterThanOrEqual(0);
      expect(token.letterSpacing.startsWith('-')).toBe(false);
    }
  });

  it('leaves no global negative tracking on <body> to undo the steps', () => {
    // The step can say `0` and still render tight if the element it sits in
    // sets tracking. This is the declaration that used to do exactly that.
    expect(indexCss).toMatch(/\nbody \{[^}]*letter-spacing:\s*normal;/);
  });

  it('leads the sans stack with Inter', () => {
    expect(typeStack.sans.startsWith("'Inter'")).toBe(true);
    // Every place the stack is spelt out in CSS, including the font-mode
    // class that outranks :root — the bug `displayFont.test.tsx` records.
    const sansDecls = [...indexCss.matchAll(/--font-sans:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim());
    expect(sansDecls.length).toBeGreaterThan(1);
    const interless = sansDecls.filter((value) => !value.startsWith("'Inter'"));
    // `.font-low-data` is the one documented mode that ships zero font bytes.
    expect(interless.every((value) => value.startsWith('system-ui'))).toBe(true);
  });

  it('ships every Inter file its @font-face rules point at', () => {
    const srcs = [...indexCss.matchAll(/src:\s*url\('([^']+)'\)/g)].map((m) => m[1] ?? '');
    const inter = srcs.filter((s) => s.includes('inter'));
    expect(inter).toHaveLength(3);
    for (const src of inter) {
      const file = path.join(ROOT, 'public', src.replace(/^\//, ''));
      expect(fs.existsSync(file), `missing font file: ${file}`).toBe(true);
    }
  });

  it('keeps the measured inks on their token names rather than minting new ones', () => {
    expect(indexCss).toContain('--color-text: 25 25 25;'); // ink #191919
    expect(indexCss).toContain('--color-text-secondary: 94 90 84;'); // #5e5a54, the AA-safe #716d66
    expect(indexCss).toContain('--color-border: 229 229 229;'); // #e5e5e5
  });
});
