/**
 * Academic identity as the mobile app holds it (mirror of the
 * GET /users/me projection — docs/phase1-academic-identity-contract.md §2).
 */
export interface AcademicProfile {
  institutionId: string | null;
  institution: { id: string; name: string; slug: string } | null;
  faculty: string | null;
  programme: string | null;
  studyLevel: number | null;
  /** 1 = first semester, 2 = second. */
  currentSemester: 1 | 2 | null;
  entryYear: number | null;
  expectedGraduationYear: number | null;
}

export const EMPTY_ACADEMIC_PROFILE: AcademicProfile = {
  institutionId: null,
  institution: null,
  faculty: null,
  programme: null,
  studyLevel: null,
  currentSemester: null,
  entryYear: null,
  expectedGraduationYear: null,
};

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function int(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return null;
}

/** Accepts the API's camelCase projection and raw snake_case rows alike. */
export function extractAcademicProfile(profile: unknown): AcademicProfile {
  if (!profile || typeof profile !== 'object') return EMPTY_ACADEMIC_PROFILE;
  const p = profile as Record<string, unknown>;
  const rawInstitution = p.institution;
  const institution =
    rawInstitution && typeof rawInstitution === 'object'
      ? {
          id: String((rawInstitution as Record<string, unknown>).id ?? ''),
          name: String((rawInstitution as Record<string, unknown>).name ?? ''),
          slug: String((rawInstitution as Record<string, unknown>).slug ?? ''),
        }
      : null;
  return {
    institutionId: str(p.institutionId ?? p.institution_id) ?? (institution?.id || null),
    institution: institution && institution.id ? institution : null,
    faculty: str(p.faculty),
    programme: str(p.programme),
    studyLevel: int(p.studyLevel ?? p.study_level),
    // Only 1 or 2 are meaningful; anything else reads as "not set".
    currentSemester: ((): 1 | 2 | null => {
      const value = int(p.currentSemester ?? p.current_semester);
      return value === 1 || value === 2 ? value : null;
    })(),
    entryYear: int(p.entryYear ?? p.entry_year),
    expectedGraduationYear: int(p.expectedGraduationYear ?? p.expected_graduation_year),
  };
}

export function hasAcademicIdentity(profile: AcademicProfile | null | undefined): boolean {
  return !!profile?.institutionId;
}
