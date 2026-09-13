#!/usr/bin/env node
/**
 * WCAG contrast gate for the shipped design tokens.
 *
 * WHY A SCRIPT AS WELL AS A TEST: `packages/shared/src/design/contrast.test.ts`
 * proves the TOKENS are legible. This proves the CSS the browser actually
 * loads is legible AND still equals the tokens — the failure mode spec v3
 * §6.2 calls out on StudyFetch, where a token layer documented a product the
 * app did not ship. Both must pass; neither is redundant.
 *
 * It reads `index.css` (`:root` and `.dark`) and `packages/shared/src/design/
 * tokens.ts` by parsing, not importing, so it needs no build step and can run
 * before `npm run build`.
 *
 *   node scripts/design/contrast.mjs          # report + exit code
 *   node scripts/design/contrast.mjs --quiet  # failures only
 *
 * Exit 1 on any pair below 4.5:1 (3:1 only for a token listed in
 * LARGE_TEXT_ONLY below), or on any drift between the CSS and the tokens.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CSS_PATH = resolve(REPO, 'index.css');
const TOKENS_PATH = resolve(REPO, 'packages/shared/src/design/tokens.ts');
/** The ONLY home of the --type-* vars (index.css must not redefine them). */
const TYPE_CSS_PATH = resolve(REPO, 'design/type.css');

const AA_NORMAL = 4.5;
const AA_LARGE = 3;

/**
 * Tokens accepted at the 3:1 large-text threshold, each with the reason it is
 * only ever painted at >=24px (or >=18.66px/700). Empty by design: an entry
 * here is a promise about every call site of that token.
 * Keep in lockstep with LARGE_TEXT_ONLY in design/contrast.ts.
 */
const LARGE_TEXT_ONLY = {};

/** Palette vars that are fills or chrome and never carry text. */
const NON_TEXT_VARS = new Set([
  '--color-background',
  '--color-background-secondary',
  '--color-nav-column',
  // Rail ink is gated on `--color-nav-column` below, not on the page ground.
  '--color-nav-column-text',
  '--color-nav-column-text-secondary',
  // The grey pill behind the lit rail item: a ground. What sits on it is
  // `--color-nav-column-text`, gated against this below.
  '--color-nav-column-active',
  '--color-surface',
  '--color-surface-secondary',
  '--color-border',
  '--color-primary-light', // gradient / hover fill only
  '--color-primary-dark', // pressed-state fill and gradient stop only
  // FILL role. Gated below by WHITE on it, which is the only text it carries.
  '--color-primary-fill',
  // FILL role too: the red under a white numeral (count badges, danger
  // buttons). Never painted as text — red TEXT is `--color-error`, which is
  // gated as text above. Gated below by WHITE on it.
  '--color-error-strong',
  // Tint GROUNDS, not inks. Checked below as the background of their own ink.
  '--color-primary-background',
  '--color-accent-background',
]);

/** Ink -> the tint ground it is painted on, for the non-feature tints. */
const INK_ON_TINT = [
  ['--color-primary', '--color-primary-background'],
  // Build 153: the ink that is ACTUALLY painted on the primary tint. Checking
  // only `--color-primary` let the accent-derived text ink ship at 4.07:1.
  ['--color-primary-text', '--color-primary-background'],
  ['--color-accent', '--color-accent-background'],
];

/**
 * Fill vars, each with the label colour painted on it. A fill is never gated
 * as text — it is gated by what sits ON it.
 */
const WHITE_ON_FILL = [
  // After the 2026-09-12 pivot the primary fill IS the theme's ink, so it
  // inverts: near-black under white in light, near-white under the inverse
  // ink (#0f172a) in dark. A per-theme label, because a single one cannot be
  // right for both — white on dark's #f5f5f5 fill is 1.04:1, which is exactly
  // the regression the `.dark .bg-lantern-primary*` rule in index.css fixes.
  ['--color-primary-fill', { light: '255 255 255', dark: '#0f172a' }],
  // The badge fix: white on `--color-error` was 3.76:1 in dark. Both themes
  // are gated so a future re-lightening of either value fails here.
  ['--color-error-strong', '255 255 255'],
];

/**
 * Palette key in tokens.ts -> the CSS var index.css must hold for it, as RGB
 * channels. Only the keys index.css actually declares; the alpha-baked
 * `*Background` pair keeps its whole-colour form and is excluded.
 */
