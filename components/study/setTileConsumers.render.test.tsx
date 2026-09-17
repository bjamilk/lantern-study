import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StudySet } from '../../types';

/**
 * The owner's tile pick, on every surface that draws a set.
 *
 * `setTilePick.test.tsx` proves `SetTile` itself honours a pick. What shipped
 * broken was everything ABOVE it: a student saved a hue and a glyph, the PATCH
 * returned 200, the store held the new row — and only the hub card changed.
 * The room header had no `tileHue`/`tileGlyph` props at all, the rail and the
 * switcher held the full set row and called `<SetTile>` without forwarding the
 * two fields, and Home drew a CONSTANT mint disc for every set.
 *
 * So the assertion each consumer gets is the same one, and it is about the
 * consumer rather than the tile: render it with a set whose pick DISAGREES with
 * the hash, and require the markup to contain the picked tile and not the
 * derived one. A consumer that drops the props fails on both halves.
 */
vi.mock('../../hooks/useResolvedStorageUrl', () => ({
  useResolvedStorageUrl: (src?: string | null) =>
    src ? `https://signed.example/${encodeURIComponent(src)}?token=t` : undefined,
}));

const SET_ID = '8f1b0c2e-1111-4a2b-9c3d-000000000001';
const TITLE = 'Cell Biology';
const PICK = { hue: 'peach', glyph: 'monitor' } as const;

// One set, whose stored pick disagrees with what its id and title would hash
// to. Every store a consumer reads is stubbed to hand back exactly this row,
// so the only thing under test is whether the consumer forwards the two fields.
const SET_ROW = {
  id: SET_ID,
  title: TITLE,
  tileHue: PICK.hue,
  tileGlyph: PICK.glyph,
  coverPath: null,
  lastStudiedAt: null,
};

const studySetState = {
  sets: [SET_ROW],
  loadSets: async () => {},
  createSet: async () => SET_ROW,
  resolveSet: (id: string) => (id === SET_ID ? SET_ROW : null),
};
vi.mock('../../stores/studySetStore', () => ({
  useStudySetStore: (selector: (s: typeof studySetState) => unknown) => selector(studySetState),
}));
vi.mock('../../stores/notesStore', () => ({
  useNotesStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ notes: [], folders: [], loadFolders: async () => {}, setSelectedFolderId: () => {} }),
}));
vi.mock('../../stores/flashcardStore', () => ({
  useFlashcardStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ decks: [] }),
}));
vi.mock('../../stores/academicStore', () => ({
  useAcademicStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ loadMyCourses: async () => {}, resolveCourse: () => null }),
}));
vi.mock('../../stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ showToast: () => {} }),
}));
vi.mock('../../services/notes', () => ({ fetchNotes: async () => [] }));

import { setTileArt } from '@lantern/shared/study/setPresentation';
import { SetTile } from './SetRoomTile';
import { SetRoomHeader } from './SetRoomHeader';
import { StudySetSwitcher } from './StudySetSwitcher';
import HomeStudySets from '../dashboard/HomeStudySets';
import SetRail from './SetRail';

// 'Cell Biology' cues a flask, so a forwarded pick is visibly different from
// the derivation — which is what makes these tests able to fail.
const derived = setTileArt(SET_ID, TITLE);

const studySet = SET_ROW as unknown as StudySet;

/**
 * The tile markup at a given size, with the pick and without it. `className`
 * is a parameter because consumers add their own layout classes to the tile
 * (the rail passes `flex-shrink-0`), and an exact-substring match would
 * otherwise fail on a consumer that IS forwarding the pick correctly.
 */
const tile = (size?: number, className?: string, withPick = true) =>
  renderToStaticMarkup(
    <SetTile
      setId={SET_ID}
      title={TITLE}
      tileHue={withPick ? PICK.hue : undefined}
      tileGlyph={withPick ? PICK.glyph : undefined}
      size={size}
      className={className}
    />
  );

/** Both halves of the rule, so a consumer cannot pass by rendering neither. */
function expectPickWins(html: string, size?: number, className?: string) {
  expect(derived.glyph).not.toBe(PICK.glyph);
  expect(html).toContain(tile(size, className));
  expect(html).not.toContain(tile(size, className, false));
}

describe('the set room header', () => {
  it('draws the owner’s picked tile, not the hash', () => {
    const html = renderToStaticMarkup(
      <SetRoomHeader
        setId={SET_ID}
        title={TITLE}
        tileHue={PICK.hue}
        tileGlyph={PICK.glyph}
        progress={null}
        onOpenSettings={() => {}}
        menu={[]}
      />
    );
    expectPickWins(html, 40);
  });
});

describe('the set switcher pill', () => {
  it('draws the owner’s picked tile, not the hash', () => {
    const html = renderToStaticMarkup(
      <StudySetSwitcher
        sets={[studySet]}
        currentId={SET_ID}
        onSelect={() => {}}
        onViewAll={() => {}}
        onCreate={() => {}}
      />
    );
    expectPickWins(html, 28);
  });
});

describe('the rail’s set pill', () => {
  it('draws the owner’s picked tile, not the hash', () => {
    const html = renderToStaticMarkup(
      <SetRail
        studySetId={SET_ID}
        expanded
        currentPath={`/study/sets/${SET_ID}`}
        onNavigate={() => {}}
        onToggleCompanion={() => {}}
      />
    );
    expectPickWins(html, 24, 'flex-shrink-0');
  });
});

describe('the Home set card', () => {
  it('draws the owner’s picked tile instead of one constant disc', () => {
    const html = renderToStaticMarkup(<HomeStudySets onOpenStudySet={() => {}} />);
    expectPickWins(html);
  });
});
