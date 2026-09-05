import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_ACADEMIC_ERRORS,
  PROGRAMME_MAX_LENGTH,
  buildOnboardingAcademicPatch,
  isOnboardingAcademicValid,
  needsOnboardingAcademicStep,
  onboardingAcademicDoneKey,
  shouldShowAcademicFallbackBanner,
  validateOnboardingAcademic,
} from '../../../utils/onboardingAcademic';

describe('validateOnboardingAcademic', () => {
  it('requires both institution and level (mobile SignUpScreen rule)', () => {
    const errors = validateOnboardingAcademic({ institutionId: null, studyLevel: null });
    expect(Object.keys(errors).sort()).toEqual(['institutionId', 'studyLevel']);
    expect(errors.institutionId).toBe(ONBOARDING_ACADEMIC_ERRORS.institutionId);
    expect(errors.studyLevel).toBe(ONBOARDING_ACADEMIC_ERRORS.studyLevel);
  });

  it('treats programme as optional', () => {
    expect(validateOnboardingAcademic({ institutionId: 'inst-1', studyLevel: 200 })).toEqual({});
    expect(
      validateOnboardingAcademic({ institutionId: 'inst-1', studyLevel: 200, programme: '' })
    ).toEqual({});
    expect(
      isOnboardingAcademicValid({ institutionId: 'inst-1', studyLevel: 200, programme: 'Law' })
    ).toBe(true);
  });

  it('rejects a blank / whitespace institution id', () => {
    expect(validateOnboardingAcademic({ institutionId: '   ', studyLevel: 100 }).institutionId).toBe(
      ONBOARDING_ACADEMIC_ERRORS.institutionId
    );
  });

  it('rejects a level outside the 100-700 profile range', () => {
    expect(validateOnboardingAcademic({ institutionId: 'inst-1', studyLevel: 0 }).studyLevel).toBe(
      ONBOARDING_ACADEMIC_ERRORS.studyLevel
    );
    expect(validateOnboardingAcademic({ institutionId: 'inst-1', studyLevel: 800 }).studyLevel).toBe(
      ONBOARDING_ACADEMIC_ERRORS.studyLevel
    );
    expect(validateOnboardingAcademic({ institutionId: 'inst-1', studyLevel: 700 })).toEqual({});
  });

  it('drops the institution requirement ONLY when the campus list is unavailable', () => {
    // A failed /marketplace/campuses fetch must not lock a student out of their
    // own account; the level is still required.
    expect(
      validateOnboardingAcademic({
        institutionId: null,
        studyLevel: 300,
        institutionsUnavailable: true,
      })
    ).toEqual({});
    expect(
      validateOnboardingAcademic({
        institutionId: null,
        studyLevel: null,
        institutionsUnavailable: true,
      })
    ).toEqual({ studyLevel: ONBOARDING_ACADEMIC_ERRORS.studyLevel });
  });
});

describe('buildOnboardingAcademicPatch', () => {
  it('sends the three fields mobile writes, normalised for PUT /users/:id', () => {
    expect(
      buildOnboardingAcademicPatch({
        institutionId: ' inst-1 ',
        studyLevel: 200,
        programme: '  Biochemistry  ',
      })
    ).toEqual({ institutionId: 'inst-1', programme: 'Biochemistry', studyLevel: 200 });
  });

  it('nulls empty optional values instead of sending empty strings', () => {
    expect(
      buildOnboardingAcademicPatch({ institutionId: '', studyLevel: null, programme: '   ' })
    ).toEqual({ institutionId: null, programme: null, studyLevel: null });
  });

  it('caps the programme at the input maxLength', () => {
    const patch = buildOnboardingAcademicPatch({
      institutionId: 'inst-1',
      studyLevel: 100,
      programme: 'x'.repeat(PROGRAMME_MAX_LENGTH + 40),
    });
    expect(patch.programme).toHaveLength(PROGRAMME_MAX_LENGTH);
  });
});

describe('needsOnboardingAcademicStep', () => {
  it('asks when either required field is missing', () => {
    expect(needsOnboardingAcademicStep({ institutionId: null, studyLevel: 200 })).toBe(true);
    expect(needsOnboardingAcademicStep({ institutionId: 'inst-1', studyLevel: null })).toBe(true);
    expect(needsOnboardingAcademicStep({ institutionId: '', studyLevel: 200 })).toBe(true);
  });

  it('does not ask a student who already answered (on web or on mobile)', () => {
    expect(needsOnboardingAcademicStep({ institutionId: 'inst-1', studyLevel: 100 })).toBe(false);
  });

  it('never asks on unknown: no user, or a profile loaded without the academic columns', () => {
    expect(needsOnboardingAcademicStep(null)).toBe(false);
    expect(needsOnboardingAcademicStep(undefined)).toBe(false);
    expect(needsOnboardingAcademicStep({})).toBe(false);
  });
});

describe('shouldShowAcademicFallbackBanner', () => {
  const legacy = { institutionId: null, studyLevel: null };

  it('shows for a legacy account that never answered the onboarding step', () => {
    expect(
      shouldShowAcademicFallbackBanner({
        user: legacy,
        dismissed: false,
        answeredOnboardingStep: false,
      })
    ).toBe(true);
  });

  it('never shows for an account that answered the onboarding step', () => {
    expect(
      shouldShowAcademicFallbackBanner({
        user: legacy,
        dismissed: false,
        answeredOnboardingStep: true,
      })
    ).toBe(false);
  });

  it('keeps the legacy dismiss behaviour', () => {
    expect(
      shouldShowAcademicFallbackBanner({
        user: legacy,
        dismissed: true,
        answeredOnboardingStep: false,
      })
    ).toBe(false);
  });

  it('stays hidden once an institution is on file, and while the profile is unknown', () => {
    expect(
      shouldShowAcademicFallbackBanner({
        user: { institutionId: 'inst-1' },
        dismissed: false,
        answeredOnboardingStep: false,
      })
    ).toBe(false);
    expect(
      shouldShowAcademicFallbackBanner({ user: {}, dismissed: false, answeredOnboardingStep: false })
    ).toBe(false);
    expect(
      shouldShowAcademicFallbackBanner({
        user: null,
        dismissed: false,
        answeredOnboardingStep: false,
      })
    ).toBe(false);
  });
});

describe('onboardingAcademicDoneKey', () => {
  it('scopes the marker per user so two accounts sharing a browser do not collide', () => {
    expect(onboardingAcademicDoneKey('user-1')).not.toBe(onboardingAcademicDoneKey('user-2'));
    expect(onboardingAcademicDoneKey('user-1')).toContain('user-1');
    expect(onboardingAcademicDoneKey(null)).toBe('lantern_onboarding_academic_done');
  });
});