const PALETTE_VAR_MAP = {
  background: '--color-background',
  backgroundSecondary: '--color-background-secondary',
  navColumn: '--color-nav-column',
  navColumnText: '--color-nav-column-text',
  navColumnTextSecondary: '--color-nav-column-text-secondary',
  navColumnActive: '--color-nav-column-active',
  ink: '--color-ink',
  surface: '--color-surface',
  surfaceSecondary: '--color-surface-secondary',
  text: '--color-text',
  textSecondary: '--color-text-secondary',
  textTertiary: '--color-text-tertiary',
  primary: '--color-primary',
  primaryLight: '--color-primary-light',
  primaryDark: '--color-primary-dark',
  primaryFill: '--color-primary-fill',
  primaryText: '--color-primary-text',
  accent: '--color-accent',
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
  errorStrong: '--color-error-strong',
  info: '--color-info',
  border: '--color-border',
};

/** The nine feature identities, in spec order (`sets` added 2026-09-11). */
const FEATURE_KEYS = [
  'notes',
  'flashcards',
  'tests',
  'recording',
  'ai',
  'groups',
  'campus',
  'budget',
  'sets',
];

// ---------------------------------------------------------------- colour math

/**
 * Returns [r, g, b] plus the alpha an 8-digit hex carries. Dark's tint
 * grounds are translucent (#6366f120), so contrast against them is only
 * meaningful once they are composited over the surface beneath — which is
 * exactly the case the eye sees and a naive parser gets wrong by 4:1.
 */
function parseRgba(value) {
  const rgb = parseChannels(value);
  if (!rgb) return null;
  const raw = value.trim().replace('#', '');
  const alpha = value.trim().startsWith('#') && raw.length === 8
    ? parseInt(raw.slice(6, 8), 16) / 255
    : 1;
  return { rgb, alpha };
}

/** Composite a possibly-translucent colour over an opaque base. */
function composite(value, baseValue) {
  const fg = parseRgba(value);
  const bg = parseChannels(baseValue);
  if (!fg || !bg) return null;
  if (fg.alpha >= 1) return fg.rgb;
  return fg.rgb.map((c, i) => Math.round(c * fg.alpha + bg[i] * (1 - fg.alpha)));
}

function parseChannels(value) {
  const v = value.trim();
  const hex = v.replace('#', '');
  if (v.startsWith('#')) {
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) return null;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const parts = v.split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.slice(0, 3);
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// -------------------------------------------------------------------- parsing

/** Pull one top-level `selector { ... }` block out of the stylesheet. */
function cssBlock(css, selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`index.css has no \`${selector}\` block`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`index.css \`${selector}\` block is unterminated`);
}

/** `--name: value;` pairs, comments stripped, `var(--other)` resolved. */
function cssVars(block) {
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  for (const [, name, value] of stripped.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  for (const [name, value] of Object.entries(out)) {
    const alias = value.match(/^var\((--[\w-]+)\)$/);
    if (alias) out[name] = out[alias[1]] ?? value;
  }
  return out;
}

function tokenSource() {
  const src = readFileSync(TOKENS_PATH, 'utf8');
  const pairs = (mapName) => {
    const start = src.indexOf(`export const ${mapName}`);
    if (start === -1) throw new Error(`tokens.ts has no ${mapName}`);
    const body = src.slice(start, src.indexOf('};', start));
    const out = {};
    for (const [, key, ink, tint] of body.matchAll(
      /(\w+):\s*\{\s*ink:\s*'(#[0-9a-fA-F]{3,8})',\s*tint:\s*'(#[0-9a-fA-F]{3,8})'\s*\}/g
    )) {
      out[key] = { ink, tint };
    }
    return out;
  };
  // `lanternColors` holds the brand hues that lightBase re-exports by
  // reference (`primary: lanternColors.primary`); resolve those or the
  // palette parse silently loses four keys.
  const brand = {};
  const brandStart = src.indexOf('export const lanternColors = {');
  for (const [, key, value] of src
    .slice(brandStart, src.indexOf('} as const;', brandStart))
    .matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) {
    brand[key] = value;
  }

  const palette = (constName) => {
    const start = src.indexOf(`const ${constName} = {`);
    if (start === -1) throw new Error(`tokens.ts has no ${constName}`);
    const body = src.slice(start, src.indexOf('} as const;', start));
    const out = {};
    for (const [, key, value] of body.matchAll(/^\s*(\w+):\s*'([^']+)',/gm)) {
      out[key] = value;
    }
    for (const [, key, ref] of body.matchAll(/^\s*(\w+):\s*lanternColors\.(\w+),/gm)) {
      if (brand[ref]) out[key] = brand[ref];
    }
    return out;
  };
  const typeSteps = {};
  const typeStart = src.indexOf('export const type: Record<TypeStepName, TypeStep> = {');
  if (typeStart === -1) throw new Error('tokens.ts has no `type` map');
  const typeBody = src.slice(typeStart, src.indexOf('\n};', typeStart));
  for (const [, name, fontSize, lineHeight, fontWeight, letterSpacing] of typeBody.matchAll(
    /(\w+):\s*\{\s*fontSize:\s*(\d+),\s*lineHeight:\s*(\d+),\s*fontWeight:\s*'(\d+)',\s*letterSpacing:\s*'([^']+)'/g
  )) {
    typeSteps[name] = { fontSize: Number(fontSize), lineHeight: Number(lineHeight), fontWeight, letterSpacing };
  }
  /**
   * `featureSmallTextInkLight` / `-Dark` — the inks the 11 px label step swaps
   * in (spec §5.6). Read from the token file, never re-typed here, so this
   * gate cannot drift from what `smallTextInk` actually paints.
   */
  const smallInks = (mapName) => {
    const start = src.indexOf(`export const ${mapName}`);
    if (start === -1) throw new Error(`tokens.ts has no ${mapName}`);
    const body = src.slice(start, src.indexOf('};', start));
    const out = {};
    for (const [, key, value] of body.matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)) {
      out[key] = value;
    }
    return out;
  };
  return {
    type: typeSteps,
    light: pairs('featureAccentsLight'),
    dark: pairs('featureAccentsDark'),
    smallInkLight: smallInks('featureSmallTextInkLight'),
    smallInkDark: smallInks('featureSmallTextInkDark'),
    lightPalette: palette('lightBase'),
    darkPalette: palette('darkBase'),
  };
}

