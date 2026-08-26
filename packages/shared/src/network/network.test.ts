/**
 * Phase 3 shared display helpers. These exist so web and mobile cannot
 * describe the same row two different ways — so the tests pin the judgement
 * calls, not just the string formatting.
 */
import {
  communityMembershipAction,
  communityPageGroupVisibilities,
  describeFeedItem,
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
