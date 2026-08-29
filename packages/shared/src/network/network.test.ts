/**
 * Phase 3 shared display helpers. These exist so web and mobile cannot
 * describe the same row two different ways — so the tests pin the judgement
 * calls, not just the string formatting.
 */
import {
  canAccessDiscoverHub,
  communityMembershipAction,
  communityPageGroupVisibilities,
  describeFeedItem,
  DISCOVER_COMING_SOON_BODY,
  DISCOVER_COMING_SOON_TITLE,
  examCountdownLabel,
  learningConnectionLabel,
  masteryBand,
  memberCountLabel,
  presenceLabel,
  resolveGroupDiscovery,
  shouldShowTrustChip,
  trustLabel,
  type FeedItem,
} from './index';

function feedItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: 1,
    verb: 'published_pack',
    objectType: 'listing',
    objectId: 'listing-1',
    audienceType: 'followers',
    audienceId: null,
    courseId: null,
    payload: {},
    createdAt: '2026-08-23T10:00:00Z',
    actor: { id: 'u1', name: 'Ada', avatarUrl: null, programme: 'MBBS' },
    ...overrides,
  };
}

describe('describeFeedItem', () => {
  it('names the actor and the object', () => {
    expect(describeFeedItem(feedItem({ payload: { title: 'Gas Exchange' } }))).toBe(
      'Ada published a study pack — Gas Exchange'
    );
  });

  it('degrades gracefully when the payload has no title', () => {
    expect(describeFeedItem(feedItem({}))).toBe('Ada published a study pack');
  });

  it('falls back to "Someone" rather than rendering a blank name', () => {
    expect(describeFeedItem(feedItem({ actor: null }))).toBe('Someone published a study pack');
  });

  it('returns null for an unknown verb so callers skip the row', () => {
    expect(describeFeedItem(feedItem({ verb: 'invented_verb' as never }))).toBeNull();
  });

  it('ignores a non-string title instead of printing [object Object]', () => {
    expect(describeFeedItem(feedItem({ payload: { title: { evil: true } } }))).toBe(
      'Ada published a study pack'
    );
  });
});

describe('canAccessDiscoverHub', () => {
  it('is admin-only until campus rooms ship', () => {
    expect(canAccessDiscoverHub(true)).toBe(true);
    expect(canAccessDiscoverHub(false)).toBe(false);
  });

  it('shares compact coming-soon copy for web and mobile', () => {
    expect(DISCOVER_COMING_SOON_TITLE).toBe('Discover');
    expect(DISCOVER_COMING_SOON_BODY).toBe('Coming soon!');
  });
});

describe('presenceLabel', () => {
  it('names the top topic when there is one', () => {
    expect(
      presenceLabel({ total: 23, byContext: {}, topics: [{ topic: 'cardiology', count: 9 }], sharing: true })
    ).toBe('23 people studying cardiology right now');
  });

  it('singularises one person', () => {
    expect(presenceLabel({ total: 1, byContext: {}, topics: [], sharing: true })).toBe(
      '1 person studying right now'
    );
  });

  it('returns null at zero rather than an honest but dispiriting "0 studying"', () => {
    expect(presenceLabel({ total: 0, byContext: {}, topics: [], sharing: true })).toBeNull();
    expect(presenceLabel(null)).toBeNull();
  });
});

describe('trust chips', () => {
  it('labels the levels it knows', () => {
    expect(trustLabel('verified')).toBe('Verified');
    expect(trustLabel('rising')).toBe('Rising');
    expect(trustLabel('nonsense')).toBeNull();
    expect(trustLabel(null)).toBeNull();
  });

  it('shows no chip for a brand-new creator', () => {
    // Labelling every newcomer on every card reads as a warning and punishes
    // exactly the people we want publishing.
    expect(shouldShowTrustChip('new')).toBe(false);
    expect(shouldShowTrustChip(null)).toBe(false);
    expect(shouldShowTrustChip('rising')).toBe(true);
    expect(shouldShowTrustChip('verified')).toBe(true);
  });
});

