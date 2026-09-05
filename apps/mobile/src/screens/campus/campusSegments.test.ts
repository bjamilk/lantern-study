import {
  CAMPUS_SEGMENT_LABELS,
  resolveCampusSegment,
  resolveCampusSegments,
  shouldShowSegmentBar,
  type CampusSegment,
} from './campusSegments';

const segments = (canSeeCommunities: boolean, marketplaceAccess: boolean | null): CampusSegment[] =>
  resolveCampusSegments({ canSeeCommunities, marketplaceAccess });

describe('resolveCampusSegments', () => {
  it('draws Communities · Shop · Jobs in that order when everything is open', () => {
    expect(segments(true, true)).toEqual(['communities', 'shop', 'jobs']);
  });

  it('hides Communities when the Discover gate is closed', () => {
    expect(segments(false, true)).toEqual(['shop', 'jobs']);
  });

  it('hides BOTH Shop and Jobs on a definite pilot refusal — one allowlist covers both', () => {
    expect(segments(true, false)).toEqual(['communities']);
  });

  it('keeps Shop and Jobs while the pilot probe has not answered', () => {
    // A failed or in-flight probe must never quietly delete a destination.
    expect(segments(true, null)).toEqual(['communities', 'shop', 'jobs']);
    expect(segments(false, null)).toEqual(['shop', 'jobs']);
  });

  it('can legitimately be empty — Campus then owes an honest empty state', () => {
    expect(segments(false, false)).toEqual([]);
  });

  it('names every segment it can return', () => {
    for (const segment of segments(true, true)) {
      expect(CAMPUS_SEGMENT_LABELS[segment]).toBeTruthy();
    }
    expect(CAMPUS_SEGMENT_LABELS.shop).toBe('Shop');
    expect(CAMPUS_SEGMENT_LABELS.jobs).toBe('Jobs');
    expect(CAMPUS_SEGMENT_LABELS.communities).toBe('Communities');
  });
});

describe('resolveCampusSegment', () => {
  const all: CampusSegment[] = ['communities', 'shop', 'jobs'];

  it('honours a requested segment that is available', () => {
    expect(resolveCampusSegment('jobs', all)).toBe('jobs');
  });

  it('falls back to the first available segment when the request is closed', () => {
    // A legacy navigate('MarketTab') on an account off the pilot must land
    // somewhere real rather than on a segment with nothing behind it.
    expect(resolveCampusSegment('shop', ['communities'])).toBe('communities');
  });

  it('falls back to the first available segment when nothing was requested', () => {
    expect(resolveCampusSegment(undefined, all)).toBe('communities');
    expect(resolveCampusSegment(null, ['shop', 'jobs'])).toBe('shop');
  });

  it('returns null when Campus has nothing to show', () => {
    expect(resolveCampusSegment('shop', [])).toBeNull();
    expect(resolveCampusSegment(undefined, [])).toBeNull();
  });
});

describe('shouldShowSegmentBar', () => {
  it('hides the bar when there is no choice to make', () => {
    expect(shouldShowSegmentBar([])).toBe(false);
    expect(shouldShowSegmentBar(['shop'])).toBe(false);
  });

  it('shows the bar as soon as there are two segments', () => {
    expect(shouldShowSegmentBar(['shop', 'jobs'])).toBe(true);
  });
});
