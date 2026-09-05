/**
 * The "browse by course" read routes and the publish refusal (Gap 3).
 *
 * What this pins:
 *   - GET /courses and GET /courses/:courseId/listings exist on the marketplace
 *     router, so they inherit the private-pilot gate that is mounted on
 *     /api/v1/marketplace — they are commerce reads, not the shared reference
 *     data the gate exempts (middleware/marketplaceAccess.ts OPEN_PATHS);
 *   - both answer with a public Cache-Control and write a 600s cache entry
 *     under the `marketplace:listings:` prefix that every publish/edit already
 *     invalidates — a new bank must not leave a stale zero on its course;
 *   - a malformed course id is a 404 and never becomes a query;
 *   - a NEW question-bank / study-pack publish without a course is refused
 *     with 400 and the SHARED copy, so web and mobile show the same sentence.
 */
import { COURSE_ANCHOR_COPY } from '@lantern/shared/marketplace';
import { PublicError } from '../utils/safeError';
import router, { initializeMarketplaceRoutes, respondMarketplaceClientError } from './marketplace';

const COURSE = '11111111-1111-4111-8111-111111111111';

function layersFor(path: string, method = 'get') {
  return (router as any).stack.filter(
    (layer: any) => layer.route?.path === path && layer.route?.methods?.[method]
  );
}

function handlerFor(path: string, method = 'get') {
  const layer = layersFor(path, method)[0];
  if (!layer) throw new Error(`No ${method.toUpperCase()} ${path} route registered`);
  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;
}

function fakeRes() {
  const out: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  out.status = (code: number) => {
    out.statusCode = code;
    return out;
  };
  out.set = (key: string, value: string) => {
    out.headers[key] = value;
    return out;
  };
  out.json = (body: unknown) => {
    out.body = body;
    return out;
  };
  return out;
}

/**
 * Runs an asyncHandler-wrapped route body to completion. asyncHandler returns
 * UNDEFINED (it swallows the promise and routes rejections to `next`), so the
 * only way to wait for the body is to drain the microtask/macrotask queue —
 * awaiting the return value would resolve before the handler had done anything,
 * and every assertion would read an untouched response.
 */
async function invoke(handler: any, req: any, res: any) {
  let failure: unknown;
  handler(req, res, (err?: unknown) => {
    if (err) failure = err;
  });
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (failure) throw failure;
}

const store = new Map<string, unknown>();
const sets: Array<{ key: string; ttl: number }> = [];
const cache = {
  get: jest.fn(async (key: string): Promise<unknown> => store.get(key) ?? null),
  set: jest.fn(async (key: string, value: unknown, ttl: number): Promise<void> => {
    store.set(key, value);
    sets.push({ key, ttl });
  }),
  delete: jest.fn(async (): Promise<void> => undefined),
  deletePattern: jest.fn(async (): Promise<void> => undefined),
};

const supabase = { getClient: () => ({ from: () => ({}) }) };

beforeAll(() => {
  initializeMarketplaceRoutes(supabase as any, cache as any);
});

beforeEach(() => {
  store.clear();
  sets.length = 0;
  jest.clearAllMocks();
});

describe('course browse routes are registered on the gated marketplace mount', () => {
  it('registers both reads exactly once', () => {
    expect(layersFor('/courses')).toHaveLength(1);
    expect(layersFor('/courses/:courseId/listings')).toHaveLength(1);
  });

  it('does not collide with the listing-by-id route', () => {
    // '/courses' and '/listings/:id' are different first segments, so no
    // ordering trap here — but a future '/:something' top-level route would
    // create one. Assert the shape we rely on.
    const paths = (router as any).stack
      .filter((layer: any) => layer.route?.methods?.get)
      .map((layer: any) => layer.route.path as string);
    expect(paths.some((p: string) => /^\/:[^/]+$/.test(p))).toBe(false);
  });
});

