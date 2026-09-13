import {
  hexHasAlpha,
  hexToRgbChannels,
  isAlphaBakedPaletteKey,
  LANTERN_CSS_VAR_PALETTE_KEYS,
} from './colorChannels';
import { lightTheme, darkTheme } from './tokens';

describe('hexToRgbChannels', () => {
  it('converts 6-digit hex to space-separated channels', () => {
    expect(hexToRgbChannels('#4f46e5')).toBe('79 70 229');
    expect(hexToRgbChannels('4f46e5')).toBe('79 70 229');
  });

  it('expands shorthand hex', () => {
    expect(hexToRgbChannels('#fff')).toBe('255 255 255');
  });

  it('returns the RGB channels of an alpha hex (alpha is not representable)', () => {
    expect(hexToRgbChannels('#6366f120')).toBe('99 102 241');
  });

  it('returns null for non-hex input so callers can pass it through', () => {
    // Critical: emitting a bad value here renders TRANSPARENT rather than failing.
    expect(hexToRgbChannels('rgb(1,2,3)')).toBeNull();
    expect(hexToRgbChannels('')).toBeNull();
    expect(hexToRgbChannels('#12345')).toBeNull();
  });
});

describe('hexHasAlpha', () => {
  it('detects alpha-carrying hex', () => {
    expect(hexHasAlpha('#6366f120')).toBe(true);
    expect(hexHasAlpha('#4f46e5')).toBe(false);
  });
});

describe('alpha-baked palette keys', () => {
  it('names exactly the dark tokens that carry their own alpha', () => {
    // Guard: if a new translucent token is added to the palette without being
    // listed here, converting it to channels would silently make it opaque.
    // Only the keys that actually reach Tailwind as CSS variables matter; the
    // rest are consumed as whole colours in style props.
    const translucent = LANTERN_CSS_VAR_PALETTE_KEYS.filter((key) =>
      hexHasAlpha((darkTheme as Record<string, string>)[key])
    );
    expect(translucent.every((key) => isAlphaBakedPaletteKey(key))).toBe(true);
    // And the exemption list must not claim keys that are actually opaque.
    expect(translucent.length).toBe(2);
  });

  it('light-theme equivalents are opaque and convert cleanly', () => {
    expect(hexHasAlpha(lightTheme.primaryBackground)).toBe(false);
    // #191919 since the 2026-09-12 colour pivot: primary is the theme's ink.
    expect(hexToRgbChannels(lightTheme.primary)).toBe('25 25 25');
  });
});