// --------------------------------------------------------------------- checks

const results = [];
const drift = [];

function check(subject, groundLabel, fg, bg) {
  const f = Array.isArray(fg) ? fg : parseChannels(fg);
  const b = Array.isArray(bg) ? bg : parseChannels(bg);
  if (!f || !b) {
    drift.push(`${subject}: cannot parse "${fg}" on "${bg}"`);
    return;
  }
  const min = subject in LARGE_TEXT_ONLY ? AA_LARGE : AA_NORMAL;
  const r = ratio(f, b);
  results.push({ subject, ground: groundLabel, ratio: r, min, pass: r >= min });
}

function run() {
  const css = readFileSync(CSS_PATH, 'utf8');
  const root = cssVars(cssBlock(css, ':root'));
  const dark = cssVars(cssBlock(css, '.dark'));
  // `.dark` inherits everything it does not redefine. Modelling that is the
  // whole point: the pre-wave bug was success/warning/error inheriting the
  // LIGHT values onto a black ground.
  const darkAll = { ...root, ...dark };
  const tokens = tokenSource();

  const themes = [
    {
      name: 'light',
      vars: root,
      page: root['--color-background'],
      surface: root['--color-surface'],
      body: root['--color-text'],
      pairs: tokens.light,
      palette: tokens.lightPalette,
      thirdLabel: 'page cream',
      third: root['--color-background'],
      card: root['--color-surface'],
    },
    {
      name: 'dark',
      vars: darkAll,
      page: darkAll['--color-background'],
      surface: darkAll['--color-surface'],
      body: darkAll['--color-text'],
      pairs: tokens.dark,
      palette: tokens.darkPalette,
      thirdLabel: 'page black',
      third: darkAll['--color-background'],
      card: darkAll['--color-surface'],
    },
  ];

  for (const t of themes) {
    for (const key of FEATURE_KEYS) {
      const inkVar = `--color-feature-${key}-ink`;
      const tintVar = `--color-feature-${key}-tint`;
      const ink = t.vars[inkVar];
      const tint = t.vars[tintVar];
      if (!ink || !tint) {
        drift.push(`${t.name}: index.css is missing ${inkVar} / ${tintVar}`);
        continue;
      }
      // CSS must equal tokens.ts, or one of them is lying.
      const token = t.pairs[key];
      if (!token) {
        drift.push(`tokens.ts featureAccents${t.name === 'dark' ? 'Dark' : 'Light'} has no "${key}"`);
      } else {
        const expectInk = parseChannels(token.ink).join(' ');
        const expectTint = parseChannels(token.tint).join(' ');
        if (ink !== expectInk) drift.push(`${inkVar}: index.css "${ink}" != tokens.ts ${token.ink} ("${expectInk}")`);
        if (tint !== expectTint) drift.push(`${tintVar}: index.css "${tint}" != tokens.ts ${token.tint} ("${expectTint}")`);
      }

      check(`${t.name} feature ${key} ink`, 'own tint', ink, tint);
      check(`${t.name} feature ${key} ink`, 'surface', ink, t.surface);
      check(`${t.name} feature ${key} ink`, t.thirdLabel, ink, t.third);
      check(`${t.name} body ink`, `feature ${key} tint`, t.body, tint);
      // A feature ink used as a BUTTON FILL — the one action on an empty-state
      // panel (spec v5.6 "Empty state"; Tests uses it today). The label on it
      // is the surface colour, not white: in dark mode every ink is a light
      // hue, so a white label on it would be the 1.x:1 failure. Checked from
      // the label's side, the way the primary fill is.
      check(`${t.name} surface label`, `feature ${key} ink fill`, t.surface, ink);
    }

    // The 11px override. Lime ink clears AA on its own tint by 0.10 (4.60:1),
    // which the spec calls too tight to set anything under 12px in — so the
    // mobile `label` step swaps in a darker lime (components/ui/FeatureDisc.tsx
    // `smallTextInk`). This asserts the substitute is actually better, on both
    // grounds a count pill sits on.
    const overrides = t.name === 'dark' ? tokens.smallInkDark : tokens.smallInkLight;
    for (const [key, smallInk] of Object.entries(overrides)) {
      if (!FEATURE_KEYS.includes(key)) {
        drift.push(`tokens.ts featureSmallTextInk${t.name === 'dark' ? 'Dark' : 'Light'} has unknown feature "${key}"`);
        continue;
      }
      const tint = t.vars[`--color-feature-${key}-tint`];
      check(`${t.name} ${key} small-text ink`, `${key} tint`, smallInk, tint);
      check(`${t.name} ${key} small-text ink`, 'surface', smallInk, t.surface);
      // An override that is no better than the ink it replaces is noise.
      const inkRatio = ratio(parseChannels(t.vars[`--color-feature-${key}-ink`]), parseChannels(tint));
      if (ratio(parseChannels(smallInk), parseChannels(tint)) <= inkRatio) {
        drift.push(`${t.name} ${key} small-text ink ${smallInk} is no darker on its own tint than the ink it replaces`);
      }
    }

    // Every --color-* that carries text, on the two grounds it renders on.
    for (const [name, value] of Object.entries(t.vars)) {
      if (!name.startsWith('--color-')) continue;
      if (name.startsWith('--color-feature-')) continue; // covered above
      if (NON_TEXT_VARS.has(name)) continue;
      if (!parseChannels(value)) continue; // alpha-baked backgrounds etc.
      check(`${t.name} ${name}`, 'page', value, t.page);
      check(`${t.name} ${name}`, 'surface', value, t.surface);
    }

    // Palette drift: index.css must equal tokens.ts, key for key. `.dark`
    // silently inheriting a light value is precisely what this catches.
    for (const [key, varName] of Object.entries(PALETTE_VAR_MAP)) {
      const tokenValue = t.palette[key];
      if (!tokenValue) {
        drift.push(`tokens.ts ${t.name} palette has no "${key}"`);
        continue;
      }
      const cssValue = t.vars[varName];
      if (!cssValue) {
        drift.push(`index.css has no ${varName} for ${t.name}`);
        continue;
      }
      const expected = parseChannels(tokenValue)?.join(' ');
      if (expected && cssValue !== expected) {
        drift.push(`${t.name} ${varName}: index.css "${cssValue}" != tokens.ts ${tokenValue} ("${expected}")`);
      }
    }

    // Non-feature tints: the ink on its own ground, composited where the
    // ground carries its own alpha (every dark tint does).
    for (const [inkVar, tintVar] of INK_ON_TINT) {
      const ink = t.vars[inkVar];
      const tint = t.vars[tintVar];
      if (!ink || !tint) continue;
      const overSurface = composite(tint, t.surface);
      const overPage = composite(tint, t.page);
      if (overSurface) check(`${t.name} ${inkVar}`, `${tintVar} over surface`, ink, overSurface);
      if (overPage) check(`${t.name} ${inkVar}`, `${tintVar} over page`, ink, overPage);
    }

    // Fills carry a white label, so they are checked from the label's side.
    for (const [fillVar, label] of WHITE_ON_FILL) {
      const fill = t.vars[fillVar];
      if (!fill) {
        drift.push(`${t.name}: index.css is missing ${fillVar}`);
        continue;
      }
      const themeLabel = typeof label === 'string' ? label : label[t.name];
      if (!themeLabel) {
        drift.push(`${t.name}: ${fillVar} has no label colour declared`);
        continue;
      }
      check(`${t.name} label on fill`, fillVar, themeLabel, fill);
    }

    // The warning chip ("Buy freeze", DailyQuestsWidget) is painted on
    // Tailwind's amber-100 / amber-900@30%, not on a token ground, so the
    // sweep above never saw it. It shipped `text-amber-700` in BOTH modes,
    // which on the dark chip is 1.4:1. It now uses `--color-warning`; gate
    // both grounds so a re-lightening of either fails here.
    const warningChipGround = t.name === 'light'
      ? '#fef3c7' // amber-100
      : composite('#78350f4d', t.surface); // amber-900 at 30% over the card
    const warningInk = t.vars['--color-warning'];
    if (warningInk && warningChipGround) {
      check(`${t.name} --color-warning`, 'amber warning chip', warningInk, warningChipGround);
    }

    // Destination rail: dedicated ink on `--color-nav-column`, not page text.
    const navColumn = t.vars['--color-nav-column'];
    const navInk = t.vars['--color-nav-column-text'];
    const navSecondaryInk = t.vars['--color-nav-column-text-secondary'];
    if (navColumn && navInk) {
      check(`${t.name} --color-nav-column-text`, 'nav column', navInk, navColumn);
      if (navSecondaryInk) {
        check(`${t.name} --color-nav-column-text-secondary`, 'nav column', navSecondaryInk, navColumn);
      }
      // The lit rail item is the SAME outline glyph turned white inside a grey
      // pill — the one place on the rail where the ground is not the rail. If
      // the pill ever drifts lighter, the white glyph on it fails here.
      const navActive = t.vars['--color-nav-column-active'];
      if (navActive) {
        check(`${t.name} --color-nav-column-text`, 'nav active pill', navInk, navActive);
        // And the pill has to be visible AS a pill against the rail it sits
        // on. 3:1 is the non-text threshold for a UI shape, but the gate has
        // no large-text bucket, so this is recorded as drift instead.
        if (ratio(parseChannels(navActive), parseChannels(navColumn)) < 1.25) {
          drift.push(
            `${t.name} --color-nav-column-active is only ${ratio(parseChannels(navActive), parseChannels(navColumn)).toFixed(2)}:1 on the rail — the lit pill would be invisible`
          );
        }
      }
    }

    // The ink must also hold on the CARD, which in both themes is its own
    // token (light #ffffff, dark #101214) and is where most primary text sits.
    const inkOnCard = t.vars['--color-primary-text'];
    if (inkOnCard) check(`${t.name} --color-primary-text`, 'card', inkOnCard, t.card);

    // `--color-primary-fill` must be DEFINED in each theme's own block. The
    // whole point is that dark does not get to be lighter here.
    if (t.name === 'dark' && !('--color-primary-fill' in dark)) {
      drift.push('.dark does not define --color-primary-fill — it would inherit light');
    }

    // The state tokens must be DEFINED in each theme's own block, not
    // inherited. This is the `.dark` drift the wave fixes; assert it stays fixed.
    if (t.name === 'dark') {
      for (const name of [
        '--color-success',
        '--color-warning',
        '--color-error',
        '--color-error-strong',
        '--color-info',
      ]) {
        if (!(name in dark)) {
          drift.push(`.dark does not define ${name} — it would inherit the LIGHT value onto a black ground`);
        }
      }
    }
  }

  // The type scale: defined ONCE, in design/type.css, as
  // `calc(<px> * var(--type-scale))` so the text-size setting scales it. It
  // must hold the 11px floor and equal `type` in tokens.ts step for step.
  const TYPE_STEPS = ['display', 'title', 'heading', 'body', 'caption', 'label'];
  const typeCss = readFileSync(TYPE_CSS_PATH, 'utf8');
  const typeRoot = cssVars(cssBlock(typeCss, ':root'));
  if (!('--type-scale' in typeRoot)) drift.push('design/type.css :root is missing --type-scale');
  for (const step of TYPE_STEPS) {
    for (const suffix of ['size', 'lh', 'weight', 'tracking']) {
      const name = `--type-${step}-${suffix}`;
      if (name in root) drift.push(`index.css :root redefines ${name} — design/type.css is its only home`);
      if (!(name in typeRoot)) drift.push(`design/type.css :root is missing ${name}`);
    }
    const token = tokens.type[step];
    if (!token) {
      drift.push(`tokens.ts \`type\` has no "${step}"`);
      continue;
    }
    // A step is `calc(<px> * var(--type-scale))`, optionally wrapped in
    // `max(<floor>px, ...)`. The wrapper is how the two smallest steps survive
    // the Small text setting: at --type-scale .875 a bare calc drops label to
    // 9.625px and caption to 11.375px, i.e. the app's own accessibility
    // setting breaking the 11px floor. See design/type.css.
    const step_ = (value) => {
      const raw = String(value ?? '').trim();
      const capped = raw.match(
        /^max\(\s*(\d+(?:\.\d+)?)px\s*,\s*calc\((\d+(?:\.\d+)?)px \* var\(--type-scale\)\)\s*\)$/
      );
      if (capped) return { px: parseFloat(capped[2]), floor: parseFloat(capped[1]) };
      const bare = raw.match(/^calc\((\d+(?:\.\d+)?)px \* var\(--type-scale\)\)$/);
      if (bare) return { px: parseFloat(bare[1]), floor: null };
      return null;
    };
    /** The smallest --type-scale the app ships (`:root.font-size-small`). */
    const MIN_SCALE = 0.875;
    const sizeSpec = step_(typeRoot[`--type-${step}-size`]);
    const lhSpec = step_(typeRoot[`--type-${step}-lh`]);
    const size = sizeSpec ? sizeSpec.px : NaN;
    const lh = lhSpec ? lhSpec.px : NaN;
    if (!Number.isFinite(size) || !Number.isFinite(lh)) {
      drift.push(
        `design/type.css ${step}: size/lh must be calc(<px> * var(--type-scale)), optionally wrapped in max(<floor>px, ...)`
      );
    } else {
      if (size < 11) drift.push(`${step} is ${size}px — below the 11px floor (spec v3 §6.5)`);
      // The floor has to hold at the SMALL setting too, not just at scale 1.
      const floor = sizeSpec.floor;
      if (size * MIN_SCALE < 11) {
        if (floor === null) {
          drift.push(
            `${step} is ${(size * MIN_SCALE).toFixed(3)}px at the Small text setting — wrap --type-${step}-size in max(11px, ...)`
          );
        } else if (floor < 11) {
          drift.push(`--type-${step}-size floor is ${floor}px — below the 11px floor (spec v3 §6.5)`);
        }
      }
      if (floor !== null && floor > size) {
        drift.push(`--type-${step}-size floor ${floor}px is above its own ${size}px base — the step would never scale down`);
      }
      if (size !== token.fontSize) drift.push(`--type-${step}-size: type.css ${size}px != tokens.ts ${token.fontSize}px`);
      if (lh !== token.lineHeight) drift.push(`--type-${step}-lh: type.css ${lh}px != tokens.ts ${token.lineHeight}px`);
    }
    if (typeRoot[`--type-${step}-weight`] !== token.fontWeight) {
      drift.push(`--type-${step}-weight: type.css "${typeRoot[`--type-${step}-weight`]}" != tokens.ts ${token.fontWeight}`);
    }
    if (typeRoot[`--type-${step}-tracking`] !== token.letterSpacing) {
      drift.push(`--type-${step}-tracking: type.css "${typeRoot[`--type-${step}-tracking`]}" != tokens.ts ${token.letterSpacing}`);
    }
  }
  for (const name of ['--font-sans', '--font-serif', '--font-mono']) {
    if (!(name in root)) drift.push(`index.css :root is missing ${name}`);
  }
}

run();

const quiet = process.argv.includes('--quiet');
const failures = results.filter((r) => !r.pass);

if (!quiet) {
  const width = Math.max(...results.map((r) => r.subject.length));
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    console.log(
      `${mark}  ${r.ratio.toFixed(2).padStart(5)}:1  (min ${r.min})  ${r.subject.padEnd(width)}  on ${r.ground}`
    );
  }
  console.log('');
}

for (const d of drift) console.error(`DRIFT ${d}`);
for (const f of failures) {
  console.error(
    `FAIL  ${f.ratio.toFixed(2)}:1 is below ${f.min}:1 — ${f.subject} on ${f.ground}`
  );
}

if (drift.length || failures.length) {
  console.error(
    `\n${failures.length} contrast failure(s), ${drift.length} drift issue(s) across ${results.length} checks.`
  );
  process.exit(1);
}

console.log(`${results.length} contrast checks pass (>= ${AA_NORMAL}:1).`);
