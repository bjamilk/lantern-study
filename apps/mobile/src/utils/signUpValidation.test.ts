import {
  PROGRAMME_MAX_LENGTH,
  SIGN_UP_ERRORS,
  areInstitutionsUnavailable,
  buildSignUpAcademicFields,
  isSignUpFormValid,
  isValidSignUpEmail,
  isValidUsernameFormat,
  validateSignUpForm,
  type SignUpFormInput,
} from './signUpValidation';

function validForm(overrides: Partial<SignUpFormInput> = {}): SignUpFormInput {
  return {
    firstName: 'Ada',
    lastName: 'Obi',
    username: 'ada_obi',
    usernameAvailable: true,
    email: 'ada@example.com',
    institutionId: 'inst-1',
    programme: 'Biochemistry',
    studyLevel: 200,
    institutionsUnavailable: false,
    password: 'secret1',
    confirmPassword: 'secret1',
    ...overrides,
  };
}

describe('validateSignUpForm — academic parity with web onboarding', () => {
  it('accepts a fully filled form', () => {
    expect(validateSignUpForm(validForm())).toEqual({});
    expect(isSignUpFormValid(validForm())).toBe(true);
  });

  it('requires an institution', () => {
    const errors = validateSignUpForm(validForm({ institutionId: '' }));
    expect(errors.institution).toBe(SIGN_UP_ERRORS.institutionRequired);
    expect(isSignUpFormValid(validForm({ institutionId: null }))).toBe(false);
  });

  it('treats a whitespace-only institution id as missing', () => {
    expect(validateSignUpForm(validForm({ institutionId: '   ' })).institution).toBe(
      SIGN_UP_ERRORS.institutionRequired
    );
  });

  it('requires a study level', () => {
    expect(validateSignUpForm(validForm({ studyLevel: null })).studyLevel).toBe(
      SIGN_UP_ERRORS.studyLevelRequired
    );
  });

  it('rejects a study level outside the known levels', () => {
    expect(validateSignUpForm(validForm({ studyLevel: 150 })).studyLevel).toBe(
      SIGN_UP_ERRORS.studyLevelRequired
    );
  });

  it('accepts every offered level', () => {
    for (const level of [100, 200, 300, 400, 500, 600, 700]) {
      expect(validateSignUpForm(validForm({ studyLevel: level }))).toEqual({});
    }
  });

  it('leaves programme optional', () => {
    expect(validateSignUpForm(validForm({ programme: '' }))).toEqual({});
    expect(validateSignUpForm(validForm({ programme: null }))).toEqual({});
    expect(validateSignUpForm(validForm({ programme: undefined }))).toEqual({});
  });
});

describe('validateSignUpForm — institution-outage escape', () => {
  it('lets sign-up through with no institution when the list could not load', () => {
    const errors = validateSignUpForm(
      validForm({ institutionId: '', institutionsUnavailable: true })
    );
    expect(errors.institution).toBeUndefined();
    expect(errors).toEqual({});
  });

  it('still requires the level during an outage — it needs no network', () => {
    const errors = validateSignUpForm(
      validForm({ institutionId: '', studyLevel: null, institutionsUnavailable: true })
    );
    expect(errors.studyLevel).toBe(SIGN_UP_ERRORS.studyLevelRequired);
  });

  it('does not weaken any other requirement during an outage', () => {
    const errors = validateSignUpForm(
      validForm({ institutionsUnavailable: true, email: 'not-an-email', password: '' })
    );
    expect(errors.email).toBe(SIGN_UP_ERRORS.emailInvalid);
    expect(errors.password).toBe(SIGN_UP_ERRORS.passwordRequired);
  });
});

