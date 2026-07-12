import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import {
  applyPublicRateLimits,
  usesAuthenticatedPublicLimit,
} from './publicRateLimitMiddleware';

const publicReadRateLimit = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());
const publicWriteRateLimit = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());
const authenticatedRateLimit = jest.fn((_req: Request, _res: Response, next: NextFunction) => next());

jest.mock('./rateLimit', () => ({
  publicReadRateLimit: (req: Request, res: Response, next: NextFunction) =>
    publicReadRateLimit(req, res, next),
  publicWriteRateLimit: (req: Request, res: Response, next: NextFunction) =>
    publicWriteRateLimit(req, res, next),
  authenticatedRateLimit: (req: Request, res: Response, next: NextFunction) =>
    authenticatedRateLimit(req, res, next),
}));

function mockReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    method: 'GET',
    baseUrl: '/api/v1/marketplace',
    path: '/listings',
    ...overrides,
  } as AuthenticatedRequest;
}

function runMiddleware(req: AuthenticatedRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const res = {} as Response;
    const next: NextFunction = (err?: unknown) => {
      if (err) reject(err);
      else resolve();
    };
    applyPublicRateLimits(req, res, next);
  });
}

describe('usesAuthenticatedPublicLimit', () => {
  it('is true when req.user is attached', () => {
    expect(
      usesAuthenticatedPublicLimit(
        mockReq({ user: { id: 'u1', permissions: ['read'], credentialType: 'jwt' } })
      )
    ).toBe(true);
  });

  it('is false without verified user', () => {
    expect(usesAuthenticatedPublicLimit(mockReq())).toBe(false);
  });
});

describe('applyPublicRateLimits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses authenticatedRateLimit for verified user on public marketplace read', async () => {
    const req = mockReq({ user: { id: 'u1', permissions: ['read'], credentialType: 'jwt' } });
    await runMiddleware(req);
    expect(authenticatedRateLimit).toHaveBeenCalledTimes(1);
    expect(publicReadRateLimit).not.toHaveBeenCalled();
  });

  it('uses publicReadRateLimit for anonymous marketplace read', async () => {
    await runMiddleware(mockReq());
    expect(publicReadRateLimit).toHaveBeenCalledTimes(1);
    expect(authenticatedRateLimit).not.toHaveBeenCalled();
  });

  it('skips public write limiter when no public write routes are registered', async () => {
    const req = mockReq({
      method: 'POST',
      baseUrl: '/api/v1/user-stats',
      path: '/',
    });
    await runMiddleware(req);
    expect(publicWriteRateLimit).not.toHaveBeenCalled();
    expect(publicReadRateLimit).not.toHaveBeenCalled();
    expect(authenticatedRateLimit).not.toHaveBeenCalled();
  });

  it('skips limiters for non-public routes', async () => {
    const req = mockReq({ baseUrl: '/api/v1/marketplace', path: '/orders' });
    await runMiddleware(req);
    expect(publicReadRateLimit).not.toHaveBeenCalled();
    expect(authenticatedRateLimit).not.toHaveBeenCalled();
  });
});
