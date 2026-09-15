/**
 * SW / Sentry LANTERN-STUDY-API-2: "Error: Gateway Timeout" thrown inside
 * POST /api/v1/users/presence/heartbeat, 25 events. A status-less Error from
 * PostgREST is filed by @sentry/node as a 500, so a nicety (the online dot)
 * read as a server crash — and the client saw a hard failure on a beat that is
 * fire-and-forget by design.
 */
import { withUpstreamTimeout, PRESENCE_UPSTREAM_TIMEOUT_MS } from './upstreamTimeout';

describe('withUpstreamTimeout', () => {
  it('passes the value through on success', async () => {
    await expect(withUpstreamTimeout(Promise.resolve('ok'), 50)).resolves.toEqual({
      ok: true,
      value: 'ok',
    });
  });

  it('reports a rejection instead of throwing it', async () => {
    const boom = new Error('Gateway Timeout');
    const result = await withUpstreamTimeout(Promise.reject(boom), 50);
    expect(result).toMatchObject({ ok: false, reason: 'error', error: boom });
  });

  it('gives up when the upstream never answers', async () => {
    const result = await withUpstreamTimeout(new Promise(() => {}), 10);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('does not leave a late rejection unhandled', async () => {
    let reject: (e: unknown) => void = () => {};
    const never = new Promise((_resolve, r) => {
      reject = r;
    });
    const result = await withUpstreamTimeout(never, 10);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    reject(new Error('late'));
    // If the rejection were unattached, this tick would emit an
    // unhandledRejection and fail the suite.
    await new Promise((r) => setTimeout(r, 5));
  });

  it('answers well inside the web client 8s fetch timeout', () => {
    expect(PRESENCE_UPSTREAM_TIMEOUT_MS).toBeLessThan(8000);
  });
});
