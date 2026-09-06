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

  it('keeps every light tint within 1.2:1 of white, so a tinted card reads as coloured, not lighter', () => {
    for (const key of FEATURE_KEYS) {
      expect(contrastRatio(featureAccentsLight[key].tint, '#ffffff')).toBeLessThanOrEqual(1.2);
    }
  });
});

describe('feature accent tokens', () => {
  it('carries the eight spec keys in both themes', () => {
    expect([...FEATURE_KEYS]).toEqual([
      'notes',
      'flashcards',
      'tests',
      'recording',
      'ai',
      'groups',
      'campus',
      'budget',
    ]);
    expect(Object.keys(featureAccentsLight)).toEqual([...FEATURE_KEYS]);
    expect(Object.keys(featureAccentsDark)).toEqual([...FEATURE_KEYS]);
  });

  it('holds the spec §5.6 hex values exactly', () => {
    expect(featureAccentsLight.notes).toEqual({ ink: '#0f766e', tint: '#ccfbf1' });
    expect(featureAccentsLight.budget).toEqual({ ink: '#b45309', tint: '#fef3c7' });
    expect(featureAccentsDark.notes).toEqual({ ink: '#5eead4', tint: '#0f2f2c' });
    expect(featureAccentsDark.budget).toEqual({ ink: '#fbbf24', tint: '#3a2a08' });
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
    // dashboard was the indigo primary and stays byte-identical.
    expect(featureAccents.dashboard).toBe(lightTheme.primary);
  });

  it('emits ink and tint as RGB channels, not hex', () => {
    const vars = featureAccentPairsToCssVars(featureAccentsLight);
    expect(vars['--color-feature-notes-ink']).toBe('15 118 110');
    expect(vars['--color-feature-notes-tint']).toBe('204 251 241');
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
    expect(light['--color-feature-notes-ink']).toBe('15 118 110');
    expect(dark['--color-feature-notes-ink']).toBe('94 234 212');
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
