import {
  isOnboardingCompleteFlag,
  ONBOARDING_COMPLETE_VALUE,
} from './onboardingComplete';

describe('isOnboardingCompleteFlag', () => {
  it('accepts the write value and the legacy mobile true', () => {
    expect(isOnboardingCompleteFlag(ONBOARDING_COMPLETE_VALUE)).toBe(true);
    expect(isOnboardingCompleteFlag('true')).toBe(true);
  });

  it('rejects empty and other strings', () => {
    expect(isOnboardingCompleteFlag(null)).toBe(false);
    expect(isOnboardingCompleteFlag('')).toBe(false);
    expect(isOnboardingCompleteFlag('yes')).toBe(false);
  });
});
