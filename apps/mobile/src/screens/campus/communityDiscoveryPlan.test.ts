import {
  COMMUNITY_DISCOVER_LIMIT,
  chipServerKind,
  planCommunityDiscovery,
} from './communityDiscoveryPlan';
import { COMMUNITY_CHIPS } from './communityHubModel';
import { isCommunityKind } from '@lantern/shared/network';

describe('chipServerKind', () => {
  it('maps the single-kind chips onto the shared vocabulary', () => {
    expect(chipServerKind('hostel')).toBe('hostel');
    expect(chipServerKind('clubs')).toBe('club');
    expect(chipServerKind('events')).toBe('event');
    expect(chipServerKind('faith')).toBe('faith');
    expect(chipServerKind('sports')).toBe('sports');
  });

  it('sends nothing for a chip that covers several kinds', () => {
    // `academic` is four kinds and `interests` is three; `all` is every kind.
    expect(chipServerKind('academic')).toBeNull();
    expect(chipServerKind('interests')).toBeNull();
    expect(chipServerKind('all')).toBeNull();
  });

  it('only ever emits a kind the shared module still knows', () => {
    for (const chip of COMMUNITY_CHIPS) {
      const kind = chipServerKind(chip);
      if (kind) expect(isCommunityKind(kind)).toBe(true);
    }
  });
});

describe('planCommunityDiscovery', () => {
  it('asks the server for the chip’s kind and keeps a widening fallback', () => {
    const plan = planCommunityDiscovery({ chip: 'hostel', query: '  moremi  ' });
    expect(plan.params).toEqual({ limit: COMMUNITY_DISCOVER_LIMIT, q: 'moremi', kind: 'hostel' });
    // Pre-migration every student room is filed as `topic`, so a kind query can
    // answer zero rows for a campus that has hostels.
    expect(plan.fallback).toEqual({ limit: COMMUNITY_DISCOVER_LIMIT, q: 'moremi' });
  });

  it('has nothing to widen when no kind was sent', () => {
    const plan = planCommunityDiscovery({ chip: 'all' });
    expect(plan.params).toEqual({ limit: COMMUNITY_DISCOVER_LIMIT });
    expect(plan.fallback).toBeNull();
  });

  it('omits an empty search rather than sending q=""', () => {
    expect(planCommunityDiscovery({ chip: 'academic', query: '   ' }).params).toEqual({
      limit: COMMUNITY_DISCOVER_LIMIT,
    });
  });

  it('honours an explicit limit', () => {
    expect(planCommunityDiscovery({ chip: 'faith', limit: 5 }).params.limit).toBe(5);
  });
});
