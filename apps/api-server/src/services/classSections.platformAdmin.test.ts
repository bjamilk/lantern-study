/**
 * classSections platform-admin escape hatch (hotfix H3, finding 9).
 *
 * `resolvePlatformAdmin` read `app_metadata.is_platform_admin` off the
 * `authUser` the routes pass, which is `req.user` — an object the auth
 * middleware builds WITHOUT any `app_metadata`. The read therefore found
 * nothing and the helper returned false for every caller alive, so both
 * `assertInstitutionAdmin` and `setCourseCanonical` had no working admin
 * path: a real platform admin was refused exactly like a stranger. It now
 * resolves live from the database, the way jobsBoard and
 * middleware/authorizeResource do.
 */
jest.mock('./aiService', () => ({
  generateQuestionsFromNotes: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
}));
jest.mock('./learningEvents', () => ({ recordLearningEvent: jest.fn(async () => 1) }));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const isLivePlatformAdmin = jest.fn(async () => false);
jest.mock('../utils/platformAdminAuth', () => ({ isLivePlatformAdmin }));

const getCourseById = jest.fn();
jest.mock('./academicCourses', () => {
  const actual = jest.requireActual('./academicCourses');
  return {
    ...actual,
    getAcademicCoursesService: () => ({ getCourseById, ensureEnrolment: jest.fn(async () => null) }),
  };
});
jest.mock('./courseTopics', () => ({
  getCourseTopicsService: () => ({ get: jest.fn(), findOrCreate: jest.fn() }),
}));

import { ClassSectionsService } from './classSections';

const ADMIN = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const INSTITUTION = '33333333-3333-4333-8333-333333333333';

const COURSE_ROW = {
  id: COURSE,
  institution_id: INSTITUTION,
  code: 'PHARM101',
  title: 'Pharmacology',
  faculty: null,
  level: null,
  semester: 1,
  is_canonical: true,
};

/**
 * `institution_staff` answers with `staffRow` (null = not staff); the
 * `courses` write that follows a successful authorisation answers with a real
 * row, so a test that gets PAST the guard fails on the guard and nothing else.
 */
function makeService(staffRow: unknown = null) {
  const db = {
    from(table: string) {
      const row = table === 'courses' ? COURSE_ROW : staffRow;
      const chain: any = {};
      for (const m of ['select', 'eq', 'update', 'in', 'order', 'limit']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: row, error: null });
      chain.single = () => Promise.resolve({ data: row, error: null });
      chain.then = (ok: any, err: any) => Promise.resolve({ data: row, error: null }).then(ok, err);
      return chain;
    },
  };
  return new ClassSectionsService({
    getClient: () => db,
    notifications: { createNotification: jest.fn(async () => null) },
  } as any);
}

beforeEach(() => {
  isLivePlatformAdmin.mockReset().mockResolvedValue(false);
  getCourseById.mockReset().mockResolvedValue({
    id: COURSE,
    institutionId: INSTITUTION,
    code: 'PHARM101',
    title: 'Pharmacology',
  });
});

describe('setCourseCanonical platform-admin path', () => {
  it('refuses a non-admin who is not campus staff', async () => {
    const svc = makeService(null);

    await expect(svc.setCourseCanonical(ADMIN, COURSE, true)).rejects.toThrow(
      /department or campus admin/
    );
    expect(isLivePlatformAdmin).toHaveBeenCalledWith(ADMIN);
  });

  it('lets a LIVE platform admin through with no staff row at all', async () => {
    isLivePlatformAdmin.mockResolvedValue(true);
    const svc = makeService(null);

    await expect(svc.setCourseCanonical(ADMIN, COURSE, true)).resolves.toBeDefined();
  });

  it('ignores an is_platform_admin claim carried in the passed authUser', async () => {
    const svc = makeService(null);

    // The old helper trusted exactly this shape. The live check says no, so
    // a forged or stale token claim buys nothing.
    await expect(
      svc.setCourseCanonical(ADMIN, COURSE, true, { app_metadata: { is_platform_admin: true } })
    ).rejects.toThrow(/department or campus admin/);
  });
});
