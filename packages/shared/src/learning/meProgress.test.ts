import {
  averageSecondsPerQuestion,
  buildAchievementRows,
  buildAchievementRowsFromSummaries,
  buildHierarchicalGroupOptions,
  getGroupName,
  MAX_LEVEL_TEXT,
  recentTestsPageCount,
  RECENT_TESTS_PAGE_SIZE,
} from './meProgress';
import { BADGE_DEFINITIONS } from '../utils/gamification';

describe('getGroupName', () => {
  const groups = [{ id: 'g1', name: 'Pharmacology' }];

  it('prefers the live group', () => {
    expect(getGroupName('g1', groups, [], 'Stale name')).toBe('Pharmacology');
  });

  it('falls back to the name stored on the result when the group is gone', () => {
    expect(getGroupName('deleted', groups, [], 'Anatomy MCQ')).toBe('Anatomy MCQ');
  });

  it('falls back to an offline bundle before giving up', () => {
    const bundles = [{ displayName: 'Offline Anatomy', config: { groupId: 'x' } }];
    expect(getGroupName('x', groups, bundles)).toBe('Offline Anatomy');
    expect(getGroupName('unknown', groups, bundles)).toBe('Unknown Exam');
  });
});

describe('buildHierarchicalGroupOptions', () => {
  const groups = [
    { id: 'root', name: 'Year 2' },
    { id: 'childB', name: 'Bravo', parentId: 'root' },
    { id: 'childA', name: 'Alpha', parentId: 'root' },
    { id: 'orphan', name: 'Orphan', parentId: 'missing-parent' },
  ];

  it('lists only groups that have data, in tree order, with depth', () => {
    const options = buildHierarchicalGroupOptions(
      groups,
      new Set(['root', 'childA', 'orphan'])
    );
    expect(options).toEqual([
      { id: 'orphan', name: 'Orphan', level: 0 },
      { id: 'root', name: 'Year 2', level: 0 },
      { id: 'childA', name: 'Alpha', level: 1 },
    ]);
  });

  it('walks through an empty parent to reach a child that has data', () => {
    const options = buildHierarchicalGroupOptions(groups, new Set(['childB']));
    expect(options.map((o) => o.id)).toEqual(['childB']);
    expect(options[0].level).toBe(1);
  });
});

describe('buildAchievementRows', () => {
  it('reads progress between the current level and the next threshold', () => {
    const definition = BADGE_DEFINITIONS.GROUP_FOUNDER;
    const [firstLevel, secondLevel] = definition.levels;
    const rows = buildAchievementRows({
      badges: [{ id: 'GROUP_FOUNDER', level: firstLevel.level, name: 'Group Founder I' }],
      stats: { groupsCreated: firstLevel.threshold + 1 },
    });
    const founder = rows.find((r) => r.id === 'GROUP_FOUNDER');
    expect(founder?.name).toBe('Group Founder I');
    expect(founder?.level).toBe(firstLevel.level);
    expect(founder?.progressText).toBe(`${firstLevel.threshold + 1} / ${secondLevel.threshold}`);
    expect(founder?.progressPercent).toBeCloseTo(
      ((firstLevel.threshold + 1 - firstLevel.threshold) /
        (secondLevel.threshold - firstLevel.threshold)) *
        100
    );
  });

  it('keeps only the highest level when the same badge appears twice', () => {
    const rows = buildAchievementRows({
      badges: [
        { id: 'GROUP_FOUNDER', level: 1 },
        { id: 'GROUP_FOUNDER', level: 3 },
      ],
      stats: {},
    });
    expect(rows.find((r) => r.id === 'GROUP_FOUNDER')?.level).toBe(3);
  });

  it('reports a maxed badge as 100% rather than a bar that can never fill', () => {
    const definition = BADGE_DEFINITIONS.GROUP_FOUNDER;
    const top = definition.levels[definition.levels.length - 1];
    const rows = buildAchievementRows({
      badges: [{ id: 'GROUP_FOUNDER', level: top.level }],
      stats: { groupsCreated: top.threshold },
    });
    const founder = rows.find((r) => r.id === 'GROUP_FOUNDER');
    expect(founder?.maxed).toBe(true);
    expect(founder?.progressPercent).toBe(100);
    expect(founder?.progressText).toBe(MAX_LEVEL_TEXT);
  });

  it('gives the upvote badge a goal line instead of a progress bar', () => {
    const rows = buildAchievementRows({ badges: [], stats: {} });
    const rising = rows.find((r) => r.id === 'RISING_STAR');
    expect(rising?.goalOnly).toBe(true);
    expect(rising?.goalText).toMatch(/upvotes on one question/);
    expect(rising?.progressPercent).toBe(0);
  });

  it('sorts earned badges first and keeps definition order inside each half', () => {
    const ids = Object.keys(BADGE_DEFINITIONS);
    const earnedId = ids[2];
    const rows = buildAchievementRows({ badges: [{ id: earnedId, level: 1 }], stats: {} });
    expect(rows[0].id).toBe(earnedId);
    expect(rows.slice(1).map((r) => r.id)).toEqual(ids.filter((id) => id !== earnedId));
  });

  it('never returns a percent outside 0–100, even with stats below the level floor', () => {
    const rows = buildAchievementRows({
      badges: [{ id: 'GROUP_FOUNDER', level: 2 }],
      stats: { groupsCreated: 0 },
    });
    const founder = rows.find((r) => r.id === 'GROUP_FOUNDER');
    expect(founder?.progressPercent).toBe(0);
  });
});

