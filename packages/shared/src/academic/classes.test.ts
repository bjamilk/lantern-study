import {
  CLASS_ROLES,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  canonicalizeJoinCode,
  classJoinPath,
  generateJoinCode,
  isClassStaffRole,
  isInstitutionCatalogAdmin,
  isValidJoinCode,
  parseJoinPath,
  parseTeachPath,
  teachClassPath,
  classSubjectLine,
  defaultClassTitle,
} from './classes';

describe('canonicalizeJoinCode', () => {
  it('uppercases and strips spaces', () => {
    expect(canonicalizeJoinCode(' ab c234 ')).toBe('ABC234');
  });

  it('returns empty for nullish', () => {
    expect(canonicalizeJoinCode(null)).toBe('');
    expect(canonicalizeJoinCode(undefined)).toBe('');
  });
});

describe('isValidJoinCode', () => {
  it('accepts 6-character alphabet codes', () => {
    expect(isValidJoinCode('ABC234')).toBe(true);
    expect(isValidJoinCode('234567')).toBe(true);
  });

  it('rejects ambiguous or short values', () => {
    expect(isValidJoinCode('ABC12')).toBe(false);
    expect(isValidJoinCode('ABC0O1')).toBe(false);
    expect(isValidJoinCode('hello!')).toBe(false);
  });
});

describe('generateJoinCode', () => {
  it('emits JOIN_CODE_LENGTH characters from the alphabet', () => {
    let i = 0;
    const code = generateJoinCode(JOIN_CODE_LENGTH, () => {
      const step = (i % JOIN_CODE_ALPHABET.length) / JOIN_CODE_ALPHABET.length;
      i += 1;
      return step;
    });
    expect(code).toHaveLength(JOIN_CODE_LENGTH);
    expect([...code].every((ch) => JOIN_CODE_ALPHABET.includes(ch))).toBe(true);
    expect(isValidJoinCode(code)).toBe(true);
  });
});

describe('roles', () => {
  it('treats instructor and TA as class staff', () => {
    expect(isClassStaffRole('instructor')).toBe(true);
    expect(isClassStaffRole('ta')).toBe(true);
    expect(isClassStaffRole('student')).toBe(false);
    expect(CLASS_ROLES).toContain('student');
  });

  it('limits catalogue writes to department/institution admins', () => {
    expect(isInstitutionCatalogAdmin('department_admin')).toBe(true);
    expect(isInstitutionCatalogAdmin('institution_admin')).toBe(true);
    expect(isInstitutionCatalogAdmin('instructor')).toBe(false);
  });
});

describe('defaultClassTitle', () => {
  const course = { code: 'MATH', title: 'Mathematics' };

  it('uses the topic title when the class is one topic', () => {
    expect(defaultClassTitle(course, { title: 'Fractions' })).toBe('Fractions');
  });

  it('falls back to code — title for a whole-course class', () => {
    expect(defaultClassTitle(course, null)).toBe('MATH — Mathematics');
    expect(defaultClassTitle(course)).toBe('MATH — Mathematics');
  });
});

describe('classSubjectLine', () => {
  it('shows code · topic when scoped', () => {
    expect(classSubjectLine({ code: 'MATH' }, { title: 'Fractions' })).toBe('MATH · Fractions');
  });

  it('shows only the code for a whole-course class', () => {
    expect(classSubjectLine({ code: 'BIO 201' }, null)).toBe('BIO 201');
  });
});

describe('paths', () => {
  it('builds join and teach URLs', () => {
    expect(classJoinPath('abc234')).toBe('/join/ABC234');
    expect(teachClassPath('c1')).toBe('/teach/classes/c1');
    expect(teachClassPath('c1', 'analytics')).toBe('/teach/classes/c1/analytics');
  });

  it('parses teach and join paths', () => {
    expect(parseTeachPath('/teach')).toEqual({ page: 'home' });
    expect(parseTeachPath('/teach/new')).toEqual({ page: 'new' });
    expect(parseTeachPath('/teach/admin')).toEqual({ page: 'admin' });
    expect(parseTeachPath('/teach/classes/abc/materials')).toEqual({
      page: 'class',
      classId: 'abc',
      tab: 'materials',
    });
    expect(parseJoinPath('/join/ABC234')).toBe('ABC234');
    expect(parseJoinPath('/dashboard')).toBeNull();
  });
});
