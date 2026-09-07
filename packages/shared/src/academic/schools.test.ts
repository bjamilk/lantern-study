import {
  isSchoolKind,
  isTeachSignupPath,
  isTertiarySchoolKind,
  isValidSchoolName,
  normalizeSchoolName,
  schoolKindLabel,
  slugifySchoolName,
  TEACH_SIGNUP_PATH,
} from './schools';

describe('school affiliation helpers', () => {
  it('accepts primary and secondary as school kinds', () => {
    expect(isSchoolKind('primary')).toBe(true);
    expect(isSchoolKind('secondary')).toBe(true);
    expect(isSchoolKind('university')).toBe(true);
    expect(isSchoolKind('other')).toBe(false);
    expect(isTertiarySchoolKind('university')).toBe(true);
    expect(isTertiarySchoolKind('primary')).toBe(false);
  });

  it('labels kinds for the instructor form', () => {
    expect(schoolKindLabel('secondary')).toBe('Secondary / high school');
    expect(schoolKindLabel('primary')).toBe('Primary school');
  });

  it('normalises names and slugs', () => {
    expect(normalizeSchoolName('  King College  Lagos ')).toBe('King College Lagos');
    expect(isValidSchoolName('A')).toBe(false);
    expect(isValidSchoolName('Queens College')).toBe(true);
    expect(slugifySchoolName('Queens College, Lagos')).toBe('queens-college-lagos');
  });

  it('recognises the instructor signup path', () => {
    expect(isTeachSignupPath(TEACH_SIGNUP_PATH)).toBe(true);
    expect(isTeachSignupPath('/signup/teach/')).toBe(true);
    expect(isTeachSignupPath('/signup')).toBe(false);
  });
});
