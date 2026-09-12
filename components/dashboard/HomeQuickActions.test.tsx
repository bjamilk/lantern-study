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
    // Two illustrations (import, record) + four feature discs = six marks, and
    // none of them is the old neutral `bg-lantern-background-secondary` circle.
    const tinted = html.match(/bg-lantern-feature-[a-z]+-tint/g) || [];
    expect(tinted.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain('rounded-full bg-lantern-background-secondary');
  });

  it('never draws the same glyph on two tiles', () => {
    const html = render();
    const glyphs = html.match(/lucide-[a-z0-9-]+/g) || [];
    // The illustrations are hand-drawn SVGs, so only the four AppIcon tiles
    // show up here; each must be a different lucide glyph.
    expect(glyphs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('renders nothing when no door is wired', () => {
    expect(renderToStaticMarkup(<HomeQuickActions />)).toBe('');
  });
});
