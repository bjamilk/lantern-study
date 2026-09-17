/**
 * POST /decks/with-cards — the endpoint that replaces "create deck, then push
 * cards". Three things it must guarantee:
 *   1. an empty card array is refused (EMPTY_CARDS) before any write;
 *   2. a card failure returns a structured 500 saying nothing was saved;
 *   3. a retry with the same key replays the FIRST deck instead of making a
 *      second one — the duplicate empty decks came back on every retry.
 */

/** Stands in for the api_idempotency_keys table: one key -> one stored response. */
const idempotencyStore = new Map<string, unknown>();

jest.mock('../services/idempotency', () => ({
  normalizeIdempotencyKey: (header: string | undefined, fallback?: string) =>
    (Array.isArray(header) ? header[0] : header) || fallback || null,
  withIdempotency: async (
    _client: unknown,
    userId: string,
    op: string,
    key: string | null,
    fn: () => Promise<unknown>,
  ) => {
    if (!key) return fn();
    const storeKey = `${userId}:${op}:${key}`;
    if (idempotencyStore.has(storeKey)) return idempotencyStore.get(storeKey);
    const result = await fn();
    idempotencyStore.set(storeKey, result);
    return result;
  },
}));

import { DeckWithCardsError } from '../services/deckWithCards';
import { setIdempotencyClient } from '../middleware/idempotency';
import router, { initializeDeckRoutes } from './decks';
import { stubDataLayer } from '../services/data/testStub';

// The stubbed withIdempotency above never touches it, but the middleware
// resolves the client before calling through.
setIdempotencyClient(() => ({}) as any);

async function runRoute(method: 'post', path: string, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);

  const res: any = { statusCode: 200, body: undefined };
  const settled = new Promise<void>((resolve, reject) => {
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

  await settled;
  return res;
}

const request = (body: any, headers: Record<string, string> = {}) => ({
  user: { id: 'user-1' },
  body,
  headers,
  query: {},
  params: {},
});

const cards = [
  { front: 'What is SDOH?', back: 'Social determinants of health' },
  { front: 'Name one', back: 'Housing' },
];

function initWith(createDeckWithCards: jest.Mock, addCardsToExistingDeck?: jest.Mock) {
  const cache = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    deletePattern: async () => {},
  };
  initializeDeckRoutes(
    stubDataLayer({ createDeckWithCards, addCardsToExistingDeck }) as any,
    cache as any,
  );
}

const EXISTING_DECK_ID = '11111111-2222-4333-8444-555555555555';

beforeEach(() => {
  idempotencyStore.clear();
  jest.clearAllMocks();
});

