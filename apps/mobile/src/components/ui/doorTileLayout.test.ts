import { DOOR_TILE, dpFromMeasuredPx } from '../../theme/surfaceMetrics';
import {
  DOOR_TILE_MIN_WIDTH,
  doorTileColumnWidth,
  doorTileLayout,
} from './doorTileLayout';

describe('doorTileLayout — the panel is told, never measured', () => {
  it('gives the panel two thirds of the height and the footer the rest', () => {
    const layout = doorTileLayout({ width: 188 });
    expect(layout.panelHeight + layout.footerHeight).toBe(layout.height);
    // 66% is the defining proportion of a StudyFetch door; anything that
    // drifts it turns the tile back into a card with a colour strip.
    expect(layout.panelHeight / layout.height).toBeCloseTo(0.66, 2);
  });

  it('reproduces the measured 493x503 px tile at its own width', () => {
    // The source measurement, converted at the device's 2.625 density.
    const width = dpFromMeasuredPx(493);
    const layout = doorTileLayout({ width });
    expect(Math.round(layout.height)).toBe(Math.round(dpFromMeasuredPx(503)));
  });

  it('is slightly portrait at every width', () => {
    for (const width of [120, 150, 188, 240]) {
      const layout = doorTileLayout({ width });
      expect(layout.height).toBeGreaterThan(width);
    }
  });

  it('reserves the illustration box without asking the illustration', () => {
    // The build-166 bug in one assertion: the picture's size must be knowable
    // from the width alone, on the very first layout pass, or a hub's doors
    // render at a floor with the drawing clipped through the tile's edge.
    const layout = doorTileLayout({ width: 188 });
    expect(layout.illustrationSize).toBeGreaterThan(0);
    // It fits inside the panel once the panel's top padding is paid at both
    // ends, so the drawing can never spill past the pastel.
    expect(layout.illustrationSize).toBeLessThanOrEqual(
      layout.panelHeight - DOOR_TILE.panelPaddingTop * 2
    );
    expect(layout.illustrationSize).toBeLessThanOrEqual(layout.width);
  });

  it('returns drawable boxes for a degenerate width rather than negative ones', () => {
    const layout = doorTileLayout({ width: 0 });
    expect(layout.height).toBe(0);
    expect(layout.panelHeight).toBe(0);
    expect(layout.footerHeight).toBe(0);
    // Yoga rejects a negative height; a zero one merely draws nothing.
    expect(layout.illustrationSize).toBe(0);
    expect(doorTileLayout({ width: -50 }).width).toBe(0);
  });

  it('carries the hard shadow and the radius, so a call site needs no literal', () => {
    const layout = doorTileLayout({ width: 188 });
    expect(layout.shadowOffset).toBe(DOOR_TILE.shadowOffset);
    expect(layout.radius).toBe(DOOR_TILE.radius);
  });
});

describe('doorTileColumnWidth — the grid the doors sit in', () => {
  it('pays both page margins and the gutters between the columns', () => {
    // 360 dp phone, two up: 360 - 13*2 - 11 = 323, halved.
    expect(
      doorTileColumnWidth({ screenWidth: 360, columns: 2 })
    ).toBeCloseTo((360 - DOOR_TILE.pageMargin * 2 - DOOR_TILE.gridGutter) / 2, 1);
  });

  it('pays no gutter for a single column', () => {
    expect(doorTileColumnWidth({ screenWidth: 360, columns: 1 })).toBeCloseTo(
      360 - DOOR_TILE.pageMargin * 2,
      1
    );
  });

  it('floors a collapsed column rather than returning a negative width', () => {
    // A door that has collapsed is invisible in review; one that overflows is
    // not. So the floor wins over the arithmetic.
    expect(doorTileColumnWidth({ screenWidth: 200, columns: 4 })).toBe(DOOR_TILE_MIN_WIDTH);
    expect(doorTileColumnWidth({ screenWidth: 0, columns: 2 })).toBe(DOOR_TILE_MIN_WIDTH);
  });

  it('treats a nonsense column count as one column', () => {
    expect(doorTileColumnWidth({ screenWidth: 360, columns: 0 })).toBeCloseTo(
      360 - DOOR_TILE.pageMargin * 2,
      1
    );
  });
});
