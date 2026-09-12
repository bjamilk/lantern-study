import {
  AA_LARGE,
  AA_NORMAL,
  LARGE_TEXT_ONLY,
  allContrastChecks,
  contrastRatio,
  failingChecks,
  formatCheck,
  parseHex,
} from './contrast';
import {
  FEATURE_KEYS,
  featureAccentsDark,
  featureAccentsLight,
  featureAccents,
  lightTheme,
  darkTheme,
  type,
  typeScaleToCssVars,
  featureAccentPairsToCssVars,
  lanternCssVars,
  TYPE_STEP_NAMES,
} from './tokens';

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4f46e5', '#4f46e5')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#0f766e', '#ccfbf1')).toBeCloseTo(
      contrastRatio('#ccfbf1', '#0f766e'),
      10
    );
  });

  it('matches known WCAG values', () => {
    // Spec v3 §5.6 quotes 4.86 for the notes ink on its tint.
    expect(contrastRatio('#0f766e', '#ccfbf1')).toBeCloseTo(4.86, 2);
    expect(contrastRatio('#4f46e5', '#ffffff')).toBeCloseTo(6.29, 2);
  });

  it('expands shorthand hex and ignores an alpha byte', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#6366f120')).toEqual([99, 102, 241]);
    expect(() => parseHex('rgb(1,2,3)')).toThrow();
  });
});

describe('design token contrast', () => {
  it('has no failing pair anywhere in the system', () => {
    const failures = failingChecks();
    // The message is the report: a bare `toHaveLength(0)` would say nothing.
    expect(failures.map(formatCheck)).toEqual([]);
  });

  it('gates at 4.5:1 unless a token is explicitly declared large-text-only', () => {
    expect(AA_NORMAL).toBe(4.5);
    expect(AA_LARGE).toBe(3);
    // Empty by design; each entry is a promise about every call site.
    expect(Object.keys(LARGE_TEXT_ONLY)).toEqual([]);
    for (const c of allContrastChecks()) {
      expect(c.min).toBe(AA_NORMAL);
    }
  });

  it('covers every feature key in both themes', () => {
    const checks = allContrastChecks();
    for (const key of FEATURE_KEYS) {
      expect(checks.some((c) => c.subject === `light feature ${key} ink`)).toBe(true);
      expect(checks.some((c) => c.subject === `dark feature ${key} ink`)).toBe(true);
    }
  });

  /**
   * 2026-09-11: the cap was 1.2:1 and the four StudyFetch pastels the founder
   * asked for are 1.16-1.33 — the cyan is 1.27, the violet 1.33. The old
   * number was not a legibility rule (body ink on every tint is gated above at
   * 13:1 or better); it was a taste rule from a wave whose tints were
   * near-white washes. The direction replaced that taste, so the number moves
   * with it. It is kept as a cap at all, rather than deleted, because the
   * thing it really prevents is a "tint" saturated enough to be an ink — at
   * 1.5:1 a panel starts competing with the black glyph drawn on it.
   */
  it('keeps every light tint within 1.35:1 of white, so a panel stays a ground and never becomes an ink', () => {
    for (const key of FEATURE_KEYS) {
      expect(contrastRatio(featureAccentsLight[key].tint, '#ffffff')).toBeLessThanOrEqual(1.35);
    }
  });
});

