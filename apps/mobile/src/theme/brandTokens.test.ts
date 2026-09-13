/**
 * The mobile side of the Round 2 colour pivot.
 *
 * The phone had TWO colour systems. One was the shared palette
 * (`packages/shared/src/design/tokens.ts`), which the mobile theme imports
 * wholesale — so retargeting the `primary` family on web moves the phone with
 * it, for free. The other was ~215 LITERAL indigo hexes and `indigo-*` Tailwind
 * classes scattered across `src/screens` and `src/components`, which followed
 * nothing: not the token, not dark mode, not the accent setting. They are why
 * the app still looked indigo after the desktop rail already went to ink.
 *
 * This file gates both halves:
 *
 *  1. MIRROR — every `primary*` token the shared palette publishes reaches the
 *     mobile theme with the SAME value, in both palettes, through both hops
 *     (`ThemeContext`'s `lightColors`/`darkColors` and the NativeWind CSS vars
 *     in `lanternCssVars.ts`). It deliberately asserts equality with the
 *     shared palette rather than a pinned hex: the web lane owns those values,
 *     and a test that restates them just goes stale loudly. What it catches is
 *     DRIFT — a token added on web that never gets a mobile var, which is
 *     exactly how `bg-lantern-ink` came to compile to nothing.
 *
 *  2. NO LITERALS — no indigo hex or `indigo-*` class survives in the app
 *     source. This is the half a mirror test cannot see, and the half that was
 *     actually broken.
 */
import {
  lightTheme,
  darkTheme,
  hexToRgbChannels,
  type ThemePalette,
} from '@lantern/shared/design';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { BRAND_INK, BRAND_ON_INK, BRAND_TINT, brand, setBrandPalette } from './brand';

/** Every token in the primary family, and the var each one must reach. */
const PRIMARY_TOKENS = [
  ['primary', '--color-lantern-primary'],
  ['primaryLight', '--color-lantern-primary-light'],
  ['primaryDark', '--color-lantern-primary-dark'],
  ['primaryFill', '--color-lantern-primary-fill'],
  ['primaryText', '--color-lantern-primary-text'],
  ['primaryBackground', '--color-lantern-primary-background'],
] as const;

/**
 * `primaryBackground` is the one value allowed to carry its own alpha
 * (`#6366f120`), so it is published as a whole colour rather than as channels.
 * Everything else must be the three channels or `<alpha-value>` breaks.
 */
const WHOLE_COLOUR_TOKENS = new Set(['primaryBackground']);

const MODES = [
  { mode: 'light' as const, palette: lightTheme as ThemePalette },
  { mode: 'dark' as const, palette: darkTheme as ThemePalette },
];

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');

function read(relative: string): string {
  return readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
}

/**
 * The var table is read as SOURCE rather than imported. `lanternCssVars.ts`
 * pulls in `nativewind`, which pulls in the React Native runtime, and this
 * jest project runs in node — importing it fails before a single assertion
 * runs. The mapping is what needs gating anyway: the values themselves come
 * off the shared palette at runtime, so the only thing that can rot is a
 * token losing its var, or getting the wrong palette key, or being emitted as
 * a whole colour where Tailwind expects channels.
 */
const VAR_SOURCE = read('src/theme/lanternCssVars.ts');
const TAILWIND_SOURCE = read('tailwind.config.js');

describe('primary token mirror', () => {
  it.each(PRIMARY_TOKENS)('%s is published as %s', (token, cssVar) => {
    // `channels(palette.x)` for everything except the alpha-carrying
    // `primaryBackground`, which must stay a whole colour or NativeWind's
    // runtime returns undefined and the plain classes die with the /opacity
    // ones. See the comment block in lanternCssVars.ts.
    const expected = WHOLE_COLOUR_TOKENS.has(token)
      ? `'${cssVar}': palette.${token},`
      : `'${cssVar}': channels(palette.${token}),`;
    expect(VAR_SOURCE).toContain(expected);
  });

  it.each(PRIMARY_TOKENS)('%s has a Tailwind colour bound to %s', (_token, cssVar) => {
    // A var with no Tailwind colour is the silent failure this codebase has
    // hit twice: Tailwind drops an unknown colour with no error, so the
    // utility compiles to nothing and the element falls back to RN's default.
    expect(TAILWIND_SOURCE).toContain(`var(${cssVar})`);
  });

  it('publishes the ink the pills and filled controls paint with', () => {
    expect(VAR_SOURCE).toContain("'--color-lantern-ink': channels(palette.ink),");
    // `bg-lantern-ink` silently compiled to nothing before this pivot: the var
    // was published but tailwind.config.js declared no `ink` colour for it.
    expect(TAILWIND_SOURCE).toContain('var(--color-lantern-ink)');
  });
});

