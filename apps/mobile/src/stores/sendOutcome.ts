// ===========================================
// Lantern Study Mobile - chat send outcomes
// ===========================================
//
// Pure classification + result shaping for chat sends. A send that fails on a
// dead connection is NOT a failure: the row is already in the outbox and will
// flush on reconnect. Telling the student "Send failed" (and leaving the text
// in the composer, inviting a duplicate) was a lie about work that was safely
// queued, so the store reports the three real outcomes and the screens react to
// each one honestly.

/** 'sent' = the server has it. 'queued' = it is in the outbox. 'failed' = it is not going anywhere without the user. */
export type SendStatus = 'sent' | 'queued' | 'failed';

export interface SendOutcome<T> {
  status: SendStatus;
  /** The row now in state: the server copy for 'sent', the pending optimistic row for 'queued'. */
  message?: T;
}

/** Network-shaped failure — worth queueing rather than surfacing as failed. */
export function isQueueableSendError(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === 'number') {
    if (status === 408 || status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
  }
  const message = String((error as { message?: string } | null)?.message || '');
  return /network request failed|network error|timed out|failed to fetch/i.test(message);
}

/**
 * What a send failure means for the user. Queueable errors are 'queued'
 * (the caller must actually have enqueued the operation); everything else —
 * a server rejection, an auth error — is 'failed' and needs their attention.
 */
export function classifySendFailure(error: unknown): 'queued' | 'failed' {
  return isQueueableSendError(error) ? 'queued' : 'failed';
}

export function sentOutcome<T>(message: T): SendOutcome<T> {
  return { status: 'sent', message };
}

export function queuedOutcome<T>(message: T): SendOutcome<T> {
  return { status: 'queued', message };
}

/** Normalises anything thrown into a real Error, preserving the message. */
export function toSendError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = (error as { message?: string } | null)?.message;
  return new Error(message || 'Failed to send message');
}

/**
 * Queued covers more than airplane mode: a timeout, a 5xx or a 429 also queue
 * while the phone is online, so the copy names the connection, not the user.
 */
export const OFFLINE_QUEUED_TOAST = "Not sent yet — it's saved and will send when the connection is back";

/**
 * Non-blocking notice for an outcome, or null when there is nothing to say.
 * 'sent' is its own confirmation (the bubble); 'failed' is an alert, not a toast.
 */
export function sendOutcomeToast(status: SendStatus): string | null {
  return status === 'queued' ? OFFLINE_QUEUED_TOAST : null;
}

/** True when the composer should be cleared: the text is safely in state either way. */
export function shouldClearComposer(status: SendStatus): boolean {
  return status === 'sent' || status === 'queued';
}
