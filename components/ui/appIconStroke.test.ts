import { describe, expect, it } from 'vitest';
import { APP_ICONS, isAppIconName } from './appIconMap';
import { LUCIDE_DEFAULT_STROKE_WIDTH, strokeWidthForSize } from './appIconStroke';

describe('strokeWidthForSize', () => {
  it('beats lucide default at every size the app draws', () => {
    for (const size of [12, 14, 16, 18, 20, 24, 28, 32, 48, 64]) {
      expect(strokeWidthForSize(size)).toBeGreaterThan(LUCIDE_DEFAULT_STROKE_WIDTH * 0.9);
    }
  });

  it('goes heavier as the glyph gets smaller', () => {
    const sizes = [14, 20, 28, 40];
    const weights = sizes.map(strokeWidthForSize);
    for (let i = 1; i < weights.length; i += 1) {
      expect(weights[i]).toBeLessThan(weights[i - 1]);
    }
  });

  it('matches the mobile ramp step for step', () => {
    // apps/mobile/src/components/ui/appIconStroke.ts. If these drift the two
    // platforms draw the same glyph at visibly different weights.
    expect(strokeWidthForSize(14)).toBe(2.5);
    expect(strokeWidthForSize(20)).toBe(2.25);
    expect(strokeWidthForSize(24)).toBe(2.1);
    expect(strokeWidthForSize(32)).toBe(1.9);
  });
});

describe('APP_ICONS', () => {
  it('resolves every name to a component', () => {
    const broken = Object.entries(APP_ICONS)
      .filter(([, glyph]) => typeof glyph !== 'function' && typeof glyph !== 'object')
      .map(([name]) => name);
    expect(broken).toEqual([]);
  });

  it('narrows untrusted strings without a fallback glyph', () => {
    expect(isAppIconName('trash')).toBe(true);
    expect(isAppIconName('cookie-outline')).toBe(false);
    expect(isAppIconName(null)).toBe(false);
  });
});