describe('masteryBand', () => {
  it('bands a known score', () => {
    expect(masteryBand(20)).toBe('weak');
    expect(masteryBand(59)).toBe('weak');
    expect(masteryBand(60)).toBe('developing');
    expect(masteryBand(79)).toBe('developing');
    expect(masteryBand(80)).toBe('strong');
  });

  it('treats an unknown score as unknown, NOT as weak', () => {
    // Telling a student they are weak at something we never tested them on is
    // the fastest way to lose their trust in everything else we say.
    expect(masteryBand(null)).toBe('unknown');
    expect(masteryBand(undefined)).toBe('unknown');
    expect(masteryBand(Number.NaN)).toBe('unknown');
  });
});

describe('communityMembershipAction', () => {
  it('joins when the viewer is not a member', () => {
    expect(communityMembershipAction(false, 'auto')).toBe('Join');
    expect(communityMembershipAction(false, 'joined')).toBe('Join');
  });

  it('hides an AUTO room instead of pretending Leave will stick', () => {
    expect(communityMembershipAction(true, 'auto')).toBe('Hide');
  });

  it('leaves an explicitly joined room', () => {
    expect(communityMembershipAction(true, 'joined')).toBe('Leave');
  });
});

describe('communityPageGroupVisibilities', () => {
  it('hides community-scoped groups from non-members', () => {
    expect(communityPageGroupVisibilities(false)).toEqual(['public']);
  });

  it('shows public and community-scoped groups to members', () => {
    expect(communityPageGroupVisibilities(true)).toEqual(['public', 'community']);
  });
});

describe('resolveGroupDiscovery', () => {
  it('defaults to private', () => {
    expect(resolveGroupDiscovery({})).toEqual({ visibility: 'private', communityId: null });
  });

  it('keeps a public listing', () => {
    expect(resolveGroupDiscovery({ visibility: 'public' })).toEqual({
      visibility: 'public',
      communityId: null,
    });
  });

  it('refuses community visibility without a community id', () => {
    expect(resolveGroupDiscovery({ visibility: 'community' })).toEqual({
      visibility: 'private',
      communityId: null,
    });
  });

  it('keeps community visibility when a real id is present', () => {
    const communityId = '33333333-3333-4333-8333-333333333333';
    expect(resolveGroupDiscovery({ visibility: 'community', communityId })).toEqual({
      visibility: 'community',
      communityId,
    });
  });
});

describe('counts and countdowns', () => {
  it('pluralises members', () => {
    expect(memberCountLabel(1)).toBe('1 member');
    expect(memberCountLabel(1204)).toBe('1,204 members');
    expect(memberCountLabel(-5)).toBe('0 members');
  });

  it('describes the exam countdown', () => {
    expect(examCountdownLabel(0)).toBe('Exam today');
    expect(examCountdownLabel(1)).toBe('1 day to your exam');
    expect(examCountdownLabel(16)).toBe('16 days to your exam');
  });

  it('stays silent when nobody was helped', () => {
    expect(learningConnectionLabel({ helpedThisWeek: 0, helpedByThisWeek: 3, helpedAllTime: 9 })).toBeNull();
    expect(learningConnectionLabel({ helpedThisWeek: 1, helpedByThisWeek: 0, helpedAllTime: 1 })).toBe(
      'You helped 1 person learn this week'
    );
    expect(learningConnectionLabel({ helpedThisWeek: 4, helpedByThisWeek: 0, helpedAllTime: 9 })).toBe(
      'You helped 4 people learn this week'
    );
  });
});

// ---------------------------------------------------------------------------
// Course readiness rollup
// ---------------------------------------------------------------------------
import { computeCourseReadiness } from './index';

