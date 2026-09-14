import { buildMeSections, meProfileBlockOrder, meRowIds } from './meRows';

const sections = (includeAdmin = false) => buildMeSections({ includeAdmin });

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
      'settings',
      'logout',
    ]);
  });

  it('puts Admin console last-but-one when the account is an admin', () => {
    expect(meRowIds(sections(true))).toEqual([
      'academic',
      'joinClass',
      'budget',
      'downloads',
      'credits',
      'teach',
      'invite',
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

  it('leaves the two mode switches to Settings, so neither is duplicated here', () => {
    const flat = sections().flatMap((section) => section.rows);
    expect(flat.some((row) => row.kind === 'switch')).toBe(false);
    expect(flat.map((row) => row.label)).not.toContain('Dark mode');
    expect(flat.map((row) => row.label)).not.toContain('Low-data mode');
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
      'app',
      'session',
    ]);
  });
});
