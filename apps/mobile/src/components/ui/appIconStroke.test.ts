import { strokeWidthForSize, LUCIDE_DEFAULT_STROKE_WIDTH } from './appIconStroke';

/**
 * The founder's complaint was that icon outlines read too thin. lucide scales
 * its 2px stroke down with the icon, so the smaller the glyph the thinner the
 * line — the opposite of what a phone screen needs. These assertions pin the
 * shape of the fix, not just today's numbers.
 */
describe('strokeWidthForSize', () => {
  /** What lucide actually paints: strokeWidth is on a 24px grid and scales. */
  const rendered = (size: number, weight: number) => (weight * size) / 24;

  it('is heavier than lucide at every size a UI control uses', () => {
    // 28 and below is every icon in a row, a tab, a button or a chip.
    for (const size of [10, 12, 14, 16, 18, 20, 22, 24, 28]) {
      expect(strokeWidthForSize(size)).toBeGreaterThan(LUCIDE_DEFAULT_STROKE_WIDTH);
    }
  });

  it('goes deliberately lighter only on the large decorative glyphs', () => {
    // An empty-state or hero icon at 48-64px would read like a marker pen at
    // 2.5; lucide's own scaling already makes it heavy enough.
    for (const size of [32, 48, 64]) {
      expect(strokeWidthForSize(size)).toBeLessThan(LUCIDE_DEFAULT_STROKE_WIDTH);
    }
  });

  it('compensates for lucide scaling the stroke down: smaller icon, heavier stroke', () => {
    const widths = [12, 16, 22, 32].map(strokeWidthForSize);
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeLessThan(widths[i - 1]!);
    }
  });

  it('narrows how much the painted line thickness varies with icon size', () => {
    const sizes = [12, 16, 20, 24, 32, 48];
    const ramped = sizes.map((s) => rendered(s, strokeWidthForSize(s)));
    const plain = sizes.map((s) => rendered(s, LUCIDE_DEFAULT_STROKE_WIDTH));
    const spread = (v: number[]) => Math.max(...v) / Math.min(...v);
    expect(spread(ramped)).toBeLessThan(spread(plain));
  });

  it('pins each bracket at its boundaries', () => {
    expect(strokeWidthForSize(10)).toBe(2.5);
    expect(strokeWidthForSize(14)).toBe(2.5);
    expect(strokeWidthForSize(15)).toBe(2.25);
    expect(strokeWidthForSize(20)).toBe(2.25);
    expect(strokeWidthForSize(21)).toBe(2.1);
    expect(strokeWidthForSize(28)).toBe(2.1);
    expect(strokeWidthForSize(29)).toBe(1.9);
    expect(strokeWidthForSize(64)).toBe(1.9);
  });
});
