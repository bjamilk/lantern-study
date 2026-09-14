/**
 * The twelve room tile scenes, as ASSETS.
 *
 * This suite guards the drawing itself — that it parses, that it stays inside
 * its box, that it names no colour of its own, and that the shade the two
 * renderers derive is a real step off the pastel in BOTH themes. What each
 * platform does with a scene is guarded beside that platform's renderer
 * (`components/ui/TileScene.test.tsx` on web, `tileScene.test.ts` on mobile),
 * because the ways to be wrong there are different ones.
 *
 * WHY A PATH PARSER LIVES IN A TEST. These scenes were ported from twelve
 * standalone SVG files, and half of them were primitives (`rect`, `circle`,
 * `ellipse`) that had to become `d` data. A typo in that conversion does not
 * throw anywhere: SVG drops an unparseable path SILENTLY, on both platforms,
 * so a broken scene renders as a blank pastel panel that looks like a loading
 * state. The parser below is the only thing standing between that and a ship.
 */
// Globals, not an import: this package runs jest, like every suite beside it.
import {
  TILE_SCENES,
  TILE_SCENE_FOR_TOOL,
  TILE_SCENE_MAX_PATH_COMMANDS,
  TILE_SCENE_NAMES,
  TILE_SCENE_VIEW_BOX,
  TILE_SHADE_INK_MIX,
  mixHex,
  tileSceneFills,
  tileSceneForTool,
  type TileSceneName,
} from './tileScenes';
import { contrastRatio, parseHex } from '../contrast';
import {
  FEATURE_KEYS,
  darkTheme,
  featureAccentsDark,
  featureAccentsLight,
  lightTheme,
} from '../tokens';

/** How many numbers each path command takes, per the SVG path grammar. */
const ARITY: Record<string, number> = {
  m: 2, l: 2, t: 2,
  h: 1, v: 1,
  c: 6,
  s: 4, q: 4,
  a: 7,
  z: 0,
};

/** Parses `d`, or throws with the offending token. Returns the command count. */
function parsePathData(d: string): number {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  let commands = 0;
  let i = 0;
  let current: string | null = null;
  if (!/^[Mm]/.test(d.trim())) throw new Error(`path does not start with a moveto: ${d}`);

  while (i < tokens.length) {
    const token = tokens[i] as string;
    if (/^[a-zA-Z]$/.test(token)) {
      const arity = ARITY[token.toLowerCase()];
      if (arity === undefined) throw new Error(`unknown path command "${token}" in: ${d}`);
      current = token;
      i += 1;
    } else if (current === null) {
      throw new Error(`number before any command in: ${d}`);
    } else {
      // An implicit repeat of the previous command, which is how `h18 h12`
      // style runs are written. A repeated `moveto` is an implicit `lineto`.
      current = current === 'M' ? 'L' : current === 'm' ? 'l' : current;
    }

    const arity = ARITY[(current as string).toLowerCase()] as number;
    const args: string[] = [];
    while (args.length < arity) {
      const arg = tokens[i];
      if (arg === undefined || /^[a-zA-Z]$/.test(arg)) {
        throw new Error(`"${current}" wants ${arity} numbers, got ${args.length} in: ${d}`);
      }
      args.push(arg);
      i += 1;
    }
    commands += 1;
  }
  return commands;
}

