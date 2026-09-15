/**
 * The ONE web transport (R1), on top of the F1 auth policy.
 *
 * What these pin, and why each one exists:
 *  - ONE auth retry, then surface. Five hand-rolled copies of this in
 *    `services/supabase.ts` disagreed about the budget; one of them (E3 C4)
 *    recursed forever on a 403 that refreshed cleanly.
 *  - A 403 is never replayed, no matter how healthy the session is.
 *  - A viewer who never held a token is not told their session expired.
 *  - Transient retry is OFF unless asked for, and even then a POST needs an
 *    explicit idempotent flag — migrating a call site must never add a
 *    request it did not make before.
 *  - The timeout surfaces as `Error('Request timed out')`, the sentence the
 *    existing catch blocks match on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getAuthHeaders = vi.fn(async () => ({ Authorization: 'Bearer live' }));
const hasCachedAccessToken = vi.fn(() => true);
const noteSuspendedResponse = vi.fn(async () => true);
const handleApiAuthFailure = vi.fn(async () => false);
const signOutForAuthCode = vi.fn();

vi.mock('./supabase', () => ({
  getApiRoot: () => 'https://api.test',
  getAuthHeaders: (...a: unknown[]) => getAuthHeaders(...(a as [])),
  hasCachedAccessToken: () => hasCachedAccessToken(),
  withApiCredentials: (init: RequestInit = {}) => ({
    ...init,
    credentials: 'include' as RequestCredentials,
    headers: { 'X-Requested-With': 'LanternStudy', ...(init.headers as Record<string, string>) },
  }),
}));
vi.mock('./accountSuspension', () => ({
  noteSuspendedResponse: (...a: unknown[]) => noteSuspendedResponse(...(a as [])),
}));
vi.mock('./sessionHandler', () => ({
  handleApiAuthFailure: (...a: unknown[]) => handleApiAuthFailure(...(a as [])),
  isTerminalAuthCode: (code?: string) =>
    code === 'SESSION_REVOKED' || code === 'ACCOUNT_BANNED' || code === 'ACCOUNT_DEACTIVATED',
  readAuthFailureCode: async (response: Response) =>
    ((await response.clone().json().catch(() => ({}))) as { code?: string }).code,
  signOutForAuthCode: (...a: unknown[]) => signOutForAuthCode(...(a as [])),
}));

function jsonResponse(status: number, body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

async function loadModule() {
  vi.resetModules();
  return import('./apiFetch');
}

beforeEach(() => {
  vi.clearAllMocks();
  hasCachedAccessToken.mockReturnValue(true);
  handleApiAuthFailure.mockResolvedValue(false);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

describe('auth retry', () => {
  it('replays ONCE after a refresh, then surfaces the second failure', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(401));
    // The policy allows the first attempt to retry and refuses the second.
    handleApiAuthFailure.mockImplementation(
      async (_r: unknown, opts: { attempt?: number } = {}) => (opts.attempt ?? 0) === 0
    );

    const response = await apiFetch('/api/v1/thing');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(handleApiAuthFailure).toHaveBeenNthCalledWith(1, expect.anything(), { attempt: 0 });
    expect(handleApiAuthFailure).toHaveBeenNthCalledWith(2, expect.anything(), { attempt: 1 });
  });

  it('sends fresh auth headers on the replay, not the token that just 401ed', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValueOnce(jsonResponse(401)).mockResolvedValueOnce(jsonResponse(200));
    handleApiAuthFailure.mockResolvedValueOnce(true);
    getAuthHeaders.mockResolvedValueOnce({ Authorization: 'Bearer refreshed' });

    await apiFetch('/api/v1/thing', { headers: { Authorization: 'Bearer stale', 'X-Keep': '1' } });

    const replayHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(replayHeaders.Authorization).toBe('Bearer refreshed');
    // Caller headers that are not auth survive the replay (e.g. Idempotency-Key).
    expect(replayHeaders['X-Keep']).toBe('1');
  });

  it('never replays a 403, and records the suspension', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(403, { code: 'ACCOUNT_SUSPENDED' }));

    const response = await apiFetch('/api/v1/thing');

    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(noteSuspendedResponse).toHaveBeenCalled();
  });

  it('signs out once on a terminal code without asking the retry policy', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(401, { code: 'SESSION_REVOKED' }));

    await apiFetch('/api/v1/thing');

    expect(signOutForAuthCode).toHaveBeenCalledWith('SESSION_REVOKED');
    expect(handleApiAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('leaves a guest 401 alone — no refresh, no session-expired notice', async () => {
    const { apiFetch } = await loadModule();
    hasCachedAccessToken.mockReturnValue(false);
    fetchMock.mockResolvedValue(jsonResponse(401));

    const response = await apiFetch('/api/v1/thing');

    expect(response.status).toBe(401);
    expect(handleApiAuthFailure).not.toHaveBeenCalled();
  });

  it('skips the auth path entirely when the caller opts out', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(401));

    await apiFetch('/api/v1/thing', {}, { allowAuthRetry: false });

    expect(handleApiAuthFailure).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('transient retry', () => {
  it('is off by default: a network error on a GET throws', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(apiFetch('/api/v1/thing')).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries an idempotent GET once on a network error when opted in', async () => {
    const { apiFetch } = await loadModule();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200));

    const response = await apiFetch('/api/v1/thing', {}, { retryTransient: true });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries an idempotent GET once on a 5xx when opted in', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValueOnce(jsonResponse(503)).mockResolvedValueOnce(jsonResponse(200));

    const response = await apiFetch('/api/v1/thing', {}, { retryTransient: true });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a POST, even opted in, unless it is flagged idempotent', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(
      apiFetch('/api/v1/thing', { method: 'POST' }, { retryTransient: true })
    ).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a POST the caller declares idempotent', async () => {
    const { apiFetch } = await loadModule();
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200));

    const response = await apiFetch(
      '/api/v1/thing',
      { method: 'POST' },
      { retryTransient: true, idempotent: true }
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a 4xx that is not the auth path', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(422));

    const response = await apiFetch('/api/v1/thing', {}, { retryTransient: true });

    expect(response.status).toBe(422);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('timeout', () => {
  it('aborts and throws the sentence callers match on', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        })
    );

    await expect(apiFetch('/api/v1/slow', {}, { timeoutMs: 5 })).rejects.toThrow(
      'Request timed out'
    );
  });

  it('arms no timer when the caller passes timeoutMs: null', async () => {
    const { apiFetch, timeoutSignal } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(200));

    await apiFetch('/api/v1/thing', {}, { timeoutMs: null });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(false);

    const { signal, clear } = timeoutSignal(null);
    await new Promise((r) => setTimeout(r, 10));
    expect(signal.aborted).toBe(false);
    clear();
  });
});

describe('request shaping', () => {
  it('resolves a relative path against the API root and keeps credentials', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(200));

    await apiFetch('/api/v1/thing');

    expect(fetchMock.mock.calls[0][0]).toBe('https://api.test/api/v1/thing');
    expect((fetchMock.mock.calls[0][1] as RequestInit).credentials).toBe('include');
  });

  it('passes an absolute URL through untouched', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(200));

    await apiFetch('https://elsewhere.test/x');

    expect(fetchMock.mock.calls[0][0]).toBe('https://elsewhere.test/x');
  });

  it('does not inject auth headers unless asked (multipart uploads rely on this)', async () => {
    const { apiFetch } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(200));

    await apiFetch('/api/v1/upload', { method: 'POST', headers: { 'X-Own': '1' } });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(getAuthHeaders).not.toHaveBeenCalled();

    await apiFetch('/api/v1/thing', {}, { auth: 'inject' });
    const injected = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(injected.Authorization).toBe('Bearer live');
  });
});

describe('apiJson error shape', () => {
  it('throws an ApiClientError carrying status, code and the status in the message', async () => {
    const { apiJson, ApiClientError } = await loadModule();
    fetchMock.mockResolvedValue(
      jsonResponse(400, { error: 'Failed to record score', code: 'BAD_SCORE' })
    );

    // `.status` on the property AND "status: 400" in the sentence: the pending
    // score / flashcard queues each read one of the two (F1 gave
    // recordQuestionBankScore exactly this contract).
    const error = await apiJson('/api/v1/scores', { method: 'POST' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(400);
    expect(error.code).toBe('BAD_SCORE');
    expect(error.message).toBe('Failed to record score (status: 400)');
    expect(error.retryable).toBe(false);
  });

  it('marks 5xx and transport failures retryable', async () => {
    const { apiJson, ApiClientError } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(502, { message: 'Bad gateway' }));

    const error = await apiJson('/api/v1/thing').catch((e) => e);
    expect(error.retryable).toBe(true);
    expect(new ApiClientError('offline').retryable).toBe(true);
  });

  it('returns the parsed body on success', async () => {
    const { apiJson } = await loadModule();
    fetchMock.mockResolvedValue(jsonResponse(200, { data: { ok: 1 } }));

    await expect(apiJson<{ data: { ok: number } }>('/api/v1/thing')).resolves.toEqual({
      data: { ok: 1 },
    });
  });
});
