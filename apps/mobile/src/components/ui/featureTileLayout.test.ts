/**
 * The door-height rule, pinned.
 *
 * This is the regression from the build 166 device pass: every Home door sat
 * at its 132 floor with the picture clipped and the chevron pushed out of the
 * card, because the tile's height was whatever the first layout pass happened
 * to measure and the picture measured nothing on that pass. The rule now lives
 * in arithmetic, so it can be asserted here instead of on a device.
 */
import { typeScale } from '../../design/typeScale';
import {
  TILE_CHEVRON_SIZE,
  TILE_ILLUSTRATION_SIZE,
  TILE_TAP_TARGET_FLOOR,
  featureTileFooterHeight,
  featureTileMinHeight,
} from './featureTileLayout';

describe('the footer row', () => {
  it('is as tall as the picture, declared rather than measured', () => {
    // THE defect. A row sized by its children is a row that a late-attaching
    // `Svg` can collapse; on Home it collapsed to nothing and the drawing
    // spilled out through the tile's clipped edge.
    expect(featureTileFooterHeight(true)).toBe(TILE_ILLUSTRATION_SIZE);
  });

  it('falls back to the chevron when the door carries no picture', () => {
    expect(featureTileFooterHeight(false)).toBe(TILE_CHEVRON_SIZE);
  });
});

describe('the tile floor', () => {
  it('keeps the tap-target floor for a door with no picture', () => {
    // 132 is the 2-up-on-a-360-screen target, and a pictureless door's content
    // does not reach it — so the floor, not the content, is what wins.
    expect(featureTileMinHeight({ hasIllustration: false, hasSubtitle: true })).toBe(
      TILE_TAP_TARGET_FLOOR
    );
    expect(featureTileMinHeight({ hasIllustration: false, hasSubtitle: false })).toBe(
      TILE_TAP_TARGET_FLOOR
    );
  });

  it('reserves the picture, so a first render cannot clip it', () => {
    const withPicture = featureTileMinHeight({ hasIllustration: true, hasSubtitle: true });
    expect(withPicture).toBeGreaterThan(TILE_TAP_TARGET_FLOOR);
    // Band + both paddings + the picture alone already exceed the old floor;
    // the promise and its gaps sit on top of that.
    expect(withPicture).toBeGreaterThanOrEqual(
      32 + 10.5 * 2 + typeScale.body.lineHeight + typeScale.caption.lineHeight + TILE_ILLUSTRATION_SIZE
    );
  });

  it('adds exactly the picture and its gap over the same door without one', () => {
    // "Must not grow beyond what the picture needs": the difference between a
    // door with a picture and the same door without one is the picture's row
    // minus the chevron's, plus the one `mt-2` between the promise and it.
    // 1 px of border top and bottom: the floor is a border box.
    const bare =
      2 + 32 + 10.5 * 2 + typeScale.body.lineHeight + 1.75 + typeScale.caption.lineHeight + TILE_CHEVRON_SIZE;
    const withPicture = featureTileMinHeight({ hasIllustration: true, hasSubtitle: true });
    expect(withPicture - bare).toBeCloseTo(TILE_ILLUSTRATION_SIZE - TILE_CHEVRON_SIZE + 7, 5);
  });

  it('is a floor, not a height: a two-line promise is taller', () => {
    const oneLine = featureTileMinHeight({ hasIllustration: true, hasSubtitle: true });
    const twoLines = featureTileMinHeight({
      hasIllustration: true,
      hasSubtitle: true,
      subtitleLines: 2,
    });
    expect(twoLines - oneLine).toBeCloseTo(typeScale.caption.lineHeight, 5);
  });

  it('stays under what the Study hub measured on device, so nothing grows', () => {
    // shots24/02-study-hub.png: 420 px at 2.625 px/dp = 160 dp of natural
    // content. The floor must sit at or below that, or every correct door on
    // the app would get taller to satisfy a fix for a broken one.
    expect(featureTileMinHeight({ hasIllustration: true, hasSubtitle: true })).toBeLessThanOrEqual(160);
  });
});
