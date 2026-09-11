/**
 * Academic identity on the user routes (Phase 1 · A).
 *
 * Three gates silently drop a new profile field unless each is extended —
 * validateUpdateUser (validation.ts), NON_ADMIN_UPDATABLE_FIELDS and
 * toPublicUser (users.ts). These tests pin all three, plus the route
 * registration of the new /users/me/courses and /courses routers.
 */
import { validationResult } from 'express-validator';
import { validateUpdateUser } from '../middleware/validation';
import { ACADEMIC_PROFILE_FIELDS, NON_ADMIN_UPDATABLE_FIELDS, toPublicUser } from './users';

async function runUpdateUserValidators(body: Record<string, unknown>) {
  const req = { body } as any;
  for (const validator of validateUpdateUser) {
    await validator.run(req);
  }
  return validationResult(req);
}

const registered = (router: any, method: 'get' | 'put' | 'post' | 'patch' | 'delete') =>
  router.stack.filter((layer: any) => layer.route?.methods?.[method]).map((layer: any) => layer.route.path);

describe('validateUpdateUser — academic fields', () => {
  it('accepts the academic identity fields (and null to clear)', async () => {
    const ok = await runUpdateUserValidators({
      institutionId: '11111111-1111-4111-8111-111111111111',
      faculty: 'Science',
      programme: 'Microbiology',
      studyLevel: 200,
      entryYear: 2025,
      expectedGraduationYear: 2029,
    });
    expect(ok.isEmpty()).toBe(true);

    const cleared = await runUpdateUserValidators({
      institutionId: null,
      faculty: null,
      programme: null,
      studyLevel: null,
      entryYear: null,
      expectedGraduationYear: null,
    });
    expect(cleared.isEmpty()).toBe(true);
  });

  it.each([
    ['institutionId', 'not-a-uuid'],
    ['studyLevel', 150],
    ['studyLevel', 1000],
    ['entryYear', 1980],
    ['expectedGraduationYear', 2101],
    ['faculty', 'x'.repeat(201)],
  ])('rejects a bad %s (%j)', async (field, value) => {
    const result = await runUpdateUserValidators({ [field]: value });
    expect(result.isEmpty()).toBe(false);
    expect(result.array().some((e) => 'path' in e && e.path === field)).toBe(true);
  });
});

describe('NON_ADMIN_UPDATABLE_FIELDS — users may write their own academic identity', () => {
  it('whitelists every academic field', () => {
    for (const field of ACADEMIC_PROFILE_FIELDS) {
      expect(NON_ADMIN_UPDATABLE_FIELDS.has(field)).toBe(true);
    }
  });

  it('still keeps settings and gamification off the profile path', () => {
    for (const field of ['settings', 'points', 'badges', 'isAdmin']) {
      expect(NON_ADMIN_UPDATABLE_FIELDS.has(field)).toBe(false);
    }
  });
});

describe('toPublicUser — academic projection', () => {
  const user = {
    id: 'u1',
    name: 'Ada',
    username: 'ada',
    points: 10,
    badges: [],
    stats: {},
    institutionId: '11111111-1111-4111-8111-111111111111',
    institution: { id: '11111111-1111-4111-8111-111111111111', name: 'University of Lagos', slug: 'unilag' },
    faculty: 'Science',
    programme: 'Microbiology',
    studyLevel: 200,
    entryYear: 2025,
    expectedGraduationYear: 2029,
  } as any;

  it('exposes institution, faculty, programme and level to other users', () => {
    expect(toPublicUser(user)).toMatchObject({
      institutionId: user.institutionId,
      institution: { id: user.institutionId, name: 'University of Lagos', slug: 'unilag' },
      faculty: 'Science',
      programme: 'Microbiology',
      studyLevel: 200,
    });
  });

  it('keeps entryYear / expectedGraduationYear owner-only', () => {
    const projected = toPublicUser(user) as Record<string, unknown>;
    expect(projected).not.toHaveProperty('entryYear');
    expect(projected).not.toHaveProperty('expectedGraduationYear');
  });

  it('reads snake_case rows too and nulls missing values', () => {
    expect(toPublicUser({ id: 'u2', name: 'B', points: 0, badges: [], stats: {} } as any)).toMatchObject({
      institutionId: null,
      institution: null,
      faculty: null,
      programme: null,
      studyLevel: null,
    });
    expect(
      toPublicUser({ id: 'u3', name: 'C', points: 0, badges: [], stats: {}, institution_id: 'x', study_level: 300 } as any)
    ).toMatchObject({ institutionId: 'x', studyLevel: 300 });
  });
});

describe('academic routers are registered', () => {
  it('serves the /users/me/courses family', () => {
    const router = require('./userCourses').default;
    expect(registered(router, 'get')).toContain('/');
    expect(registered(router, 'put')).toContain('/');
    expect(registered(router, 'patch')).toContain('/:courseId');
    expect(registered(router, 'delete')).toContain('/:courseId');
    expect(registered(router, 'post')).toContain('/archive-semester');
    // archive-semester must be registered before /:courseId so it is never
    // captured as a course id (it would fail the UUID check with a 400).
    const postIndex = router.stack.findIndex((l: any) => l.route?.path === '/archive-semester');
    const patchIndex = router.stack.findIndex((l: any) => l.route?.path === '/:courseId');
    expect(postIndex).toBeGreaterThanOrEqual(0);
    expect(postIndex).toBeLessThan(patchIndex);
  });

  it('serves GET/POST /courses', () => {
    const router = require('./courses').default;
    expect(registered(router, 'get')).toContain('/');
    expect(registered(router, 'post')).toContain('/');
  });

  it('mounts /users/me/courses before /users in server.ts', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8') as string;
    // Live mounts only — server.ts also carries a commented-out legacy block.
    const coursesMount = server.search(/^\s*app\.use\('\/api\/v1\/users\/me\/courses'/m);
    const usersMount = server.search(/^\s*app\.use\('\/api\/v1\/users', userRoutes\)/m);
    expect(coursesMount).toBeGreaterThanOrEqual(0);
    expect(usersMount).toBeGreaterThan(coursesMount);
    expect(server).toMatch(/^\s*app\.use\('\/api\/v1\/courses'/m);
  });

  it('mounts /users/me/study-sets before /users in server.ts', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const server = readFileSync(join(__dirname, '../server.ts'), 'utf8') as string;
    const setsMount = server.search(/^\s*app\.use\('\/api\/v1\/users\/me\/study-sets'/m);
    const usersMount = server.search(/^\s*app\.use\('\/api\/v1\/users', userRoutes\)/m);
    expect(setsMount).toBeGreaterThanOrEqual(0);
    expect(usersMount).toBeGreaterThan(setsMount);
  });
});
