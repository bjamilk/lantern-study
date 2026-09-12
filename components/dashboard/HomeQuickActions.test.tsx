import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HomeQuickActions } from './HomeQuickActions';

/** Server rendering keeps this suite off a DOM it does not need. */
const render = () =>
  renderToStaticMarkup(
    <HomeQuickActions
      onImport={() => undefined}
      onOpenTests={() => undefined}
      onToggleCompanion={() => undefined}
      onOpenTutor={() => undefined}
      onRecordLecture={() => undefined}
      onOpenStudyHub={() => undefined}
    />
  );

const LABELS = [
  'Import materials',
  'Create a quiz',
  'Chat with Lantern',
  'Tutor',
  'Record a lecture',
  'Open Study',
];

describe('HomeQuickActions', () => {
  it('keeps every door and its label', () => {
    const html = render();
    for (const label of LABELS) expect(html).toContain(label);
    expect(html.match(/<button/g) || []).toHaveLength(LABELS.length);
  });

  it('gives every tile a tinted mark — no tile falls to a grey disc', () => {
    const html = render();
    // SIX marks, not four. The illustrated doors (import, record) used to draw
    // a bare SVG whose only tinted shape is a ground ellipse that disappears on
    // a surface, so they measured as untinted on the live grid. Every door now
    // sits in a feature tile.
    const tinted = html.match(/bg-lantern-feature-[a-z]+-tint/g) || [];
    expect(tinted).toHaveLength(LABELS.length);
    expect(html).not.toContain('rounded-full bg-lantern-background-secondary');
  });

  it('never repeats a hue — six doors, six feature tints', () => {
    const html = render();
    // `Tutor` and `Chat with Lantern` both wore the `ai` pink, so two of six
    // tiles were indistinguishable by colour.
    const tinted = html.match(/bg-lantern-feature-([a-z]+)-tint/g) || [];
    expect(new Set(tinted).size).toBe(LABELS.length);
  });

  it('never draws the same glyph on two tiles', () => {
    const html = render();
    const glyphs = html.match(/lucide-[a-z0-9-]+/g) || [];
    // The illustrations are hand-drawn SVGs, so only the four AppIcon tiles
    // show up here; each must be a different lucide glyph.
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('keeps the drawing on the two illustrated doors', () => {
    const html = render();
    // Moving the mark into the tile must not quietly downgrade those two doors
    // to a line glyph: the illustrations are stroked paths, never <path> from
    // lucide, and they are repainted to the panel ink.
    expect(html).toContain('!text-lantern-ink');
    expect((html.match(/<svg/g) || []).length).toBeGreaterThanOrEqual(LABELS.length);
  });

  it('renders nothing when no door is wired', () => {
    expect(renderToStaticMarkup(<HomeQuickActions />)).toBe('');
  });
});
