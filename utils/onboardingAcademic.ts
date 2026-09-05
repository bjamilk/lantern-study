/**
 * Pure helpers behind the web onboarding "Where do you study?" step.
 *
 * Web used to collect academic identity only in the dashboard's
 * AcademicSetupBanner, which a student can dismiss permanently — so a dismissal
 * fed nothing into the academic graph (auto-communities, course rows, campus
 * counts) and left Discover empty forever. Mobile's SignUpScreen asks during
 * sign-up instead; this module is the web equivalent's rules.
 *
 * The rule matches mobile's academic block: institution REQUIRED, study level
 * REQUIRED, programme optional. Kept free of React/DOM so
 * apps/web/src/onboardingAcademic.test.ts can exercise it directly.
 */
import { PROFILE_STUDY_LEVELS } from './academicSetup';

/** Same cap the profile-setup step puts on the programme input. */
export const PROGRAMME_MAX_LENGTH = 120;

export interface OnboardingAcademicInput {
  institutionId: string | null;
  studyLevel: number | null;
  programme?: string | null;
  /**
   * `true` when the campus list could not be loaded (request failed, or came
   * back empty). Institution is required — but a fetch outage must not lock a
   * student out of their own account, so the requirement degrades to optional
   * and the legacy banner picks them up later. This is the ONLY path that
   * lets the step finish without an institution.
   */
  institutionsUnavailable?: boolean;
}

export interface OnboardingAcademicErrors {
  institutionId?: string;
  studyLevel?: string;
}

export const ONBOARDING_ACADEMIC_ERRORS = {
  institutionId: 'Choose your institution to continue.',
  studyLevel: 'Pick your current level to continue.',
} as const;

/** Field-level validation for the onboarding academic step. Empty object = valid. */
export function validateOnboardingAcademic(input: OnboardingAcademicInput): OnboardingAcademicErrors {
  const errors: OnboardingAcademicErrors = {};
  if (!input.institutionsUnavailable && !(input.institutionId || '').trim()) {
    errors.institutionId = ONBOARDING_ACADEMIC_ERRORS.institutionId;
  }
  if (input.studyLevel == null || !PROFILE_STUDY_LEVELS.includes(input.studyLevel)) {
    errors.studyLevel = ONBOARDING_ACADEMIC_ERRORS.studyLevel;
  }
  return errors;
}

export function isOnboardingAcademicValid(input: OnboardingAcademicInput): boolean {
  return Object.keys(validateOnboardingAcademic(input)).length === 0;
}

/**
 * Body for PUT /users/:id — the same three fields mobile's sign-up writes, so
 * the server's refreshAutoMemberships / marketplace campus seeding fire.
 */
export function buildOnboardingAcademicPatch(input: OnboardingAcademicInput): {
  institutionId: string | null;
  programme: string | null;
  studyLevel: number | null;
} {
  const programme = (input.programme || '').trim().slice(0, PROGRAMME_MAX_LENGTH);
  return {
    institutionId: (input.institutionId || '').trim() || null,
    programme: programme || null,
    studyLevel: input.studyLevel ?? null,
  };
}

export interface AcademicIdentitySubject {
  institutionId?: string | null;
  studyLevel?: number | null;
}

/**
 * Whether onboarding should show the academic step at all.
 *
 * `undefined` on BOTH fields means the profile has not been loaded with the
 * academic columns yet — never ask on unknown, the same rule
 * utils/academicSetup.ts uses for the dashboard nudge.
 */
export function needsOnboardingAcademicStep(
  user: AcademicIdentitySubject | null | undefined
): boolean {
  if (!user) return false;
  if (user.institutionId === undefined && user.studyLevel === undefined) return false;
  return !user.institutionId || user.studyLevel == null;
}

// ---------- "this account already answered the step" marker ----------

/**
 * Set once the onboarding step has been answered WITH an institution, so the
 * legacy dashboard nudge can never come back for that account — not even if the
 * student later clears their institution in Settings.
 *
 * It is deliberately NOT set on the campus-list-outage path: that student still
 * has no institution on file, so the banner remains their fallback.
 */
export const ONBOARDING_ACADEMIC_DONE_KEY = 'lantern_onboarding_academic_done';

/** Per-user key so one account's answer can't silence another's nudge. */
export function onboardingAcademicDoneKey(userId?: string | null): string {
  return userId ? `${ONBOARDING_ACADEMIC_DONE_KEY}:${userId}` : ONBOARDING_ACADEMIC_DONE_KEY;
}

export function readOnboardingAcademicDone(userId?: string | null): boolean {
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(onboardingAcademicDoneKey(userId)) === '1'
    );
  } catch {
    return false;
  }
}

export function markOnboardingAcademicDone(userId?: string | null): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(onboardingAcademicDoneKey(userId), '1');
  } catch {
    /* storage unavailable — best-effort */
  }
}

/**
 * Dashboard fallback banner gate.
 *
 * The banner is now ONLY for accounts that never answered the onboarding step
 * with an institution — i.e. accounts created before the step existed, plus the
 * rare student who finished it during a campus-list outage. Its per-user
 * dismissal is unchanged for that legacy case.
 */
export function shouldShowAcademicFallbackBanner(input: {
  user: AcademicIdentitySubject | null | undefined;
  dismissed: boolean;
  answeredOnboardingStep: boolean;
}): boolean {
  if (!input.user || input.dismissed || input.answeredOnboardingStep) return false;
  // `undefined` = profile not loaded with the academic columns; never nag on unknown.
  return input.user.institutionId === null;
}
