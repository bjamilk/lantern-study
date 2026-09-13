import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The study set's own picture — the rules and the one render fact.
 *
 * StudyFetch gives the cover to the SET, and prints "Recommended: 400x400px,
 * max 5MB" under the button. Both halves of that sentence are load-bearing:
 *
 *  - 5 MB, not the 10 MB a deck cover takes. A student who reads 5MB and is
 *    refused at 7 has been lied to by whichever side drifted, so the client
 *    ceiling is pinned here against the server's `MAX_STUDY_SET_COVER_BYTES`.
 *  - 1:1, at the tile's own size. A cover that changed the tile's box would
 *    reflow the hub grid one card at a time as signatures land.
 *
 * The signing hook is mocked because it resolves over the network and its
 * effect never runs under the server renderer — with the real hook every case
 * below would report "no cover" and the suite would pass proving nothing.
 */
vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) =>
    src ? `https://signed.example/${encodeURIComponent(src)}?token=t` : undefined,
}));

import {
  STUDY_SET_COVER_HINT,
  STUDY_SET_COVER_MAX_BYTES,
  validateCoverFile,
} from '../ui/coverPickerModel';
import { SetCoverSquare, SetTile } from './SetRoomTile';

const SET_ID = '8f1b0c2e-1111-4a2b-9c3d-000000000001';
const COVER = 'user-1/study-sets/set-1/1757600000-cover.webp';
const file = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({
  type: 'image/png',
  size: 1024,
  name: 'cover.png',
  ...over,
});

describe('study set cover rules', () => {
  it('promises 5 MB and enforces exactly that', () => {
    expect(STUDY_SET_COVER_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(STUDY_SET_COVER_HINT).toBe('Recommended: 400×400px, max 5MB');

    const justOver = validateCoverFile(file({ size: STUDY_SET_COVER_MAX_BYTES + 1 }), STUDY_SET_COVER_MAX_BYTES);
    expect(justOver.ok).toBe(false);
    // The refusal names the limit the block printed, not the deck's 10 MB.
    expect(justOver.ok === false && justOver.message).toContain('5 MB');
  });

  it('accepts a file a deck would accept and a set still should', () => {
    expect(validateCoverFile(file({ size: 4 * 1024 * 1024 }), STUDY_SET_COVER_MAX_BYTES).ok).toBe(true);
  });

  it('refuses a 7 MB pick that the 10 MB deck ceiling would have let through', () => {
    expect(validateCoverFile(file({ size: 7 * 1024 * 1024 }), STUDY_SET_COVER_MAX_BYTES).ok).toBe(false);
    // Same file, deck rules: allowed. This is the difference being pinned.
    expect(validateCoverFile(file({ size: 7 * 1024 * 1024 })).ok).toBe(true);
  });

  it('refuses a type the server would refuse anyway', () => {
    expect(validateCoverFile(file({ type: 'image/svg+xml' }), STUDY_SET_COVER_MAX_BYTES).ok).toBe(false);
  });
});

describe('SetTile with a cover', () => {
  it('draws the picture instead of the pastel art once a set has one', () => {
    const html = renderToStaticMarkup(
      <SetTile setId={SET_ID} title="Cell Biology" coverPath={COVER} size={40} />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('https://signed.example/');
    // The pastel square's tint class must be gone — a cover REPLACES the art.
    expect(html).not.toContain('feature-sets');
  });

  it('keeps the pastel art when the set has no cover', () => {
    const html = renderToStaticMarkup(<SetTile setId={SET_ID} title="Cell Biology" size={40} />);
    expect(html).not.toContain('<img');
    expect(html).toContain('svg');
  });

  it('is 1:1 at the tile size it replaces, so no grid reflows', () => {
    const html = renderToStaticMarkup(
      <SetTile setId={SET_ID} title="Cell Biology" coverPath={COVER} size={44} />,
    );
    expect(html).toContain('width:44px');
    expect(html).toContain('height:44px');
  });
});

describe('SetCoverSquare', () => {
  it('falls back to the caller tile when the path cannot be signed', () => {
    const fallback = <span className="pastel-tile">tile</span>;
    // `useResolvedStorageUrl` returns undefined for an empty path: an
    // unresolved cover is not a cover, and an empty box is worse than the art.
    const html = renderToStaticMarkup(<SetCoverSquare coverPath="" fallback={fallback} />);
    expect(html).toContain('pastel-tile');
    expect(html).not.toContain('<img');
  });
});

describe('StudySetCard', () => {
  const base = {
    id: SET_ID,
    userId: 'u1',
    title: 'Cell Biology',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
  };

  it('shows the cover in place of the tile art, and the art when there is none', async () => {
    const { StudySetCard } = await import('./StudySetCard');
    const props = {
      counts: { materials: 2 },
      onOpen: () => {},
      onEdit: () => {},
      onDelete: () => {},
      now: new Date('2026-09-02T00:00:00.000Z'),
    };

    const withCover = renderToStaticMarkup(
      <StudySetCard {...props} studySet={{ ...base, coverPath: COVER }} />,
    );
    expect(withCover).toContain('https://signed.example/');

    const withoutCover = renderToStaticMarkup(<StudySetCard {...props} studySet={base} />);
    expect(withoutCover).not.toContain('<img');
    // The card still reads as a set: title and counts are untouched either way.
    expect(withoutCover).toContain('Cell Biology');
    expect(withCover).toContain('Cell Biology');
  });
});