describe('buildAchievementRowsFromSummaries', () => {
  /**
   * The phone's stats store has already thrown the raw stats away, so it
   * builds rows from badge summaries. These two paths are the same numbers or
   * the phone and web disagree about how far along a student is.
   */
  it('matches buildAchievementRows for the same student', () => {
    const stats = {
      groupsCreated: 4,
      questionsCreated: 30,
      testsCompleted: 12,
      highScoreTests: 2,
      perfectScoreTests: 0,
      gamesWon: 1,
      listingsCreated: 0,
      listingsSold: 0,
      fiveStarReviews: 0,
      offersMade: 0,
    } as Record<string, number>;
    const badges = [
      { id: 'GROUP_FOUNDER', level: 2 },
      { id: 'QUESTION_ASKER', level: 2 },
    ];
    const canonical = buildAchievementRows({ badges, stats });

    // Exactly what the phone's stats store holds per badge.
    const summaries = canonical.map((row) => {
      const definition = BADGE_DEFINITIONS[row.id as keyof typeof BADGE_DEFINITIONS];
      const metric = definition.metric;
      return {
        id: row.id,
        name: row.name,
        level: row.level,
        maxLevel: row.maxLevel,
        currentValue: metric === 'question_upvotes' ? 0 : stats[metric] || 0,
        targetValue: definition.levels.find((l) => l.level === row.level + 1)?.threshold ?? 0,
      };
    });

    expect(buildAchievementRowsFromSummaries(summaries)).toEqual(canonical);
  });
});

describe('recent test helpers', () => {
  it('averages only the answers that were timed', () => {
    expect(
      averageSecondsPerQuestion({ a: { timeSpentSeconds: 10 }, b: { timeSpentSeconds: 20 }, c: {} })
    ).toBe(15);
  });

  it('returns null rather than 0 when nothing was timed', () => {
    expect(averageSecondsPerQuestion({ a: {}, b: undefined })).toBeNull();
    expect(averageSecondsPerQuestion(undefined)).toBeNull();
  });

  it('counts pages, and never fewer than one', () => {
    expect(recentTestsPageCount(0)).toBe(1);
    expect(recentTestsPageCount(RECENT_TESTS_PAGE_SIZE)).toBe(1);
    expect(recentTestsPageCount(RECENT_TESTS_PAGE_SIZE + 1)).toBe(2);
  });
});