describe('computeCourseReadiness', () => {
  const outline = [
    { id: 't1', title: 'Cell Structure', position: 10 },
    { id: 't2', title: 'Enzymes', position: 20 },
    { id: 't3', title: 'Genetics', position: 30 },
  ];

  it('bridges outline titles to mastery tags case/whitespace-insensitively', () => {
    const r = computeCourseReadiness({
      courseId: 'c1',
      outline,
      mastery: [
        { topic: '  enzymes ', masteryScore: 90, attempts: 5, cardsTotal: 10, cardsDue: 1 },
        { topic: 'CELL STRUCTURE', masteryScore: 40, attempts: 4, cardsTotal: 0, cardsDue: 0 },
      ],
    });
    expect(r.outlineTotal).toBe(3);
    expect(r.coveredCount).toBe(2);
    expect(r.coveragePct).toBe(67);
    expect(r.topics.find(t => t.topicId === 't2')).toMatchObject({
      covered: true,
      masteryScore: 90,
      band: 'strong',
    });
    expect(r.topics.find(t => t.topicId === 't3')).toMatchObject({
      covered: false,
      masteryScore: null,
      band: 'unknown',
    });
  });

  it('blends coverage into the readiness score and never fabricates one', () => {
    const withEvidence = computeCourseReadiness({
      courseId: 'c1',
      outline,
      mastery: [{ topic: 'Enzymes', masteryScore: 90, attempts: 5, cardsTotal: 0, cardsDue: 0 }],
    });
    // avg 90, coverage 33% -> 0.6*90 + 0.4*33 = 67.2 -> 67; strong-on-one-topic
    // must NOT read as exam-ready.
    expect(withEvidence.averageMastery).toBe(90);
    expect(withEvidence.readinessScore).toBe(67);

    const coverageOnly = computeCourseReadiness({
      courseId: 'c1',
      outline,
      // A mastery row can exist with a NULL score (thin evidence).
      mastery: [{ topic: 'Enzymes', masteryScore: null, attempts: 1, cardsTotal: 2, cardsDue: 0 }],
    });
    expect(coverageOnly.coveredCount).toBe(1);
    expect(coverageOnly.averageMastery).toBeNull();
    expect(coverageOnly.readinessScore).toBeNull();

    const noOutline = computeCourseReadiness({
      courseId: 'c1',
      outline: [],
      mastery: [{ topic: 'Anything', masteryScore: 72, attempts: 4, cardsTotal: 0, cardsDue: 0 }],
    });
    expect(noOutline.coveragePct).toBeNull();
    expect(noOutline.readinessScore).toBe(72);
  });

  it('picks the first untouched outline topic as the day-one pointer, then the weakest', () => {
    const fresh = computeCourseReadiness({ courseId: 'c1', outline, mastery: [] });
    expect(fresh.nextTopic).toEqual({ topicId: 't1', title: 'Cell Structure' });

    const allCovered = computeCourseReadiness({
      courseId: 'c1',
      outline,
      mastery: [
        { topic: 'Cell Structure', masteryScore: 80, attempts: 4, cardsTotal: 0, cardsDue: 0 },
        { topic: 'Enzymes', masteryScore: 45, attempts: 4, cardsTotal: 0, cardsDue: 0 },
        { topic: 'Genetics', masteryScore: 70, attempts: 4, cardsTotal: 0, cardsDue: 0 },
      ],
    });
    expect(allCovered.nextTopic).toEqual({ topicId: 't2', title: 'Enzymes' });
  });

  it('keeps out-of-outline evidence, weakest first, after the outline', () => {
    const r = computeCourseReadiness({
      courseId: 'c1',
      outline,
      mastery: [
        { topic: 'Past questions 2019', masteryScore: 55, attempts: 6, cardsTotal: 0, cardsDue: 0 },
        { topic: 'Hormones', masteryScore: 30, attempts: 3, cardsTotal: 0, cardsDue: 0 },
      ],
    });
    const outside = r.topics.filter(t => !t.inOutline);
    expect(outside.map(t => t.title)).toEqual(['Hormones', 'Past questions 2019']);
    expect(r.topics.slice(0, 3).every(t => t.inOutline)).toBe(true);
    expect(r.weakestTopics[0]).toBe('Hormones');
  });

  it('collapses duplicate tags onto the row with more evidence', () => {
    const r = computeCourseReadiness({
      courseId: 'c1',
      outline: [{ id: 't1', title: 'Enzymes', position: 10 }],
      mastery: [
        { topic: 'enzymes', masteryScore: 20, attempts: 1, cardsTotal: 0, cardsDue: 0 },
        { topic: 'Enzymes ', masteryScore: 85, attempts: 9, cardsTotal: 12, cardsDue: 2 },
      ],
    });
    expect(r.topics).toHaveLength(1);
    expect(r.topics[0]?.masteryScore).toBe(85);
  });
});
