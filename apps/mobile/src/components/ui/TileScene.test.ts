/**
 * The mobile renderer's two decisions, tested without a renderer.
 *
 * This project's jest run is node-only and matches `*.test.ts`, so there is no
 * rendered tree to assert against — the same constraint `Illustration.test.ts`
 * beside this file works under, and the reason both renderers keep their
 * sizing and colour decisions in a pure module.
 *
 * What is NOT tested here on purpose: the geometry, the stroke weight and the
 * path validity. Those belong to the asset, they live in `@lantern/shared`,
 * and `tileScenes.test.ts` beside that module already pins them.
 */
import {
  TILE_SCENES,
  TILE_SCENE_NAMES,
  TILE_SCENE_VIEW_BOX,
  featureAccentsDark,
  featureAccentsLight,
  tileSceneForTool,
} from '@lantern/shared/design';
import { tileSceneFills, tileSceneSvgProps } from './tileSceneFills';
import { doorTileLayout } from './doorTileLayout';
import { SET_ROOM_TILE_ORDER } from '../study/setRoomSections';
import { STUDY_SET_RECOMMENDED_CARDS } from '@lantern/shared/learning';

describe('tile scene coverage in the room', () => {
  it('gives every tile in the room a scene', () => {
    // The ledger. All eleven have art; a tile that lost its picture — because
    // an id was renamed, or a scene dropped — fails here rather than quietly
    // falling back to the glyph, which looks like the old product and reviews
    // as "fine".
    const missing = SET_ROOM_TILE_ORDER.filter((id) => !tileSceneForTool(id));
    expect(missing).toEqual([]);
  });

  it('maps every tile to a scene that is actually drawn', () => {
    for (const id of SET_ROOM_TILE_ORDER) {
      const scene = tileSceneForTool(id);
      expect(TILE_SCENE_NAMES).toContain(scene);
      expect(TILE_SCENES[scene!].paths.length).toBeGreaterThan(0);
    }
  });

  it('draws `record` by name, because it is a block and not a tile', () => {
    // The Lectures section's record block is a door in its own right but it is
    // not a `SetRoomTileId`, so its scene is reachable by name only.
    expect(TILE_SCENE_NAMES).toContain('record');
    expect(SET_ROOM_TILE_ORDER).not.toContain('record' as never);
  });
});

describe('tileSceneSvgProps', () => {
  it('fits the landscape scene inside the box it is given, never stretching it', () => {
    // 4:3. A 200x120 box is width-slack, so the fit is by height.
    expect(tileSceneSvgProps({ boxWidth: 200, boxHeight: 120 })).toEqual({
      width: 160,
      height: 120,
      viewBox: TILE_SCENE_VIEW_BOX,
    });
    // A 120x120 box is height-slack, so the fit is by width.
    expect(tileSceneSvgProps({ boxWidth: 120, boxHeight: 120 })).toEqual({
      width: 120,
      height: 90,
      viewBox: TILE_SCENE_VIEW_BOX,
    });
  });

  it('always returns the asset aspect ratio, at every box shape', () => {
    for (const [w, h] of [
      [160, 96], [120, 200], [88, 88], [320, 240], [137, 51],
    ] as const) {
      const { width, height } = tileSceneSvgProps({ boxWidth: w, boxHeight: h });
      expect(width / height).toBeCloseTo(4 / 3, 1);
      expect(width).toBeLessThanOrEqual(w);
      expect(height).toBeLessThanOrEqual(h);
    }
  });

  it('never returns a negative box, however silly the input', () => {
    // Yoga rejects a negative dimension; `doorTileLayout` makes the same guard
    // for the same reason.
    const tiny = tileSceneSvgProps({ boxWidth: -40, boxHeight: 10 });
    expect(tiny.width).toBeGreaterThanOrEqual(0);
    expect(tiny.height).toBeGreaterThanOrEqual(0);
  });

  it('fills the panel a real tile hands it, rather than sitting in it as a stamp', () => {
    // The glyph this replaces was `illustrationSize * 0.62`. At the narrowest
    // column a phone produces, the scene must still be wider than that mark —
    // otherwise the whole change is a redraw nobody can see.
    const layout = doorTileLayout({ width: 160 });
    const svg = tileSceneSvgProps({
      boxWidth: layout.width,
      boxHeight: layout.illustrationSize,
    });
    expect(svg.width).toBeGreaterThan(Math.round(layout.illustrationSize * 0.62));
    expect(svg.width).toBeLessThanOrEqual(layout.width);
    expect(svg.height).toBeLessThanOrEqual(layout.illustrationSize);
  });
});

describe('tileSceneFills on the phone', () => {
  it('paints bodies in the surface, so they read against the pastel', () => {
    const light = tileSceneFills({ ...featureAccentsLight.tests, surface: '#ffffff' });
    expect(light.fill).toBe('#ffffff');
    const dark = tileSceneFills({ ...featureAccentsDark.tests, surface: '#101214' });
    expect(dark.fill).toBe('#101214');
  });

  it('derives a shade that is neither the tint nor the ink', () => {
    for (const accents of [featureAccentsLight, featureAccentsDark]) {
      const accent = accents.flashcards;
      const { shade } = tileSceneFills({ ...accent, surface: '#ffffff' });
      expect(shade).not.toBe(accent.tint);
      expect(shade).not.toBe(accent.ink);
      expect(shade).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('gives the two themes different colours from the same asset', () => {
    // The proof that nothing about the scene is theme-specific: same scene,
    // same call, two palettes, two results.
    const light = tileSceneFills({ ...featureAccentsLight.ai, surface: '#ffffff' });
    const dark = tileSceneFills({ ...featureAccentsDark.ai, surface: '#101214' });
    expect(light.fill).not.toBe(dark.fill);
    expect(light.shade).not.toBe(dark.shade);
  });
});

describe('the Overview recommendation tiles', () => {
  // The set room's Overview recommends the same tools the Practice tiles open,
  // so it draws the same scenes. `read` is the deliberate exception: there is
  // no scene for a note in the approved set, and web's `notes` door has none
  // either, so it falls back to its glyph. This table is the decision, pinned
  // so an added card or a renamed id is a visible diff.
  const EXPECTED: Record<string, string | undefined> = {
    ask: 'ask',
    read: undefined,
    quiz: 'quiz',
    cards: 'flashcards',
    lesson: 'tutor',
    recap: 'listen',
    play: 'arcade',
    test: 'tests',
  };

  it('maps every recommendation card to its expected scene, or to the glyph', () => {
    for (const card of STUDY_SET_RECOMMENDED_CARDS) {
      expect(EXPECTED).toHaveProperty(card.id);
      expect(tileSceneForTool(card.id)).toBe(EXPECTED[card.id]);
    }
  });

  it('covers exactly the cards the room offers, so a new card is a real diff', () => {
    expect(STUDY_SET_RECOMMENDED_CARDS.map((card) => card.id).sort()).toEqual(
      Object.keys(EXPECTED).sort()
    );
  });

  it('draws every mapped recommendation scene from the shared art set', () => {
    for (const card of STUDY_SET_RECOMMENDED_CARDS) {
      const scene = tileSceneForTool(card.id);
      if (!scene) continue;
      expect(TILE_SCENE_NAMES).toContain(scene);
      expect(TILE_SCENES[scene].paths.length).toBeGreaterThan(0);
    }
  });
});
