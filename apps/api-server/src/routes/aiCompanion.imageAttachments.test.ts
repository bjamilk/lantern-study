/**
 * "Add image" in the companion composer.
 *
 * The companion's chat providers take a string prompt and nothing else, so an
 * attached photo is READ at upload time and it is the transcript that grounds
 * the answer. That makes three things worth pinning:
 *   - the upload stores the image, extracts text, and records the attachment;
 *   - a file that is not an image is refused BEFORE anything is stored;
 *   - the read is charged exactly once, and given back when it fails.
 */
const charged: Array<{ userId: string; amount: number }> = [];
const refunded: Array<{ userId: string; amount: number }> = [];
const readPhotoPageText = jest.fn();

jest.mock('../services/aiService', () => ({
  companionChat: jest.fn(),
  summarizeGroupChat: jest.fn(),
}));
jest.mock('../services/companionContext', () => ({
  buildTrustedCompanionContext: jest.fn(async () => ({})),
  fetchAuthorizedGroupSummaryMessages: jest.fn(async () => []),
}));
jest.mock('../services/noteOcr', () => ({
  readPhotoPageText: (...args: unknown[]) => readPhotoPageText(...args),
}));
// sharp is real in the API image pipeline; the bytes here are a 1x1 PNG, and
// this test is about the route's contract, not about resizing.
jest.mock('../services/imageProcessing', () => ({
  processImageForUpload: jest.fn(async (buffer: Buffer) => ({
    normalized: {
      buffer,
      contentType: 'image/webp',
      ext: 'webp',
      width: 1,
      height: 1,
      passthrough: false,
    },
    thumb: null,
    budget: { maxDimension: 2000, quality: 82, thumb: 480 },
  })),
}));
jest.mock('../middleware/aiRateLimit', () => ({
  NOTE_OCR_CREDIT_COST: 2,
  aiRateLimit: (_req: any, _res: any, next: any) => next(),
  aiRateLimitForFeature: () => (_req: any, _res: any, next: any) => next(),
  applyGlobalUsageHeaders: jest.fn(async () => {}),
  chargeAiCreditsDetailed: jest.fn(async (userId: string, amount: number) => {
    charged.push({ userId, amount });
    return { ok: true, pool: 'daily', credits: amount };
  }),
  refundAiCredits: jest.fn(async (userId: string, amount: number) => {
    refunded.push({ userId, amount });
  }),
  refundFeatureAiCredit: jest.fn(async () => {}),
}));
jest.mock('../middleware/rateLimit', () => ({
  aiPostBurstRateLimit: (_req: any, _res: any, next: any) => next(),
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
}));

import router, { initializeAICompanionRoutes } from './aiCompanion';

/** A real 1x1 PNG, so the magic-byte check sees an actual image. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makeClient() {
  const inserted: any[] = [];
  const client = {
    from(table: string) {
      const builder: any = {
        _table: table,
        insert(row: any) {
          inserted.push({ table, row });
          return {
            select: () => ({
              single: async () => ({ data: { id: 'att-1' }, error: null }),
            }),
          };
        },
      };
      return builder;
    },
  };
  return { client, inserted };
}

function makeSupabase(overrides: Record<string, any> = {}) {
  const { client } = makeClient();
  const uploads: string[] = [];
  const deletes: string[] = [];
  return {
    uploads,
    deletes,
    service: {
      getClient: () => client,
      uploadNoteFile: jest.fn(async (params: any) => {
        uploads.push(params.storagePath);
        return { path: params.storagePath };
      }),
      createSignedNoteFileUrl: jest.fn(async (path: string) => `https://signed.test/${path}`),
      deleteNoteFile: jest.fn(async (path: string) => {
        deletes.push(path);
      }),
      ...overrides,
    } as any,
  };
}

/** The route body — the last handler on the layer. */
function attachmentsHandler() {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/attachments' && l.route?.methods?.post,
  );
  if (!layer) throw new Error('route POST /attachments not found');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  return handlers[handlers.length - 1] as (req: any, res: any) => Promise<void>;
}

