import { buildMeSections, meRowIds } from './meRows';

const sections = (darkMode = false, lowDataMode = false) =>
  buildMeSections({ darkMode, lowDataMode });

describe('the Me tab', () => {
  it('carries exactly the rows the shell moved onto it, in order', () => {
    expect(meRowIds(sections())).toEqual([
      'academic',
      'budget',
      'downloads',
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
