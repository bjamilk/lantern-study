/**
 * POST/DELETE /decks/:deckId/cover — the route contract.
 *
 *   - only the OWNER may set or clear a cover (the access middleware is wired
 *     at 'owner', not 'edit': a collaborator must not restyle someone's shelf);
 *   - a database without the cover_path column answers 503 naming the
 *     migration, so the client says "not available yet" instead of "failed";
 *   - a declared non-image content type is refused before any upload;
 *   - a failed column write never leaves the uploaded object orphaned.
 */
const accessCalls: Array<{ param: string; level: string }> = [];

jest.mock('../middleware/authorizeResource', () => ({
  requireDeckAccess: (param: string, level: string) => {
    accessCalls.push({ param, level });
    return (_req: any, _res: any, next: any) => next();
  },
}));
jest.mock('../middleware/rateLimit', () => ({
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: () => null,
  withIdempotency: async (_c: unknown, _u: string, _o: string, _k: unknown, fn: () => unknown) => fn(),
}));

import {
  CoverColumnMissingError,
  CoverStorageUnavailableError,
  COVER_IMAGE_MIGRATION,
} from '../services/supabase';
import { setIdempotencyClient } from '../middleware/idempotency';
import router, { initializeDeckRoutes } from './decks';
import { stubDataLayer } from '../services/data/testStub';

setIdempotencyClient(() => ({}) as any);

const DECK_ID = '11111111-2222-4333-8444-555555555555';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function routeLayer(method: 'post' | 'delete', path: string) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer;
}

async function runRoute(method: 'post' | 'delete', path: string, req: any) {
  const handlers = routeLayer(method, path).route.stack.map((s: any) => s.handle);

  const res: any = { statusCode: 200, body: undefined };
  await new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    // Skip authMiddleware (index 0); req.user is set by the caller.
    let index = 1;
    const next = (err?: unknown) => {
      if (err) return reject(err);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route never responded'));
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (thrown) {
        reject(thrown);
      }
    };
    next();
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

const request = (body: any) => ({
  user: { id: 'user-1' },
  body,
  headers: {},
  query: {},
  params: { deckId: DECK_ID },
});

function initWith(service: any) {
  const cache = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    deletePattern: async () => {},
  };
  initializeDeckRoutes(stubDataLayer(service) as any, cache as any);
}

beforeEach(() => jest.clearAllMocks());

describe('deck cover ownership', () => {
  it('gates both cover routes on deck OWNERSHIP, not edit access', () => {
    // requireDeckAccess is recorded at module load; both cover routes must ask
    // for 'owner'. A collaborator restyling the owner's deck is the bug here.
    expect(accessCalls.filter((c) => c.level === 'owner').length).toBeGreaterThanOrEqual(2);
    expect(routeLayer('post', '/:deckId/cover')).toBeTruthy();
    expect(routeLayer('delete', '/:deckId/cover')).toBeTruthy();
  });
});

describe('POST /decks/:deckId/cover', () => {
  it('answers 503 naming the migration BEFORE any byte is stored', async () => {
    // The probe runs first: a database without the migration never leaves an
    // orphan object behind, and the client gets a retryable 503 rather than
    // the blank 500 production actually returned.
    const uploadCoverImage = jest.fn();
    initWith({
      assertCoverColumn: jest.fn(async () => {
        throw new CoverColumnMissingError();
      }),
      uploadCoverImage,
      setDeckCoverPath: jest.fn(),
      deleteCoverObject: jest.fn(),
    });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Covers need a server update — try again later',
      migration: COVER_IMAGE_MIGRATION,
    });
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('still cleans up the object when the column write fails late', async () => {
    const deleteCoverObject = jest.fn(async () => {});
    initWith({
      assertCoverColumn: jest.fn(async () => {}),
      uploadCoverImage: jest.fn(async () => ({ path: 'user-1/decks/d/1-c.webp', url: 'u', thumbUrl: null })),
      setDeckCoverPath: jest.fn(async () => {
        throw new CoverColumnMissingError();
      }),
      deleteCoverObject,
    });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(503);
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/decks/d/1-c.webp');
  });

  it('names storage when the bucket is the thing that is broken', async () => {
    initWith({
      assertCoverColumn: jest.fn(async () => {}),
      uploadCoverImage: jest.fn(async () => {
        throw new CoverStorageUnavailableError('Bucket not found');
      }),
      setDeckCoverPath: jest.fn(),
      deleteCoverObject: jest.fn(),
    });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: 'Cover storage is not ready',
      detail: 'Bucket not found',
    });
    // A storage failure is NOT a missing migration: no migration to apply.
    expect(res.body.migration).toBeUndefined();
  });

  it('refuses a non-image content type before anything is uploaded', async () => {
    const uploadCoverImage = jest.fn();
    initWith({ uploadCoverImage, setDeckCoverPath: jest.fn(), deleteCoverObject: jest.fn() });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.svg', contentType: 'image/svg+xml' }),
    );

    expect(res.statusCode).toBe(400);
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('refuses a payload over 10 MB before anything is uploaded', async () => {
    const uploadCoverImage = jest.fn();
    initWith({ uploadCoverImage, setDeckCoverPath: jest.fn(), deleteCoverObject: jest.fn() });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({
        base64Data: 'A'.repeat(14 * 1024 * 1024),
        fileName: 'c.png',
        contentType: 'image/png',
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('10 MB');
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('returns the path plus display-only signed urls and deletes the replaced object', async () => {
    const deleteCoverObject = jest.fn(async () => {});
    initWith({
      uploadCoverImage: jest.fn(async () => ({
        path: 'user-1/decks/d/2-c.webp',
        url: 'https://signed/c',
        thumbUrl: 'https://signed/c.thumb',
      })),
      assertCoverColumn: jest.fn(async () => {}),
      setDeckCoverPath: jest.fn(async () => ({ previousPath: 'user-1/decks/d/1-old.webp' })),
      deleteCoverObject,
    });

    const res = await runRoute(
      'post',
      '/:deckId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      coverPath: 'user-1/decks/d/2-c.webp',
      coverUrl: 'https://signed/c',
      coverThumbUrl: 'https://signed/c.thumb',
    });
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/decks/d/1-old.webp');
  });
});

describe('DELETE /decks/:deckId/cover', () => {
  it('clears the column and best-effort deletes the object', async () => {
    const deleteCoverObject = jest.fn(async () => {});
    const setDeckCoverPath = jest.fn(async () => ({ previousPath: 'user-1/decks/d/1-c.webp' }));
    initWith({ setDeckCoverPath, deleteCoverObject });

    const res = await runRoute('delete', '/:deckId/cover', request({}));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ coverPath: null });
    expect(setDeckCoverPath).toHaveBeenCalledWith(DECK_ID, 'user-1', null);
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/decks/d/1-c.webp');
  });

  it('answers 503 naming the migration when cover_path does not exist', async () => {
    initWith({
      setDeckCoverPath: jest.fn(async () => {
        throw new CoverColumnMissingError();
      }),
      deleteCoverObject: jest.fn(),
    });

    const res = await runRoute('delete', '/:deckId/cover', request({}));

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, migration: COVER_IMAGE_MIGRATION });
  });
});