describe('POST /decks/with-cards', () => {
  it('refuses an empty card array without touching the database', async () => {
    const createDeckWithCards = jest.fn();
    initWith(createDeckWithCards);

    const res = await runRoute('post', '/with-cards', request({ name: 'SDOH', cards: [] }));

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: 'EMPTY_CARDS', retryable: false });
    expect(createDeckWithCards).not.toHaveBeenCalled();
  });

  it('names the offending card instead of a generic validation error', async () => {
    const createDeckWithCards = jest.fn();
    initWith(createDeckWithCards);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'SDOH', cards: [{ front: 'q', back: 'a' }, { front: 'q2' }] }),
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ code: 'INVALID_CARD', cardIndex: 1, field: 'back' });
    expect(createDeckWithCards).not.toHaveBeenCalled();
  });

  it('creates the deck and its cards in one call', async () => {
    const createDeckWithCards = jest.fn(async () => ({
      deck: { id: 'deck-1', name: 'SDOH' },
      flashcards: [{ id: 'c1' }, { id: 'c2' }],
      atomic: true,
    }));
    initWith(createDeckWithCards);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'SDOH', cards, source: { noteId: 'note-1' } }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data).toMatchObject({ cardCount: 2, atomic: true });
    expect(res.body.data.deck.id).toBe('deck-1');
    expect(createDeckWithCards).toHaveBeenCalledTimes(1);
  });

  it('replays the first response on a retry with the same key', async () => {
    let created = 0;
    const createDeckWithCards = jest.fn(async () => {
      created += 1;
      return {
        deck: { id: `deck-${created}`, name: 'SDOH' },
        flashcards: [{ id: 'c1' }, { id: 'c2' }],
        atomic: true,
      };
    });
    initWith(createDeckWithCards);

    const body = { name: 'SDOH', cards, source: { jobId: 'job-7' } };
    const first = await runRoute('post', '/with-cards', request(body));
    const retry = await runRoute('post', '/with-cards', request(body));

    expect(first.body.data.deck.id).toBe('deck-1');
    // The retry must NOT produce deck-2 — that duplicate is the bug.
    expect(retry.body.data.deck.id).toBe('deck-1');
    expect(createDeckWithCards).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit Idempotency-Key header over the job id', async () => {
    const createDeckWithCards = jest.fn(async () => ({
      deck: { id: 'deck-1', name: 'SDOH' },
      flashcards: [{ id: 'c1' }],
      atomic: true,
    }));
    initWith(createDeckWithCards);

    const body = { name: 'SDOH', cards };
    await runRoute('post', '/with-cards', request(body, { 'idempotency-key': 'key-a' }));
    await runRoute('post', '/with-cards', request(body, { 'idempotency-key': 'key-a' }));
    await runRoute('post', '/with-cards', request(body, { 'idempotency-key': 'key-b' }));

    expect(createDeckWithCards).toHaveBeenCalledTimes(2);
  });

  it('reports a rolled-back write as a structured 500, not a bare 500', async () => {
    const createDeckWithCards = jest.fn(async () => {
      throw new DeckWithCardsError('CARD_WRITE_FAILED', 'check constraint', true);
    });
    initWith(createDeckWithCards);

    const res = await runRoute('post', '/with-cards', request({ name: 'SDOH', cards }));

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: 'CARD_WRITE_FAILED', rolledBack: true });
    expect(res.body.error).toContain('Nothing was added to your library');
  });

  it('does not cache a failed attempt — the next retry runs again', async () => {
    let attempts = 0;
    const createDeckWithCards = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new DeckWithCardsError('CARD_WRITE_FAILED', 'boom', true);
      return { deck: { id: 'deck-1' }, flashcards: [{ id: 'c1' }], atomic: true };
    });
    initWith(createDeckWithCards);

    const body = { name: 'SDOH', cards, clientKey: 'key-c' };
    const failed = await runRoute('post', '/with-cards', request(body));
    expect(failed.statusCode).toBe(500);

    const retry = await runRoute('post', '/with-cards', request(body));
    expect(retry.statusCode).toBe(201);
  });
});

/**
 * Generation opened from inside a deck sends that deck's id. The server used
 * to ignore it and create a SECOND deck with the same name while the client
 * filed the cards under the original — a duplicate in the library and an
 * original still missing its cards.
 */
describe('POST /decks/with-cards with an existing deckId', () => {
  it('appends to the named deck instead of creating a second one', async () => {
    const createDeckWithCards = jest.fn();
    const addCardsToExistingDeck = jest.fn(async () => ({
      deck: { id: EXISTING_DECK_ID, name: 'Pharmacology' },
      flashcards: [{ id: 'c1' }, { id: 'c2' }],
      atomic: true,
    }));
    initWith(createDeckWithCards, addCardsToExistingDeck);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'Pharmacology', deckId: EXISTING_DECK_ID, cards }),
    );

    expect(res.statusCode).toBe(201);
    expect(res.body.data.deck.id).toBe(EXISTING_DECK_ID);
    expect(res.body.data).toMatchObject({ cardCount: 2, atomic: true });
    // The duplicate deck is the bug: this path must never create one.
    expect(createDeckWithCards).not.toHaveBeenCalled();
    expect(addCardsToExistingDeck).toHaveBeenCalledWith(
      EXISTING_DECK_ID,
      expect.arrayContaining([expect.objectContaining({ front: 'What is SDOH?' })]),
      'user-1',
    );
  });

  it('creates a deck when no deckId is sent', async () => {
    const createDeckWithCards = jest.fn(async () => ({
      deck: { id: 'deck-1', name: 'SDOH' },
      flashcards: [{ id: 'c1' }],
      atomic: true,
    }));
    const addCardsToExistingDeck = jest.fn();
    initWith(createDeckWithCards, addCardsToExistingDeck);

    const res = await runRoute('post', '/with-cards', request({ name: 'SDOH', cards }));

    expect(res.statusCode).toBe(201);
    expect(addCardsToExistingDeck).not.toHaveBeenCalled();
    expect(createDeckWithCards).toHaveBeenCalledTimes(1);
  });

  it('answers 404 when the deck is gone or not editable', async () => {
    const createDeckWithCards = jest.fn();
    const addCardsToExistingDeck = jest.fn(async () => null);
    initWith(createDeckWithCards, addCardsToExistingDeck);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'Pharmacology', deckId: EXISTING_DECK_ID, cards }),
    );

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, retryable: false });
    expect(createDeckWithCards).not.toHaveBeenCalled();
  });

  it('rejects a local draft id instead of sending it to the database', async () => {
    const createDeckWithCards = jest.fn();
    const addCardsToExistingDeck = jest.fn();
    initWith(createDeckWithCards, addCardsToExistingDeck);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'Pharmacology', deckId: 'temp_local_deck', cards }),
    );

    expect(res.statusCode).toBe(400);
    expect(addCardsToExistingDeck).not.toHaveBeenCalled();
    expect(createDeckWithCards).not.toHaveBeenCalled();
  });

  it('reports a failed card insert as nothing-saved, leaving the deck untouched', async () => {
    const addCardsToExistingDeck = jest.fn(async () => {
      throw new DeckWithCardsError('CARD_WRITE_FAILED', 'check constraint', true);
    });
    initWith(jest.fn(), addCardsToExistingDeck);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ name: 'Pharmacology', deckId: EXISTING_DECK_ID, cards }),
    );

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({ code: 'CARD_WRITE_FAILED', rolledBack: true });
  });
});

