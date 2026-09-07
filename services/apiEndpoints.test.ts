import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pagesUnavailableCopy, walkthroughUnavailableCopy } from '../utils/walkthroughModel';

vi.mock('./supabase', () => ({
  getApiRoot: () => 'https://api.example.test',
  getAuthHeaders: async () => ({ Authorization: 'Bearer test' }),
  withApiCredentials: (init: RequestInit) => init,
}));
vi.mock('./authCookieSession', () => ({ isCookieAuthEnabled: () => false }));
vi.mock('./jobPoll', () => ({ pollApiJob: vi.fn() }));

const { fetchNoteAttachmentPages } = await import('./apiEndpoints');

const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';

/** Exactly what an API without the pages route answers. */
const RAW_404 = {
  error: `Not found - /api/v1/notes/${NOTE_ID}/attachments/${ATTACHMENT_ID}/pages?images=1`,
};

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }))
  );
}

describe('fetchNoteAttachmentPages', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not put the server sentence in the thrown message', async () => {
    respond(404, RAW_404);
    const error = await fetchNoteAttachmentPages(NOTE_ID, ATTACHMENT_ID, { images: true }).then(
      () => null,
      (err: Error) => err
    );
    expect(error).toBeInstanceOf(Error);
    expect(error!.message).not.toContain('/api/');
    expect(error!.message).not.toContain(NOTE_ID);
  });

  it('carries the status and the body so the screen can classify it', async () => {
    respond(404, RAW_404);
    const error = (await fetchNoteAttachmentPages(NOTE_ID, ATTACHMENT_ID).catch(
      (err) => err
    )) as Error & { status?: number; body?: unknown };
    expect(error.status).toBe(404);
    expect(error.body).toEqual(RAW_404);
  });

  it('reads as "not split into pages yet", with no retry a student could press', async () => {
    respond(404, RAW_404);
    const error = await fetchNoteAttachmentPages(NOTE_ID, ATTACHMENT_ID).catch((err) => err);
    const copy = pagesUnavailableCopy(error);
    expect(copy).toEqual(walkthroughUnavailableCopy('schema_missing'));
    expect(copy.retryable).toBe(false);
  });

  it('keeps the reason the server named when it answers one', async () => {
    respond(200, { data: { available: false, reason: 'preview_pending', pageCount: 0, pages: [] } });
    const result = await fetchNoteAttachmentPages(NOTE_ID, ATTACHMENT_ID);
    expect(result.reason).toBe('preview_pending');
    expect(result.available).toBe(false);
    expect(result.pages).toEqual([]);
  });
});
