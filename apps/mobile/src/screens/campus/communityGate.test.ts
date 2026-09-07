import { EMPTY_ACADEMIC_PROFILE, type AcademicProfile } from '../../utils/academicProfile';
import { canCreateCommunity, canSeeCommunitiesSegment, communityGateRefusal } from './communityGate';

const profile = (over: Partial<AcademicProfile> = {}): AcademicProfile => ({
  ...EMPTY_ACADEMIC_PROFILE,
  institutionId: 'inst-1',
  programme: 'Medicine',
  ...over,
});

describe('the Communities gate', () => {
  it('lets in every signed-in student with an academic profile (founder decision)', () => {
    expect(
      canSeeCommunitiesSegment({ isPlatformAdmin: false, academicProfile: profile() })
    ).toBe(true);
  });

  it('keeps a platform admin in whatever their own profile says', () => {
    expect(
      canSeeCommunitiesSegment({ isPlatformAdmin: true, academicProfile: null })
    ).toBe(true);
  });

  it('asks for the missing profile field rather than refusing outright', () => {
    const noProgramme = { isPlatformAdmin: false, academicProfile: profile({ programme: null }) };
    expect(canSeeCommunitiesSegment(noProgramme)).toBe(false);
    expect(communityGateRefusal(noProgramme)).toBe('needsProfile');
    expect(communityGateRefusal({ isPlatformAdmin: false, academicProfile: profile() })).toBeNull();
  });

  it('passes the OBJECT form to shared, never the boolean one', () => {
    // The boolean form means "is this a platform admin?" and nothing else, so
    // passing it here would silently re-close the hub for every student — the
    // one mistake this module exists to prevent.
    expect(canSeeCommunitiesSegment({ isPlatformAdmin: false, academicProfile: profile() })).toBe(
      true
    );
    expect(
      canSeeCommunitiesSegment({ isPlatformAdmin: false, academicProfile: EMPTY_ACADEMIC_PROFILE })
    ).toBe(false);
  });

  it('gates starting a community on the same answer', () => {
    expect(canCreateCommunity({ isPlatformAdmin: false, academicProfile: profile() })).toBe(true);
    expect(canCreateCommunity({ isPlatformAdmin: false, academicProfile: null })).toBe(false);
  });
});
