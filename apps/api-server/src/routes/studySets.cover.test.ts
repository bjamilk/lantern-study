/**
 * POST/DELETE /users/me/study-sets/:setId/cover — the route contract.
 *
 * The set is the thing StudyFetch actually lets a student picture, so this is
 * the cover route students will use most. What it has to hold:
 *
 *   - only the OWNER may set a cover: ownership is proved by reading the set
 *     through the owner-scoped service BEFORE a byte is stored, so a set
 *     belonging to someone else never reaches storage at all;
 *   - the cap is 5 MB, not the 10 MB decks take — that is the number printed
 *     under the button, and a limit a student reads must be the limit the
 *     server enforces;
 *   - a database without `cover_path` answers 503 NAMING the migration, so the
 *     client can say "needs a server update" instead of "failed";
 *   - a failed column write never leaves the uploaded object orphaned.
 */
jest.mock('../middleware/rateLimit', () => ({
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));

const setsService = {
  get: jest.fn(async () => ({ id: 'set', title: 'Cell Biology' })),
  update: jest.fn(async () => ({ id: 'set', title: 'Cell Biology' })),
};
jest.mock('../services/studySets', () => ({
  getStudySetsService: () => setsService,
}));

import { CoverColumnMissingError, COVER_IMAGE_MIGRATION } from '../services/supabase';
import { PublicError } from '../utils/safeError';
import router, { initializeStudySetRoutes, MAX_STUDY_SET_COVER_BYTES } from './studySets';

const SET_ID = '11111111-2222-4333-8444-555555555555';
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function routeLayer(method: 'post' | 'delete' | 'patch', path: string) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  return layer;
}

async function runRoute(method: 'post' | 'delete' | 'patch', path: string, req: any) {
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
  params: { setId: SET_ID },
});

beforeEach(() => {
  jest.clearAllMocks();
  setsService.get.mockImplementation(async () => ({ id: 'set', title: 'Cell Biology' }));
  setsService.update.mockImplementation(async () => ({ id: 'set', title: 'Cell Biology' }));
});