describe('GET /courses', () => {
  it('answers from the service, caches for 600s under the invalidated prefix, and sets a public Cache-Control', async () => {
    const payload = { courses: [{ courseId: COURSE, code: 'BIO 201' }], truncated: false };
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({
        listCoursesWithListings: jest.fn(async () => payload),
      } as any);

    const res = fakeRes();
    await invoke(handlerFor('/courses'), { query: {} }, res);

    expect(res.body).toEqual({ success: true, data: payload });
    expect(res.headers['Cache-Control']).toBe('public, max-age=600');
    expect(sets).toEqual([
      { key: 'marketplace:listings:courses:all:default', ttl: 600 },
    ]);
    // Every publish/edit route calls deletePattern('marketplace:listings:*'),
    // so the key MUST live under that prefix or a new bank leaves a stale zero.
    expect(sets[0].key.startsWith('marketplace:listings:')).toBe(true);
  });

  it('serves a cached index without touching the service again', async () => {
    const listCoursesWithListings = jest.fn(async () => ({ courses: [], truncated: false }));
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({ listCoursesWithListings } as any);

    store.set('marketplace:listings:courses:all:default', { courses: [], truncated: false });
    const res = fakeRes();
    await invoke(handlerFor('/courses'), { query: {} }, res);

    expect(listCoursesWithListings).not.toHaveBeenCalled();
    expect(res.headers['Cache-Control']).toBe('public, max-age=600');
  });

  it('ignores a junk institutionId rather than querying with it', async () => {
    const listCoursesWithListings = jest.fn(async () => ({ courses: [], truncated: false }));
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({ listCoursesWithListings } as any);

    await invoke(handlerFor('/courses'), { query: { institutionId: "'; drop--" } }, fakeRes());
    expect(listCoursesWithListings).toHaveBeenCalledWith({ institutionId: null, limit: undefined });
  });
});

describe('GET /courses/:courseId/listings', () => {
  it('404s a malformed course id without reaching the service', async () => {
    const listListingsForCourse = jest.fn();
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({ listListingsForCourse } as any);

    const res = fakeRes();
    await invoke(handlerFor('/courses/:courseId/listings'), { params: { courseId: 'bio-201' }, query: {} }, res);

    expect(res.statusCode).toBe(404);
    expect(listListingsForCourse).not.toHaveBeenCalled();
  });

  it('404s an unknown course', async () => {
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({ listListingsForCourse: jest.fn(async () => null) } as any);

    const res = fakeRes();
    await invoke(handlerFor('/courses/:courseId/listings'), { params: { courseId: COURSE }, query: {} }, res);
    expect(res.statusCode).toBe(404);
    expect(sets).toHaveLength(0);
  });

  it('returns the page, caches it per course and offset, and sets a public Cache-Control', async () => {
    const page = { course: { id: COURSE, code: 'BIO 201' }, listings: [], total: 0 };
    jest
      .spyOn(await import('../services/marketplaceCourses'), 'getMarketplaceCoursesService')
      .mockReturnValue({ listListingsForCourse: jest.fn(async () => page) } as any);

    const res = fakeRes();
    await invoke(
      handlerFor('/courses/:courseId/listings'),
      { params: { courseId: COURSE }, query: { limit: '10', offset: '10' } },
      res
    );

    expect(res.body).toEqual({ success: true, data: page });
    expect(res.headers['Cache-Control']).toBe('public, max-age=600');
    expect(sets).toEqual([
      { key: `marketplace:listings:course:${COURSE}:10:10`, ttl: 600 },
    ]);
  });
});

describe('publish refusal reaches the client as a 400 with the shared copy', () => {
  it('surfaces the course-required PublicError verbatim', () => {
    const res = fakeRes();
    expect(
      respondMarketplaceClientError(res, new PublicError(COURSE_ANCHOR_COPY.required))
    ).toBe(true);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: COURSE_ANCHOR_COPY.required });
  });

  it('surfaces the "no such course" refusal verbatim too', () => {
    const res = fakeRes();
    expect(
      respondMarketplaceClientError(res, new PublicError(COURSE_ANCHOR_COPY.invalid))
    ).toBe(true);
    expect(res.body).toEqual({ success: false, error: COURSE_ANCHOR_COPY.invalid });
  });

  it('keeps the two refusals distinguishable — "pick one" is not "that one is gone"', () => {
    expect(COURSE_ANCHOR_COPY.required).not.toBe(COURSE_ANCHOR_COPY.invalid);
  });
});