async function post(body: any) {
  const res: any = {
    statusCode: 200,
    body: undefined,
    setHeader() {},
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  await attachmentsHandler()({ user: { id: 'u1' }, body }, res);
  return res;
}

describe('POST /ai/companion/attachments', () => {
  beforeEach(() => {
    charged.length = 0;
    refunded.length = 0;
    readPhotoPageText.mockReset();
    readPhotoPageText.mockResolvedValue({
      text: 'Mitochondria are the powerhouse of the cell',
      provider: 'tesseract',
    });
  });

  it('stores the image, reads it, and returns the attachment with a word count', async () => {
    const { service, uploads } = makeSupabase();
    initializeAICompanionRoutes(service);

    const res = await post({ base64Data: PNG_BASE64, fileName: 'page.png' });

    expect(res.statusCode).toBe(201);
    expect(res.body.attachmentId).toBe('att-1');
    expect(res.body.url).toContain('https://signed.test/');
    expect(res.body.extractedText).toContain('powerhouse');
    expect(res.body.wordCount).toBe(7);
    expect(uploads).toHaveLength(1);
    // Stored under the user's own folder — the same rule the note photo
    // storage path enforces.
    expect(uploads[0].startsWith('u1/')).toBe(true);
  });

  it('accepts a data: URL body, which is what the web file picker produces', async () => {
    const { service } = makeSupabase();
    initializeAICompanionRoutes(service);

    const res = await post({
      base64Data: `data:image/png;base64,${PNG_BASE64}`,
      fileName: 'page.png',
    });

    expect(res.statusCode).toBe(201);
    expect(res.body.wordCount).toBe(7);
  });

  it('charges the OCR price exactly once', async () => {
    const { service } = makeSupabase();
    initializeAICompanionRoutes(service);

    const res = await post({ base64Data: PNG_BASE64, fileName: 'page.png' });

    expect(charged).toEqual([{ userId: 'u1', amount: 2 }]);
    expect(res.body.creditsCharged).toBe(2);
    expect(refunded).toHaveLength(0);
  });

  it('rejects a file that is not an image, and refunds what it charged', async () => {
    const { service, uploads } = makeSupabase();
    initializeAICompanionRoutes(service);

    // "%PDF-1.4" — a real file, just not an image.
    const res = await post({
      base64Data: Buffer.from('%PDF-1.4 not a picture').toString('base64'),
      fileName: 'lecture.pdf',
    });

    expect(res.statusCode).toBe(400);
    expect(uploads).toHaveLength(0);
    expect(refunded).toEqual([{ userId: 'u1', amount: 2 }]);
  });

  it('refuses an empty body before charging anything', async () => {
    const { service } = makeSupabase();
    initializeAICompanionRoutes(service);

    const res = await post({ fileName: 'page.png' });

    expect(res.statusCode).toBe(400);
    expect(charged).toHaveLength(0);
  });

  it('says which migration is missing rather than failing blankly', async () => {
    const { client } = (() => {
      const failing = {
        from() {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: {
                    code: '42P01',
                    message: 'relation "companion_image_attachments" does not exist',
                  },
                }),
              }),
            }),
          };
        },
      };
      return { client: failing };
    })();
    const { service, deletes } = makeSupabase({ getClient: () => client });
    initializeAICompanionRoutes(service);

    const res = await post({ base64Data: PNG_BASE64, fileName: 'page.png' });

    expect(res.statusCode).toBe(503);
    expect(res.body.error).toContain('20260912100000_companion_image_attachments.sql');
    // Nothing usable was created, so the object does not stay behind…
    expect(deletes).toHaveLength(1);
    // …and the read is not billed.
    expect(refunded).toEqual([{ userId: 'u1', amount: 2 }]);
  });

  it('still attaches an unreadable photo, with a zero word count', async () => {
    readPhotoPageText.mockResolvedValue({ text: '   ', provider: 'tesseract' });
    const { service } = makeSupabase();
    initializeAICompanionRoutes(service);

    const res = await post({ base64Data: PNG_BASE64, fileName: 'blurry.png' });

    expect(res.statusCode).toBe(201);
    expect(res.body.wordCount).toBe(0);
  });
});
