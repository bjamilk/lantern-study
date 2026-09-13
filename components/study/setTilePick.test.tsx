import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * A set's tile, once its owner has picked one.
 *
 * The hash is a good default and a bad verdict: StudyFetch lets a set BE the
 * mint monitor because someone said so. What this file pins is the precedence
 * the three layers have to agree on — cover picture > the owner's pick > the
 * hash — and the fact that the pick reaches the DOM rather than stopping at
 * the store.
 *
 * The signing hook is mocked for the same reason `studySetCover.test.tsx`
 * mocks it: it resolves over the network and its effect never runs under the
 * server renderer, so with the real hook every cover case below would silently
 * report "no cover" and the suite would pass proving nothing.
 */
vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) =>
    src ? `https://signed.example/${encodeURIComponent(src)}?token=t` : undefined,
}));

import { setTileArt } from '@lantern/shared/study/setPresentation';
import { SetTile } from './SetRoomTile';

const SET_ID = '8f1b0c2e-1111-4a2b-9c3d-000000000001';
const TITLE = 'Cell Biology';
const COVER = 'user-1/study-sets/set-1/1757600000-cover.webp';

/** What the tile would draw with no pick at all — the thing a pick must beat. */
const derived = setTileArt(SET_ID, TITLE);

describe('SetTile with a chosen hue and glyph', () => {
  it('draws the picked glyph instead of the one the title cues', () => {
    // 'Cell Biology' cues a flask. A pick has to survive that, or a student's
    // choice would evaporate the next time they renamed the set.
    expect(derived.glyph).toBe('flask');
    const html = renderToStaticMarkup(
      <SetTile setId={SET_ID} title={TITLE} tileHue="peach" tileGlyph="monitor" />
    );
    // The glyph icons are rendered by AppIcon; what is asserted is that the
    // markup CHANGED from the derived one, and in the direction of the pick.
    const derivedHtml = renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} />);
    expect(html).not.toBe(derivedHtml);
    expect(html).toBe(
      renderToStaticMarkup(
        <SetTile setId={SET_ID} title={TITLE} tileHue="peach" tileGlyph="monitor" />
      )
    );
  });

  it('honours a hue pick while leaving the glyph derived', () => {
    // The settings block is two independent rows, so half a pick has to be a
    // real state rather than quietly freezing the other half.
    const other = derived.hue === 'peach' ? 'lilac' : 'peach';
    const halfPicked = renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} tileHue={other} />);
    const bothPicked = renderToStaticMarkup(
      <SetTile setId={SET_ID} title={TITLE} tileHue={other} tileGlyph={derived.glyph} />
    );
    expect(halfPicked).toBe(bothPicked);
  });

  it('falls back to the derived tile for a value outside the six', () => {
    // These arrive off a database row, not off a button. An unknown string has
    // to draw the derived tile rather than index a palette with a missing key.
    expect(
      renderToStaticMarkup(
        <SetTile setId={SET_ID} title={TITLE} tileHue="chartreuse" tileGlyph="rocket" />
      )
    ).toBe(renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} />));
  });

  it('treats null as "derive it", which is what Reset writes', () => {
    expect(
      renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} tileHue={null} tileGlyph={null} />)
    ).toBe(renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} />));
  });

  it('still lets a cover picture win over the pick', () => {
    // The whole precedence in one assertion: with a cover, the picked tile is
    // not drawn at all.
    const html = renderToStaticMarkup(
      <SetTile setId={SET_ID} title={TITLE} coverPath={COVER} tileHue="peach" tileGlyph="monitor" />
    );
    expect(html).toContain('<img');
    expect(html).toBe(
      renderToStaticMarkup(<SetTile setId={SET_ID} title={TITLE} coverPath={COVER} />)
    );
  });
});