describe('feature accent tokens', () => {
  it('carries the nine spec keys in both themes', () => {
    expect([...FEATURE_KEYS]).toEqual([
      'notes',
      'flashcards',
      'tests',
      'recording',
      'ai',
      'groups',
      'campus',
      'budget',
      'sets',
    ]);
    expect(Object.keys(featureAccentsLight)).toEqual([...FEATURE_KEYS]);
    expect(Object.keys(featureAccentsDark)).toEqual([...FEATURE_KEYS]);
  });

  /**
   * The four tints the 2026-09-11 direction NAMES, pinned to the hex it names.
   * These are measurements off StudyFetch, not preferences: a later wave that
   * wants to nudge one is changing the reference, and should have to say so
   * here. `budget` is pinned too, as the one family the pass did not touch.
   */
  it('holds the StudyFetch pastels and the untouched families exactly', () => {
    expect(featureAccentsLight.tests.tint).toBe('#bbeef0');
    expect(featureAccentsLight.flashcards.tint).toBe('#bcf887');
    expect(featureAccentsLight.recording.tint).toBe('#f9f284');
    expect(featureAccentsLight.ai.tint).toBe('#f5d5ff');
    expect(featureAccentsLight.budget).toEqual({ ink: '#b45309', tint: '#fef3c7' });
    expect(featureAccentsDark.budget).toEqual({ ink: '#fbbf24', tint: '#3a2a08' });
  });

  /**
   * The light palette the 2026-09-11 pass shipped, as a snapshot. Every value
   * here is a number someone measured off the reference product; a silent
   * drift back to the old cream/navy is exactly the regression this catches.
   */
  it('holds the StudyFetch ground, rail and hairline', () => {
    expect(lightTheme.background).toBe('#f7f6ef');
    expect(lightTheme.backgroundSecondary).toBe('#f2f0e8');
    expect(lightTheme.surface).toBe('#ffffff');
    expect(lightTheme.border).toBe('#eceae0');
    expect(lightTheme.navColumn).toBe('#171717');
    expect(lightTheme.navColumnActive).toBe('#383838');
    expect(lightTheme.ink).toBe('#191919');
    // The ink INVERTS: a black pill on the black page would be a hole, and
    // whatever sits on the pill is `surface`, which inverts with it.
    expect(darkTheme.ink).toBe('#f5f5f5');
  });

  it('keeps the nine legacy keys as aliases so the existing call sites compile', () => {
    expect(Object.keys(featureAccents).sort()).toEqual([
      'admin',
      'budget',
      'dashboard',
      'flashcards',
      'groups',
      'library',
      'marketplace',
      'offline',
      'tests',
    ]);
    expect(featureAccents.dashboard).toBe(featureAccentsLight.ai.ink);
    expect(featureAccents.library).toBe(featureAccentsLight.notes.ink);
    expect(featureAccents.admin).toBe(featureAccentsLight.campus.ink);
    expect(featureAccents.marketplace).toBe(featureAccentsLight.campus.ink);
    expect(featureAccents.offline).toBe(featureAccentsLight.budget.ink);
    // `dashboard` USED to be byte-identical to the indigo primary, which is
    // why the alias was safe to ship. The 2026-09-11 pass moved the `ai`
    // family to StudyFetch's violet, so the alias now genuinely repaints its
    // remaining call sites — which is the intent, not a regression. Pinned to
    // the new ink so a third value cannot arrive unannounced.
    expect(featureAccents.dashboard).toBe('#7b2cab');
    expect(featureAccents.dashboard).not.toBe(lightTheme.primary);
  });

  it('emits ink and tint as RGB channels, not hex', () => {
    const vars = featureAccentPairsToCssVars(featureAccentsLight);
    expect(vars['--color-feature-notes-ink']).toBe('107 96 49');
    expect(vars['--color-feature-notes-tint']).toBe('239 235 221');
    expect(Object.keys(vars)).toHaveLength(FEATURE_KEYS.length * 2);
  });
});

describe('type scale', () => {
  it('is the six spec steps with paired line-height, weight and tracking', () => {
    expect([...TYPE_STEP_NAMES]).toEqual([
      'display',
      'title',
      'heading',
      'body',
      'caption',
      'label',
    ]);
    expect(type.display).toMatchObject({ fontSize: 28, lineHeight: 34, fontWeight: '700' });
    expect(type.title).toMatchObject({ fontSize: 22, lineHeight: 28, fontWeight: '700' });
    expect(type.heading).toMatchObject({ fontSize: 17, lineHeight: 24, fontWeight: '600' });
    expect(type.body).toMatchObject({ fontSize: 15, lineHeight: 22, fontWeight: '400' });
    expect(type.caption).toMatchObject({ fontSize: 13, lineHeight: 18, fontWeight: '400' });
    expect(type.label).toMatchObject({ fontSize: 11, lineHeight: 16, fontWeight: '600' });
  });

  it('never goes below the 11px floor', () => {
    for (const name of TYPE_STEP_NAMES) {
      expect(type[name].fontSize).toBeGreaterThanOrEqual(11);
    }
  });

  it('keeps letterSpacingPx consistent with the em tracking React Native cannot read', () => {
    for (const name of TYPE_STEP_NAMES) {
      const step = type[name];
      const em = parseFloat(step.letterSpacing);
      expect(step.letterSpacingPx).toBeCloseTo(em * step.fontSize, 1);
    }
  });

  it('emits px sizes on both platforms (rem is not resolved to 16 on mobile)', () => {
    const vars = typeScaleToCssVars();
    expect(vars['--type-display-size']).toBe('28px');
    expect(vars['--type-label-tracking']).toBe('0.04em');
    expect(vars['--type-body-lh']).toBe('22px');
    expect(vars['--font-serif']).toContain('ui-serif');
    expect(vars['--font-mono']).toContain('ui-monospace');
    // --font-sans is owned by the user's font-mode setting, not the scale.
    expect(vars['--font-sans']).toBeUndefined();
  });
});

describe('lanternCssVars', () => {
  it('gives light and dark different feature inks but the same type scale', () => {
    const light = lanternCssVars('light');
    const dark = lanternCssVars('dark');
    expect(light['--color-feature-notes-ink']).toBe('107 96 49');
    expect(dark['--color-feature-notes-ink']).toBe('226 218 194');
    expect(light['--type-title-size']).toBe(dark['--type-title-size']);
  });

  it('defines the state tokens in BOTH themes — the .dark drift this wave fixes', () => {
    for (const name of ['--color-success', '--color-warning', '--color-error', '--color-info']) {
      expect(lanternCssVars('light')[name]).toBeTruthy();
      expect(lanternCssVars('dark')[name]).toBeTruthy();
      expect(lanternCssVars('light')[name]).not.toBe(lanternCssVars('dark')[name]);
    }
  });
});
