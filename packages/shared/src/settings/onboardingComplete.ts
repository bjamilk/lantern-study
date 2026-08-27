/** Both clients persist this key. Always write `'1'`; accept `'true'` on read. */
export const ONBOARDING_COMPLETE_STORAGE_KEY = 'lantern_onboarding_complete';
export const ONBOARDING_COMPLETE_VALUE = '1';

export function isOnboardingCompleteFlag(value: string | null | undefined): boolean {
  return value === '1' || value === 'true';
}
