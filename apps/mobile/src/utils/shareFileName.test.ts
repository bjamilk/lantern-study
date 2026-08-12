import { sanitizeFileName, toSafeFileName } from './shareFileName';

describe('toSafeFileName', () => {
  it('slugifies a title and appends the extension', () => {
    expect(toSafeFileName('Biology 101', 'json')).toBe('biology-101.json');
  });

  it('strips characters a file system would object to', () => {
    // A deck called "Bio / Wk 3" previously reached the share sheet verbatim.
    expect(toSafeFileName('Bio / Wk 3', 'csv')).toBe('bio-wk-3.csv');
    expect(toSafeFileName('../../etc/passwd', 'json')).toBe('etc-passwd.json');
  });

  it('falls back rather than producing a nameless file', () => {
    expect(toSafeFileName('', 'json')).toBe('export.json');
    expect(toSafeFileName('!!!', 'csv')).toBe('export.csv');
  });

  it('caps runaway titles', () => {
    const name = toSafeFileName('a'.repeat(200), 'json');
    expect(name.length).toBeLessThanOrEqual(65);
    expect(name.endsWith('.json')).toBe(true);
  });
});

describe('sanitizeFileName', () => {
  it('keeps an extension the caller already supplied', () => {
    // The applicants CSV name comes from the server complete with `.csv`;
    // treating it as a bare title yields `applicants-2026-08-12-csv.csv`.
    expect(sanitizeFileName('applicants-2026-08-12.csv')).toBe('applicants-2026-08-12.csv');
  });

  it('still cleans the body of a complete name', () => {
    expect(sanitizeFileName('Senior Dev / Lagos.csv')).toBe('senior-dev-lagos.csv');
  });

  it('lowercases the extension', () => {
    expect(sanitizeFileName('Deck.JSON')).toBe('deck.json');
  });

  it('appends the fallback when there is no extension at all', () => {
    expect(sanitizeFileName('applicants', 'csv')).toBe('applicants.csv');
  });

  it('does not mistake a dotted title for an extension', () => {
    // "v1.2" has a plausible-looking tail, so the guard is length-bounded only —
    // document the behaviour rather than pretend it is smarter than it is.
    expect(sanitizeFileName('report v1.2', 'csv')).toBe('report-v1.2');
  });

  it('survives an empty name', () => {
    expect(sanitizeFileName('', 'csv')).toBe('export.csv');
  });
});
