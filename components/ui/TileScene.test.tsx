import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  TILE_SCENES,
  TILE_SCENE_NAMES,
  TILE_SCENE_STROKE_WIDTH,
  tileSceneForTool,
  type TileSceneName,
} from '@lantern/shared/design';
import { TileScene } from './TileScene';
import { FEATURE_TILE_SCENE_VARS } from './featureClasses';
import { OWN_WAY_TOOL_ORDER } from '../study/OwnWayGrid';

/**
 * The web half of the tile scenes.
 *
 * The shared suite guards the ASSETS — that they parse, stay in the box and
 * name no colour. This one guards what the web does with them, which is a
 * different set of ways to be wrong:
 *
 *   1. Every door on the wall either HAS a scene or is one of the two that
 *      deliberately does not. A door that silently fell back to a glyph
 *      because its id was renamed is invisible in review — the row still
 *      looks fine, it just looks like the old product.
 *   2. The two fills arrive as CSS variables. A literal that crept in would
 *      pin the drawing to one theme, which is the exact failure the variable
 *      pair exists to prevent.
 *   3. The cast shadow is not stroked. It is the one path in every scene that
 *      must not be, and it is the one a "stroke everything" refactor would
 *      quietly outline.
 */

const render = (scene: TileSceneName, feature: 'notes' | 'tests' = 'notes', height?: number) =>
  renderToStaticMarkup(<TileScene scene={scene} feature={feature} height={height} />);

describe('TileScene renderer', () => {
  it('draws every scene without throwing, on its landscape viewBox', () => {
    for (const name of TILE_SCENE_NAMES) {
      const html = render(name);
      expect(html, name).toContain(`viewBox="${TILE_SCENES[name].viewBox}"`);
      expect(html, name).toContain('<svg');
      expect(html, name).toContain('preserveAspectRatio="xMidYMid meet"');
    }
  });

  it('renders every path of the scene, in order', () => {
    for (const name of TILE_SCENE_NAMES) {
      const html = render(name);
      const rendered = [...html.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      expect(rendered, name).toEqual(TILE_SCENES[name].paths.map((p) => p.d));
    }
  });

  it('keeps the draft rotations rather than re-drawing the geometry', () => {
    // `flashcards` is the only scene with transforms: three fanned cards and
    // the rules on two of them. Baking the rotation into the coordinates would
    // have been a re-draw; carrying the transform keeps the data verbatim.
    const html = render('flashcards');
    const withTransform = TILE_SCENES.flashcards.paths.filter((p) => p.transform);
    expect(withTransform.length).toBeGreaterThan(0);
    for (const path of withTransform) {
      expect(html).toContain(`transform="${path.transform}"`);
    }
  });

  it('paints the two fills as variables, and nothing as a literal colour', () => {
    for (const name of TILE_SCENE_NAMES) {
      const html = render(name);
      const fills = [...html.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
      for (const fill of fills) {
        expect(['none'], `${name}: ${fill}`).toSatisfy(
          () => fill === 'none' || fill.startsWith('var(--tile-fill') || fill.startsWith('var(--tile-shade')
        );
      }
      // The scene's roles and the rendered fills must line up one for one.
      expect(fills, name).toEqual(
        TILE_SCENES[name].paths.map((p) =>
          p.fill === 'fill'
            ? 'var(--tile-fill, #ffffff)'
            : p.fill === 'shade'
              ? 'var(--tile-shade, #bfd3d4)'
              : 'none'
        )
      );
    }
  });

  it('strokes in currentColor at the shared weight, and never strokes the shadow', () => {
    for (const name of TILE_SCENE_NAMES) {
      const html = render(name);
      const strokes = [...html.matchAll(/stroke="([^"]+)"/g)].map((m) => m[1]);
      expect(strokes, name).toEqual(
        TILE_SCENES[name].paths.map((p) => (p.stroke === false ? 'none' : 'currentColor'))
      );
      expect(html, name).toContain(`stroke-width="${TILE_SCENE_STROKE_WIDTH}"`);
      expect(html, name).not.toMatch(/stroke="#/);
    }
  });

  it('sets both tile variables, derived from that feature’s own tokens', () => {
    const html = render('quiz', 'tests');
    expect(html).toContain('--tile-fill:rgb(var(--color-surface))');
    // The shade is a mix of the feature's OWN tint and ink, so it follows the
    // theme without a nineteenth token.
    expect(html).toContain('--color-feature-tests-tint');
    expect(html).toContain('--color-feature-tests-ink');
    expect(html).toContain('color-mix(in srgb');
    for (const key of Object.keys(FEATURE_TILE_SCENE_VARS)) {
      expect(FEATURE_TILE_SCENE_VARS[key as 'notes']['--tile-shade']).toContain(
        `--color-feature-${key}-tint`
      );
    }
  });

  it('carries the panel ink pairing, so the drawing survives dark mode', () => {
    // Strong ink on the pastel, the feature's own ink on the near-black that
    // panel becomes in dark. Losing the dark half repaints the scene in a
    // near-black on a near-black.
    const html = render('ask', 'notes');
    expect(html).toContain('text-lantern-ink');
    expect(html).toContain('dark:text-lantern-feature-notes-ink');
  });

  it('is decorative — the tile’s own label already names it', () => {
    const html = render('plan');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain('aria-label');
  });

  it('scales without re-authoring: only width and height move', () => {
    const a = render('essay', 'notes', 80);
    const b = render('essay', 'notes', 160);
    expect(a).toContain('height="80"');
    expect(b).toContain('height="160"');
    // 4:3, fitted rather than stretched.
    expect(a).toContain('width="106.66666666666667"');
    expect(a.replace(/(width|height)="[^"]*"/g, '')).toBe(
      b.replace(/(width|height)="[^"]*"/g, '')
    );
  });
});

describe('tile scene coverage on the web wall', () => {
  it('gives every own-way door a scene, except the two that keep their glyph', () => {
    // The ledger. `notes` and `walkthrough` were not in the set the art lane
    // drew, so they keep their `AppIcon` until someone decides they are rooms;
    // anything else missing here is a door that quietly lost its picture.
    const missing = OWN_WAY_TOOL_ORDER.filter((id) => !tileSceneForTool(id));
    expect([...missing].sort()).toEqual(['notes', 'walkthrough']);
  });

  it('maps every door to a scene that is actually drawn', () => {
    for (const id of OWN_WAY_TOOL_ORDER) {
      const scene = tileSceneForTool(id);
      if (!scene) continue;
      expect(TILE_SCENE_NAMES, `${id} -> ${scene}`).toContain(scene);
      expect(() => render(scene), `${id}`).not.toThrow();
    }
  });
});