describe('validateSignUpForm — the rest of the form', () => {
  it('requires both names and rejects one-character names', () => {
    expect(validateSignUpForm(validForm({ firstName: '  ' })).firstName).toBe(
      SIGN_UP_ERRORS.firstNameRequired
    );
    expect(validateSignUpForm(validForm({ firstName: 'A' })).firstName).toBe(
      SIGN_UP_ERRORS.firstNameShort
    );
    expect(validateSignUpForm(validForm({ lastName: '' })).lastName).toBe(
      SIGN_UP_ERRORS.lastNameRequired
    );
    expect(validateSignUpForm(validForm({ lastName: 'B' })).lastName).toBe(
      SIGN_UP_ERRORS.lastNameShort
    );
  });

  it('validates the username length, charset and availability', () => {
    expect(validateSignUpForm(validForm({ username: '' })).username).toBe(
      SIGN_UP_ERRORS.usernameRequired
    );
    expect(validateSignUpForm(validForm({ username: 'ab' })).username).toBe(
      SIGN_UP_ERRORS.usernameShort
    );
    expect(validateSignUpForm(validForm({ username: 'a'.repeat(21) })).username).toBe(
      SIGN_UP_ERRORS.usernameLong
    );
    expect(validateSignUpForm(validForm({ username: 'ada obi' })).username).toBe(
      SIGN_UP_ERRORS.usernameFormat
    );
    expect(validateSignUpForm(validForm({ usernameAvailable: false })).username).toBe(
      SIGN_UP_ERRORS.usernameTaken
    );
  });

  it('does not block on an availability check that has not answered yet', () => {
    expect(validateSignUpForm(validForm({ usernameAvailable: null }))).toEqual({});
  });

  it('validates the email', () => {
    expect(validateSignUpForm(validForm({ email: '  ' })).email).toBe(SIGN_UP_ERRORS.emailRequired);
    expect(validateSignUpForm(validForm({ email: 'ada@' })).email).toBe(
      SIGN_UP_ERRORS.emailInvalid
    );
  });

  it('validates the password and its confirmation', () => {
    expect(validateSignUpForm(validForm({ password: '', confirmPassword: '' })).password).toBe(
      SIGN_UP_ERRORS.passwordRequired
    );
    expect(validateSignUpForm(validForm({ password: 'abc', confirmPassword: 'abc' })).password).toBe(
      SIGN_UP_ERRORS.passwordShort
    );
    expect(validateSignUpForm(validForm({ confirmPassword: '' })).confirmPassword).toBe(
      SIGN_UP_ERRORS.confirmPasswordRequired
    );
    expect(validateSignUpForm(validForm({ confirmPassword: 'other1' })).confirmPassword).toBe(
      SIGN_UP_ERRORS.passwordsDiffer
    );
  });
});

describe('isValidSignUpEmail / isValidUsernameFormat', () => {
  it('accepts and rejects the obvious cases', () => {
    expect(isValidSignUpEmail(' ada@example.com ')).toBe(true);
    expect(isValidSignUpEmail('ada@example')).toBe(false);
    expect(isValidUsernameFormat('Ada_Obi')).toBe(true);
    expect(isValidUsernameFormat('ada-obi')).toBe(false);
  });
});

describe('buildSignUpAcademicFields', () => {
  it('trims and nulls empty values', () => {
    expect(
      buildSignUpAcademicFields({ institutionId: ' inst-1 ', programme: '  ', studyLevel: 300 })
    ).toEqual({ institutionId: 'inst-1', programme: null, studyLevel: 300 });
  });

  it('nulls a missing institution and level', () => {
    expect(buildSignUpAcademicFields({ institutionId: null, studyLevel: null })).toEqual({
      institutionId: null,
      programme: null,
      studyLevel: null,
    });
  });

  it('caps the programme at the shared max length', () => {
    const patch = buildSignUpAcademicFields({
      institutionId: 'inst-1',
      programme: 'x'.repeat(PROGRAMME_MAX_LENGTH + 40),
      studyLevel: 100,
    });
    expect(patch.programme).toHaveLength(PROGRAMME_MAX_LENGTH);
  });
});

describe('areInstitutionsUnavailable', () => {
  it('is false while the list is still loading', () => {
    expect(areInstitutionsUnavailable({ loading: true, error: null, count: 0 })).toBe(false);
  });

  it('is true on a fetch error', () => {
    expect(areInstitutionsUnavailable({ loading: false, error: 'offline', count: 0 })).toBe(true);
  });

  it('is true on an empty list — the picker would offer nothing to choose', () => {
    expect(areInstitutionsUnavailable({ loading: false, error: null, count: 0 })).toBe(true);
  });

  it('is false once institutions are loaded', () => {
    expect(areInstitutionsUnavailable({ loading: false, error: null, count: 12 })).toBe(false);
  });
});
