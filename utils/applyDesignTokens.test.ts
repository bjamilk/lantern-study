/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  darkTheme,
  lightTheme,
} from '@lantern/shared/design';
import { applyDesignTokensToDom, deriveAccentRoles } from './applyDesignTokens';

const AA = 4.5;
const channelsToHex = (channels: string) =>
  '#' +
  channels
    .split(' ')
    .map((c) => Number(c).toString(16).padStart(2, '0'))
    .join('');

describe('deriveAccentRoles', () => {
  const accents = ['#6366f1', '#f59e0b', '#0f766e', '#4f46e5', '#ffffff', '#000000'];

  it.each(accents)('fill holds a white label and text clears every ground: %s', (accent) => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = theme === 'dark' ? darkTheme : lightTheme;
      const roles = deriveAccentRoles(accent, theme);
      expect(roles).not.toBeNull();
      const fill = channelsToHex(roles!.primaryFill);
      const text = channelsToHex(roles!.primaryText);
      expect(contrastRatio('#ffffff', fill)).toBeGreaterThanOrEqual(AA);
      for (const ground of [
        palette.surface,
        palette.card,
        palette.background,
        compositeOver(palette.primaryBackground, palette.surface),
        compositeOver(palette.primaryBackground, palette.background),
      ]) {
        expect(contrastRatio(text, ground)).toBeGreaterThanOrEqual(AA);
      }
    }
  });

  it('gives the dual-role --color-primary each theme dominant role', () => {
    const light = deriveAccentRoles('#6366f1', 'light')!;
    const dark = deriveAccentRoles('#6366f1', 'dark')!;
    expect(light.primary).toBe(light.primaryFill);
    expect(dark.primary).toBe(dark.primaryText);
  });

  it('returns null for an unparseable accent', () => {
    expect(deriveAccentRoles('not-a-colour', 'light')).toBeNull();
  });
});

describe('applyDesignTokensToDom', () => {
  const root = () => document.documentElement;
  beforeEach(() => {
    root().removeAttribute('style');
  });

  it('writes fill, text and the dual-role var as channels for a custom accent', () => {
    applyDesignTokensToDom('light', { accentColor: '#f59e0b' });
    const fill = root().style.getPropertyValue('--color-primary-fill');
    const text = root().style.getPropertyValue('--color-primary-text');
    const primary = root().style.getPropertyValue('--color-primary');
    expect(fill).toMatch(/^\d+ \d+ \d+$/);
    expect(text).toMatch(/^\d+ \d+ \d+$/);
    expect(primary).toBe(fill);
    expect(contrastRatio('#ffffff', channelsToHex(fill))).toBeGreaterThanOrEqual(AA);
    expect(root().style.getPropertyValue('--lantern-accent')).toBe('#f59e0b');
  });

  it('re-derives the text ink against the dark palette on a theme change', () => {
    applyDesignTokensToDom('light', { accentColor: '#0f766e' });
    const lightText = root().style.getPropertyValue('--color-primary-text');
    applyDesignTokensToDom('dark', { accentColor: '#0f766e' });
    const darkText = root().style.getPropertyValue('--color-primary-text');
    expect(darkText).not.toBe(lightText);
    expect(contrastRatio(channelsToHex(darkText), darkTheme.surface)).toBeGreaterThanOrEqual(AA);
    expect(root().style.getPropertyValue('--color-primary')).toBe(darkText);
  });

  it('clears all three vars for the default accent so the stylesheet palette wins', () => {
    applyDesignTokensToDom('light', { accentColor: '#f59e0b' });
    applyDesignTokensToDom('light', { accentColor: '#6366f1' });
    for (const name of ['--color-primary', '--color-primary-fill', '--color-primary-text', '--lantern-accent']) {
      expect(root().style.getPropertyValue(name)).toBe('');
    }
  });

  it('clears the vars for an unparseable accent rather than poisoning them', () => {
    applyDesignTokensToDom('light', { accentColor: '#f59e0b' });
    applyDesignTokensToDom('light', { accentColor: 'nope' });
    for (const name of ['--color-primary', '--color-primary-fill', '--color-primary-text']) {
      expect(root().style.getPropertyValue(name)).toBe('');
    }
  });
});
