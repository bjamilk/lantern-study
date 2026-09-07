import {
  ILLUSTRATIONS,
  ILLUSTRATION_CONTENT_BOXES,
  ILLUSTRATION_FRAME_MARGIN,
  ILLUSTRATION_MAX_PATH_BYTES,
  ILLUSTRATION_NAMES,
  ILLUSTRATION_STROKE_WIDTH,
  ILLUSTRATION_VIEW_BOX,
  ILLUSTRATION_VIEW_BOX_SIZE,
  illustrationPathBytes,
  illustrationViewBox,
  isIllustrationName,
  type IllustrationName,
} from './index';

/** The commands the authored subset uses. Anything else is a typo, not a style. */
const ALLOWED_COMMANDS = /^[MLHVCAZmlhvcaz0-9.\s-]+$/;

describe('the illustration set', () => {
  it('is the ten names the spec enumerates, and only those ten', () => {
    // Spelled out rather than derived: this list IS the §5.6 budget. Adding an
    // eleventh door has to be a decision someone makes here, not a side effect.
    expect(ILLUSTRATION_NAMES).toEqual([
      'notes-stack',
      'cards-fan',
      'test-sheet',
      'mic-wave',
      'import-tray',
      'readiness-ring',
      'sparkles-book',
      'campus-hall',
      'download-phone',
      'empty-inbox',
    ]);
    expect(ILLUSTRATION_NAMES).toHaveLength(10);
  });

  it('shares one viewBox and one stroke weight across every asset', () => {
    expect(ILLUSTRATION_VIEW_BOX).toBe('0 0 96 96');
    expect(ILLUSTRATION_VIEW_BOX).toBe(`0 0 ${ILLUSTRATION_VIEW_BOX_SIZE} ${ILLUSTRATION_VIEW_BOX_SIZE}`);
    expect(ILLUSTRATION_STROKE_WIDTH).toBe(2);
  });

  it('narrows an unmapped string at runtime, the way the type does at compile time', () => {
    expect(isIllustrationName('notes-stack')).toBe(true);
    expect(isIllustrationName('notes_stack')).toBe(false);
    expect(isIllustrationName('toString')).toBe(false); // prototype keys are not names
    expect(isIllustrationName(undefined)).toBe(false);
  });
});

