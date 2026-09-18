/**
 * Wave T gate: no NEW raw text sizes.
 *
 * The app carries a large backlog of ad-hoc sizes — 1-sp-apart values, a
 * `text-sm` that renders 12.25 sp because NativeWind inlines rem at 14, and
 * strings below Material's 11 sp floor. Migrating all of them in one wave would
 * be a 200-file diff nobody could review, so this test freezes the backlog at
 * its current size instead: every file's remaining count is budgeted in
 * typeScaleAllowlist.ts, and anything above that budget — or in a file with no
 * budget at all — fails.
 *
 * The fix is never to raise a number. It is `text-body` / `<T.Body>`.
 */
import path from 'path';
import { scanRawSizes } from './typeScaleSources';
import { TYPE_SCALE_ALLOWLIST, TYPE_SCALE_ALLOWLIST_TOTAL } from './typeScaleAllowlist';
import { typeScale, MIN_FONT_SIZE } from './typeScale';

const SRC_ROOT = path.resolve(__dirname, '..');

describe('type scale', () => {
  const scan = scanRawSizes(SRC_ROOT);

  it('reports the remaining backlog', () => {
    // Not an assertion about the number — a printed count so a shrinking
    // backlog is visible in CI output rather than only in a diff.
    const files = Object.keys(scan.counts).length;
    // eslint-disable-next-line no-console
    console.log(
      `[type-scale] ${scan.total} raw text sizes across ${files} files ` +
        `(budget ${TYPE_SCALE_ALLOWLIST_TOTAL} across ${Object.keys(TYPE_SCALE_ALLOWLIST).length})`
    );
    expect(scan.total).toBeLessThanOrEqual(TYPE_SCALE_ALLOWLIST_TOTAL);
  });

  it('adds no raw text size outside components/ui', () => {
    const offenders: string[] = [];
    for (const [file, count] of Object.entries(scan.counts)) {
      const budget = TYPE_SCALE_ALLOWLIST[file];
      if (budget === undefined) {
        offenders.push(
          `${file}: ${count} raw text size(s) in a file with no budget — use ` +
            '`text-body`/`text-caption`… or `<T.Body>` from components/ui'
        );
      } else if (count > budget) {
        offenders.push(`${file}: ${count} raw text size(s), budget ${budget} — do not raise the budget`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('names allowlist rows that are now dead', () => {
    // A fully migrated file should lose its row so the budget can only shrink.
    // This REPORTS rather than fails: a stale row is progress, and failing on
    // one would mean a lane that migrates a file also has to edit a shared
    // allowlist other lanes are touching in the same tree.
    const stale = Object.keys(TYPE_SCALE_ALLOWLIST).filter((f) => scan.counts[f] === undefined);
    if (stale.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[type-scale] ${stale.length} migrated file(s), drop their rows: ${stale.join(', ')}`);
    }
    expect(stale.every((f) => typeof f === 'string')).toBe(true);
  });

  it('holds the 11 sp floor and the six steps', () => {
    expect(MIN_FONT_SIZE).toBe(11);
    const sizes = Object.values(typeScale).map((s) => s.fontSize);
    // Re-measured 2026-09-17 with web (packages/shared design/tokens.ts):
    // 24/32 heads, 18/28 eyebrow, 14/20 base, 12/16 meta. The floor is
    // unchanged, and `label` — the only step at it — is unchanged with it.
    expect(sizes).toEqual([28, 24, 18, 14, 12, 11]);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(11);
    for (const step of Object.values(typeScale)) {
      // Leading is set on every step; none inherits RN's font-dependent default.
      expect(step.lineHeight).toBeGreaterThan(step.fontSize);
    }
  });
});
