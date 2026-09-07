import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APP_ICONS } from './appIconMap';
import {
  HEROICON_TO_APP_ICON,
  SOLID_KEEPS_OUTLINE,
  sizeForTailwindStep,
  solidKeepsOutline,
} from './heroiconsMigration';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Where the web app's own source lives. apps/ and packages/ are other lanes. */
const SOURCE_ROOTS = ['components', 'utils', 'hooks', 'services', 'stores'];
const SOURCE_FILES = ['App.tsx'];

/**
 * `import { A, B as C } from '@heroicons/react/24/outline'`. The character
 * class stops at the first `}` on purpose: a greedy body would swallow every
 * import between two unrelated braces and report whole statements as icons.
 */
const HEROICONS_IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@heroicons\/react\/([^'"]+)['"]/g;
/** Anything else pulled off @heroicons — a default or namespace import. */
const HEROICONS_OTHER_IMPORT = /import\s+(?!(?:type\s+)?\{)[^;]*from\s*['"]@heroicons\/react\/[^'"]+['"]/g;

function collectSourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      // This file quotes a heroicons import in its own doc comments; scanning
      // it would report the example's identifiers as real, unmapped icons.
      if (entry.name === 'heroiconsMigration.test.ts') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) found.push(full);
    }
  };
  for (const root of SOURCE_ROOTS) {
    const full = path.join(REPO_ROOT, root);
    if (fs.existsSync(full)) walk(full);
  }
  for (const file of SOURCE_FILES) {
    const full = path.join(REPO_ROOT, file);
    if (fs.existsSync(full)) found.push(full);
  }
  return found;
}

/** Every heroicons component imported anywhere, with the files importing it. */
function collectHeroiconUsages(): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  for (const file of collectSourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('@heroicons/react')) continue;
    const rel = path.relative(REPO_ROOT, file);
    for (const match of source.matchAll(HEROICONS_IMPORT)) {
      for (const specifier of match[1].split(',')) {
        const name = specifier.trim().split(/\s+as\s+/)[0].trim();
        if (!name) continue;
        const list = usages.get(name) ?? [];
        if (!list.includes(rel)) list.push(rel);
        usages.set(name, list);
      }
    }
  }
  return usages;
}

describe('heroicons -> AppIcon migration table', () => {
  const usages = collectHeroiconUsages();

  it('finds the heroicons call sites it is meant to police', () => {
    // A silent zero here would make every other assertion vacuously pass —
    // which is exactly how a "green" sweep leaves icons behind. Once the sweep
    // finishes this drops to 0 and the guard below is what has to change:
    // delete this file, the table, and the `svg[data-slot="icon"]` rule in
    // index.css together.
    expect(usages.size).toBeGreaterThan(0);
  });

  it('has an entry for every heroicon the codebase imports', () => {
    const missing = [...usages.entries()]
      .filter(([name]) => !(name in HEROICON_TO_APP_ICON))
      .map(([name, files]) => `${name} (${files.slice(0, 3).join(', ')})`);
    expect(missing).toEqual([]);
  });

  it('maps every entry to a glyph AppIcon can actually draw', () => {
    const unmapped = Object.entries(HEROICON_TO_APP_ICON)
      .filter(([, appName]) => !(appName in APP_ICONS))
      .map(([hero, appName]) => `${hero} -> ${appName}`);
    expect(unmapped).toEqual([]);
  });

  it('only names real heroicons in the keep-outline deny-list', () => {
    const unknown = SOLID_KEEPS_OUTLINE.filter((name) => !(name in HEROICON_TO_APP_ICON));
    expect(unknown).toEqual([]);
  });

  it('does not list the same keep-outline heroicon twice', () => {
    expect(new Set(SOLID_KEEPS_OUTLINE).size).toBe(SOLID_KEEPS_OUTLINE.length);
  });

  it('carries no entry the codebase has no use for', () => {
    // A stale row is a wrong-looking icon waiting for someone to trust it.
    const unused = Object.keys(HEROICON_TO_APP_ICON).filter((name) => !usages.has(name));
    expect(unused).toEqual([]);
  });

  it('uses only named imports off @heroicons, which the table can see', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      if (!source.includes('@heroicons/react')) continue;
      for (const match of source.matchAll(HEROICONS_OTHER_IMPORT)) {
        offenders.push(`${path.relative(REPO_ROOT, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves solid variants that keep their outline', () => {
    expect(solidKeepsOutline('RectangleStackIcon')).toBe(true);
    expect(solidKeepsOutline('SparklesIcon')).toBe(false);
  });

  it('reads Tailwind sizing steps as pixels', () => {
    expect(sizeForTailwindStep(4)).toBe(16);
    expect(sizeForTailwindStep(5)).toBe(20);
    expect(sizeForTailwindStep(6)).toBe(24);
  });
});