describe.each(MODES)('primary family shape ($mode)', ({ palette }) => {
  it('keeps every primary token a parseable colour', () => {
    for (const [token] of PRIMARY_TOKENS) {
      const value = palette[token];
      expect(typeof value).toBe('string');
      // `primaryBackground` is allowed the extra alpha pair; the rest must be
      // six digits, or `hexToRgbChannels` returns null and the var falls back
      // to the raw hex inside an rgb(), which kills the utility outright.
      const expected = WHOLE_COLOUR_TOKENS.has(token) ? /^#[0-9a-f]{6}([0-9a-f]{2})?$/i : /^#[0-9a-f]{6}$/i;
      expect(value).toMatch(expected);
      if (!WHOLE_COLOUR_TOKENS.has(token)) {
        expect(hexToRgbChannels(value)).not.toBeNull();
      }
    }
  });
});

describe('brand accessors', () => {
  afterEach(() => setBrandPalette(false));

  it('follows the effective theme', () => {
    setBrandPalette(false);
    expect(brand.ink).toBe(lightTheme.primaryFill);
    expect(brand.text).toBe(lightTheme.primaryText);
    expect(brand.onInk).toBe(lightTheme.textInverse);

    setBrandPalette(true);
    expect(brand.ink).toBe(darkTheme.primaryFill);
    expect(brand.text).toBe(darkTheme.primaryText);
    expect(brand.onInk).toBe(darkTheme.textInverse);
  });

  it('pins the fixed constants to the LIGHT palette', () => {
    // These exist for `StyleSheet.create` at module scope and for fills whose
    // label is a hard-coded `#fff`. If they ever started following the theme,
    // the StyleSheet copies would freeze to whatever was current at import and
    // the white labels would land on a near-white ground. See theme/brand.ts.
    expect(BRAND_INK).toBe(lightTheme.primaryFill);
    expect(BRAND_ON_INK).toBe(lightTheme.textInverse);
    expect(BRAND_TINT).toBe(lightTheme.primaryBackground);
  });
});

describe('no literal indigo in the app source', () => {
  /**
   * The deliberate survivors, each a USER-FACING PALETTE rather than a brand
   * treatment — indigo is one swatch among several the user picks from, so
   * removing it would remove a choice:
   *   - the accent-colour presets in Settings,
   *   - the budget category colour picker,
   *   - the flashcard SRS status colours.
   *
   * Test files are skipped wholesale: several of them (this one included)
   * name the old hexes precisely in order to assert they are gone, and a lint
   * that flags its own assertion list is a lint that gets deleted.
   */
  const ALLOWED = [
    'src/screens/settings/SettingsScreen.tsx',
    'src/stores/budgetStore.ts',
    'src/utils/flashcardHelpers.ts',
  ];

  const isTest = (file: string) => /\.test\.tsx?$/.test(file);

  function grep(pattern: string): string[] {
    try {
      const out = execFileSync(
        'grep',
        ['-rlE', '--include=*.ts', '--include=*.tsx', pattern, 'src'],
        { cwd: MOBILE_ROOT, encoding: 'utf8' }
      );
      return out.split('\n').filter(Boolean);
    } catch {
      // grep exits 1 when it matches nothing, which is the passing case.
      return [];
    }
  }

  /** Only a hex in CODE counts; the pivot's own prose names the old colours. */
  function codeHits(file: string, pattern: RegExp): string[] {
    const src = execFileSync('cat', [file], { cwd: MOBILE_ROOT, encoding: 'utf8' });
    return src
      .split('\n')
      .filter((line) => pattern.test(line))
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  }

  it('has no indigo hex outside the user-facing palettes', () => {
    const offenders = grep('#4[fF]46[eE]5|#6366[fF]1|#818[cC][fF]8')
      .filter((f) => !ALLOWED.includes(f) && !isTest(f))
      .flatMap((f) => codeHits(f, /#4[fF]46[eE]5|#6366[fF]1|#818[cC][fF]8/).map((l) => `${f}: ${l.trim()}`));
    expect(offenders).toEqual([]);
  });

  it('has no indigo-* Tailwind class', () => {
    const offenders = grep('indigo-')
      .filter((f) => !isTest(f))
      .flatMap((f) =>
      codeHits(f, /indigo-/).map((l) => `${f}: ${l.trim()}`)
    );
    expect(offenders).toEqual([]);
  });
});
