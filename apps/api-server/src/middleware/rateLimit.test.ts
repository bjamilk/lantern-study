import express, { NextFunction, Request, Response } from 'express';
import {
  hasAuthCredential,
  resolveClientIp,
  anonymousIpRateLimit,
  authenticatedRateLimit,
  aiPostBurstRateLimit,
  isWebhookRateLimitExempt,
} from './rateLimit';
import { AuthenticatedRequest } from '../types';

type LimiterResult = { status: number; nextCalled: boolean };

const testUser = (id: string) => ({
  id,
  permissions: ['read'] as string[],
  credentialType: 'jwt' as const,
});

function mockRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    method: 'GET',
    path: '/test',
    ip: '203.0.113.10',
    headers: {},
    socket: { remoteAddress: '203.0.113.10' } as AuthenticatedRequest['socket'],
    ...overrides,
  } as AuthenticatedRequest;
}

function createMockResponse(resolve: (result: LimiterResult) => void): Response {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | number | string[] | undefined>,
    setHeader(name: string, value: string | number | string[]) {
      this.headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return this.headers[name.toLowerCase()];
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json() {
      resolve({ status: this.statusCode, nextCalled: false });
    },
  };
  return res as unknown as Response;
}

async function runLimiter(
  limiter: (req: Request, res: Response, next: NextFunction) => void,
  req: AuthenticatedRequest
): Promise<LimiterResult> {
  return new Promise((resolve) => {
    const res = createMockResponse(resolve);
    limiter(req, res, () => resolve({ status: 200, nextCalled: true }));
  });
}

describe('hasAuthCredential', () => {
  it('detects Authorization and X-API-Key headers', () => {
    expect(hasAuthCredential(mockRequest({ headers: { authorization: 'Bearer jwt' } }))).toBe(true);
    expect(hasAuthCredential(mockRequest({ headers: { 'x-api-key': 'lsk_test' } }))).toBe(true);
    expect(hasAuthCredential(mockRequest())).toBe(false);
    expect(hasAuthCredential(mockRequest({ headers: { authorization: '   ' } }))).toBe(false);
  });

  it('detects HttpOnly auth cookies', () => {
    expect(
      hasAuthCredential(
        mockRequest({ cookies: { lantern_access: 'access-token' } } as Partial<AuthenticatedRequest>)
      )
    ).toBe(true);
    expect(
      hasAuthCredential(
        mockRequest({ cookies: { lantern_refresh: 'refresh-token' } } as Partial<AuthenticatedRequest>)
      )
    ).toBe(true);
    expect(hasAuthCredential(mockRequest({ cookies: { lantern_access: '   ' } } as Partial<AuthenticatedRequest>))).toBe(false);
  });
});

describe('resolveClientIp', () => {
  it('normalizes req.ip for rate-limit keys', () => {
    const key = resolveClientIp(mockRequest({ ip: '203.0.113.10' }));
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });
});

describe('anonymousIpRateLimit', () => {
  it('skips requests that carry credentials', async () => {
    const credentialed = mockRequest({ headers: { authorization: 'Bearer token' } });
    for (let i = 0; i < 5; i++) {
      const result = await runLimiter(anonymousIpRateLimit, credentialed);
      expect(result.nextCalled).toBe(true);
    }
  });
});

describe('authenticatedRateLimit', () => {
  it('keys limits per authenticated user id', async () => {
    const userA = mockRequest({ user: testUser('user-a') });
    const userB = mockRequest({ user: testUser('user-b') });

    const firstA = await runLimiter(authenticatedRateLimit, userA);
    const firstB = await runLimiter(authenticatedRateLimit, userB);
    expect(firstA.nextCalled).toBe(true);
    expect(firstB.nextCalled).toBe(true);
  });

  it('skips when user is not attached', async () => {
    const result = await runLimiter(authenticatedRateLimit, mockRequest());
    expect(result.nextCalled).toBe(true);
  });
});

describe('ai route burst wiring', () => {
  it('does not apply aiPostBurstRateLimit to GET /usage', async () => {
    const attachUser: express.RequestHandler = (req, _res, next) => {
      (req as AuthenticatedRequest).user = testUser('usage-user');
      next();
    };

    const app = express();
    app.get('/usage', attachUser, (_req, res) => res.status(200).json({ ok: true }));
    app.use(attachUser);
    app.use(aiPostBurstRateLimit);
    app.post('/generate-questions', (_req, res) => res.status(200).json({ ok: true }));

    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;

    try {
      for (let i = 0; i < 25; i++) {
        const resp = await fetch(`http://127.0.0.1:${port}/usage`);
        expect(resp.status).not.toBe(429);
        expect(resp.status).toBe(200);
      }
    } finally {
      server.close();
    }
  });
});

describe('resolveClientIp — X-Forwarded-For is never trusted directly', () => {
  it('ignores a spoofed XFF header and keys on the socket address', () => {
    const spoofed = mockRequest({
      ip: undefined as unknown as string,
      headers: { 'x-forwarded-for': '1.2.3.4' },
      socket: { remoteAddress: '203.0.113.10' } as AuthenticatedRequest['socket'],
    });
    expect(resolveClientIp(spoofed)).toBe(resolveClientIp(mockRequest()));
  });

  it('two requests differing only in XFF share one bucket key', () => {
    const a = resolveClientIp(mockRequest({ headers: { 'x-forwarded-for': '9.9.9.9' } }));
    const b = resolveClientIp(mockRequest({ headers: { 'x-forwarded-for': '8.8.8.8' } }));
    expect(a).toBe(b);
  });
});

describe('isWebhookRateLimitExempt', () => {
  it.each([
    '/webhooks/paystack',
    '/api/v1/webhooks/paystack',
    '/api/v1/webhooks/paystack/',
    '/webhooks/paystack?x=1',
  ])('exempts %s from the anonymous IP limiter', (p) => {
    expect(isWebhookRateLimitExempt(p)).toBe(true);
  });

  it.each(['/api/v1/notes', '/webhooks/other', '/api/v1/webhooks/paystack/extra'])(
    'does not exempt %s',
    (p) => {
      expect(isWebhookRateLimitExempt(p)).toBe(false);
    }
  );
});
