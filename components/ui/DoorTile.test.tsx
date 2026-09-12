import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DoorTile, DOOR_ILLUSTRATION_SIZE } from './DoorTile';

/**
 * The door's ANATOMY, which is the thing the 2026-09-11 StudyFetch direction
 * actually specifies: a white card, a flat pastel panel across the top with a
 * black line drawing on it, a hard offset shadow in the ink, and a footer
 * glyph tinted to the feature's own hue.
 *
 * WHAT THIS SUITE REPLACED. It used to assert a 25%-tint cap by reading the
 * band's height class and the body's padding class back out of the HTML and
 * doing arithmetic on them. That cap is gone — the panel is now deliberately
 * about two thirds of the tile — and the reasoning is in `DoorTile.tsx`. The
 * cap was never what kept a door legible (nothing is set on the panel but a
 * drawing; body ink on every tint is still gated in
 * `packages/shared/src/design/contrast.test.ts`), so replacing it with an
 * anatomy check is not a weakening: the failure modes below are the ones that
 * would actually make a wall of doors stop working.
 *
 * Each assertion reads a value the MARKUP carries rather than restating a
 * constant, so the test fails when the component changes rather than when
 * someone forgets to update a number here.
 */

const glyph = <span data-testid="glyph" className="w-4 h-4" />;

/**
 * Passed through a binding, not written as `illustration="notes-stack"` in the
 * JSX below. `Illustration.test.tsx` greps the component tree for that literal
 * attribute to police which SCREENS carry art, and a literal here would
 * register this test file as an eighth screen.
 */
const PICTURE = 'notes-stack' as const;

const render = (props: Partial<React.ComponentProps<typeof DoorTile>> = {}) =>
  renderToStaticMarkup(
    <DoorTile
      feature="notes"
      icon={glyph}
      illustration={PICTURE}
      title="Library"
      promise="Turn slides into cards"
      count="12 items"
      onClick={() => {}}
      {...props}
    />,
  );

/** The panel strip and the body, split at the body's padding wrapper. */
function halves(html: string): { panel: string; body: string } {
  const at = html.indexOf('<div class="p-4');
  expect(at, 'body padding wrapper').toBeGreaterThan(-1);
  return { panel: html.slice(0, at), body: html.slice(at) };
}

describe('DoorTile anatomy (StudyFetch, 2026-09-11)', () => {
  it('draws a pastel panel across the top, with the picture ON it', () => {
    const html = render();
    const { panel, body } = halves(html);
    expect(panel).toContain('data-testid="door-panel"');
    // The panel is the feature's TINT — a ground, never an ink.
    expect(panel).toContain('bg-lantern-feature-notes-tint');
    // The drawing moved out of the body and onto the colour. Its ground
    // ellipse is the asset's tell.
    expect(panel).toContain('<ellipse');
    expect(panel).toContain(`width="${DOOR_ILLUSTRATION_SIZE}"`);
    expect(body).not.toContain('<ellipse');
  });

  it('sets the panel drawing in the ink, not in the feature hue', () => {
    const { panel } = halves(render());
    // `!` because `Illustration` names its own `text-*` class and two
    // utilities of equal specificity are resolved by stylesheet order. Losing
    // this repaints every drawing from black to a mid-tone on its own pastel.
    expect(panel).toContain('!text-lantern-ink');
    // …and inverts in dark, where flat black on a near-black panel is invisible.
    expect(panel).toContain('dark:!text-lantern-feature-notes-ink');
  });

  it('sits on a hard offset shadow drawn in the ink', () => {
    const html = render();
    expect(html).toContain('shadow-lantern-hard');
    // The shadow is a token so it can invert with the theme. A literal black
    // offset would vanish against the dark page, which is the regression.
    expect(html).not.toContain('shadow-[4px_4px_0_0_#191919]');
  });

  it('tints the footer glyph to the hue and keeps the count beside it', () => {
    const { body } = halves(render());
    const footer = body.indexOf('data-testid="door-footer-glyph"');
    expect(footer).toBeGreaterThan(-1);
    expect(body.slice(footer)).toContain('text-lantern-feature-notes-ink');
    expect(body.slice(footer)).toContain('data-testid="glyph"');
    expect(body).toContain('12 items');
  });

  it('orders the tile panel, then title, then promise, then footer', () => {
    const html = render();
    const panel = html.indexOf('data-testid="door-panel"');
    const title = html.indexOf('Library');
    const promise = html.indexOf('Turn slides into cards');
    const footer = html.indexOf('data-testid="door-footer-glyph"');
    expect(panel).toBeLessThan(title);
    expect(title).toBeLessThan(promise);
    expect(promise).toBeLessThan(footer);
  });

  it('stands the feature glyph in for a door that has no drawing yet', () => {
    const { panel, body } = halves(render({ illustration: undefined }));
    expect(panel).not.toContain('<ellipse');
    // The glyph appears twice — once enlarged on the panel, once in the footer
    // — rather than leaving the panel empty.
    expect(panel).toContain('data-testid="glyph"');
    // Asserted through the testid rather than the arbitrary-variant class:
    // `[&_svg]:w-8` is serialised with the ampersand HTML-escaped, so matching
    // the class as written passes nowhere and fails for the wrong reason.
    expect(panel).toContain('data-testid="door-panel-glyph"');
    expect(body).toContain('data-testid="door-footer-glyph"');
  });

  it('renders a door with nothing to count, without an empty pill', () => {
    const html = render({ count: undefined });
    expect(html).toContain('data-testid="door-footer-glyph"');
    expect(html).not.toContain('tabular-nums');
  });
});
