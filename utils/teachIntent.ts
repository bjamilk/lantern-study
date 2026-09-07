/**
 * Instructor signup intent — survives the OAuth round-trip (sessionStorage)
 * so a lecturer who starts on /teach or /signup/teach lands in Teach after
 * Google/Apple, not the student onboarding funnel.
 */
import {
  TEACH_SIGNUP_INTENT_KEY,
  TEACH_SIGNUP_PATH,
  isTeachSignupPath,
} from '@lantern/shared/academic';
import {
  ONBOARDING_COMPLETE_STORAGE_KEY,
  ONBOARDING_COMPLETE_VALUE,
} from '@lantern/shared/settings';
import { markAcademicSetupDismissed } from './academicSetup';

export function markTeachSignupIntent(): void {
  try {
    sessionStorage.setItem(TEACH_SIGNUP_INTENT_KEY, '1');
  } catch {
    /* private mode */
  }
}

export function hasTeachSignupIntent(): boolean {
  try {
    return sessionStorage.getItem(TEACH_SIGNUP_INTENT_KEY) === '1';
  } catch {
    return false;
  }
}

export function clearTeachSignupIntent(): void {
  try {
    sessionStorage.removeItem(TEACH_SIGNUP_INTENT_KEY);
  } catch {
    /* ignore */
  }
}

export function isTeachNextPath(next: string | null | undefined): boolean {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('://')) return false;
  const path = next.split('?')[0].replace(/\/$/, '') || '/';
  return path === '/teach' || path.startsWith('/teach/');
}

export function isTeachAuthRequest(pathname: string, search = ''): boolean {
  if (isTeachSignupPath(pathname)) return true;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.get('intent') === 'teach') return true;
  if (isTeachNextPath(params.get('next'))) return true;
  return hasTeachSignupIntent();
}

/** Skip the student starter-deck onboarding after instructor signup/sign-in. */
export function completeTeachOnboarding(userId?: string | null): void {
  try {
    localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, ONBOARDING_COMPLETE_VALUE);
  } catch {
    /* ignore */
  }
  markAcademicSetupDismissed(userId);
}

export function consumeTeachSignupIntent(userId?: string | null): boolean {
  const teach = hasTeachSignupIntent() || (typeof window !== 'undefined' && isTeachAuthRequest(window.location.pathname, window.location.search));
  if (teach) completeTeachOnboarding(userId);
  clearTeachSignupIntent();
  return teach;
}

export { TEACH_SIGNUP_PATH };
