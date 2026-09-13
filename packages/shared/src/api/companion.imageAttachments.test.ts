/**
 * The client half of "Add image".
 *
 * The upload is a real charge — 2 AI uses, spent when the photo is READ, not
 * when the question is sent — so it goes to its own endpoint and, unlike the
 * read-only companion calls, it must let the usage badge learn from the
 * response headers.
 */
import { createCompanionClient } from './companion';

const ATTACHMENT = {
  attachmentId: 'c0ffee00-1111-4222-8333-444444444444',
  url: 'https://signed.test/u1/1757600000-companion-page.webp',
  fileName: 'page.webp',
  extractedText: 'Krebs cycle produces two ATP per turn',
  wordCount: 7,
  creditsCharged: 2,
};

function clientWithResponse(
  body: unknown,
  init: { ok?: boolean; status?: number; headers?: Record<string, string> } = {}
) {
  const headers = init.headers || {};
  const fetchMock = jest.fn().mockResolvedValue({
    ok: init.ok !== false,
    status: init.status ?? 201,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => body,
  });
  (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
  const usage: unknown[] = [];
  const client = createCompanionClient({
    getBaseUrl: () => 'https://api.test',
    getAuthHeaders: async () => ({ 'Content-Type': 'application/json' }),
    supportsResponseStreaming: false,
    onUsageUpdate: (snapshot: unknown) => usage.push(snapshot),
  });
  return { client, fetchMock, usage };
}

describe('uploadCompanionImage', () => {
  it('posts the image to the attachments endpoint and returns what was read', async () => {
    const { client, fetchMock } = clientWithResponse(ATTACHMENT);

    const result = await client.uploadCompanionImage({
      base64Data: 'AAAA',
      fileName: 'page.png',
      contentType: 'image/png',
    });

    expect(result).toEqual(ATTACHMENT);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/ai/companion/attachments');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      base64Data: 'AAAA',
      fileName: 'page.png',
      contentType: 'image/png',
    });
  });

  it('names the file even when the caller does not', async () => {
    const { client, fetchMock } = clientWithResponse(ATTACHMENT);
    await client.uploadCompanionImage({ base64Data: 'AAAA' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).fileName).toBe('image.jpg');
  });

  it('updates the usage badge — the credits are gone before the student types', async () => {
    const { client, usage } = clientWithResponse(ATTACHMENT, {
      headers: {
        'X-AI-Global-Usage-Used': '12',
        'X-AI-Global-Usage-Limit': '30',
        'X-AI-Global-Usage-Resets-At': '2026-09-13T00:00:00.000Z',
      },
    });

    await client.uploadCompanionImage({ base64Data: 'AAAA' });

    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ used: 12, limit: 30, remaining: 18 });
  });

  it('surfaces the server sentence when the image is refused', async () => {
    const { client } = clientWithResponse(
      { error: 'That image is over 10 MB. Try a smaller photo.' },
      { ok: false, status: 400 }
    );

    await expect(client.uploadCompanionImage({ base64Data: 'AAAA' })).rejects.toThrow(
      'That image is over 10 MB'
    );
  });

  it('sends base64 JSON — React Native cannot post a web Blob or a bare File', async () => {
    const { client, fetchMock } = clientWithResponse(ATTACHMENT);
    await client.uploadCompanionImage({
      base64Data: 'AAAA',
      fileName: 'testcard.png',
      contentType: 'image/png',
    });
    const options = fetchMock.mock.calls[0][1];
    expect(typeof options.body).toBe('string');
    expect(options.headers['Content-Type']).toBe('application/json');
    // No multipart: the endpoint reads `base64Data`, so there is nothing on RN
    // that has to produce a FormData part out of a content:// uri.
    expect(options.body).not.toContain('Content-Disposition');
    expect(JSON.parse(options.body).base64Data).toBe('AAAA');
  });

  it('prefers the reason over the label when the API answers with a class name', async () => {
    // `errorHandler.ts` sends `{ error: apiError.name || 'Error', message }`.
    const { client } = clientWithResponse(
      { error: 'Error', message: 'Image data could not be read' },
      { ok: false, status: 500 }
    );
    await expect(client.uploadCompanionImage({ base64Data: 'AAAA' })).rejects.toThrow(
      'Image data could not be read'
    );
  });

  it('carries the status so the composer can recognise a 503', async () => {
    const { client } = clientWithResponse(
      { error: 'Image attachments are not enabled yet (apply 20260912100000_companion_image_attachments.sql).' },
      { ok: false, status: 503 }
    );
    await expect(client.uploadCompanionImage({ base64Data: 'AAAA' })).rejects.toMatchObject({
      status: 503,
      message: expect.stringContaining('20260912100000_companion_image_attachments.sql'),
    });
  });
});
