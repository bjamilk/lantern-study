import { buildMeSections, meRowIds } from './meRows';
import { LOW_DATA_MODE_HINT } from '@lantern/shared/settings';

const sections = (darkMode = false, lowDataMode = false) =>
  buildMeSections({ darkMode, lowDataMode });

describe('the Me tab', () => {
  it('carries exactly the rows the shell moved onto it, in order', () => {
    expect(meRowIds(sections())).toEqual([
      'academic',
      'joinClass',
      'budget',
      'downloads',
      'credits',
      'darkMode',
      'lowData',
      'settings',
      'logout',
    ]);
  });

  it('ends with Log out, and marks it destructive', () => {
    const flat = sections().flatMap((section) => section.rows);
    const last = flat[flat.length - 1];
    expect(last.id).toBe('logout');
    expect(last.kind).toBe('destructive');
  });

  it('describes Low-data mode with the one shared sentence, not a second wording', () => {
    // Me said "Skip images and heavy downloads on mobile data" while Settings >
    // Appearance said "Lighter images, charts, and page loads" — one switch
    // described twice reads as two switches.
    const flat = sections().flatMap((section) => section.rows);
    expect(flat.find((row) => row.id === 'lowData')?.hint).toBe(LOW_DATA_MODE_HINT);
  });

  it('keeps Dark mode and Low-data mode as switches, never destinations', () => {
    const flat = sections().flatMap((section) => section.rows);
    const modes = flat.filter((row) => row.id === 'darkMode' || row.id === 'lowData');
    expect(modes).toHaveLength(2);
    for (const row of modes) expect(row.kind).toBe('switch');
  });

  it('reflects the current state on the switch rows', () => {
    const flat = sections(true, false).flatMap((section) => section.rows);
    expect(flat.find((row) => row.id === 'darkMode')?.value).toBe(true);
    expect(flat.find((row) => row.id === 'lowData')?.value).toBe(false);

    const both = sections(true, true).flatMap((section) => section.rows);
    expect(both.find((row) => row.id === 'lowData')?.value).toBe(true);
  });

  it('never encodes a switch state in its label — the label is constant', () => {
    // The old drawer printed "Low-data mode: ON" / "Dark mode" vs "Light mode",
    // so the only signal was the words changing under the reader's thumb.
    const off = sections(false, false).flatMap((s) => s.rows);
    const on = sections(true, true).flatMap((s) => s.rows);
    for (const id of ['darkMode', 'lowData'] as const) {
      const a = off.find((row) => row.id === id);
      const b = on.find((row) => row.id === id);
      expect(a?.label).toBe(b?.label);
      expect(a?.accessibilityLabel).toBe(b?.accessibilityLabel);
    }
    expect(off.find((row) => row.id === 'darkMode')?.label).toBe('Dark mode');
    expect(off.find((row) => row.id === 'lowData')?.label).toBe('Low-data mode');
  });

  it('accents exactly two rows, and they are Downloads and Credits', () => {
    // §5.7: a loud Me screen is a Me screen that is selling. Everything else
    // draws a neutral glyph.
    const accented = sections()
      .flatMap((section) => section.rows)
      .filter((row) => row.feature);
    expect(accented.map((row) => row.id)).toEqual(['downloads', 'credits']);
    expect(accented.map((row) => row.feature)).toEqual(['budget', 'ai']);
  });

  it('makes AI uses a door, now that Usage & limits exists', () => {
    // It was a readout for exactly as long as there was nothing behind it.
    const credits = sections()
      .flatMap((section) => section.rows)
      .find((row) => row.id === 'credits');
    expect(credits?.kind).toBe('link');
  });

  it('calls the AI allowance "AI uses" — the same word the badge uses', () => {
    // One unit, one word. "Credits" here and "AI uses" in the badge read as
    // two different currencies for the same thing.
    const credits = sections()
      .flatMap((section) => section.rows)
      .find((row) => row.id === 'credits');
    expect(credits?.label).toBe('AI uses');
  });

  it('says what Downloads costs before the tap', () => {
    const downloads = sections()
      .flatMap((section) => section.rows)
      .find((row) => row.id === 'downloads');
    expect(downloads?.hint).toBe('Saved on this phone only — costs no data');
  });

  it('uses the single shared vocabulary for the moved rows', () => {
    const flat = sections().flatMap((section) => section.rows);
    expect(flat.find((row) => row.id === 'budget')?.label).toBe('Budget');
    // "Downloads", never "Offline" — one feature, one name, one door.
    expect(flat.find((row) => row.id === 'downloads')?.label).toBe('Downloads');
  });

  it('gives every row an accessibility label and an icon', () => {
    for (const row of sections().flatMap((section) => section.rows)) {
      expect(row.accessibilityLabel.length).toBeGreaterThan(0);
      expect(row.icon.length).toBeGreaterThan(0);
    }
  });

  it('lists no row twice', () => {
    const ids = meRowIds(sections());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
