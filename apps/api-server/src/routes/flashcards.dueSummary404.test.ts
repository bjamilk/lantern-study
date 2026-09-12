/**
 * `GET /api/v1/flashcards/due-summary` returned 500 in production.
 *
 * There is no such endpoint. Express matched `GET /:flashcardId`, the handler
 * looked up the flashcard whose id is the literal string `due-summary`, and
 * `id = 'due-summary'` against a uuid column raises Postgres 22P02, which the
 * service rethrows and the error handler masks as "Something went wrong". A
 * wrong URL is a 404, not a server fault — the `flashcardId` param guard now
 * rejects anything that is not a UUID before the database is touched.
 */
import router, { initializeFlashcardRoutes } from './flashcards';

/** The `router.param('flashcardId', …)` callback, as Express stores it. */
function paramGuard() {
  const registered = (router as any).params?.flashcardId;
  if (!registered || registered.length === 0) throw new Error('flashcardId param guard not registered');
  return registered[registered.length - 1] as (
    req: any,
    res: any,
    next: (err?: unknown) => void,
    value: string,
  ) => void;
}

function runGuard(value: string) {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  let nextCalled = false;
  paramGuard()({ params: { flashcardId: value } }, res, () => {
    nextCalled = true;
  }, value);
  return { res, nextCalled };
}

describe('flashcards :flashcardId guard', () => {
  const lookup = jest.fn();

  beforeEach(() => {
    lookup.mockReset();
    initializeFlashcardRoutes(
      { getFlashcardForUser: lookup } as any,
      { get: jest.fn(async () => null), set: jest.fn(async () => {}) } as any,
    );
  });

  it('404s /flashcards/due-summary instead of asking Postgres for a non-uuid id', () => {
    const { res, nextCalled } = runGuard('due-summary');
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Flashcard not found' });
    expect(nextCalled).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['', 'null', 'undefined', '123', 'not-a-uuid', 'due-summary/extra'])(
    '404s the malformed id %p',
    (value) => {
      const { res, nextCalled } = runGuard(value);
      expect(res.statusCode).toBe(404);
      expect(nextCalled).toBe(false);
    },
  );

  it('lets a real flashcard id through untouched', () => {
    const { res, nextCalled } = runGuard('3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d');
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBeUndefined();
  });
});