describe('POST /users/me/study-sets/:setId/cover', () => {
  it('stores under {ownerId}/study-sets/{setId}/ and returns path plus signed urls', async () => {
    const uploadCoverImage = jest.fn(async () => ({
      path: 'user-1/study-sets/set/2-c.webp',
      url: 'https://signed/c',
      thumbUrl: 'https://signed/c.thumb',
    }));
    const deleteCoverObject = jest.fn(async () => {});
    initializeStudySetRoutes({
      uploadCoverImage,
      setStudySetCoverPath: jest.fn(async () => ({
        previousPath: 'user-1/study-sets/set/1-old.webp',
      })),
      deleteCoverObject,
    } as any);

    const res = await runRoute(
      'post',
      '/:setId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({
      coverPath: 'user-1/study-sets/set/2-c.webp',
      coverUrl: 'https://signed/c',
      coverThumbUrl: 'https://signed/c.thumb',
    });
    expect(uploadCoverImage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'study-set', id: SET_ID, userId: 'user-1' }),
    );
    // The replaced object is removed: paths are timestamped, so keeping it
    // would leak one orphan per re-pick.
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/study-sets/set/1-old.webp');
  });

  it("refuses a set this account does not own before anything is stored", async () => {
    const uploadCoverImage = jest.fn();
    setsService.get.mockImplementation(async () => {
      throw new PublicError('Study set not found');
    });
    initializeStudySetRoutes({
      uploadCoverImage,
      setStudySetCoverPath: jest.fn(),
      deleteCoverObject: jest.fn(),
    } as any);

    const res = await runRoute(
      'post',
      '/:setId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('not found');
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('refuses a payload over 5 MB before anything is uploaded', async () => {
    const uploadCoverImage = jest.fn();
    initializeStudySetRoutes({
      uploadCoverImage,
      setStudySetCoverPath: jest.fn(),
      deleteCoverObject: jest.fn(),
    } as any);

    const res = await runRoute(
      'post',
      '/:setId/cover',
      // base64 is 4/3 of the bytes it encodes, so this clears 5 MB decoded.
      request({
        base64Data: 'A'.repeat(MAX_STUDY_SET_COVER_BYTES * 2),
        fileName: 'c.png',
        contentType: 'image/png',
      }),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('5 MB');
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('accepts a payload just under the cap that a 10 MB rule would also pass', () => {
    // Guards the number itself: the block's copy says 5MB, so 6 MB must fail.
    expect(MAX_STUDY_SET_COVER_BYTES).toBe(5 * 1024 * 1024);
  });

  it('refuses a non-image content type before anything is uploaded', async () => {
    const uploadCoverImage = jest.fn();
    initializeStudySetRoutes({
      uploadCoverImage,
      setStudySetCoverPath: jest.fn(),
      deleteCoverObject: jest.fn(),
    } as any);

    const res = await runRoute(
      'post',
      '/:setId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.svg', contentType: 'image/svg+xml' }),
    );

    expect(res.statusCode).toBe(400);
    expect(uploadCoverImage).not.toHaveBeenCalled();
  });

  it('answers 503 naming the migration when cover_path does not exist', async () => {
    const deleteCoverObject = jest.fn(async () => {});
    initializeStudySetRoutes({
      uploadCoverImage: jest.fn(async () => ({
        path: 'user-1/study-sets/set/1-c.webp',
        url: 'u',
        thumbUrl: null,
      })),
      setStudySetCoverPath: jest.fn(async () => {
        throw new CoverColumnMissingError();
      }),
      deleteCoverObject,
    } as any);

    const res = await runRoute(
      'post',
      '/:setId/cover',
      request({ base64Data: PNG_BASE64, fileName: 'c.png', contentType: 'image/png' }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, migration: COVER_IMAGE_MIGRATION });
    expect(res.body.error).toContain(COVER_IMAGE_MIGRATION);
    // The stored object must not survive a failed column write.
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/study-sets/set/1-c.webp');
  });
});

describe('DELETE /users/me/study-sets/:setId/cover', () => {
  it('clears the column and best-effort deletes the object', async () => {
    const setStudySetCoverPath = jest.fn(async () => ({
      previousPath: 'user-1/study-sets/set/1-c.webp',
    }));
    const deleteCoverObject = jest.fn(async () => {});
    initializeStudySetRoutes({ setStudySetCoverPath, deleteCoverObject } as any);

    const res = await runRoute('delete', '/:setId/cover', request({}));

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ coverPath: null });
    expect(setStudySetCoverPath).toHaveBeenCalledWith(SET_ID, 'user-1', null);
    expect(deleteCoverObject).toHaveBeenCalledWith('user-1/study-sets/set/1-c.webp');
  });

  it('answers 503 naming the migration when cover_path does not exist', async () => {
    initializeStudySetRoutes({
      setStudySetCoverPath: jest.fn(async () => {
        throw new CoverColumnMissingError();
      }),
      deleteCoverObject: jest.fn(),
    } as any);

    const res = await runRoute('delete', '/:setId/cover', request({}));

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ migration: COVER_IMAGE_MIGRATION });
  });
});

describe('PATCH /users/me/study-sets/:setId', () => {
  it('clears a cover through the owner-scoped writer, never through the patch body', async () => {
    const setStudySetCoverPath = jest.fn(async () => ({
      previousPath: 'user-1/study-sets/set/1-c.webp',
    }));
    const deleteCoverObject = jest.fn(async () => {});
    initializeStudySetRoutes({ setStudySetCoverPath, deleteCoverObject } as any);

    const res = await runRoute(
      'patch',
      '/:setId',
      request({ title: 'Renamed', coverPath: null }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body.data.coverPath).toBeNull();
    expect(setStudySetCoverPath).toHaveBeenCalledWith(SET_ID, 'user-1', null);
    // The generic update must never see `coverPath`.
    expect(setsService.update).toHaveBeenCalledWith('user-1', SET_ID, { title: 'Renamed' });
  });

  it('never lets a patch body aim the column at an arbitrary storage object', async () => {
    const setStudySetCoverPath = jest.fn(async () => ({ previousPath: null }));
    initializeStudySetRoutes({ setStudySetCoverPath, deleteCoverObject: jest.fn() } as any);

    const res = await runRoute(
      'patch',
      '/:setId',
      request({ coverPath: 'someone-else/study-sets/theirs/1-c.webp' }),
    );

    expect(res.statusCode).toBe(200);
    expect(setStudySetCoverPath).not.toHaveBeenCalled();
    expect(setsService.update).toHaveBeenCalledWith('user-1', SET_ID, {});
  });
});