/**
 * The payload both clients actually send.
 *
 * Every generated-deck save on web and mobile goes through one request built by
 * `services/jobArtifacts.ts`. When that request tripped express-validator the
 * body came back as `{ error: 'Validation Error', message: '<the real reason>' }`
 * — and the clients render `error`, so the student got the bare words
 * "Validation Error" over cards that were never filed. These pin the shape that
 * must be accepted, and the one field that has to reach the write: a deck
 * generated from a note inside a study set belongs to that set.
 */
describe('POST /decks/with-cards — the shape the clients send', () => {
  const SET_ID = '22222222-3333-4444-8555-666666666666';
  const COURSE_ID = '33333333-4444-4555-8666-777777777777';

  const ok = () =>
    jest.fn(async () => ({
      deck: { id: 'deck-1', name: 'From: Note', study_set_id: SET_ID },
      flashcards: [{ id: 'c1' }, { id: 'c2' }],
      atomic: true,
    }));

  it('accepts the mobile deck save and files it into the study set', async () => {
    const createDeckWithCards = ok();
    initWith(createDeckWithCards);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({
        clientKey: 'job-42',
        name: 'From: Note',
        description: 'Generated from note: Note',
        courseId: COURSE_ID,
        studySetId: SET_ID,
        topicId: null,
        cards,
      }),
    );

    expect(res.statusCode).toBe(201);
    // The set has to reach the write, not just the request.
    expect(createDeckWithCards).toHaveBeenCalledTimes(1);
    expect((createDeckWithCards.mock.calls[0] as unknown[])[0]).toMatchObject({
      studySetId: SET_ID,
      courseId: COURSE_ID,
    });
    expect(res.body.data.deck.study_set_id).toBe(SET_ID);
  });

  it('accepts a save with no course, set or topic at all', async () => {
    const createDeckWithCards = ok();
    initWith(createDeckWithCards);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ clientKey: 'job-43', name: 'From: Note', description: 'd', cards }),
    );

    expect(res.statusCode).toBe(201);
  });

  it('answers a bare "Validation Error" for an empty-string id — which is why the clients must send null', async () => {
    const createDeckWithCards = ok();
    initWith(createDeckWithCards);

    const res = await runRoute(
      'post',
      '/with-cards',
      request({ clientKey: 'job-44', name: 'From: Note', studySetId: '', cards }),
    );

    // Documented, not endorsed: `optional({ values: 'null' })` skips undefined
    // and null but runs isUUID on ''. The nothing-was-saved failure a student
    // saw as "Validation Error" was exactly this, so the clients normalise a
    // missing id to null before it ever leaves the device.
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ error: 'Validation Error', field: 'studySetId' });
    expect(createDeckWithCards).not.toHaveBeenCalled();
  });
});
