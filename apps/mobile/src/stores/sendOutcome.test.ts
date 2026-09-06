import {
  OFFLINE_QUEUED_TOAST,
  classifySendFailure,
  isQueueableSendError,
  queuedOutcome,
  sendOutcomeToast,
  sentOutcome,
  shouldClearComposer,
  toSendError,
} from './sendOutcome';

describe('isQueueableSendError', () => {
  it('queues the airplane-mode failure students actually hit', () => {
    expect(isQueueableSendError(new Error('Network request failed'))).toBe(true);
  });

  it('queues timeouts, 408, 429 and server errors', () => {
    expect(isQueueableSendError(new Error('The request timed out'))).toBe(true);
    expect(isQueueableSendError({ status: 408 })).toBe(true);
    expect(isQueueableSendError({ status: 429 })).toBe(true);
    expect(isQueueableSendError({ status: 503 })).toBe(true);
  });

  it('does not queue a rejection the user must act on', () => {
    expect(isQueueableSendError({ status: 401 })).toBe(false);
    expect(isQueueableSendError({ status: 403, message: 'network error' })).toBe(false);
    expect(isQueueableSendError(new Error('Message too long'))).toBe(false);
    expect(isQueueableSendError(undefined)).toBe(false);
  });
});

describe('classifySendFailure', () => {
  it('maps a dead connection to queued and a rejection to failed', () => {
    expect(classifySendFailure(new Error('Network request failed'))).toBe('queued');
    expect(classifySendFailure({ status: 400 })).toBe('failed');
  });
});

describe('outcome shaping', () => {
  it('carries the row it settled on', () => {
    expect(sentOutcome({ id: 'server-1' })).toEqual({ status: 'sent', message: { id: 'server-1' } });
    expect(queuedOutcome({ id: 'opt-1' })).toEqual({ status: 'queued', message: { id: 'opt-1' } });
  });

  it('normalises anything thrown into an Error without losing the message', () => {
    const original = new Error('boom');
    expect(toSendError(original)).toBe(original);
    expect(toSendError({ message: 'rejected' }).message).toBe('rejected');
    expect(toSendError(null).message).toBe('Failed to send message');
  });
});

describe('user-facing reactions', () => {
  it('only a queued send gets a toast', () => {
    expect(sendOutcomeToast('queued')).toBe(OFFLINE_QUEUED_TOAST);
    expect(sendOutcomeToast('sent')).toBeNull();
    expect(sendOutcomeToast('failed')).toBeNull();
  });

  it('never says the work was lost', () => {
    expect(OFFLINE_QUEUED_TOAST).toMatch(/will send when the connection is back/i);
    expect(OFFLINE_QUEUED_TOAST).not.toMatch(/fail|lost|error/i);
    // A 503 or a timeout also queues while the phone is online, so the toast
    // must not claim the student is offline.
    expect(OFFLINE_QUEUED_TOAST).not.toMatch(/you're offline/i);
  });

  it('clears the composer for sent and queued, keeps the text for failed', () => {
    expect(shouldClearComposer('sent')).toBe(true);
    expect(shouldClearComposer('queued')).toBe(true);
    expect(shouldClearComposer('failed')).toBe(false);
  });
});
