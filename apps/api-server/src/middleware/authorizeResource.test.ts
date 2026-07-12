import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  initializeAuthorizeResource,
  requireDeckAccess,
} from './authorizeResource';
import { SupabaseService } from '../services/supabase';

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
  middleware: ReturnType<typeof requireDeckAccess>,
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
    const service = {
      verifyDeckAccess,
    } as unknown as SupabaseService;
    initializeAuthorizeResource(service);
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