describe.each(ILLUSTRATION_NAMES)('%s', (name: IllustrationName) => {
  const asset = ILLUSTRATIONS[name];

  it('draws at least one path and stays inside the per-asset byte budget', () => {
    expect(asset.paths.length).toBeGreaterThan(0);
    expect(illustrationPathBytes(name)).toBeLessThanOrEqual(ILLUSTRATION_MAX_PATH_BYTES);
  });

  it('is pure ASCII path data, so byte length equals string length', () => {
    for (const d of asset.paths) {
      expect(Buffer.byteLength(d, 'utf8')).toBe(d.length);
    }
  });

  it('uses only the authored command subset and starts every subpath absolutely', () => {
    for (const d of asset.paths) {
      expect(d).toMatch(ALLOWED_COMMANDS);
      expect(d.startsWith('M')).toBe(true);
      expect(d.trim()).toBe(d);
      // A `fill`/`stroke`/`style` string here would mean colour escaped into
      // the asset, which is what breaks the "identical in both themes" rule.
      expect(d).not.toMatch(/#|rgb|fill|stroke/i);
    }
  });

  it('has exactly one ground ellipse, sitting low and inside the square', () => {
    const { cx, cy, rx, ry } = asset.ground;
    for (const v of [cx, cy, rx, ry]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(rx).toBeGreaterThan(0);
    expect(ry).toBeGreaterThan(0);
    // Low: the ground is under the subject, not behind it.
    expect(cy).toBeGreaterThanOrEqual(ILLUSTRATION_VIEW_BOX_SIZE * 0.7);
    // Inside: nothing clips at the viewBox edge, at any render size.
    expect(cx - rx).toBeGreaterThanOrEqual(0);
    expect(cx + rx).toBeLessThanOrEqual(ILLUSTRATION_VIEW_BOX_SIZE);
    expect(cy - ry).toBeGreaterThanOrEqual(0);
    expect(cy + ry).toBeLessThanOrEqual(ILLUSTRATION_VIEW_BOX_SIZE);
  });

  it('keeps every drawn coordinate inside the square, allowing for the stroke', () => {
    // Absolute-command coordinates only — enough to catch a fat-fingered digit
    // without re-implementing an SVG path parser.
    const half = ILLUSTRATION_STROKE_WIDTH / 2;
    for (const d of asset.paths) {
      for (const [, xs, ys] of d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
        const x = Number(xs);
        const y = Number(ys);
        expect(x - half).toBeGreaterThanOrEqual(0);
        expect(x + half).toBeLessThanOrEqual(ILLUSTRATION_VIEW_BOX_SIZE);
        expect(y - half).toBeGreaterThanOrEqual(0);
        expect(y + half).toBeLessThanOrEqual(ILLUSTRATION_VIEW_BOX_SIZE);
      }
    }
  });
});

describe('how big the drawing is inside its box', () => {
  // These pinned the crop on mobile before the table moved here. They belong
  // beside the data now, because BOTH renderers read it: a box that drifts
  // would reframe web and mobile at once.

  it('crops the viewBox to the asset, so the ink fills the box', () => {
    // The build 166 finding: a 56 dp tile picture drew ~32 dp of ink (Library
    // 32x34, Tests 32x42, Flashcards 36x35, Import 32x39) and the 72 dp
    // readiness ring drew 44x50. The box was already correct; the drawing
    // inside it was two thirds of the authored 96-square. Every asset must
    // therefore be framed tighter than that square.
    for (const name of ILLUSTRATION_NAMES) {
      const box = ILLUSTRATION_CONTENT_BOXES[name];
      expect(box.side + ILLUSTRATION_FRAME_MARGIN * 2).toBeLessThan(96);
      // and not so tight that the drawing would overflow its own box
      expect(box.side).toBeGreaterThan(48);
    }
  });

  it('frames every asset square, so no drawing is stretched', () => {
    for (const name of ILLUSTRATION_NAMES) {
      const [, , w, h] = illustrationViewBox(name).split(' ').map(Number);
      expect(w).toBe(h);
    }
  });

  it("keeps each asset's ground ellipse inside its frame", () => {
    // The one part of the geometry that is DATA rather than path syntax, so it
    // is the one part this table can be checked against: if a drawing moves,
    // its ground moves with it, and a stale box is caught here rather than on
    // a device.
    for (const name of ILLUSTRATION_NAMES) {
      const { ground } = ILLUSTRATIONS[name];
      const box = ILLUSTRATION_CONTENT_BOXES[name];
      expect(ground.cx - ground.rx).toBeGreaterThanOrEqual(box.x);
      expect(ground.cx + ground.rx).toBeLessThanOrEqual(box.x + box.side);
      expect(ground.cy - ground.ry).toBeGreaterThanOrEqual(box.y);
      expect(ground.cy + ground.ry).toBeLessThanOrEqual(box.y + box.side);
    }
  });

  it('answers for every name, so no call site can render an empty frame', () => {
    for (const name of ILLUSTRATION_NAMES) {
      expect(ILLUSTRATION_CONTENT_BOXES[name]).toBeDefined();
    }
    expect(Object.keys(ILLUSTRATION_CONTENT_BOXES).sort()).toEqual([...ILLUSTRATION_NAMES].sort());
  });
});

describe('the asset inventory', () => {
  it('records each asset path count and cost, so a redraw shows up in the diff', () => {
    const inventory = ILLUSTRATION_NAMES.map((name) => ({
      name,
      viewBox: ILLUSTRATION_VIEW_BOX,
      paths: ILLUSTRATIONS[name].paths.length,
      bytes: illustrationPathBytes(name),
    }));

    expect(inventory).toEqual([
      { name: 'notes-stack', viewBox: '0 0 96 96', paths: 6, bytes: 178 },
      { name: 'cards-fan', viewBox: '0 0 96 96', paths: 5, bytes: 164 },
      { name: 'test-sheet', viewBox: '0 0 96 96', paths: 8, bytes: 189 },
      { name: 'mic-wave', viewBox: '0 0 96 96', paths: 6, bytes: 163 },
      { name: 'import-tray', viewBox: '0 0 96 96', paths: 3, bytes: 100 },
      { name: 'readiness-ring', viewBox: '0 0 96 96', paths: 3, bytes: 90 },
      { name: 'sparkles-book', viewBox: '0 0 96 96', paths: 5, bytes: 330 },
      { name: 'campus-hall', viewBox: '0 0 96 96', paths: 7, bytes: 82 },
      { name: 'download-phone', viewBox: '0 0 96 96', paths: 6, bytes: 147 },
      { name: 'empty-inbox', viewBox: '0 0 96 96', paths: 4, bytes: 97 },
    ]);
  });

  it('costs the whole set well under the Android bundle allowance', () => {
    const total = ILLUSTRATION_NAMES.reduce((sum, n) => sum + illustrationPathBytes(n), 0);
    // Ten assets against a 40 KB delta budget; path data must not be the
    // reason that budget is spent.
    expect(total).toBeLessThan(8 * 1024);
  });
});
