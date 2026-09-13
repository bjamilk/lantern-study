import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The one render fact that matters: a card with a cover shows the PICTURE, and
 * a card without one still shows the pastel type tile. Getting this backwards
 * in either direction is silent — a cover that never appears looks like a
 * failed upload, and a tile that survives a cover looks like the picture was
 * rejected.
 *
 * The signing hook is mocked because it resolves through the network and, on
 * the server renderer used here, its effect would never run at all — so the
 * real hook would report "no cover" for every input and the suite would pass
 * while proving nothing.
 */
vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) =>
    src ? `https://signed.example/${encodeURIComponent(src)}?token=t` : undefined,
}));

import { CoverBanner, CoverThumb } from './CoverPicker';

const TILE = <span className="feature-tile-fallback">tile</span>;

describe('CoverThumb', () => {
  it('renders the resolved image when the row carries a coverPath', () => {
    const html = renderToStaticMarkup(
      <CoverThumb coverPath="cover-images/u1/decks/d1/cover.webp" fallback={TILE} />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('https://signed.example/');
    expect(html).not.toContain('feature-tile-fallback');
  });

  it('keeps the pastel tile when no cover is set', () => {
    const html = renderToStaticMarkup(<CoverThumb coverPath={null} fallback={TILE} />);
    expect(html).toContain('feature-tile-fallback');
    expect(html).not.toContain('<img');
  });

  it('is a 4:3 box, so a row of covers does not ripple', () => {
    const html = renderToStaticMarkup(
      <CoverThumb coverPath="cover-images/u1/notes/n1/cover.webp" fallback={TILE} />,
    );
    expect(html).toContain('aspect-[4/3]');
    // The picture is cropped to the box rather than letterboxed inside it.
    expect(html).toContain('object-cover');
  });

  it('keeps the type glyph as a badge over the picture', () => {
    const html = renderToStaticMarkup(
      <CoverThumb
        coverPath="cover-images/u1/decks/d1/cover.webp"
        fallback={TILE}
        badge={<span className="type-badge">deck</span>}
      />,
    );
    expect(html).toContain('type-badge');
  });
});

describe('CoverBanner', () => {
  it('is 16:5 and renders nothing at all without a cover', () => {
    expect(renderToStaticMarkup(<CoverBanner coverPath={null} />)).toBe('');
    const html = renderToStaticMarkup(<CoverBanner coverPath="cover-images/u1/decks/d1/c.webp" />);
    expect(html).toContain('aspect-[16/5]');
    expect(html).toContain('<img');
  });
});
