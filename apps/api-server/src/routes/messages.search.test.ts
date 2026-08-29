/**
 * The search endpoint must refuse to fan out for degenerate queries: under two
 * characters returns empty without touching the database, and wildcard-only
 * queries collapse to empty after sanitising.
 */
jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { id: 'searcher', permissions: [], credentialType: 'jwt' };
    next();
  },
}));
jest.mock('../services/supabase', () => ({
  SupabaseService: class {},
}));

import express from 'express';
import http from 'http';

describe('GET /messages/search guards', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    const mod = require('./messages');
    // getClient must never be called for guarded queries — throw if it is.
    mod.initializeMessageRoutes(
      {
        getClient: () => {
          throw new Error('database should not be touched for short queries');
        },
      } as any,
      { get: async () => null, set: async () => {}, del: async () => {} } as any
    );
    const app = express();
    app.use('/api/v1/messages', mod.default);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        base = `http://127.0.0.1:${(server.address() as any).port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('returns empty for a one-character query without hitting the database', async () => {
    const res = await fetch(`${base}/api/v1/messages/search?q=a`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });

  it('returns empty when the query is only wildcard characters', async () => {
    const res = await fetch(`${base}/api/v1/messages/search?q=%25%25`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [] });
  });
});
