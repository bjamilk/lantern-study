import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DoorTile, DOOR_ILLUSTRATION_SIZE } from './DoorTile';

/**
 * §5.6's tint cap, applied to the one component that can break it on nine
 * screens at once.
 *
 * "No card may be more than 25% tint" is arithmetic, not taste: a door is a
 * tint band over a neutral body, so the cap is a statement about two numbers
 * the markup itself carries — the band's height class and the body's padding
 * class. This suite reads BOTH out of the rendered HTML rather than restating
 * them, so growing the band to fit a picture (h-8 → h-14, which is 42% on a
 * door and is exactly how this regressed) fails here instead of at review.
 *
 * The picture therefore lives in the BODY, on the chevron's row, the way
 * mobile's `FeatureTile` draws it. That placement is asserted too: a door whose
 * illustration migrates back into the band would still pass a pure-ratio check
 * once someone re-grew the band, so the two rules are tested together.
 */

/** Tailwind's spacing scale: `h-8` = 8 × 4 px. */
const SPACING_PX = 4;
/** §5.6. */
const TINT_CAP = 0.25;

const glyph = <span data-testid="glyph" className="w-6 h-6" />;

const render = (illustration?: 'notes-stack') =>
  renderToStaticMarkup(
    <DoorTile
      feature="notes"
      icon={glyph}
      illustration={illustration}
      title="Library"
      promise="Turn slides into cards"
      count="12 items"
      onClick={() => {}}
    />,
  );

/** The band strip and the body, split at the body's padding wrapper. */
function halves(html: string): { band: string; body: string } {
  const at = html.indexOf('<div class="p-4');
  expect(at, 'body padding wrapper').toBeGreaterThan(-1);
  return { band: html.slice(0, at), body: html.slice(at) };
}

/** Band height in px, read from the class the band actually rendered with. */
function bandPx(html: string): number {
  const m = html.match(/class="flex h-(\d+) /);
  expect(m, 'band height class').not.toBeNull();
  return Number(m![1]) * SPACING_PX;
}

/** Body padding in px per side, for the base step and the `md:` step. */
function bodyPaddingPx(body: string): { base: number; md: number } {
  const m = body.match(/<div class="p-(\d+) md:p-(\d+)"/);
  expect(m, 'body padding classes').not.toBeNull();
  return { base: Number(m![1]) * SPACING_PX, md: Number(m![2]) * SPACING_PX };
}

/**
 * The body's own content height, from the type scale the door uses:
 * a 24 px heading, 2 px of `mt-0.5`, an 18 px caption, an 8 px `gap-2`, and the
 * bottom row — the 20 px chevron, or the picture when it is taller.
 */
function contentPx(illustrationPx: number): number {
  const HEADING = 24;
  const MT = 2;
  const CAPTION = 18;
  const GAP = 8;
  const CHEVRON = 20;
  return HEADING + MT + CAPTION + GAP + Math.max(CHEVRON, illustrationPx);
}

function tintRatios(html: string, illustrationPx: number) {
  const band = bandPx(html);
  const pad = bodyPaddingPx(halves(html).body);
  const at = (p: number) => band / (band + p * 2 + contentPx(illustrationPx));
  return { base: at(pad.base), md: at(pad.md) };
}

describe('DoorTile tint budget (§5.6: a card is at most 25% tint)', () => {
  it('keeps a door with a picture under the cap, at both padding steps', () => {
    const { base, md } = tintRatios(render('notes-stack'), DOOR_ILLUSTRATION_SIZE);
    expect(base).toBeLessThanOrEqual(TINT_CAP);
    expect(md).toBeLessThanOrEqual(TINT_CAP);
    // Not merely legal — the picture's height is what buys the headroom.
    expect(base).toBeLessThan(0.2);
  });

  it('keeps a door without one under the cap too', () => {
    const { base, md } = tintRatios(render(), 0);
    expect(base).toBeLessThanOrEqual(TINT_CAP);
    expect(md).toBeLessThanOrEqual(TINT_CAP);
  });

  it('would fail if the band grew to hold the picture', () => {
    // The regression this suite exists for, spelled out: the same tile with a
    // 56 px band is 42%. Left as arithmetic on the numbers above so the
    // threshold cannot be met by quietly editing the helper.
    const grown = 56;
    const ratio = grown / (grown + 16 * 2 + contentPx(DOOR_ILLUSTRATION_SIZE));
    expect(ratio).toBeGreaterThan(TINT_CAP);
  });
});

describe('DoorTile composition', () => {
  it('puts the feature glyph in the band and the picture in the body', () => {
    const { band, body } = halves(render('notes-stack'));
    expect(band).toContain('data-testid="glyph"');
    // The band carries no drawing: the ground ellipse is the asset's tell.
    expect(band).not.toContain('<ellipse');
    expect(band).not.toContain('<svg');
    expect(body).toContain('<ellipse');
    expect(body).toContain(`width="${DOOR_ILLUSTRATION_SIZE}"`);
  });

  it('draws the picture on the chevron’s own row, below the promise', () => {
    const { body } = halves(render('notes-stack'));
    const promise = body.indexOf('Turn slides into cards');
    const picture = body.indexOf('<ellipse');
    const chevron = body.lastIndexOf('<svg');
    expect(promise).toBeGreaterThan(-1);
    expect(picture).toBeGreaterThan(promise);
    expect(chevron).toBeGreaterThan(picture);
  });

  it('still renders a door with no picture, band and chevron intact', () => {
    const { band, body } = halves(render());
    expect(band).toContain('data-testid="glyph"');
    expect(band).toContain('12 items');
    expect(body).not.toContain('<ellipse');
    expect(body).toContain('<svg');
  });
});
