/**
 * PUT /flashcards/:flashcardId used to silently ignore a changed `type` (and a
 * changed `deckId`): buildFlashcardUpdateData only copies editable fields, so
 * the client showed "saved" while the server discarded the change. The route
 * now refuses both with a 400 instead of pretending. Identical values still
 * pass through as no-ops, since the web client always echoes deckId back.
 */
import router, { initializeFlashcardRoutes } from './flashcards';
import { stubDataLayer } from '../services/data/testStub';

const CARD = {
  id: 'card-1',
  deck_id: 'deck-1',
  type: 'BASIC',
  front: 'Q',
  back: 'A',
  version: 3,
};

/**
 * asyncHandler swallows its own promise, so awaiting the handler proves
 * nothing — wait on the response instead. The route body is the last handler
 * on the layer (after authMiddleware).
 */
async function runPut(req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/:flashcardId' && l.route?.methods?.put,
  );
  if (!layer) throw new Error('route PUT /:flashcardId not found');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

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
    handler(req, res, (err: unknown) => reject(err));
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });

  await settled;
  return res;
}

function init() {
  const supabase: any = {
    getFlashcardForUser: jest.fn(async () => ({ ...CARD })),
    updateFlashcard: jest.fn(async () => ({ ...CARD, front: 'Q2', version: 4 })),
  };
  const cache: any = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    deletePattern: jest.fn(async () => {}),
  };
  initializeFlashcardRoutes(stubDataLayer(supabase) as any, cache);
  return { supabase, cache };
}

const request = (body: Record<string, unknown>) => ({
  params: { flashcardId: 'card-1' },
  body,
  user: { id: 'u1' },
});

describe('PUT /flashcards/:flashcardId — type/deck immutability', () => {
  it('rejects a changed type with 400 instead of silently dropping it', async () => {
    const { supabase } = init();
    const res = await runPut(request({ type: 'CLOZE', clozeText: 'The {{c1::answer}}' }));

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Card type can't be changed — recreate the card as the new type");
    expect(supabase.updateFlashcard).not.toHaveBeenCalled();
  });

  it('rejects a changed deckId with 400', async () => {
    const { supabase } = init();
    const res = await runPut(request({ deckId: 'deck-2', front: 'Q2' }));

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Moving cards between decks isn't supported yet");
    expect(supabase.updateFlashcard).not.toHaveBeenCalled();
  });

  it('lets identical type and deckId pass through as no-ops', async () => {
    const { supabase } = init();
    const res = await runPut(request({ type: 'BASIC', deckId: 'deck-1', front: 'Q2' }));

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(supabase.updateFlashcard).toHaveBeenCalledWith(
      'card-1',
      expect.objectContaining({ front: 'Q2' }),
      'u1',
      expect.anything(),
    );
  });

  it('404s when the card is not visible to the user', async () => {
    const { supabase } = init();
    supabase.getFlashcardForUser.mockResolvedValueOnce(null);
    const res = await runPut(request({ type: 'CLOZE' }));

    expect(res.statusCode).toBe(404);
    expect(supabase.updateFlashcard).not.toHaveBeenCalled();
  });

  it('still updates normally when neither type nor deckId is sent', async () => {
    const { supabase } = init();
    const res = await runPut(request({ front: 'Q2' }));

    expect(res.statusCode).toBe(200);
    expect(supabase.getFlashcardForUser).not.toHaveBeenCalled();
    expect(supabase.updateFlashcard).toHaveBeenCalled();
  });
});
