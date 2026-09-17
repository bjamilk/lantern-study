/**
 * The LIVE platform-admin gate (monolith lane M3, Phase B).
 *
 * ## Why this suite exists
 *
 * Every admin-only mutation in the server is behind `assertLivePlatformAdmin`,
 * and ten suites mock this module wholesale — so the body itself, the one that
 * decides who is an admin, had NO test. Flipping it from the facade to the
 * layer moves the lookup from `supabaseService.isPlatformAdmin(id)` to
 * `dataLayer.client.isPlatformAdmin(id)`, which is exactly the kind of rename
 * that type-checks while pointing at nothing (#92). It gets a test first.
 *
 * ## What is pinned
 *
 *  - the check is LIVE on every call: two calls are two lookups, never a
 *    cached answer, so a revoked admin loses access on the next request;
 *  - it reads the DATABASE, never `req.user.isAdmin` — a JWT minted before the
 *    role was revoked still carries the stale claim, and that claim is what
 *    this gate exists to ignore;
 *  - before bootstrap it FAILS CLOSED (no host → not an admin);
 *  - the assert helpers answer 401 without a user and 403 for a non-admin, and
 *    `assertSelfOrLivePlatformAdmin` lets a user act on themselves without a
 *    lookup at all.
 */
import type { Response } from 'express';

import type { AuthenticatedRequest } from '../types';
import {
  assertLivePlatformAdmin,
  assertSelfOrLivePlatformAdmin,
  initializePlatformAdminAuth,
  isLivePlatformAdmin,
  isSelfOrLivePlatformAdmin,
} from './platformAdminAuth';

function mockRes(): Response & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const req = (id?: string) =>
  ({ user: id ? { id } : undefined }) as unknown as AuthenticatedRequest;

function install(answers: boolean[] | boolean) {
  const isPlatformAdmin = jest.fn(async () =>
    Array.isArray(answers) ? (answers.shift() ?? false) : answers,
  );
  initializePlatformAdminAuth({ client: { isPlatformAdmin } } as never);
  return isPlatformAdmin;
}

describe('isLivePlatformAdmin', () => {
  it('asks the database on EVERY call — the answer is never cached', async () => {
    // Admin now, revoked a moment later: the second call must see the change.
    const isPlatformAdmin = install([true, false]);

    await expect(isLivePlatformAdmin('user-1')).resolves.toBe(true);
    await expect(isLivePlatformAdmin('user-1')).resolves.toBe(false);
    expect(isPlatformAdmin).toHaveBeenCalledTimes(2);
    expect(isPlatformAdmin).toHaveBeenCalledWith('user-1');
  });

  it('fails closed before bootstrap has injected a host', async () => {
    initializePlatformAdminAuth(null as never);
    await expect(isLivePlatformAdmin('user-1')).resolves.toBe(false);
  });
});

describe('assertLivePlatformAdmin', () => {
  it('401s an unauthenticated caller without asking the database', async () => {
    const isPlatformAdmin = install(true);
    const res = mockRes();

    await expect(assertLivePlatformAdmin(req(), res)).resolves.toBe(false);
    expect(res.statusCode).toBe(401);
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('403s a signed-in non-admin', async () => {
    install(false);
    const res = mockRes();

    await expect(assertLivePlatformAdmin(req('user-1'), res)).resolves.toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: 'Platform admin access required',
    });
  });

  it('passes a live admin and writes no response', async () => {
    install(true);
    const res = mockRes();

    await expect(assertLivePlatformAdmin(req('user-1'), res)).resolves.toBe(true);
    expect(res.statusCode).toBe(200);
  });
});

describe('self-or-admin', () => {
  it('lets a user act on themselves without a lookup', async () => {
    const isPlatformAdmin = install(false);

    await expect(isSelfOrLivePlatformAdmin(req('user-1'), 'user-1')).resolves.toBe(true);
    expect(isPlatformAdmin).not.toHaveBeenCalled();
  });

  it('falls back to the live lookup for someone else, and 403s a non-admin', async () => {
    const isPlatformAdmin = install(false);
    const res = mockRes();

    await expect(
      assertSelfOrLivePlatformAdmin(req('user-1'), res, 'user-2'),
    ).resolves.toBe(false);
    expect(res.statusCode).toBe(403);
    expect(isPlatformAdmin).toHaveBeenCalledWith('user-1');
  });

  it('lets a live admin act on someone else', async () => {
    install(true);
    const res = mockRes();

    await expect(
      assertSelfOrLivePlatformAdmin(req('admin-1'), res, 'user-2'),
    ).resolves.toBe(true);
    expect(res.statusCode).toBe(200);
  });
});
