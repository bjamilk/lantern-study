import { describe, expect, it } from 'vitest';
import { canAccessDiscoverHub } from '@lantern/shared/network';
import { canOpenCommunities, communityGateRefusal, hasAcademicProfile } from './communityAccess';

describe('hasAcademicProfile', () => {
  it('needs an institution and a programme — the two fields the shared gate reads', () => {
    expect(hasAcademicProfile({ institutionId: 'inst-1', programme: 'Pharmacy' })).toBe(true);
  });

  it('is false while either is missing', () => {
    expect(hasAcademicProfile(null)).toBe(false);
    expect(hasAcademicProfile({ institutionId: null, programme: 'Pharmacy' })).toBe(false);
    expect(hasAcademicProfile({ institutionId: 'inst-1', programme: '' })).toBe(false);
  });
});

describe('canOpenCommunities', () => {
  const student = { institutionId: 'inst-1', programme: 'Pharmacy' };

  it('is the shared object-form gate, so web and mobile agree', () => {
    expect(canOpenCommunities({ isPlatformAdmin: false, user: student })).toBe(
      canAccessDiscoverHub({ isPlatformAdmin: false, ...student })
    );
    expect(canOpenCommunities({ isPlatformAdmin: false, user: student })).toBe(true);
  });

  it('always lets a platform admin in', () => {
    expect(canOpenCommunities({ isPlatformAdmin: true, user: null })).toBe(true);
  });

  it('closes on an incomplete profile and names why', () => {
    const half = { institutionId: 'inst-1', programme: null };
    expect(canOpenCommunities({ isPlatformAdmin: false, user: half })).toBe(false);
    expect(communityGateRefusal({ isPlatformAdmin: false, user: half })).toBe('needsProfile');
    expect(communityGateRefusal({ isPlatformAdmin: false, user: student })).toBeNull();
  });
});
