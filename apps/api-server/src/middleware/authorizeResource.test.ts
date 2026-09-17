import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  initializeAuthorizeResource,
  requireDeckAccess,
  requireGroupAdmin,
  requireGroupMember,
  requireTestOwner,
} from './authorizeResource';
import type { DataLayer } from '../services/data';

jest.mock('../utils/platformAdminAuth', () => ({
  isLivePlatformAdmin: jest.fn(),
}));

import { isLivePlatformAdmin } from '../utils/platformAdminAuth';

const mockIsLivePlatformAdmin = isLivePlatformAdmin as jest.MockedFunction<
  typeof isLivePlatformAdmin
>;

function mockRes(): Response {
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
  return res as unknown as Response;
}

function runMiddleware(
  middleware: ReturnType<typeof requireDeckAccess | typeof requireGroupMember>,
  req: AuthenticatedRequest
): Promise<{ res: Response; nextCalled: boolean }> {
  return new Promise((resolve) => {
    const res = mockRes();
    const originalJson = res.json.bind(res);
    (res as Response & { json: typeof res.json }).json = ((payload: unknown) => {
      originalJson(payload);
      resolve({ res, nextCalled: false });
      return res;
    }) as typeof res.json;
    void middleware(req, res, () => {
      resolve({ res, nextCalled: true });
    });
  });
}

describe('requireDeckAccess live admin bypass', () => {
  const verifyDeckAccess = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    // Regrouped onto the namespace that owns the predicate (M3 Phase B); the
    // stub itself is the same `jest.fn()`.
    initializeAuthorizeResource({
      offlineBundles: { verifyDeckAccess },
    } as unknown as DataLayer);
  });

  it('denies when deck access fails and JWT isAdmin is stale', async () => {
    verifyDeckAccess.mockResolvedValue(false);
    mockIsLivePlatformAdmin.mockResolvedValue(false);

    const req = {
      user: { id: 'user-1', permissions: [], isAdmin: true, credentialType: 'jwt' },
      params: { deckId: 'deck-1' },
    } as unknown as AuthenticatedRequest;

    const { res, nextCalled } = await runMiddleware(requireDeckAccess(), req);

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(mockIsLivePlatformAdmin).toHaveBeenCalledWith('user-1');
  });

  it('allows when live platform admin even without deck access', async () => {
    verifyDeckAccess.mockResolvedValue(false);
    mockIsLivePlatformAdmin.mockResolvedValue(true);

    const req = {
      user: { id: 'admin-1', permissions: [], isAdmin: false, credentialType: 'jwt' },
      params: { deckId: 'deck-1' },
    } as unknown as AuthenticatedRequest;

    const { nextCalled } = await runMiddleware(requireDeckAccess(), req);

    expect(nextCalled).toBe(true);
  });
});


/**
 * The group and test predicates read through the layer's `groups` and `tests`
 * namespaces (monolith lane M3, Phase B). Nothing drove them before — this is
 * the security boundary, and a predicate that reads the wrong handle denies
 * everyone or, worse, denies no one.
 */
describe('group and test predicates read through the layer', () => {
  const getGroupById = jest.fn();
  const getTestById = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLivePlatformAdmin.mockResolvedValue(false);
    initializeAuthorizeResource({
      groups: { getGroupById },
      tests: { getTestById },
    } as unknown as DataLayer);
  });

  const req = (params: Record<string, string>) =>
    ({
      user: { id: 'user-1', permissions: [], credentialType: 'jwt' },
      params,
    }) as unknown as AuthenticatedRequest;

  it('requireGroupMember passes a member and denies a stranger', async () => {
    getGroupById.mockResolvedValueOnce({ id: 'group-1' });
    const pass = await runMiddleware(requireGroupMember(), req({ groupId: 'group-1' }));
    expect(pass.nextCalled).toBe(true);
    expect(getGroupById).toHaveBeenCalledWith('group-1', 'user-1');

    getGroupById.mockResolvedValueOnce(null);
    const deny = await runMiddleware(requireGroupMember(), req({ groupId: 'group-1' }));
    expect(deny.nextCalled).toBe(false);
    expect(deny.res.statusCode).toBe(403);
  });

  it('requireGroupAdmin denies a plain member and passes a live platform admin', async () => {
    getGroupById.mockResolvedValue({ id: 'group-1', adminIds: ['someone-else'] });

    const deny = await runMiddleware(requireGroupAdmin(), req({ groupId: 'group-1' }));
    expect(deny.nextCalled).toBe(false);
    expect(deny.res.statusCode).toBe(403);

    // The bypass is the LIVE lookup, never the JWT claim.
    mockIsLivePlatformAdmin.mockResolvedValue(true);
    const pass = await runMiddleware(requireGroupAdmin(), req({ groupId: 'group-1' }));
    expect(pass.nextCalled).toBe(true);
  });

  it('requireTestOwner 404s a test the caller cannot see', async () => {
    getTestById.mockResolvedValueOnce(null);
    const deny = await runMiddleware(requireTestOwner(), req({ testId: 'test-1' }));
    expect(deny.nextCalled).toBe(false);
    expect(deny.res.statusCode).toBe(404);

    getTestById.mockResolvedValueOnce({ id: 'test-1' });
    const pass = await runMiddleware(requireTestOwner(), req({ testId: 'test-1' }));
    expect(pass.nextCalled).toBe(true);
    expect(getTestById).toHaveBeenCalledWith('test-1', 'user-1');
  });
});
