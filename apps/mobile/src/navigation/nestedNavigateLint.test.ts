/**
 * A source scan, not a behaviour test.
 *
 * `navigate('StudyTab', { screen: 'TestTaking', params })` builds that tab's
 * stack as `[TestTaking]` — the tab's own root is DROPPED — unless the caller
 * also passes `initial: false` (see navigation/nestedTab.ts for the full
 * mechanism). Nothing about the call looks wrong, nothing warns, and the bug
 * only shows up as "back leaves the tab" or "the tab can never get home"
 * later. It had accumulated at roughly thirty-five call sites before anyone
 * connected the symptoms to the omission.
 *
 * So the rule is enforced mechanically: every nested tab navigate in the
 * mobile source must carry `initial: false`, or use `toTab()`, which supplies
 * it. Adding one without it fails this test with a file:line list.
 */

import fs from 'fs';
import path from 'path';
import { TAB_STACK_ROOT_ROUTE } from './tabPressBehavior';

const SRC_ROOT = path.resolve(__dirname, '..');

/** Files that may legitimately mention the pattern without obeying it. */
const EXEMPT_FILES = new Set([
  // The helper defines the shape; it has no navigate call of its own.
  'navigation/nestedTab.ts',
]);

/**
 * Blank out comments so prose about the pattern is not mistaken for the
 * pattern (RootNavigator and tabPressBehavior both quote it at length).
 * Replaces comment bodies with spaces rather than deleting them, so byte
 * offsets — and therefore reported line numbers — stay true to the file.
 * String and template literals are left alone: the scan reads route names
 * out of them.
 */
function blankComments(source: string): string {
  const out = source.split('');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') out[i++] = ' ';
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) if (source[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join('');
}

/** Advance past a string literal that starts at `i`; returns the index after it. */
function skipString(source: string, i: number): number {
  const quote = source[i];
  i++;
  while (i < source.length) {
    if (source[i] === '\\') { i += 2; continue; }
    if (source[i] === quote) return i + 1;
    i++;
  }
  return i;
}

/**
 * The keys written directly in the object literal opening at `open`, mapped to
 * the index just after their colon. Nested objects are skipped, so a `screen`
 * belonging to an inner `params` is never mistaken for this object's own.
 */
function topLevelKeys(source: string, open: number): Map<string, number> {
  const keys = new Map<string, number>();
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(source, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) break;
      i++;
      continue;
    }
    if (depth === 1 && /[A-Za-z_$]/.test(ch)) {
      const word = /^[A-Za-z0-9_$]+/.exec(source.slice(i))?.[0] ?? '';
      const after = source.slice(i + word.length);
      const colon = /^\s*:/.exec(after);
      if (colon) keys.set(word, i + word.length + colon[0].length);
      // `{ screen, params }` — shorthand, so the route name is a variable and
      // nothing here can prove which screen it is. -1 marks "unknowable".
      else if (/^\s*[,}]/.test(after)) keys.set(word, -1);
      i += word.length;
      continue;
    }
    i++;
  }
  return keys;
}

