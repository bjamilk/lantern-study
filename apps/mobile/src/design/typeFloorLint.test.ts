/**
 * The 11 sp floor — an absolute gate, unlike the Wave T backlog budget.
 *
 * typeScaleLint.test.ts freezes the number of raw sizes and lets files carry a
 * budget while they wait their turn. This one has no allowlist: a string below
 * Material's 11 sp minimum is a legibility bug wherever it is, so any
 * `fontSize: <11` or `text-[<11px]` anywhere under src/ fails, including in
 * components/ui and design/ (which typeScaleSources.ts exempts from the
 * budget). The fix is `typeScale.label` / `text-label`, never a smaller step.
 *
 * `text-xs` and friends are NOT scanned here: they are names, not numbers, and
 * the budget lint already blocks new ones. They resolve to 10.5 sp at this
 * project's NativeWind rem of 14, which is why migrating a file means reaching
 * for `text-caption`, not `text-xs`.
 */
import fs from 'fs';
import path from 'path';
import { MIN_FONT_SIZE } from './typeScale';

const SRC_ROOT = path.resolve(__dirname, '..');

const FONT_SIZE = /\bfontSize:\s*(\d+(?:\.\d+)?)/g;
const ARBITRARY_CLASS = /\btext-\[(\d+(?:\.\d+)?)px\]/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__snapshots__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Exported so a codemod (or a future web twin) can reuse the scan. */
export function findBelowFloor(source: string, floor: number): string[] {
  const found: string[] = [];
  for (const re of [FONT_SIZE, ARBITRARY_CLASS]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      if (Number(m[1]) < floor) found.push(m[0]);
    }
  }
  return found;
}

describe('11 sp floor', () => {
  it('catches both spellings of a too-small size', () => {
    expect(findBelowFloor('{ fontSize: 10 }', MIN_FONT_SIZE)).toEqual(['fontSize: 10']);
    expect(findBelowFloor('className="text-[9px]"', MIN_FONT_SIZE)).toEqual(['text-[9px]']);
    expect(findBelowFloor('{ fontSize: 11 } text-[12px]', MIN_FONT_SIZE)).toEqual([]);
  });

  it('sets no text below the floor anywhere in src', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC_ROOT).sort()) {
      const rel = `src/${path.relative(SRC_ROOT, file).split(path.sep).join('/')}`;
      for (const hit of findBelowFloor(fs.readFileSync(file, 'utf8'), MIN_FONT_SIZE)) {
        offenders.push(`${rel}: ${hit} — below the ${MIN_FONT_SIZE} sp floor, use typeScale.label / text-label`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
