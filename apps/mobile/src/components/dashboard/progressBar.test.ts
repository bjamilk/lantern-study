import { clampProgressPercent, goalCountLabel, isGoalOvershot } from './progressBar';
import { newLectureNoteTitle } from '../../screens/study/recorderDoor';

describe('clampProgressPercent', () => {
  it('caps the 1200% bar at a bar that can actually be drawn', () => {
    expect(clampProgressPercent(1200)).toBe(100);
  });

  it('never goes negative', () => {
    expect(clampProgressPercent(-40)).toBe(0);
  });

  it('rounds to whole percents', () => {
    expect(clampProgressPercent(33.4)).toBe(33);
    expect(clampProgressPercent(33.6)).toBe(34);
  });

  it('treats a missing or non-finite figure as empty rather than NaN%', () => {
    expect(clampProgressPercent(undefined)).toBe(0);
    expect(clampProgressPercent(null)).toBe(0);
    expect(clampProgressPercent(Number.NaN)).toBe(0);
    expect(clampProgressPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('goalCountLabel', () => {
  it('says the overshoot the bar cannot draw', () => {
    expect(goalCountLabel(12, 1)).toBe('12 of 1');
  });

  it('reads the same under the goal', () => {
    expect(goalCountLabel(0, 20)).toBe('0 of 20');
  });
});

describe('isGoalOvershot', () => {
  it('is true only past the goal', () => {
    expect(isGoalOvershot(12, 1)).toBe(true);
    expect(isGoalOvershot(1, 1)).toBe(false);
    expect(isGoalOvershot(5, 0)).toBe(false);
  });
});

describe('newLectureNoteTitle', () => {
  it('names the day so a lecture note is findable a week later', () => {
    expect(newLectureNoteTitle(new Date(2026, 8, 6))).toBe('Lecture — 6 Sep');
    expect(newLectureNoteTitle(new Date(2026, 0, 31))).toBe('Lecture — 31 Jan');
  });
});
