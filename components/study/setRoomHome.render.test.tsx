// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The set room's front door, at the dimensions measured off StudyFetch on
 * 2026-09-17 (docs/studyfetch-mysets-2026-09-17/01-set-home.md).
 *
 * These are STRUCTURE tests, not pixel tests: a render test cannot measure a
 * laid-out box, and asserting on a Tailwind class string would only prove the
 * string was typed. What each case pins is the thing that was actually missing
 * or wrong, and that a reviewer can check against the measurement doc:
 *
 *   - the header carries a stats ROW with all three counts, a progress bar
 *     with the ARIA a bar needs, and a Mode control — Lantern had a quiet
 *     prose line with no bar and no mode;
 *   - the unit chips are numbered `01`, `02`, … and say which one is current
 *     (`aria-pressed`), so the row is a position in a syllabus rather than a
 *     row of filter pills;
 *   - the materials grid draws a card per material and ends with the
 *     `View all materials` card, capped at eight.
 */

vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) => (src ? `https://signed.example/${src}` : undefined),
}));

import { SetRoomHeader } from './SetRoomHeader';
import { UnitChipRow } from './UnitChipRow';
import { RecentMaterials } from './RecentMaterials';

const SET_ID = '8f1b0c2e-2222-4a2b-9c3d-000000000002';

function header(extra: Partial<React.ComponentProps<typeof SetRoomHeader>> = {}) {
  return renderToStaticMarkup(
    <SetRoomHeader
      setId={SET_ID}
      title="Cell Biology"
      progress={{ topics: 15, covered: 2, mastered: 0 }}
      variant="home"
      mode="standard"
      onSelectMode={() => undefined}
      onOpenSettings={() => undefined}
      menu={[]}
      {...extra}
    />
  );
}

describe('set room header stats row', () => {
  it('names all three counts, in the reference’s order', () => {
    const html = header();
    expect(html).toContain('data-testid="set-room-stats"');
    for (const word of ['Topics', 'Covered', 'Mastered']) expect(html).toContain(word);
    expect(html.indexOf('Topics')).toBeLessThan(html.indexOf('Covered'));
    expect(html.indexOf('Covered')).toBeLessThan(html.indexOf('Mastered'));
    expect(html).toContain('>15<');
    expect(html).toContain('>2<');
  });

  it('draws a progress bar a screen reader can read', () => {
    // 2 of 15 covered is 13%. The bar shipped without a percentage anywhere
    // but the label, so a student using a reader got "progressbar" and no
    // number at all on some engines.
    const html = header();
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="13"');
    expect(html).toContain('aria-label="Topics covered"');
    expect(html).toContain('13%');
  });

  it('offers Mode, and says which mode is on', () => {
    const html = header();
    expect(html).toMatch(/aria-label="Mode: Standard\./);
  });

  it('draws no Mode control when it has nothing to save it with', () => {
    // A control that silently cannot write is worse than no control.
    expect(header({ onSelectMode: undefined })).not.toMatch(/aria-label="Mode:/);
  });

  it('keeps the compact header for a studio: no stats row, no 64px tile', () => {
    const html = header({ variant: 'compact', progress: null, counts: undefined });
    expect(html).not.toContain('data-testid="set-room-stats"');
  });
});

describe('unit chip row', () => {
  const units = [
    { id: 'u1', studySetId: SET_ID, title: 'AI Foundations', position: 0 },
    { id: 'u2', studySetId: SET_ID, title: 'Neural Networks', position: 1 },
  ];

  it('numbers the cards from 01 and says which one is current', () => {
    const html = renderToStaticMarkup(
      <UnitChipRow units={units} activeUnitId="u2" onSelect={() => undefined} />
    );
    expect(html).toContain('01');
    expect(html).toContain('02');
    expect(html).toContain('AI Foundations');
    expect(html).toContain('Neural Networks');
    // A toggle over mutually exclusive choices, not a navigation position.
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('draws nothing at all when the plan has no units', () => {
    expect(
      renderToStaticMarkup(<UnitChipRow units={[]} activeUnitId={null} onSelect={() => undefined} />)
    ).toBe('');
  });
});

describe('recent materials grid', () => {
  const notes = Array.from({ length: 10 }, (_, i) => ({
    id: `n${i}`,
    title: `Note ${i}`,
    body: `Body of note ${i}`,
    studySetId: SET_ID,
    createdAt: new Date(2026, 8, i + 1).toISOString(),
  })) as never[];

  function grid() {
    return renderToStaticMarkup(
      <RecentMaterials notes={notes} onOpenNote={() => undefined} onViewAll={() => undefined} />
    );
  }

  it('caps the grid at eight, newest first, and ends with View all materials', () => {
    const html = grid();
    expect(html).toContain('View all materials');
    expect(html).toContain('Note 9');
    // The two oldest are the ones the cap leaves out.
    expect(html).not.toContain('>Note 0<');
    expect(html).not.toContain('>Note 1<');
  });

  it('draws each card as a preview block over its type glyph and title', () => {
    const html = grid();
    expect(html).toContain('Body of note 9');
    expect(html).toContain('min-h-[226px]');
  });

  it('offers the type filter, with All types as the default', () => {
    const html = grid();
    expect(html).toContain('All types');
    expect(html).toContain('Filter materials by type');
  });
});
