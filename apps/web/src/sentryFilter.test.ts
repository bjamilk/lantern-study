import { describe, expect, it } from 'vitest';

import { isExpectedClientCondition } from '../../../services/sentry';

/**
 * SW / Sentry WEB-1K, WEB-1M, WEB-1Q, WEB-1T, WEB-18: raw
 * "HTTP Client Error with status code: …" events for conditions the app
 * already handles were arriving as errors and burying the real crashes.
 */
describe('isExpectedClientCondition', () => {
  const httpClientEvent = (status: number, url?: string) => ({
    message: `HTTP Client Error with status code: ${status}`,
    request: url ? { url } : undefined,
    contexts: { response: { status_code: status } },
  });

  it.each([401, 403, 408, 429, 502, 503, 504])('drops an expected %i', (status) => {
    expect(isExpectedClientCondition(httpClientEvent(status))).toBe(true);
  });

  it('keeps a 500 — an API crash is not an expected client condition', () => {
    expect(isExpectedClientCondition(httpClientEvent(500))).toBe(false);
  });

  it('keeps a plain 400 — a rejected payload is a bug worth seeing', () => {
    expect(
      isExpectedClientCondition(httpClientEvent(400, 'https://lanternstudy.com/api/v1/notes'))
    ).toBe(false);
  });

  it('drops the 400 supabase answers on a cookie-managed token refresh', () => {
    expect(
      isExpectedClientCondition(httpClientEvent(400, 'https://xyz.supabase.co/auth/v1/token'))
    ).toBe(true);
  });

  it('reads the status out of an ApiClientError sentence when there is no response context', () => {
    expect(
      isExpectedClientCondition({
        exception: { values: [{ type: 'ApiClientError', value: 'Request failed (status: 429)' }] },
      })
    ).toBe(true);
  });

  it('keeps an error that carries no status at all', () => {
    expect(isExpectedClientCondition({ message: 'Cannot read properties of undefined' })).toBe(
      false
    );
  });
});
