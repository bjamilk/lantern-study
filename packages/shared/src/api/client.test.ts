/**
 * The 401 contract.
 *
 * A boolean `refreshAuth` could not tell "the server revoked this session"
 * from "the phone could not reach the server", so both ended in
 * onUnauthorized — i.e. a dropped connection signed students out and (on
 * mobile) took their unsynced work with it. These tests pin the third state.
 */
import { createApiClient, isOfflineAuthError, OFFLINE_AUTH_MESSAGE } from './client';

const BASE = 'https://api.test';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setFetch(responses: Response[]): jest.Mock {
  const mock = jest.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error('fetch called more times than the test queued');
    return next;
  });
  (globalThis as { fetch: unknown }).fetch = mock;
  return mock;
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = originalFetch;
  jest.restoreAllMocks();
});

function baseConfig() {
  return {
    getBaseUrl: () => BASE,
    getAuthHeaders: async () => ({ Authorization: 'Bearer stale' }),
  };
}

describe('createApiClient — 401 with a transient refresh failure', () => {
  it('calls onOffline, never onUnauthorized, and throws an offline 401', async () => {
    const fetchMock = setFetch([jsonResponse(401, { error: 'Unauthorized' })]);
    const onUnauthorized = jest.fn();
    const onOffline = jest.fn();

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth: async () => 'transient',
      onUnauthorized,
      onOffline,
    });

    const error = await client.request('/decks').then(
      () => {
        throw new Error('request should have rejected');
      },
      (e: unknown) => e
    );

    expect(onOffline).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(isOfflineAuthError(error)).toBe(true);
    expect((error as Error).message).toBe(OFFLINE_AUTH_MESSAGE);
    expect((error as { status?: number }).status).toBe(401);
    expect((error as { offline?: boolean }).offline).toBe(true);
    // The failed request is NOT replayed: nothing was refreshed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not sign out even when the 401 body carries a non-definitive code', async () => {
    setFetch([jsonResponse(401, { code: 'TOKEN_EXPIRED', message: 'jwt expired' })]);
    const onUnauthorized = jest.fn();
    const onOffline = jest.fn();

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth: async () => 'transient',
      onUnauthorized,
      onOffline,
    });

    await expect(client.request('/decks')).rejects.toThrow(OFFLINE_AUTH_MESSAGE);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onOffline).toHaveBeenCalledTimes(1);
  });
});

describe('createApiClient — 401 with a successful refresh', () => {
  it('retries the request exactly once and returns the retried body', async () => {
    const fetchMock = setFetch([
      jsonResponse(401, { error: 'Unauthorized' }),
      jsonResponse(200, { data: { ok: true } }),
    ]);
    const onUnauthorized = jest.fn();
    const onOffline = jest.fn();
    const refreshAuth = jest.fn(async () => true);

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth,
      onUnauthorized,
      onOffline,
    });

    await expect(client.request('/decks')).resolves.toEqual({ ok: true });
    expect(refreshAuth).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onOffline).not.toHaveBeenCalled();
  });
});

describe('createApiClient — 401 with a proven-dead session', () => {
  it('calls onUnauthorized when refreshAuth returns false', async () => {
    setFetch([jsonResponse(401, { message: 'Session ended. Please sign in again.' })]);
    const onUnauthorized = jest.fn();
    const onOffline = jest.fn();

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth: async () => false,
      onUnauthorized,
      onOffline,
    });

    await expect(client.request('/decks')).rejects.toThrow('Session ended. Please sign in again.');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(onOffline).not.toHaveBeenCalled();
  });

  it.each(['SESSION_REVOKED', 'ACCOUNT_BANNED', 'ACCOUNT_DEACTIVATED'])(
    'calls onUnauthorized for a definitive %s code without attempting a refresh',
    async (code) => {
      setFetch([jsonResponse(401, { code, message: 'Session ended. Please sign in again.' })]);
      const onUnauthorized = jest.fn();
      const onOffline = jest.fn();
      const refreshAuth = jest.fn(async () => 'transient' as const);

      const client = createApiClient({
        ...baseConfig(),
        refreshAuth,
        onUnauthorized,
        onOffline,
      });

      await expect(client.request('/decks')).rejects.toThrow('Session ended.');
      expect(refreshAuth).not.toHaveBeenCalled();
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
      expect(onOffline).not.toHaveBeenCalled();
    }
  );
});

describe('createApiClient — 401 with no refreshAuth configured', () => {
  it('is gated the same way: offline error, no sign-out', async () => {
    setFetch([jsonResponse(401, { error: 'Unauthorized' })]);
    const onUnauthorized = jest.fn();
    const onOffline = jest.fn();

    const client = createApiClient({ ...baseConfig(), onUnauthorized, onOffline });

    const error = await client.request('/decks').catch((e: unknown) => e);
    expect(isOfflineAuthError(error)).toBe(true);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(onOffline).toHaveBeenCalledTimes(1);
  });
});

describe('isOfflineAuthError', () => {
  it('rejects ordinary errors and non-objects', () => {
    expect(isOfflineAuthError(new Error('boom'))).toBe(false);
    expect(isOfflineAuthError({ status: 401 })).toBe(false);
    expect(isOfflineAuthError({ offline: true })).toBe(false);
    expect(isOfflineAuthError(null)).toBe(false);
    expect(isOfflineAuthError('offline')).toBe(false);
  });
});

/**
 * F9 · E3 L2: `requestText` used to be a second, bare copy of the fetch —
 * no refresh, no SESSION_REVOKED, and every failure flattened to the string
 * `HTTP error <status>` with nothing machine-readable on it. A student with a
 * just-expired token exporting a deck got a number and no recovery. These pin
 * that the text path now runs the SAME core as the JSON path.
 */
describe('requestText shares the request core', () => {
  it('refreshes once on a 401 and returns the retried body', async () => {
    const fetchMock = setFetch([
      jsonResponse(401, { error: 'Unauthorized' }),
      new Response('front,back\na,b', { status: 200 }),
    ]);
    const onUnauthorized = jest.fn();

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth: async () => true,
      onUnauthorized,
    });

    await expect(client.requestText('/decks/1/export')).resolves.toBe('front,back\na,b');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('signs out once on a definitive 401 rather than throwing a bare number', async () => {
    setFetch([jsonResponse(401, { code: 'SESSION_REVOKED', message: 'Session ended.' })]);
    const onUnauthorized = jest.fn();

    const client = createApiClient({
      ...baseConfig(),
      refreshAuth: async () => true,
      onUnauthorized,
    });

    await expect(client.requestText('/decks/1/export')).rejects.toThrow('Session ended.');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('carries the server sentence and status on a plain failure', async () => {
    setFetch([jsonResponse(404, { error: 'Deck not found' })]);
    const client = createApiClient(baseConfig());

    const error = await client.requestText('/decks/missing/export').then(
      () => {
        throw new Error('requestText should have rejected');
      },
      (err: Error & { status?: number }) => err
    );

    expect(error.message).toBe('Deck not found');
    expect(error.status).toBe(404);
  });
});
