import { checkAndAwardBadges, initialUserStats } from './testHelpers';
import { BADGE_DEFINITIONS } from './gamification';
import type { User, UserStats } from '../types';

/**
 * Badge awarding used to disagree with the dashboard and with itself.
 *
 * Three separate problems fed the same symptom — "some activities capture and
 * some do not":
 *  1. The badge stats were imperative counters that were never reconciled, so a
 *     swallowed increment undercounted forever and a re-submitted test result
 *     incremented twice. The server now recounts from source rows.
 *  2. RISING_STAR read a pseudo-metric ('question_upvotes') that is not a
 *     UserStats key, so it was skipped outright and could never be earned.
 *  3. Mobile ran this award logic on-device and wrote the result back, while web
 *     did not — the same account progressed differently per platform.
 *
 * The reconciliation in (1) can lower a count. These tests pin the property that
 * makes that safe: awarding is monotonic and never takes a badge back.
 */

const user = (stats: Partial<UserStats>, badges: User['badges'] = [], points = 0): User =>
  ({
    id: 'u1',
    name: 'Test',
    points,
    badges,
    stats: { ...initialUserStats, ...stats },
  }) as User;

describe('checkAndAwardBadges — monotonicity when counts are corrected down', () => {
  it('keeps a badge whose stat was corrected below its threshold', () => {
    // The real case: perfectScoreTests was stored as 3 (PERFECTIONIST II) but
    // only 2 perfect scores exist. Reconciliation must not revoke level II.
    const earned = [
      { id: 'PERFECTIONIST', level: 2, name: 'Perfectionist II', description: '', icon: '🏆', dateAwarded: '2026-01-01T00:00:00Z' },
    ] as User['badges'];

    const { updatedUser, awardedBadges } = checkAndAwardBadges(user({ perfectScoreTests: 2 }, earned, 450));

    expect(awardedBadges).toHaveLength(0);
    expect(updatedUser.badges.find(b => b.id === 'PERFECTIONIST')?.level).toBe(2);
    expect(updatedUser.points).toBe(450);
  });

  it('does not re-award or double-count points when run repeatedly', () => {
    let current = user({ testsCompleted: 5 });
    const first = checkAndAwardBadges(current);
    expect(first.awardedBadges).toHaveLength(1);
    const pointsAfterFirst = first.updatedUser.points;

    // Re-running against unchanged stats is what a re-submitted result did.
    const second = checkAndAwardBadges(first.updatedUser);
    expect(second.awardedBadges).toHaveLength(0);
    expect(second.updatedUser.points).toBe(pointsAfterFirst);
  });

  it('still awards the next level once the corrected count genuinely reaches it', () => {
    const earned = [
      { id: 'TEST_TAKER', level: 1, name: 'Test Taker I', description: '', icon: '📝', dateAwarded: '2026-01-01T00:00:00Z' },
    ] as User['badges'];
    const { awardedBadges } = checkAndAwardBadges(user({ testsCompleted: 15 }, earned));
    expect(awardedBadges.map(b => `${b.id} L${b.level}`)).toEqual(['TEST_TAKER L2']);
  });

  it('awards only one level per run, so a big correction cannot skip levels', () => {
    const { awardedBadges, updatedUser } = checkAndAwardBadges(user({ testsCompleted: 500 }));
    expect(awardedBadges).toHaveLength(1);
    expect(updatedUser.badges.find(b => b.id === 'TEST_TAKER')?.level).toBe(1);
  });
});

describe('RISING_STAR — previously unearnable', () => {
  it('reads a real UserStats key rather than a pseudo-metric', () => {
    // The skip in checkAndAwardBadges keyed off this exact string.
    expect(BADGE_DEFINITIONS.RISING_STAR.metric).not.toBe('question_upvotes');
    expect(Object.keys(initialUserStats)).toContain(BADGE_DEFINITIONS.RISING_STAR.metric);
  });

  it('is awarded once a question reaches the upvote threshold', () => {
    const { awardedBadges } = checkAndAwardBadges(user({ questionUpvotesMax: 10 }));
    expect(awardedBadges.map(b => b.id)).toContain('RISING_STAR');
  });

  it('is not awarded below the threshold', () => {
    const { awardedBadges } = checkAndAwardBadges(user({ questionUpvotesMax: 9 }));
    expect(awardedBadges.map(b => b.id)).not.toContain('RISING_STAR');
  });
});

describe('every badge metric is backed by a real stat', () => {
  it('has no definition pointing at a key the award logic cannot read', () => {
    // A metric absent from UserStats silently reads `undefined` and the badge
    // becomes permanently unearnable — exactly how RISING_STAR broke.
    const statKeys = Object.keys(initialUserStats);
    const orphaned = Object.values(BADGE_DEFINITIONS)
      .filter(def => !statKeys.includes(def.metric))
      .map(def => `${def.id} -> ${def.metric}`);
    expect(orphaned).toEqual([]);
  });
});
