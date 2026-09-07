import { describe, expect, it } from 'vitest';
import { newLectureNoteTitle } from './recorderDoor';

/**
 * The same two assertions the mobile helper carries
 * (`apps/mobile/src/components/dashboard/progressBar.test.ts`), so the two
 * platforms cannot drift apart on the name a student sees in their Library.
 */
describe('newLectureNoteTitle', () => {
  it('names a lecture note for the day it was recorded', () => {
    expect(newLectureNoteTitle(new Date(2026, 8, 6))).toBe('Lecture — 6 Sep');
    expect(newLectureNoteTitle(new Date(2026, 0, 31))).toBe('Lecture — 31 Jan');
  });
});
