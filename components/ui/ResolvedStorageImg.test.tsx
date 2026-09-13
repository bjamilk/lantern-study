import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The blank-cover bug, from the web side.
 *
 * A cover row carries a storage REF, never a URL. If the ref is not recognised
 * as a private object it is handed to <img> verbatim and the browser draws an
 * empty box — which is exactly what a student saw on every deck, note and set
 * whose cover was uploaded before covers were persisted bucket-qualified. So
 * two facts are pinned here: a cover ref (qualified OR legacy bare) is SIGNED,
 * and anything that cannot be signed falls back to the caller's own tile
 * rather than to a hole.
 *
 * react-test-renderer is used because this project's vitest run has no DOM;
 * unlike renderToStaticMarkup it still runs effects, which is where the
 * signing happens.
 */
// React only treats act() as real outside a DOM test env when this is set;
// without it every render logs "not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fetchSignedStorageUrl = vi.fn();
vi.mock('../../services/supabase', () => ({
  fetchSignedStorageUrl: (...args: unknown[]) => fetchSignedStorageUrl(...args),
}));

import { CoverThumb } from './CoverPicker';
import { ResolvedStorageImg } from './ResolvedStorageImg';

const TILE = <span className="feature-tile-fallback" />;

async function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  return renderer;
}

beforeEach(() => {
  fetchSignedStorageUrl.mockReset();
});

describe('ResolvedStorageImg cover refs', () => {
  it('signs a bucket-qualified cover ref as a thumb and shows the picture', async () => {
    fetchSignedStorageUrl.mockResolvedValue('https://signed.example/c.webp?token=t');

    const renderer = await render(
      <CoverThumb coverPath="cover-images/u1/decks/d1/1700-cover.webp" fallback={TILE} />,
    );

    expect(fetchSignedStorageUrl).toHaveBeenCalledWith(
      'cover-images',
      'u1/decks/d1/1700-cover.webp',
      expect.any(Number),
      // Cards ask for the cheap sibling thumb, not the full-size original.
      'thumb',
    );
    const img = renderer.root.findByType('img');
    expect(img.props.src).toBe('https://signed.example/c.webp?token=t');
    expect(renderer.root.findAllByProps({ className: 'feature-tile-fallback' })).toHaveLength(0);
  });

  it('signs a LEGACY bucket-less cover path too, so old rows render', async () => {
    fetchSignedStorageUrl.mockResolvedValue('https://signed.example/legacy.webp?token=t');

    await render(<CoverThumb coverPath="u1/study-sets/s1/1700-cover.webp" fallback={TILE} />);

    expect(fetchSignedStorageUrl).toHaveBeenCalledWith(
      'cover-images',
      'u1/study-sets/s1/1700-cover.webp',
      expect.any(Number),
      'thumb',
    );
  });

  it('falls back to the tile when the ref cannot be signed', async () => {
    fetchSignedStorageUrl.mockRejectedValue(new Error('403'));

    const renderer = await render(
      <CoverThumb coverPath="cover-images/u1/notes/n1/1700-cover.webp" fallback={TILE} />,
    );

    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'feature-tile-fallback' }).length)
      .toBeGreaterThan(0);
  });

  it('falls back to the tile when the signed image itself fails to load', async () => {
    fetchSignedStorageUrl.mockResolvedValue('https://signed.example/gone.webp?token=t');

    const renderer = await render(
      <ResolvedStorageImg
        src="cover-images/u1/decks/d1/1700-cover.webp"
        variant="thumb"
        fallback={TILE}
      />,
    );

    // A signature that resolves but points at a deleted object 404s in the
    // browser; without an onError the tile keeps a broken-image glyph forever.
    await act(async () => {
      renderer.root.findByType('img').props.onError({});
    });

    expect(renderer.root.findAllByType('img')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'feature-tile-fallback' }).length)
      .toBeGreaterThan(0);
  });
});
