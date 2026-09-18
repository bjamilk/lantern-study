// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
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
import { RoomRecommendationCard } from './RoomRecommendationCard';
import { SetRoomFooter } from './SetRoomFooter';

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

  it('offers ONLY the type filter on home — no sort, no grid/list toggle', () => {
    // The reference puts one control here. Sort and the toggle are not
    // deleted; they stay on the Materials page, where the whole archive is
    // the subject. Two fewer choices in front of a student who came to study.
    const home = renderToStaticMarkup(
      <RecentMaterials
        notes={notes}
        onOpenNote={() => undefined}
        onViewAll={() => undefined}
        showViewControls={false}
      />
    );
    expect(home).toContain('All types');
    expect(home).not.toContain('recent materials');
    expect(home).not.toContain('Recent materials view');
    // And the archive keeps both.
    expect(grid()).toContain('recent materials');
  });
});

describe('the set home scrolls its own header', () => {
  it('takes the header as content, not as chrome above the scroller', () => {
    // The bug the coordinator saw on 2026-09-17: tile + title + stats stayed
    // pinned and held ~90px of every scrolled view. In the reference only the
    // 52px top bar is sticky. The room proves it by passing the header IN.
    const room = fs.readFileSync(path.join(__dirname, 'CourseWorkspace.tsx'), 'utf8');
    const flat = room.replace(/\s+/g, ' ');
    expect(flat).toContain('header={setHeader}');
    // And the block above the scroller draws it only for a studio.
    expect(flat).toContain("activity === 'home' ? null : setHeader");
  });
});

describe('recommendation card anatomy', () => {
  const card = () =>
    renderToStaticMarkup(
      <RoomRecommendationCard
        feature="ai"
        icon="sparkles"
        eyebrow="Recommended"
        label="Ask Lantern"
        about="Opens the companion."
        onClick={() => undefined}
      />
    );

  it('sets the eyebrow in the serif heading step, not as a caption', () => {
    // Measured (doc 02): Bitter 18/28 weight 500 in the body ink. It shipped
    // as 14px secondary sans, which read as a caption over a label.
    expect(card()).toContain('text-heading font-display text-lantern-text');
  });

  it('puts About in the card’s top-right corner', () => {
    const html = card();
    expect(html).toContain('absolute right-2 top-2');
    expect(html).toContain('aria-label="About Ask Lantern"');
    // Outside the card button: a <button> inside a <button> is markup the
    // keyboard cannot reach.
    expect(html.indexOf('aria-label="About Ask Lantern"')).toBeLessThan(
      html.indexOf('Recommended')
    );
  });
});

describe('exam aside', () => {
  it('always offers Add, whether or not a date is already saved', () => {
    // It used to read `Edit exam` once a date existed, so a student with a
    // midterm saved could not see this was still the way to add the final.
    const html = renderToStaticMarkup(
      <SetRoomFooter
        studySetId={SET_ID}
        examDate="2026-12-01"
        exams={[]}
        onViewSchedule={() => undefined}
        onAddSyllabus={() => undefined}
      />
    );
    expect(html).toContain('aria-label="Add an exam date"');
    expect(html).toContain('Exam dates');
    expect(html).toContain('View schedule');
    expect(html).toContain('Add syllabus');
    expect(html).toContain('aria-label="Edit Exam"');
  });
});
