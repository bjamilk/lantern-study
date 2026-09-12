// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeQuickActions } from './dashboard/HomeQuickActions';

/**
 * The serif display voice regressed invisibly: `:root` set `--font-display` to
 * the Bitter stack, but the font-mode class that ships on `<html>` by default
 * (`.font-full`) reassigned it to `var(--font-sans)`. A mode class outranks
 * `:root`, so every heading computed `system-ui` and the browser never even
 * requested the Bitter files.
 *
 * jsdom does not substitute `var()` — `getComputedStyle(h2).fontFamily` comes
 * back as the literal string `var(--font-display)` — so asserting on a computed
 * family in a render test would assert nothing. This suite instead resolves the
 * real cascade out of `index.css` for the classes an unconfigured account
 * actually carries, and checks the rendered markup reaches for it.
 */

const CSS_PATH = path.resolve(__dirname, '..', 'index.css');
const css = fs.readFileSync(CSS_PATH, 'utf8');
/** Comments sit between rules, so they land in the captured selector text. */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The classes `<html>` carries for a default account (no preferences set). */
const DEFAULT_HTML_CLASSES = ['font-full', 'font-size-small'];

/**
 * Every `--font-display: …` declaration in source order, with the selector it
 * sits under. Enough of a resolver for this file: the selectors involved are
 * all single class / `:root` selectors of equal specificity-or-less, so later
 * wins among those that apply.
 */
function displayFontDeclarations(): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  const blocks = cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const [, rawSelector, body] of blocks) {
    const decl = body.match(/--font-display\s*:\s*([^;]+);/);
    if (decl) out.push({ selector: rawSelector.trim(), value: decl[1].trim() });
  }
  return out;
}

function resolveDisplayFont(htmlClasses: string[]): string {
  const applies = (selector: string) =>
    selector === ':root' ||
    selector
      .split(',')
      .map((s) => s.trim())
      .some((s) => s.startsWith('.') && htmlClasses.includes(s.slice(1)));

  let winner = '';
  for (const { selector, value } of displayFontDeclarations()) {
    if (applies(selector)) winner = value;
  }
  return winner;
}

describe('the display font survives the font modes', () => {
  it('resolves to the Bitter stack under the default <html> classes', () => {
    expect(resolveDisplayFont(DEFAULT_HTML_CLASSES)).toMatch(/^'Bitter'/);
  });

  it('resolves to Bitter with no font-mode class at all', () => {
    expect(resolveDisplayFont([])).toMatch(/^'Bitter'/);
  });

  it('no font-mode class may reassign the display face except low-data', () => {
    // The modes exist to scale sizes. `.font-low-data` is the one documented
    // exception: it is the accessibility / bandwidth mode and deliberately
    // ships zero font bytes.
    const reassigning = displayFontDeclarations()
      .map((d) => d.selector)
      .filter((s) => s !== ':root' && s !== '.font-low-data');
    expect(reassigning).toEqual([]);
  });

  it('low-data still drops to a system stack, on purpose', () => {
    expect(resolveDisplayFont(['font-low-data'])).toMatch(/^system-ui/);
  });

  it('maps text-display and text-title onto the display variable', () => {
    expect(cssNoComments).toMatch(
      /\.text-display,\s*\.text-title\s*\{[^}]*font-family:\s*var\(--font-display\)/
    );
  });

  it('ships every Bitter file the @font-face rules point at', () => {
    const srcs = [...cssNoComments.matchAll(/src:\s*url\('([^']+)'\)/g)].map((m) => m[1]);
    const bitter = srcs.filter((s) => s.includes('bitter'));
    expect(bitter.length).toBeGreaterThanOrEqual(4);
    for (const src of bitter) {
      const file = path.resolve(__dirname, '..', 'public', src.replace(/^\//, ''));
      expect(fs.existsSync(file), `missing font file: ${file}`).toBe(true);
    }
  });

  it('renders section headings through text-title, so they take the serif', () => {
    const html = renderToStaticMarkup(<HomeQuickActions onImport={() => undefined} />);
    expect(html).toContain('text-title');
  });
});
