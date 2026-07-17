import { defaultPhotoNoteTitle } from './photoNoteTitle';

describe('defaultPhotoNoteTitle', () => {
  it('formats as Photos · MMM D, YYYY', () => {
    // Local calendar date avoids UTC timezone skew in CI.
    expect(defaultPhotoNoteTitle(new Date(2026, 6, 15))).toBe('Photos · Jul 15, 2026');
  });

  it('defaults to current date when omitted', () => {
    expect(defaultPhotoNoteTitle()).toMatch(/^Photos · /);
  });
});
