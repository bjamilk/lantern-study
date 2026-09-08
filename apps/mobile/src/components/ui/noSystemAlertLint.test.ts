/**
 * A source scan, not a behaviour test.
 *
 * The founder rejected the stock Material dialog — white card, teal
 * CANCEL/EXIT in caps, Roboto — and the whole point of `appAlert` is that
 * every prompt in the app is drawn by us instead. That only holds if the next
 * screen someone writes cannot quietly reach for `Alert.alert` again, so the
 * rule is mechanical: no `Alert.alert(` and no `Alert` imported from
 * 'react-native' anywhere under apps/mobile/src.
 *
 * The 79 call sites that predated the primitive were migrated in one sweep
 * (2026-09-07), through an allowlist that could only shrink. It reached zero
 * and was deleted; this is now a plain ban with no budget.
 */
import fs from 'fs';
import path from 'path';

/** apps/mobile/src — this file sits two levels under it. */
const SRC_ROOT = path.resolve(__dirname, '../..');

/**
 * The dialog module itself: it documents the API it replaces, and the lint
 * names the pattern by definition.
 */
const EXEMPT = new Set([
  'src/components/ui/appDialog.ts',
  'src/components/ui/AppDialogHost.tsx',
  'src/components/ui/noSystemAlertLint.test.ts',
  'src/components/ui/appDialog.test.ts',
]);

/**
 * Blank comment bodies so prose ABOUT the pattern is not read as the pattern —
 * ActionSheet.tsx explains at length why it cannot use `Alert.alert`. Newlines
 * are preserved so reported line numbers stay true. Strings are left alone;
 * nothing here reads inside them.
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
      for (; i < stop; i += 1) if (source[i] !== '\n') out[i] = ' ';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return out.join('');
}

const ALERT_CALL = /\bAlert\s*\.\s*(alert|prompt)\s*\(/g;
const RN_IMPORT = /import\s*(type\s*)?\{([^}]*)\}\s*from\s*['"]react-native['"]/g;

export interface AlertHit {
  line: number;
  detail: string;
}

/** Every reason `source` still depends on the system dialog. */
export function findSystemAlerts(source: string): AlertHit[] {
  const code = blankComments(source);
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;
  const hits: AlertHit[] = [];

  for (const m of code.matchAll(ALERT_CALL)) {
    hits.push({ line: lineOf(m.index ?? 0), detail: `Alert.${m[1]}(` });
  }
  for (const m of code.matchAll(RN_IMPORT)) {
    const named = m[2].split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
    if (named.includes('Alert')) {
      hits.push({ line: lineOf(m.index ?? 0), detail: "imports Alert from 'react-native'" });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__snapshots__') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function scan(): Record<string, AlertHit[]> {
  const files: string[] = [];
  walk(SRC_ROOT, files);
  const found: Record<string, AlertHit[]> = {};
  for (const file of files.sort()) {
    const rel = `src/${path.relative(SRC_ROOT, file).split(path.sep).join('/')}`;
    if (EXEMPT.has(rel)) continue;
    const hits = findSystemAlerts(fs.readFileSync(file, 'utf8'));
    if (hits.length > 0) found[rel] = hits;
  }
  return found;
}

describe('no system alert', () => {
  const found = scan();

  it('has no Alert.alert, Alert.prompt, or react-native Alert import anywhere', () => {
    const offenders = Object.entries(found).map(
      ([file, hits]) =>
        `${file}:${hits.map((h) => h.line).join(',')} — ${hits[0].detail}. Use ` +
        "`appAlert` from components/ui/appDialog (same signature), or `confirmAsync`."
    );
    expect(offenders).toEqual([]);
  });
});

describe('the scan itself', () => {
  it('sees a call and the import', () => {
    const src = "import { Alert, View } from 'react-native';\nAlert.alert('Hi');\n";
    expect(findSystemAlerts(src).map((h) => h.detail)).toEqual([
      "imports Alert from 'react-native'",
      'Alert.alert(',
    ]);
  });

  it('ignores the pattern inside a comment', () => {
    expect(findSystemAlerts('// Alert.alert("x") is banned\n')).toEqual([]);
    expect(findSystemAlerts('/* Alert.alert("x") */\n')).toEqual([]);
  });

  it('ignores an unrelated identifier that merely ends in Alert', () => {
    expect(findSystemAlerts("import { View } from 'react-native';\nfoo(alertsLabel(0));\n")).toEqual(
      []
    );
  });

  it('is not fooled by a type-only import or an alias', () => {
    expect(findSystemAlerts("import type { Alert } from 'react-native';\n")).toHaveLength(1);
    expect(findSystemAlerts("import { Alert as RNAlert } from 'react-native';\n")).toHaveLength(1);
  });

  it('reports the migrated form as clean', () => {
    const src =
      "import { View } from 'react-native';\n" +
      "import { appAlert } from '../components/ui/appDialog';\n" +
      "appAlert('Saved');\n";
    expect(findSystemAlerts(src)).toEqual([]);
  });
});
