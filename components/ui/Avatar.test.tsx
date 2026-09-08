import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// Keep the avatar off the network: the resolved-src hook pulls in the supabase
// service. This suite only exercises the fallback (initials) rendering, so stub
// the hook to "no image", which forces the coloured initials span every time.
vi.mock('../../hooks/useResolvedAvatarSrc', () => ({
  useResolvedAvatarSrc: () => undefined,
}));

import { Avatar } from './Avatar';

const render = (props: React.ComponentProps<typeof Avatar>) =>
  renderToStaticMarkup(<Avatar {...props} />);

/** Pull the inline background-color out of the rendered initials span. */
const bgColorOf = (markup: string): string | null => {
  const match = markup.match(/background-color:\s*([^;"]+)/i);
  return match ? match[1].trim() : null;
};

describe('Avatar colour seeding', () => {
  it('gives two nameless accounts different colours (seeded from id, not the name)', () => {
    // Both accounts have no name, so both resolve to the same neutral label
    // ("User"). Seeding the colour from that label — the regression — paints
    // them identically; seeding from the per-account id separates them.
    const a = render({ name: '', id: 'account-alpha' });
    const b = render({ name: '', id: 'account-bravo' });

    const colorA = bgColorOf(a);
    const colorB = bgColorOf(b);

    expect(colorA).toBeTruthy();
    expect(colorB).toBeTruthy();
    expect(colorA).not.toBe(colorB);
  });

  it('keeps the same account the same colour across renders', () => {
    const first = render({ name: '', id: 'account-alpha' });
    const second = render({ name: '', id: 'account-alpha' });
    expect(bgColorOf(first)).toBe(bgColorOf(second));
  });

  it('does not seed the colour from the display name — a rename keeps the colour', () => {
    // Same account (same id), different display name on two renders. The colour
    // must not move, because it is seeded from the id and not the label.
    const before = render({ name: 'Ada Lovelace', id: 'account-alpha' });
    const after = render({ name: 'Ada L.', id: 'account-alpha' });
    expect(bgColorOf(before)).toBe(bgColorOf(after));
  });

  it('leaves the neutral mark and label untouched for a nameless account', () => {
    // The colour seed change must not disturb what a nameless avatar draws or
    // announces: the neutral "?" glyph and the neutral "User" label.
    const markup = render({ name: '', id: 'account-alpha' });
    expect(markup).toContain('>?<');
    expect(markup).toContain('aria-label="User"');
  });

  it('never invents initials or leaks an email into the label', () => {
    // An email-shaped name has no initials to invent and must not be spoken by a
    // screen reader; it still draws the neutral mark and neutral label.
    const markup = render({ name: 'nimaj22@example.com', id: 'account-alpha' });
    expect(markup).toContain('>?<');
    expect(markup).toContain('aria-label="User"');
    expect(markup).not.toContain('nimaj22');
  });

  it('does not derive the colour from an email-shaped name (no id passed)', () => {
    // Two different email-shaped names, neither with an id: the seed must NOT be
    // the address, so both fall back to the neutral label and paint the SAME
    // colour. If the raw name still seeded the colour, the two addresses would
    // paint differently — the leak this guards against.
    const a = render({ name: 'aaa@example.com' });
    const b = render({ name: 'zzz@example.com' });
    expect(bgColorOf(a)).toBeTruthy();
    expect(bgColorOf(a)).toBe(bgColorOf(b));
  });

  it('still separates two distinct genuine names when no id is passed', () => {
    // The id-less fallback must keep distinct named accounts distinct: a real
    // name still seeds the colour, so these two differ.
    const a = render({ name: 'Ada Lovelace' });
    const b = render({ name: 'Alan Turing' });
    expect(bgColorOf(a)).not.toBe(bgColorOf(b));
  });
});
