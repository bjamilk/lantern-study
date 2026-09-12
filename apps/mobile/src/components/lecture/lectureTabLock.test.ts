import { isLectureTabLocked } from './lectureTabLock';

describe('isLectureTabLocked', () => {
  it('locks every tab but My Notes while a take is running', () => {
    expect(isLectureTabLocked('notes', true)).toBe(false);
    expect(isLectureTabLocked('enhanced', true)).toBe(true);
    expect(isLectureTabLocked('transcript', true)).toBe(true);
    expect(isLectureTabLocked('audio', true)).toBe(true);
  });

  it('locks nothing when the recorder is idle', () => {
    expect(isLectureTabLocked('notes', false)).toBe(false);
    expect(isLectureTabLocked('enhanced', false)).toBe(false);
    expect(isLectureTabLocked('transcript', false)).toBe(false);
    expect(isLectureTabLocked('audio', false)).toBe(false);
  });
});
