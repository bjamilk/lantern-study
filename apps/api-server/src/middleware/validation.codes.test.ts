/**
 * Every 400 from express-validator used to read "Validation Error / Invalid
 * request data" with no field. The mobile sync queue could not tell a payload
 * that will NEVER be accepted (a card whose deckId is a local `temp_…` draft
 * id) from a server hiccup worth retrying — so it replayed the rejected write
 * forever (240 identical `[SyncHandler:flashcard] Error: Validation Error
 * status 400` lines in one session).
 *
 * The rejection now carries `code`, `field` and `retryable: false`.
 */
import { validationResult } from 'express-validator';
import {
  handleValidationErrors,
  validateFlashcardCreate,
  validationCodeForField,
} from './validation';

async function runValidators(validators: any[], body: unknown) {
  const req: any = { body, query: {}, params: {}, headers: {} };
  for (const validator of validators) {
    await validator.run(req);
  }
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  let nextCalled = false;
  handleValidationErrors(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled, errors: validationResult(req).array() };
}

describe('validationCodeForField', () => {
  it('derives a stable machine code from the field path', () => {
    expect(validationCodeForField('deckId')).toBe('INVALID_DECK_ID');
    expect(validationCodeForField('config.courseId')).toBe('INVALID_CONFIG_COURSE_ID');
    expect(validationCodeForField('cards[3].front')).toBe('INVALID_CARDS_FRONT');
    expect(validationCodeForField('')).toBe('INVALID_BODY');
  });
});

describe('handleValidationErrors', () => {
  it('classifies a temp deck id as a permanent, non-retryable failure', async () => {
    const { res, nextCalled } = await runValidators(validateFlashcardCreate, {
      deckId: 'temp_1756900000000',
      front: 'q',
      back: 'a',
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      code: 'INVALID_DECK_ID',
      field: 'deckId',
      retryable: false,
    });
    // The message has to say WHY, or a client can only log it again.
    expect(res.body.message).toContain('temp_');
  });

  it('reports the missing side of a basic card by name', async () => {
    const { res } = await runValidators(validateFlashcardCreate, {
      deckId: '2f1c1e0a-0000-4000-8000-000000000001',
      front: 'q',
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('back is required for basic cards');
    expect(res.body.retryable).toBe(false);
  });

  it('still carries the full details array for logging', async () => {
    const { res } = await runValidators(validateFlashcardCreate, { deckId: 'nope' });
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.error).toBe('Validation Error');
  });

  it('passes a valid body straight through', async () => {
    const { res, nextCalled } = await runValidators(validateFlashcardCreate, {
      deckId: '2f1c1e0a-0000-4000-8000-000000000001',
      front: 'q',
      back: 'a',
    });
    expect(nextCalled).toBe(true);
    expect(res.body).toBeUndefined();
  });
});