/** The string literal starting at `from` (after optional whitespace), if any. */
function literalAt(source: string, from: number): string | null {
  const match = /^\s*(['"])([^'"]*)\1/.exec(source.slice(from));
  return match ? match[2] : null;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

/**
 * An object that hands a tab a child screen must say `initial: false` — unless
 * the child IS that tab's root, which is reached by navigating to the tab
 * alone and would otherwise be stacked under itself.
 */
function violates(source: string, open: number, tab: string): boolean {
  const keys = topLevelKeys(source, open);
  const screenAt = keys.get('screen');
  if (screenAt === undefined) return false; // Landing on the tab itself.
  if (keys.has('initial')) return false;
  // A computed screen name could be anything, including a non-root — so the
  // exemption below cannot be claimed for it.
  if (screenAt < 0) return true;
  const screen = literalAt(source, screenAt);
  const root = (TAB_STACK_ROOT_ROUTE as Record<string, string>)[tab];
  return !(screen !== null && screen === root);
}

/**
 * `navigate('SomeTab', { … })` — a screen reaching sideways into another tab.
 */
const DIRECT_NAVIGATE = /navigate\s*\(\s*['"](\w+Tab)['"]\s*,\s*\{/g;

/**
 * `{ screen: 'SomeTab', params: { … } }` — the CommonActions form used to
 * cross the root navigator (deep links, the companion panel, modals).
 */
const NESTED_DESCRIPTOR = /screen\s*:\s*['"](\w+Tab)['"]/g;

/** Find the `params: {` written as a sibling of the match at `from`. */
function siblingParamsObject(source: string, from: number): number | null {
  let depth = 0;
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(source, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      if (depth === 0) return null; // Left the enclosing object.
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && source.startsWith('params', i) && /[^A-Za-z0-9_$]/.test(source[i - 1] ?? ' ')) {
      const open = /^params\s*:\s*\{/.exec(source.slice(i));
      if (open) return i + open[0].length - 1;
    }
    i++;
  }
  return null;
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__mocks__') continue;
      collectFiles(full, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.test\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

export function findNestedNavigateViolations(): string[] {
  const violations: string[] = [];
  for (const file of collectFiles(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, file).split(path.sep).join('/');
    if (EXEMPT_FILES.has(rel)) continue;
    const source = blankComments(fs.readFileSync(file, 'utf8'));

    DIRECT_NAVIGATE.lastIndex = 0;
    for (let m = DIRECT_NAVIGATE.exec(source); m; m = DIRECT_NAVIGATE.exec(source)) {
      const open = m.index + m[0].length - 1;
      if (violates(source, open, m[1])) {
        violations.push(`${rel}:${lineOf(source, m.index)} navigate('${m[1]}', …)`);
      }
    }

    NESTED_DESCRIPTOR.lastIndex = 0;
    for (let m = NESTED_DESCRIPTOR.exec(source); m; m = NESTED_DESCRIPTOR.exec(source)) {
      const open = siblingParamsObject(source, m.index + m[0].length);
      if (open !== null && violates(source, open, m[1])) {
        violations.push(`${rel}:${lineOf(source, m.index)} { screen: '${m[1]}', params: … }`);
      }
    }
  }
  return violations;
}

describe('nested tab navigates', () => {
  it('all pass initial:false (use toTab from navigation/nestedTab)', () => {
    const violations = findNestedNavigateViolations();
    expect(violations.join('\n')).toBe('');
  });

  it('actually detects the pattern it is meant to guard (self-check)', () => {
    // If the scanner ever silently stops matching, the test above passes for
    // the wrong reason. Prove the two forms are still recognised.
    const bad = "navigate('StudyTab', { screen: 'TestTaking', params: { id: 1 } });";
    const good = "navigate('StudyTab', { screen: 'TestTaking', params: { id: 1 }, initial: false });";
    DIRECT_NAVIGATE.lastIndex = 0;
    const match = DIRECT_NAVIGATE.exec(bad);
    expect(match).not.toBeNull();
    expect(violates(bad, match!.index + match![0].length - 1, 'StudyTab')).toBe(true);
    DIRECT_NAVIGATE.lastIndex = 0;
    const okMatch = DIRECT_NAVIGATE.exec(good)!;
    expect(violates(good, okMatch.index + okMatch[0].length - 1, 'StudyTab')).toBe(false);
  });

  it('allows navigating to a tab root, which must not be stacked under itself', () => {
    const rootward = "navigate('HomeTab', { screen: 'Dashboard' });";
    DIRECT_NAVIGATE.lastIndex = 0;
    const m = DIRECT_NAVIGATE.exec(rootward)!;
    expect(violates(rootward, m.index + m[0].length - 1, 'HomeTab')).toBe(false);
  });

  it('catches a shorthand screen, whose route name it cannot read', () => {
    // `navigate('ChatTab', { screen, params })` — the route is a variable, so
    // the tab-root exemption cannot be claimed and initial:false is required.
    const shorthand = "navigate('ChatTab', { screen, params });";
    DIRECT_NAVIGATE.lastIndex = 0;
    const m = DIRECT_NAVIGATE.exec(shorthand)!;
    expect(violates(shorthand, m.index + m[0].length - 1, 'ChatTab')).toBe(true);
  });

  it('ignores the pattern when it appears in a comment', () => {
    const commented = "// navigate('StudyTab', { screen: 'TestTaking' })\nconst x = 1;";
    DIRECT_NAVIGATE.lastIndex = 0;
    expect(DIRECT_NAVIGATE.exec(blankComments(commented))).toBeNull();
  });
});
