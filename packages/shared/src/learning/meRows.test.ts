import { LOW_DATA_MODE_HINT } from '../settings/userSettings';
import { buildMeSections, meProfileBlockOrder, meRowIds } from './meRows';

const sections = (darkMode = false, lowDataMode = false, includeAdmin = false) =>
  buildMeSections({ darkMode, lowDataMode, includeAdmin });

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

  it('puts Admin console last-but-one when the account is an admin', () => {
    expect(meRowIds(sections(false, false, true))).toEqual([
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
      'admin',
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
    expect(accented.map((row) => row.feature)).toEqual(['budget', 'ai']);
  });

  it('calls the AI allowance AI uses', () => {
    const credits = sections()
      .flatMap((section) => section.rows)
      .find((row) => row.id === 'credits');
    expect(credits?.label).toBe('AI uses');
    expect(credits?.kind).toBe('link');
  });
});

describe('the Profile section order', () => {
  it('puts the identity card above every row section, and keeps Progress off this page', () => {
    expect(meProfileBlockOrder(sections())).toEqual([
      'identity',
      'account',
      'mine',
      'preferences',
      'app',
      'session',
    ]);
  });
});
