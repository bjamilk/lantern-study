/**
 * Pure validation behind the mobile sign-up form.
 *
 * The academic rule is the one the web onboarding step applies
 * (utils/onboardingAcademic.ts): institution REQUIRED, study level REQUIRED,
 * programme optional. Both fields feed every compounding asset in the product
 * — auto communities, course rows, campus counts, Discover — so a blank one is
 * a permanently empty account, not a saved minute.
 *
 * The single deliberate escape is `institutionsUnavailable`: when the campus
 * list cannot be fetched, requiring an institution would lock a student out of
 * creating an account at all, so that one requirement degrades to optional
 * (level still required) and RootNavigator's academic profile-setup modal picks
 * them up on the next boot.
 *
 * Kept free of React Native, stores and services so signUpValidation.test.ts can
 * exercise it directly (importing a store pulls in expo-secure-store and the
 * suite dies).
 */
import { isValidStudyLevel } from '@lantern/shared/academic';

/** Same cap the web onboarding step puts on the programme input. */
export const PROGRAMME_MAX_LENGTH = 120;

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;
export const PASSWORD_MIN_LENGTH = 6;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

export function isValidSignUpEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function isValidUsernameFormat(username: string): boolean {
  return USERNAME_RE.test(username.toLowerCase().trim());
}

export interface SignUpFormInput {
  firstName: string;
  lastName: string;
  username: string;
  /** Result of the debounced availability check; `null` = not yet known. */
  usernameAvailable: boolean | null;
  email: string;
  institutionId: string | null;
  programme?: string | null;
  studyLevel: number | null;
  /**
   * `true` when the institution list could not be loaded (request failed, or
   * came back empty). The ONLY path that lets sign-up proceed with no
   * institution.
   */
  institutionsUnavailable?: boolean;
  password: string;
  confirmPassword: string;
}

export interface SignUpFormErrors {
  firstName?: string;
  lastName?: string;
  username?: string;
  email?: string;
  institution?: string;
  studyLevel?: string;
  password?: string;
  confirmPassword?: string;
}

/** Every message the form can show, so screen and tests never drift. */
export const SIGN_UP_ERRORS = {
  firstNameRequired: 'First name is required',
  firstNameShort: 'First name must be at least 2 characters',
  lastNameRequired: 'Last name is required',
  lastNameShort: 'Last name must be at least 2 characters',
  usernameRequired: 'Username is required',
  usernameShort: `Username must be at least ${USERNAME_MIN_LENGTH} characters`,
  usernameLong: `Username must be at most ${USERNAME_MAX_LENGTH} characters`,
  usernameFormat: 'Username can only contain letters, numbers, and underscores',
  usernameTaken: 'This username is already taken',
  emailRequired: 'Email is required',
  emailInvalid: 'Please enter a valid email',
  institutionRequired: 'Choose your institution to continue.',
  studyLevelRequired: 'Pick your current level to continue.',
  passwordRequired: 'Password is required',
  passwordShort: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
  confirmPasswordRequired: 'Please confirm your password',
  passwordsDiffer: 'Passwords do not match',
} as const;

/** Field-level validation for the whole sign-up form. Empty object = valid. */
export function validateSignUpForm(input: SignUpFormInput): SignUpFormErrors {
  const errors: SignUpFormErrors = {};

  const firstName = input.firstName.trim();
  if (!firstName) {
    errors.firstName = SIGN_UP_ERRORS.firstNameRequired;
  } else if (firstName.length < 2) {
    errors.firstName = SIGN_UP_ERRORS.firstNameShort;
  }

  const lastName = input.lastName.trim();
  if (!lastName) {
    errors.lastName = SIGN_UP_ERRORS.lastNameRequired;
  } else if (lastName.length < 2) {
    errors.lastName = SIGN_UP_ERRORS.lastNameShort;
  }

  const username = input.username.toLowerCase().trim();
  if (!username) {
    errors.username = SIGN_UP_ERRORS.usernameRequired;
  } else if (username.length < USERNAME_MIN_LENGTH) {
    errors.username = SIGN_UP_ERRORS.usernameShort;
  } else if (username.length > USERNAME_MAX_LENGTH) {
    errors.username = SIGN_UP_ERRORS.usernameLong;
  } else if (!isValidUsernameFormat(username)) {
    errors.username = SIGN_UP_ERRORS.usernameFormat;
  } else if (input.usernameAvailable === false) {
    errors.username = SIGN_UP_ERRORS.usernameTaken;
  }

  if (!input.email.trim()) {
    errors.email = SIGN_UP_ERRORS.emailRequired;
  } else if (!isValidSignUpEmail(input.email)) {
    errors.email = SIGN_UP_ERRORS.emailInvalid;
  }

  if (!input.institutionsUnavailable && !(input.institutionId || '').trim()) {
    errors.institution = SIGN_UP_ERRORS.institutionRequired;
  }

  // Level stays required even during a campus-list outage: it needs no network.
  if (!isValidStudyLevel(input.studyLevel)) {
    errors.studyLevel = SIGN_UP_ERRORS.studyLevelRequired;
  }

  // Programme is optional by design — an unlisted or interdisciplinary course
  // of study must never block account creation.

  if (!input.password) {
    errors.password = SIGN_UP_ERRORS.passwordRequired;
  } else if (input.password.length < PASSWORD_MIN_LENGTH) {
    errors.password = SIGN_UP_ERRORS.passwordShort;
  }

  if (!input.confirmPassword) {
    errors.confirmPassword = SIGN_UP_ERRORS.confirmPasswordRequired;
  } else if (input.password !== input.confirmPassword) {
    errors.confirmPassword = SIGN_UP_ERRORS.passwordsDiffer;
  }

  return errors;
}

export function isSignUpFormValid(input: SignUpFormInput): boolean {
  return Object.keys(validateSignUpForm(input)).length === 0;
}

/**
 * The three academic fields written to profiles on insert and to
 * PUT /users/:id once a session exists (which triggers
 * refreshAutoMemberships server-side). Same shape the web patch builds.
 */
export function buildSignUpAcademicFields(input: {
  institutionId: string | null;
  programme?: string | null;
  studyLevel: number | null;
}): { institutionId: string | null; programme: string | null; studyLevel: number | null } {
  const programme = (input.programme || '').trim().slice(0, PROGRAMME_MAX_LENGTH);
  return {
    institutionId: (input.institutionId || '').trim() || null,
    programme: programme || null,
    studyLevel: input.studyLevel ?? null,
  };
}

/**
 * Whether the institution requirement should degrade to optional.
 *
 * An empty list is an outage too: the picker would offer nothing to choose.
 */
export function areInstitutionsUnavailable(state: {
  loading: boolean;
  error: string | null;
  count: number;
}): boolean {
  return !state.loading && (!!state.error || state.count === 0);
}
