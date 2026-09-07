import {
  isDoomedTempDeckOp,
  isPermanentSyncError,
  syncErrorMessage,
  syncErrorStatus,
} from './syncErrorPolicy';

const httpError = (status: number, message = 'Validation Error') =>
  Object.assign(new Error(message), { status });

describe('isPermanentSyncError', () => {
  it('treats a 400 as permanent — replaying it cannot make it valid', () => {
    expect(isPermanentSyncError(httpError(400))).toBe(true);
    expect(isPermanentSyncError(httpError(404))).toBe(true);
    expect(isPermanentSyncError(httpError(422))).toBe(true);
  });

  it('keeps retrying the 4xx codes that describe the moment, not the request', () => {
    for (const status of [401, 403, 408, 425, 429]) {
      expect(isPermanentSyncError(httpError(status))).toBe(false);
    }
  });

  it('never claims a 5xx or a status-less failure is permanent', () => {
    expect(isPermanentSyncError(httpError(500))).toBe(false);
    expect(isPermanentSyncError(httpError(503))).toBe(false);
    expect(isPermanentSyncError(new Error('Network request failed'))).toBe(false);
    expect(isPermanentSyncError(null)).toBe(false);
    expect(isPermanentSyncError(undefined)).toBe(false);
  });
});

describe('syncErrorStatus', () => {
  it('reads a numeric status and ignores anything else', () => {
    expect(syncErrorStatus(httpError(400))).toBe(400);
    expect(syncErrorStatus(Object.assign(new Error('x'), { status: '400' }))).toBeUndefined();
    expect(syncErrorStatus(new Error('x'))).toBeUndefined();
  });
});

describe('syncErrorMessage', () => {
  it('keeps a message that says something', () => {
    expect(syncErrorMessage(httpError(400, 'Front is required'), 'fallback')).toBe(
      'Front is required'
    );
  });

  it('replaces the messages that say nothing', () => {
    expect(syncErrorMessage(httpError(400, 'Validation Error'), 'fallback')).toBe('fallback');
    expect(syncErrorMessage(httpError(400, '  '), 'fallback')).toBe('fallback');
    expect(syncErrorMessage(httpError(400, 'Request failed'), 'fallback')).toBe('fallback');
    expect(syncErrorMessage({}, 'fallback')).toBe('fallback');
  });
});

describe('isDoomedTempDeckOp', () => {
  it('flags a card create aimed at a deck the server never issued', () => {
    expect(
      isDoomedTempDeckOp({
        entityType: 'flashcard',
        entityId: 'temp_card_1',
        operation: 'create',
        data: { deckId: 'temp_deck_1756' },
      })
    ).toBe(true);
  });

  it('flags an update or delete against a card that was never created', () => {
    expect(
      isDoomedTempDeckOp({
        entityType: 'flashcard',
        entityId: 'temp_card_1',
        operation: 'update',
        data: { front: 'x' },
      })
    ).toBe(true);
  });

  it('leaves real work alone', () => {
    expect(
      isDoomedTempDeckOp({
        entityType: 'flashcard',
        entityId: 'temp_card_1',
        operation: 'create',
        data: { deckId: 'deck-abc' },
      })
    ).toBe(false);
    // A deck create carries no server id and is perfectly replayable.
    expect(
      isDoomedTempDeckOp({
        entityType: 'deck',
        entityId: 'temp_deck_1',
        operation: 'create',
        data: { name: 'Offline deck' },
      })
    ).toBe(false);
  });
});
