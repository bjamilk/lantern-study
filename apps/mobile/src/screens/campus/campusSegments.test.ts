import {
  CAMPUS_SEGMENT_LABELS,
  campusAppBarTitleOverride,
  resolveCampusSegment,
  resolveCampusSegments,
  shouldPublishCampusSegment,
  shouldShowSegmentBar,
  type CampusSegment,
} from './campusSegments';

const segments = (canSeeCommunities: boolean): CampusSegment[] =>
  resolveCampusSegments({ canSeeCommunities });

describe('resolveCampusSegments', () => {
  it('draws Communities · Shop · Jobs in that order for a student past the profile gate', () => {
    expect(segments(true)).toEqual(['communities', 'shop', 'jobs']);
  });

  it('hides Communities when the academic-profile gate is closed', () => {
    expect(segments(false)).toEqual(['shop', 'jobs']);
  });

  it('shows Shop and Jobs to EVERY account — no pilot allowlist gates them', () => {
    // Regression guard for V1 (2026-09-15): the founder-only allowlist that
    // could delete both segments is gone, and no probe may bring it back.
    expect(segments(false)).toContain('shop');
    expect(segments(false)).toContain('jobs');
    expect(segments(true)).toContain('shop');
    expect(segments(true)).toContain('jobs');
  });

  it('is never empty, so Campus always has somewhere to land', () => {
    expect(segments(false).length).toBeGreaterThan(0);
    expect(segments(true).length).toBeGreaterThan(0);
  });

  it('names every segment it can return', () => {
    for (const segment of segments(true)) {
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
    // A legacy navigate('MarketTab') must land somewhere real rather than on
    // a segment with nothing behind it.
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

describe('shouldPublishCampusSegment', () => {
  it('publishes on first mount, when the params carry no request', () => {
    expect(shouldPublishCampusSegment({ requested: undefined, picked: null, active: 'communities' })).toBe(
      true
    );
  });

  it('is quiet when the params already say what is showing', () => {
    expect(shouldPublishCampusSegment({ requested: 'shop', picked: 'shop', active: 'shop' })).toBe(false);
    // A deep link the screen has not copied into `picked` yet still resolves
    // to itself, so there is nothing to write.
    expect(shouldPublishCampusSegment({ requested: 'shop', picked: null, active: 'shop' })).toBe(false);
  });

  it('never overwrites a request the screen has not adopted yet', () => {
    // The oscillation: the reader is on Shop, a JobsHome redirect navigates
    // Campus with `segment: 'jobs'`. This render still shows Shop (`picked`
    // wins), the request effect is about to adopt 'jobs' — writing 'shop'
    // back here would make the two effects alternate forever.
    expect(shouldPublishCampusSegment({ requested: 'jobs', picked: 'shop', active: 'shop' })).toBe(false);
  });

  it('publishes the honest answer once a request for a closed gate has been adopted', () => {
    // Requested Communities, gate closed, so Shop is showing: the params must
    // say Shop or the chrome keys on a segment nobody is looking at.
    expect(
      shouldPublishCampusSegment({ requested: 'communities', picked: 'communities', active: 'shop' })
    ).toBe(true);
  });

  it('has nothing to publish when Campus is empty', () => {
    expect(shouldPublishCampusSegment({ requested: undefined, picked: null, active: null })).toBe(false);
  });
});

describe('campusAppBarTitleOverride', () => {
  it('renames the app bar to "Shop" while Shop owns the whole bottom bar', () => {
    // The finding (14-shop-browse-root): the bottom bar is Browse · Cart · You
    // and the section the student is in is Shop, so the title must say so
    // instead of naming Shop's parent, Campus.
    expect(campusAppBarTitleOverride({ activeTab: 'Campus', shopOwnsBottomBar: true })).toBe('Shop');
    // The exact word the segment strip and the shared web page already use.
    expect(campusAppBarTitleOverride({ activeTab: 'Campus', shopOwnsBottomBar: true })).toBe(
      CAMPUS_SEGMENT_LABELS.shop
    );
  });

  it('keeps the Campus title (no override) for the segments that keep the global five', () => {
    // Communities and Jobs carry no replace row: the global five stay, so
    // "Campus" — the section — is the honest name, and this returns null.
    expect(campusAppBarTitleOverride({ activeTab: 'Campus', shopOwnsBottomBar: false })).toBeNull();
  });

  it('leaves every other lit tab to name itself, even one whose row also replaces the bar', () => {
    // Study is `replace` too, but the lit tab is already Study, so tabTitle
    // names it — this override is Campus's alone and must not touch Study.
    expect(campusAppBarTitleOverride({ activeTab: 'Study', shopOwnsBottomBar: true })).toBeNull();
    expect(campusAppBarTitleOverride({ activeTab: 'Home', shopOwnsBottomBar: false })).toBeNull();
    expect(campusAppBarTitleOverride({ activeTab: 'Me', shopOwnsBottomBar: false })).toBeNull();
  });
});
