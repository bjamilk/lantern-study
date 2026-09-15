/**
 * Regression guard for the live 400 `INVALID_CLIENT_MESSAGE_ID`.
 *
 * Lane F1 (E3 M3) switched the web optimistic id factory to
 * `createOptimisticClientMessageId`, which returns `temp-<uuid>` so every local
 * merge path can recognise an in-flight row via `isTempMessageId`. That same
 * value was then POSTed as `clientMessageId`, and the API validates it as a
 * STRICT UUID (`body('clientMessageId').optional().isUUID()` in
 * apps/api-server/src/middleware/validation.ts) — so EVERY group message send on
 * the web failed with 400.
 *
 * The invariant these pin, in one sentence: the optimistic row keeps its
 * `temp-` id, the wire value is a bare UUID, and the reconcile step still
 * matches the server's echo to the local row.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  createOptimisticClientMessageId,
  isTempMessageId,
  matchesClientMessageId,
  mergeChatMessagesById,
  toWireClientMessageId,
} from '@lantern/shared/utils';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let fetchMock: ReturnType<typeof vi.fn>;

function okJson(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * The body the client actually put on the wire for the send itself, parsed.
 * Selected by URL so an auth/session request made along the way cannot be
 * mistaken for the send.
 */
function sentBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes('/api/v1/messages/')
  );
  expect(call, 'no send request was made').toBeTruthy();
  const init = call?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body ?? '{}'));
}

beforeEach(() => {
  fetchMock = vi.fn(async () => okJson({ data: { id: 'server-id' } }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('clientMessageId on the wire', () => {
  it('sends a bare UUID for a group message while the optimistic id keeps temp-', async () => {
    const { sendMessage } = await import('./supabase');
    const optimisticId = createOptimisticClientMessageId();

    // Local state: prefixed, so every merge path recognises it as in-flight.
    expect(optimisticId.startsWith('temp-')).toBe(true);
    expect(isTempMessageId(optimisticId)).toBe(true);

    await sendMessage(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'hello',
      optimisticId
    );

    // Wire state: a strict UUID, which is what the API validator accepts.
    const body = sentBody();
    expect(body.clientMessageId).toMatch(UUID_RE);
    expect(String(body.clientMessageId).startsWith('temp-')).toBe(false);
    expect(body.clientMessageId).toBe(optimisticId.slice('temp-'.length));
  });

  it('sends a bare UUID for a direct message while the optimistic id keeps temp-', async () => {
    const { sendDirectMessage } = await import('./supabase');
    const optimisticId = createOptimisticClientMessageId();

    expect(optimisticId.startsWith('temp-')).toBe(true);

    await sendDirectMessage(
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      'hi there',
      optimisticId
    );

    const body = sentBody();
    expect(body.clientMessageId).toMatch(UUID_RE);
    expect(String(body.clientMessageId).startsWith('temp-')).toBe(false);
    expect(body.clientMessageId).toBe(optimisticId.slice('temp-'.length));
  });

  it('leaves an id that is already bare untouched, and omits an absent one', async () => {
    const { sendMessage } = await import('./supabase');
    const bare = '44444444-4444-4444-8444-444444444444';

    await sendMessage(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'hello',
      bare
    );
    expect(sentBody().clientMessageId).toBe(bare);

    fetchMock.mockClear();
    await sendMessage(
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      'hello'
    );
    expect(sentBody().clientMessageId).toBeUndefined();
  });
});

describe('reconciling the server echo back to the temp- row', () => {
  it('normalises both directions and never collapses a bare "temp-"', () => {
    const uuid = '55555555-5555-4555-8555-555555555555';
    expect(toWireClientMessageId(`temp-${uuid}`)).toBe(uuid);
    expect(toWireClientMessageId(uuid)).toBe(uuid);
    // Idempotent: a replay through the same helper is byte-identical.
    expect(toWireClientMessageId(toWireClientMessageId(`temp-${uuid}`))).toBe(uuid);
    expect(toWireClientMessageId('temp-')).toBe('temp-');

    expect(matchesClientMessageId(`temp-${uuid}`, uuid)).toBe(true);
    expect(matchesClientMessageId(uuid, `temp-${uuid}`)).toBe(true);
    expect(matchesClientMessageId(`temp-${uuid}`, `temp-${uuid}`)).toBe(true);
    expect(matchesClientMessageId(`temp-${uuid}`, undefined)).toBe(false);
    expect(matchesClientMessageId(`temp-${uuid}`, 'temp-')).toBe(false);
  });

  it('replaces the optimistic row rather than duplicating it', () => {
    const uuid = '66666666-6666-4666-8666-666666666666';
    const optimistic = { id: `temp-${uuid}`, timestamp: 1000 };
    // The server echoes the WIRE id, not the local one.
    const server = { id: 'server-row-1', clientMessageId: uuid, timestamp: 1000 };

    const merged = mergeChatMessagesById([optimistic], [server]);

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('server-row-1');
  });
});
