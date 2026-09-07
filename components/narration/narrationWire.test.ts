/**
 * The narration wire shape, as the server actually sends it.
 *
 * The server answers with the deck FLAT on `data` — `status`, `segments`,
 * `pages` and `pageCount` beside `available` and `reason` — because that is the
 * single object both clients keep for offline play. An earlier draft of this
 * client read a nested `data.script`, which the server never sends, so every
 * paid-for reading came back as "nobody has had this read out yet". These
 * tests pin the flat shape so that cannot come back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/supabase', () => ({
  getApiRoot: () => 'https://api.test',
  getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
  withApiCredentials: (init: RequestInit) => init,
}));
vi.mock('../../services/authCookieSession', () => ({
  isCookieAuthEnabled: () => false,
}));
vi.mock('../../services/jobPoll', () => ({
  pollApiJob: vi.fn(),
}));
vi.mock('@lantern/shared/api', () => ({
  createApiClient: () => ({}),
  createApiEndpoints: () => ({
    createDeckWithCards: vi.fn(),
    createPersonalTest: vi.fn(),
  }),
}));

import { fetchNarrationScript } from '../../services/apiEndpoints';

const NOTE = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT = '22222222-2222-4222-8222-222222222222';

function answer(body: unknown, status = 200) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

describe('narration wire shape', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads a ready deck sent flat on data', async () => {
    globalThis.fetch = answer({
      success: true,
      data: {
        attachmentId: ATTACHMENT,
        available: true,
        reason: 'ok',
        status: 'ready',
        version: 2,
        pageCount: 3,
        segments: [
          { pageIndex: 0, order: 0, text: 'First.', estimatedSeconds: 2, startMs: 0, durationMs: 2000 },
          { pageIndex: 2, order: 1, text: 'Third.', estimatedSeconds: 2, startMs: 2000, durationMs: 2000 },
        ],
        estimatedSeconds: 4,
        creditCost: 2,
        generatedAt: '2026-09-07T10:00:00.000Z',
        pages: [{ pageIndex: 0, imageUrl: 'https://signed/0' }, { pageIndex: 1 }, { pageIndex: 2 }],
        imageUrlExpiresIn: 86400,
        maxPages: 40,
      },
    }) as unknown as typeof fetch;

    const result = await fetchNarrationScript(NOTE, ATTACHMENT);
    expect(result.available).toBe(true);
    expect(result.reason).toBe('ok');
    expect(result.maxPages).toBe(40);
    expect(result.script).not.toBeNull();
    expect(result.script?.status).toBe('ready');
    expect(result.script?.version).toBe(2);
    expect(result.script?.pageCount).toBe(3);
    expect(result.script?.segments).toHaveLength(2);
    expect(result.script?.pages[0]?.imageUrl).toBe('https://signed/0');
    expect(result.script?.imageUrlExpiresIn).toBe(86400);
    expect(result.script?.creditCost).toBe(2);
    expect(result.script?.createdAt).toBe('2026-09-07T10:00:00.000Z');
  });

  it('treats a document nobody has narrated as a door, not a script', async () => {
    globalThis.fetch = answer({
      success: true,
      data: {
        attachmentId: ATTACHMENT,
        available: true,
        reason: 'not_generated',
        status: null,
        pageCount: 0,
        segments: [],
        pages: [],
        maxPages: 40,
      },
    }) as unknown as typeof fetch;

    const result = await fetchNarrationScript(NOTE, ATTACHMENT);
    expect(result.available).toBe(true);
    expect(result.reason).toBe('not_generated');
    expect(result.script).toBeNull();
  });

  it('keeps a run still being written visible so the player can poll it', async () => {
    globalThis.fetch = answer({
      success: true,
      data: {
        attachmentId: ATTACHMENT,
        available: true,
        reason: 'ok',
        status: 'generating',
        version: 1,
        pageCount: 12,
        segments: [],
        jobId: 'job-1',
        pages: [],
        maxPages: 40,
      },
    }) as unknown as typeof fetch;

    const result = await fetchNarrationScript(NOTE, ATTACHMENT);
    expect(result.script?.status).toBe('generating');
    expect(result.script?.jobId).toBe('job-1');
  });

  it('reports a failed run as failed, with the reason the student is owed', async () => {
    globalThis.fetch = answer({
      success: true,
      data: {
        attachmentId: ATTACHMENT,
        available: true,
        reason: 'unreadable',
        status: 'failed',
        version: 1,
        pageCount: 5,
        segments: [],
        errorMessage: 'Every narration batch failed',
        pages: [],
        maxPages: 40,
      },
    }) as unknown as typeof fetch;

    const result = await fetchNarrationScript(NOTE, ATTACHMENT);
    expect(result.reason).toBe('failed');
    expect(result.script?.status).toBe('failed');
    expect(result.script?.errorMessage).toBe('Every narration batch failed');
  });

  it('degrades honestly when the migration is not applied', async () => {
    globalThis.fetch = answer({
      success: true,
      data: {
        attachmentId: ATTACHMENT,
        available: false,
        reason: 'schema_missing',
        pageCount: 0,
        segments: [],
        pages: [],
      },
    }) as unknown as typeof fetch;

    const result = await fetchNarrationScript(NOTE, ATTACHMENT);
    expect(result.available).toBe(false);
    expect(result.reason).toBe('schema_missing');
    expect(result.script).toBeNull();
  });
});