describe('tile scenes — the assets', () => {
  it('has the twelve the art lane drew, and only those', () => {
    expect([...TILE_SCENE_NAMES].sort()).toEqual([
      'arcade', 'ask', 'essay', 'flashcards', 'lectures', 'listen',
      'materials', 'plan', 'quiz', 'record', 'tests', 'tutor',
    ]);
  });

  it('draws every scene on the one landscape viewBox', () => {
    // The whole point of a separate record: a panel is landscape, and a scene
    // authored on a square would letterbox inside it.
    const wrong = TILE_SCENE_NAMES.filter(
      (name) => TILE_SCENES[name].viewBox !== TILE_SCENE_VIEW_BOX
    );
    expect(wrong).toEqual([]);
  });

  it('parses every path, on every scene', () => {
    // The thrown message carries the offending `d`, so a failure here says
    // exactly which command in which path the conversion got wrong.
    for (const name of TILE_SCENE_NAMES) {
      for (const path of TILE_SCENES[name].paths) {
        expect(() => parsePathData(path.d)).not.toThrow();
      }
    }
  });

  it('keeps every path under the command budget', () => {
    const over = TILE_SCENE_NAMES.flatMap((name) =>
      TILE_SCENES[name].paths
        .map((path, index) => ({ name, index, commands: parsePathData(path.d) }))
        .filter((row) => row.commands > TILE_SCENE_MAX_PATH_COMMANDS)
    );
    expect(over).toEqual([]);
  });

  it('stays inside its own box', () => {
    // Coordinates outside the viewBox are not an error — they are a drawing
    // clipped at the panel edge, which on a rounded tile reads as a rendering
    // fault. Absolute coordinates only: a relative run's true position needs a
    // full path walk, and the drafts put every extreme on an absolute command.
    const [minX, minY, width, height] = TILE_SCENE_VIEW_BOX.split(' ').map(Number) as [
      number,
      number,
      number,
      number,
    ];
    const outside: Array<{ scene: string; command: string; value: number }> = [];
    for (const name of TILE_SCENE_NAMES) {
      for (const path of TILE_SCENES[name].paths) {
        // A rotated card legitimately sticks out of its unrotated bounds.
        if (path.transform) continue;
        for (const run of path.d.match(/[MLHVCSQTA][^a-zA-Z]*/g) ?? []) {
          const nums = (run.slice(1).match(/-?\d*\.?\d+/g) ?? []).map(Number);
          const command = run[0] as string;
          const flag = (value: number, lo: number, hi: number) => {
            if (value < lo || value > hi) outside.push({ scene: name, command, value });
          };
          if (command === 'H') for (const x of nums) flag(x as number, minX, minX + width);
          else if (command === 'V') for (const y of nums) flag(y as number, minY, minY + height);
          else if (command === 'M' || command === 'L') {
            for (let i = 0; i < nums.length; i += 2) {
              flag(nums[i] as number, minX, minX + width);
              flag(nums[i + 1] as number, minY, minY + height);
            }
          }
        }
      }
    }
    expect(outside).toEqual([]);
  });

  it('carries exactly one unstroked shape per scene: the cast shadow', () => {
    // A shadow with an outline is a second object. Everything else in a scene
    // is stroked, which is what makes the twelve read as one set.
    const shadows = TILE_SCENE_NAMES.map((name) => {
      const unstroked = TILE_SCENES[name].paths.filter((p) => p.stroke === false);
      return {
        name,
        count: unstroked.length,
        fill: unstroked[0]?.fill,
        // Drawn first, so every stroke crosses it rather than hides under it.
        first: TILE_SCENES[name].paths[0] === unstroked[0],
      };
    });
    expect(shadows).toEqual(
      TILE_SCENE_NAMES.map((name) => ({ name, count: 1, fill: 'shade', first: true }))
    );
  });

  it('names no colour of its own — the two roles are the whole palette', () => {
    // A literal hex anywhere here is how "one asset, both themes" stops being
    // true, because a literal does not follow `--color-feature-*`.
    const literals = TILE_SCENE_NAMES.flatMap((name) =>
      TILE_SCENES[name].paths
        .filter(
          (path) =>
            !['fill', 'shade', 'none'].includes(path.fill) || /#|rgb|var\(/.test(path.d)
        )
        .map((path) => ({ name, fill: path.fill, d: path.d }))
    );
    expect(literals).toEqual([]);
  });

  it('fills something on every scene, so none is a bare wireframe', () => {
    const bare = TILE_SCENE_NAMES.filter(
      (name) => !TILE_SCENES[name].paths.some((p) => p.fill === 'fill')
    );
    expect(bare).toEqual([]);
  });
});

