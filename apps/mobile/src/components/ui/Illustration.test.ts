/**
 * The renderer's two decisions, tested without a renderer.
 *
 * What is NOT tested here on purpose: the geometry, the stroke weight and the
 * byte budget. Those belong to the asset, they live in `@lantern/shared`, and
 * the suite beside that module already pins them — asserting them again here
 * would just mean two places to update when a drawing changes.
 */
import {
  ILLUSTRATIONS,
  ILLUSTRATION_NAMES,
  ILLUSTRATION_STROKE_WIDTH,
  ILLUSTRATION_VIEW_BOX,
  illustrationViewBox,
  type IllustrationName,
} from '@lantern/shared/design';
import {
  ILLUSTRATION_SIZES,
  illustrationFills,
  illustrationSvgProps,
} from './illustrationFills';

const PAIR = { ink: '#0f766e', tint: '#ccfbf1', surface: '#fffdf7' };

describe('illustrationFills', () => {
  it('draws in the feature ink whichever ground it sits on', () => {
    expect(illustrationFills({ ...PAIR, variant: 'tint' }).stroke).toBe(PAIR.ink);
    expect(illustrationFills({ ...PAIR, variant: 'surface' }).stroke).toBe(PAIR.ink);
  });

  it('fills the ground with the tint on a neutral surface', () => {
    expect(illustrationFills({ ...PAIR, variant: 'tint' }).ground).toBe(PAIR.tint);
  });

  it('inverts the ground on a tint band, so it is not tint-on-tint', () => {
    // The whole reason `variant` exists: on an empty state's band or a
    // full-tint coaching card the authored tint ground would be invisible.
    expect(illustrationFills({ ...PAIR, variant: 'surface' }).ground).toBe(PAIR.surface);
    expect(illustrationFills({ ...PAIR, variant: 'surface' }).ground).not.toBe(PAIR.tint);
  });
});

describe('sizes', () => {
  it('offers three and only three', () => {
    // A fourth size is a design decision, not a prop tweak — same rule as
    // FeatureDisc's 40/32/24.
    expect(ILLUSTRATION_SIZES).toEqual([96, 72, 56]);
  });

  it('scales one square asset, so the stroke stays proportional at every size', () => {
    expect(ILLUSTRATION_VIEW_BOX).toBe('0 0 96 96');
    expect(ILLUSTRATION_STROKE_WIDTH).toBe(2);
  });
});

describe('the map the renderer indexes', () => {
  it('answers for every name, so no call site can render a hole', () => {
    for (const name of ILLUSTRATION_NAMES) {
      const asset = ILLUSTRATIONS[name];
      expect(asset.paths.length).toBeGreaterThan(0);
      expect(asset.ground.rx).toBeGreaterThan(0);
    }
  });

  it('is ten doors and empty states, not an open icon set', () => {
    // Mobile's own guard on §5.6: growing this is a founder decision that has
    // to break a test, not something a screen quietly does on its own.
    expect(ILLUSTRATION_NAMES).toHaveLength(10);
  });

  it('names the ones the mobile app actually places', () => {
    // Every illustration this lane wired, listed once. If a screen drops its
    // picture, this is the line that notices.
    const placed: IllustrationName[] = [
      'notes-stack',
      'cards-fan',
      'test-sheet',
      'mic-wave',
      'import-tray',
      'readiness-ring',
      'campus-hall',
      'download-phone',
    ];
    for (const name of placed) expect(ILLUSTRATION_NAMES).toContain(name);
  });
});

// The per-asset ink boxes themselves are pinned in `@lantern/shared`, beside
// the geometry they crop, because web frames the ten drawings from the same
// table. What is left here is the half that is this renderer's own: the box it
// hands the `Svg`.
describe('how big the drawing is', () => {
  it('hands the Svg the size the call site asked for, in both axes', () => {
    // The renderer may decide the size and NOTHING else may change it — no
    // wrapper, no parent row, no percentage. Asserted for every asset at every
    // legal size because a per-asset box is exactly where a size could get
    // dropped.
    for (const name of ILLUSTRATION_NAMES) {
      for (const size of ILLUSTRATION_SIZES) {
        const svg = illustrationSvgProps(name, size);
        expect(svg.width).toBe(size);
        expect(svg.height).toBe(size);
      }
    }
  });

  it('takes the crop from the shared table rather than cropping again here', () => {
    // `illustrationSvgProps` is a wrapper, and the point of a wrapper is that
    // it adds nothing: the moment mobile computes its own viewBox, the two
    // platforms are free to drift, which is the thing the shared table exists
    // to prevent.
    for (const name of ILLUSTRATION_NAMES) {
      expect(illustrationSvgProps(name, 56).viewBox).toBe(illustrationViewBox(name));
    }
  });
});
