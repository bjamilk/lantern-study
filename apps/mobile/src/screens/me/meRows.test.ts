import { readFileSync } from 'fs';
import { join } from 'path';
import { buildMeSections, meProfileBlockOrder, meRowIds } from './meRows';
import { LOW_DATA_MODE_HINT } from '@lantern/shared/settings';

const sections = (darkMode = false, lowDataMode = false) =>
  buildMeSections({ darkMode, lowDataMode });

describe('the Profile menu', () => {
  it('carries the shared rows in order', () => {
    expect(meRowIds(sections())).toEqual([
      'academic',
      'joinClass',
      'budget',
      'downloads',
      'credits',
      'teach',
      'invite',
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

  it('describes Low-data mode with the one shared sentence', () => {
    const flat = sections().flatMap((section) => section.rows);
    expect(flat.find((row) => row.id === 'lowData')?.hint).toBe(LOW_DATA_MODE_HINT);
  });

  it('keeps Dark mode and Low-data mode as switches', () => {
    const flat = sections().flatMap((section) => section.rows);
    const modes = flat.filter((row) => row.id === 'darkMode' || row.id === 'lowData');
    expect(modes).toHaveLength(2);
    for (const row of modes) expect(row.kind).toBe('switch');
  });

  it('accents exactly Downloads and AI uses', () => {
    const accented = sections()
      .flatMap((section) => section.rows)
      .filter((row) => row.feature);
    expect(accented.map((row) => row.id)).toEqual(['downloads', 'credits']);
  });
});

describe('the Profile screen order', () => {
  it('puts the identity card above every row section', () => {
    expect(meProfileBlockOrder(sections())).toEqual([
      'identity',
      'account',
      'mine',
      'preferences',
      'app',
      'session',
    ]);
  });

  it('keeps Progress off the Profile screen', () => {
    const source = readFileSync(join(__dirname, 'MeScreen.tsx'), 'utf8');
    expect(source).not.toContain('<MeProgress');
    expect(source).toContain('<MeWorkspaceBar');
    expect(source).toContain("{sections.map(");
  });

  it('keeps the account doors on Profile', () => {
    for (const id of ['settings', 'downloads', 'credits', 'teach', 'invite', 'darkMode', 'lowData', 'logout'] as const) {
      expect(meRowIds(sections())).toContain(id);
    }
  });
});