describe('tile scene mapping', () => {
  it('maps the eleven doors that have art, and each to a scene that exists', () => {
    expect(Object.keys(TILE_SCENE_FOR_TOOL).sort()).toEqual([
      'ask', 'cards', 'essay', 'import', 'lecture', 'lesson',
      'plan', 'play', 'quiz', 'recap', 'test',
    ]);
    const undrawn = Object.entries(TILE_SCENE_FOR_TOOL).filter(
      ([, scene]) => !TILE_SCENE_NAMES.includes(scene)
    );
    expect(undrawn).toEqual([]);
  });

  it('leaves `record` off the tool table — it is a block, not a door', () => {
    // `record` is the one scene with no tile: on the phone it is a block in
    // the Lectures section. It is in `TILE_SCENES` and reachable by name; it
    // is deliberately not reachable by tool id, because there is no such tool.
    expect(tileSceneForTool('record')).toBeUndefined();
    expect(TILE_SCENE_NAMES).toContain('record' as TileSceneName);
  });

  it('gives the two web-only ids no scene, rather than a wrong one', () => {
    expect(tileSceneForTool('notes')).toBeUndefined();
    expect(tileSceneForTool('walkthrough')).toBeUndefined();
  });

  it('renames where the art and the product disagree', () => {
    // The table exists because these four do not match. A cast would have
    // silently produced `undefined` for every one of them.
    expect(tileSceneForTool('import')).toBe('materials');
    expect(tileSceneForTool('lesson')).toBe('tutor');
    expect(tileSceneForTool('recap')).toBe('listen');
    expect(tileSceneForTool('play')).toBe('arcade');
  });
});

describe('tile scene fills', () => {
  it('fills bodies with the SURFACE, never the tile hue', () => {
    // An object painted in the tile's own pastel vanishes into the tile.
    expect(
      FEATURE_KEYS.map((key) => [
        tileSceneFills({ ...featureAccentsLight[key], surface: lightTheme.surface }).fill,
        tileSceneFills({ ...featureAccentsDark[key], surface: darkTheme.surface }).fill,
      ])
    ).toEqual(FEATURE_KEYS.map(() => [lightTheme.surface, darkTheme.surface]));
  });

  it('derives a shade that is a visible step off the pastel, in both themes', () => {
    // Bands, not hexes: a token may move without this test being rewritten,
    // but it may not move so far that the shadow disappears into the tile or
    // hardens into a second object.
    const faults: string[] = [];
    for (const key of FEATURE_KEYS) {
      for (const [theme, accents, palette] of [
        ['light', featureAccentsLight, lightTheme],
        ['dark', featureAccentsDark, darkTheme],
      ] as const) {
        const accent = accents[key];
        const { shade, fill } = tileSceneFills({ ...accent, surface: palette.surface });
        const step = contrastRatio(shade, accent.tint);
        if (step <= 1.08) faults.push(`${theme} ${key}: shadow invisible on its own tint`);
        if (step >= 2.2) faults.push(`${theme} ${key}: shadow reads as a second object`);
        // And it must not be mistaken for a body or for a stroke.
        if (contrastRatio(shade, fill) <= 1.2) faults.push(`${theme} ${key}: shadow vs body`);
        if (contrastRatio(shade, accent.ink) <= 1.5) faults.push(`${theme} ${key}: shadow vs ink`);
      }
    }
    expect(faults).toEqual([]);
  });

  it('mixes toward the feature ink, so the shade keeps the tile hue', () => {
    // A grey shadow under a green card is the failure this guards: the mix
    // partner is the feature's OWN ink, so the shade stays in the hue family.
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
    const tint = '#bcf887';
    const ink = '#3f6212';
    const shade = mixHex(tint, ink, TILE_SHADE_INK_MIX);
    const [r, g, b] = parseHex(shade);
    // Still green-dominant, and darker than the tint it came from.
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
    expect(g).toBeLessThan(parseHex(tint)[1]);
  });

  it('keeps the stroke ink legible on the pastel it is drawn on', () => {
    // The scenes are stroked in the tile's ink on the tile's tint. On the web
    // panel that ink is the page's own in light and the feature's in dark
    // (`FEATURE_PANEL_INK_OVERRIDE`); on the phone it is the theme's text.
    // Both pairings are gated here at AA, because a scene is line art and
    // line art at 2px has no bulk to fall back on.
    const illegible: string[] = [];
    for (const key of FEATURE_KEYS) {
      const pairs: Array<[string, number]> = [
        [`light web panel ink on ${key}`, contrastRatio(lightTheme.text, featureAccentsLight[key].tint)],
        [`dark web panel ink on ${key}`, contrastRatio(featureAccentsDark[key].ink, featureAccentsDark[key].tint)],
        [`dark phone ink on ${key}`, contrastRatio(darkTheme.text, featureAccentsDark[key].tint)],
      ];
      for (const [subject, ratio] of pairs) {
        if (ratio < 4.5) illegible.push(`${subject}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(illegible).toEqual([]);
  });
});
