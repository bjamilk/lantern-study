/**
 * The page model, from the API's side of the wire.
 *
 * The fake below stands in for `note_attachment_pages` and honours the one
 * property the migration guarantees — PK (attachment_id, page_index), so an
 * upsert replaces a page instead of duplicating it. The tests pin the service's
 * INTERPRETATION: that a re-extraction upgrades rows in place, that a blank
 * page is stored rather than skipped, that an image path already rendered
 * survives a later text-only pass, and — most importantly — that an unapplied
 * migration degrades to "this document has no pages yet" instead of throwing.
 */
import type { SupabaseService } from './supabase';

jest.mock('./noteFiles', () => {
  const actual = jest.requireActual('./noteFiles');
  return {
    ...actual,
    extractPdfPageTextsFromBuffer: jest.fn(),
  };
});
jest.mock('./pdfPageOcr', () => ({ renderPdfPageImages: jest.fn() }));
jest.mock('./imageProcessing', () => ({ normalizeImageForStorage: jest.fn() }));

import {
  __resetNotePagesWarningForTests,
  ensurePageImages,
  ensurePages,
  getPages,
  isMissingPagesSchema,
  persistPagesAfterPdfOcr,
  resolvePaginableSource,
  savePages,
  signPageImages,
} from './notePages';
import { extractPdfPageTextsFromBuffer } from './noteFiles';
import { renderPdfPageImages } from './pdfPageOcr';
import { normalizeImageForStorage } from './imageProcessing';

const extractMock = extractPdfPageTextsFromBuffer as jest.MockedFunction<
  typeof extractPdfPageTextsFromBuffer
>;
const renderMock = renderPdfPageImages as jest.MockedFunction<typeof renderPdfPageImages>;
const normalizeMock = normalizeImageForStorage as jest.MockedFunction<
  typeof normalizeImageForStorage
>;

const ATTACHMENT_ID = 'att-1';
const NOTE_ID = 'note-1';

type PgError = { code?: string; message?: string } | null;
type Row = {
  attachment_id: string;
  page_index: number;
  text: string;
  image_path?: string | null;
  char_count: number;
  created_at: string;
};

/** In-memory stand-in for the table, keyed the way the PK keys it. */
function makeStore(options: { failWith?: PgError } = {}) {
  const rows = new Map<string, Row>();
  const key = (attachmentId: string, pageIndex: number) => `${attachmentId}#${pageIndex}`;

  const from = jest.fn((table: string) => {
    if (table !== 'note_attachment_pages') throw new Error(`unexpected table ${table}`);
    let filterId = '';

    const query: any = {
      select: () => query,
      eq: (_column: string, value: string) => {
        filterId = value;
        return query;
      },
      order: () => {
        if (options.failWith) return Promise.resolve({ data: null, error: options.failWith });
        const data = [...rows.values()]
          .filter((row) => row.attachment_id === filterId)
          .sort((a, b) => a.page_index - b.page_index);
        return Promise.resolve({ data, error: null });
      },
      upsert: (incoming: Array<Record<string, unknown>>) => {
        if (options.failWith) return Promise.resolve({ data: null, error: options.failWith });
        for (const raw of incoming) {
          const attachmentId = String(raw.attachment_id);
          const pageIndex = Number(raw.page_index);
          const existing = rows.get(key(attachmentId, pageIndex));
          rows.set(key(attachmentId, pageIndex), {
            attachment_id: attachmentId,
            page_index: pageIndex,
            text: String(raw.text ?? ''),
            char_count: Number(raw.char_count ?? 0),
            // The real upsert leaves a column alone when the payload omits it.
            image_path:
              raw.image_path !== undefined
                ? (raw.image_path as string | null)
                : (existing?.image_path ?? null),
            created_at: existing?.created_at ?? '2026-09-07T00:00:00.000Z',
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
    return query;
  });

  return { rows, from };
}

function makeService(
  store: ReturnType<typeof makeStore>,
  overrides: Partial<Record<string, unknown>> = {}
): SupabaseService {
  return {
    getClient: () => ({ from: store.from }),
    getNoteAttachment: jest.fn(async () => ({
      id: ATTACHMENT_ID,
      noteId: NOTE_ID,
      type: 'pdf',
      metadata: { storagePath: 'user-1/1234-lecture.pdf' },
    })),
    downloadNoteFile: jest.fn(async () => ({
      buffer: Buffer.from('%PDF-1.4'),
      contentType: 'application/pdf',
    })),
    uploadNoteFile: jest.fn(async ({ storagePath }: { storagePath: string }) => ({
      path: storagePath,
    })),
    signStorageDisplayUrls: jest.fn(async () => new Map<number, string>()),
    ...overrides,
  } as unknown as SupabaseService;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetNotePagesWarningForTests();
});

describe('isMissingPagesSchema', () => {
  it('recognizes an unapplied migration', () => {
    expect(isMissingPagesSchema({ code: '42P01' })).toBe(true);
    expect(isMissingPagesSchema({ code: 'PGRST205' })).toBe(true);
    expect(
      isMissingPagesSchema({
        message: 'relation "public.note_attachment_pages" does not exist',
      })
    ).toBe(true);
  });

  it('does not mistake a real fault for an unapplied migration', () => {
    expect(isMissingPagesSchema({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingPagesSchema({ message: 'permission denied' })).toBe(false);
    expect(isMissingPagesSchema(null)).toBe(false);
  });
});

describe('savePages / getPages', () => {
  it('stores blank pages so the page numbering has no holes', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [
      { pageIndex: 0, text: 'Intro' },
      { pageIndex: 1, text: '   ' },
      { pageIndex: 2, text: 'Conclusion' },
    ]);

    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.available).toBe(true);
    expect(read.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(read.pages[1]).toMatchObject({ text: '', charCount: 0 });
  });

  it('upserts a page instead of duplicating it on re-extraction', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [{ pageIndex: 0, text: 'thin' }]);
    await savePages(service, ATTACHMENT_ID, [{ pageIndex: 0, text: 'much better OCR text' }]);

    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.pages).toHaveLength(1);
    expect(read.pages[0].text).toBe('much better OCR text');
    expect(read.pages[0].charCount).toBe('much better OCR text'.length);
  });

  it('keeps an image already rendered when a later pass only writes text', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [
      { pageIndex: 0, text: 'a', imagePath: 'user-1/lecture-page-0.webp' },
    ]);
    await savePages(service, ATTACHMENT_ID, [{ pageIndex: 0, text: 'a much fuller page' }]);

    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.pages[0].imagePath).toBe('user-1/lecture-page-0.webp');
  });

  it('drops a nonsense page index rather than writing it', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [
      { pageIndex: -1, text: 'nope' },
      { pageIndex: 0, text: 'yes' },
    ]);
    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.pages.map((p) => p.pageIndex)).toEqual([0]);
  });

  it('reads back an empty list for an attachment with no pages', async () => {
    const store = makeStore();
    const read = await getPages(makeService(store), 'other-attachment');
    expect(read).toEqual({ available: true, reason: 'ok', pages: [] });
  });

  it('surfaces a real database fault instead of reporting no pages', async () => {
    const store = makeStore({ failWith: { code: '42501', message: 'permission denied' } });
    await expect(getPages(makeService(store), ATTACHMENT_ID)).rejects.toMatchObject({
      code: '42501',
    });
  });
});

describe('degrading when the migration is not applied', () => {
  const missing: PgError = {
    code: '42P01',
    message: 'relation "public.note_attachment_pages" does not exist',
  };

  it('reads as unavailable with no pages', async () => {
    const service = makeService(makeStore({ failWith: missing }));
    const read = await getPages(service, ATTACHMENT_ID);
    expect(read).toEqual({ available: false, reason: 'schema_missing', pages: [] });
  });

  it('writes nothing and reports it, without throwing', async () => {
    const service = makeService(makeStore({ failWith: missing }));
    await expect(savePages(service, ATTACHMENT_ID, [{ pageIndex: 0, text: 'a' }])).resolves.toEqual(
      { available: false, saved: 0 }
    );
  });

  it('does not try to backfill from storage', async () => {
    const service = makeService(makeStore({ failWith: missing }));
    const result = await ensurePages(service, { noteId: NOTE_ID, attachmentId: ATTACHMENT_ID });
    expect(result).toEqual({
      available: false,
      reason: 'schema_missing',
      pages: [],
      backfilled: 0,
    });
    expect(service.downloadNoteFile).not.toHaveBeenCalled();
  });
});

describe('resolvePaginableSource', () => {
  it('splits a PDF from its own file', () => {
    expect(
      resolvePaginableSource({ id: 'a', type: 'pdf', metadata: { storagePath: 'u/doc.pdf' } })
    ).toEqual({ storagePath: 'u/doc.pdf', reason: 'ok' });
  });

  it('splits a deck from its converted preview, never the raw pptx', () => {
    expect(
      resolvePaginableSource({
        id: 'a',
        type: 'presentation',
        metadata: { storagePath: 'u/deck.pptx', previewStoragePath: 'u/deck-preview.pdf' },
      })
    ).toEqual({ storagePath: 'u/deck-preview.pdf', reason: 'ok' });
  });

  it('says a deck is waiting on its preview rather than saying it has no pages', () => {
    expect(
      resolvePaginableSource({
        id: 'a',
        type: 'presentation',
        metadata: { storagePath: 'u/deck.pptx' },
      })
    ).toEqual({ storagePath: null, reason: 'preview_pending' });
  });

  it('refuses attachments that have no pages at all', () => {
    expect(resolvePaginableSource({ id: 'a', type: 'image', metadata: {} }).reason).toBe(
      'unsupported'
    );
    expect(resolvePaginableSource({ id: 'a', type: 'youtube', metadata: {} }).reason).toBe(
      'unsupported'
    );
  });
});

describe('ensurePages', () => {
  it('backfills from the stored file on first open', async () => {
    extractMock.mockResolvedValue({
      pages: [
        { pageIndex: 0, text: '# Kinetics' },
        { pageIndex: 1, text: 'Rate laws' },
      ],
      pageCount: 2,
    });
    const service = makeService(makeStore());

    const result = await ensurePages(service, { noteId: NOTE_ID, attachmentId: ATTACHMENT_ID });
    expect(result.backfilled).toBe(2);
    expect(result.pages.map((p) => p.text)).toEqual(['# Kinetics', 'Rate laws']);
  });

  it('does not re-read the file once pages exist', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [{ pageIndex: 0, text: 'already here' }]);

    const result = await ensurePages(service, { noteId: NOTE_ID, attachmentId: ATTACHMENT_ID });
    expect(result.backfilled).toBe(0);
    expect(service.downloadNoteFile).not.toHaveBeenCalled();
    expect(extractMock).not.toHaveBeenCalled();
  });

  it('reports an unreadable file honestly instead of inventing a page', async () => {
    extractMock.mockResolvedValue({ pages: [], pageCount: 0 });
    const result = await ensurePages(makeService(makeStore()), {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
    });
    expect(result).toMatchObject({ available: true, reason: 'unreadable', pages: [] });
  });

  it('reports a missing source file rather than failing the request', async () => {
    const service = makeService(makeStore(), {
      downloadNoteFile: jest.fn(async () => {
        throw new Error('Object not found');
      }),
    });
    const result = await ensurePages(service, { noteId: NOTE_ID, attachmentId: ATTACHMENT_ID });
    expect(result).toMatchObject({ reason: 'source_missing', pages: [] });
  });

  it('writes empty pages for a scan so OCR can upgrade the same rows later', async () => {
    extractMock.mockResolvedValue({
      pages: [
        { pageIndex: 0, text: '' },
        { pageIndex: 1, text: '' },
      ],
      pageCount: 2,
    });
    const store = makeStore();
    const service = makeService(store);
    await ensurePages(service, { noteId: NOTE_ID, attachmentId: ATTACHMENT_ID });

    await persistPagesAfterPdfOcr(service, ATTACHMENT_ID, Buffer.from('%PDF'), [
      { pageIndex: 0, text: 'OCR read this' },
      { pageIndex: 1, text: 'and this' },
    ]);

    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.pages).toHaveLength(2);
    expect(read.pages.map((p) => p.text)).toEqual(['OCR read this', 'and this']);
  });
});

describe('persistPagesAfterPdfOcr', () => {
  it('merges the text layer with what OCR read, page by page', async () => {
    extractMock.mockResolvedValue({
      pages: [
        { pageIndex: 0, text: 'Exact text layer' },
        { pageIndex: 1, text: '' },
      ],
      pageCount: 2,
    });
    const service = makeService(makeStore());
    await persistPagesAfterPdfOcr(service, ATTACHMENT_ID, Buffer.from('%PDF'), [
      { pageIndex: 0, text: 'Exact text layer' },
      { pageIndex: 1, text: 'Only OCR could read this scanned page' },
    ]);

    const read = await getPages(service, ATTACHMENT_ID);
    // Identical text is not concatenated with itself.
    expect(read.pages[0].text).toBe('Exact text layer');
    expect(read.pages[1].text).toBe('Only OCR could read this scanned page');
  });

  it('never throws, so a page failure cannot undo a successful OCR run', async () => {
    extractMock.mockRejectedValue(new Error('pdfjs exploded'));
    await expect(
      persistPagesAfterPdfOcr(makeService(makeStore()), ATTACHMENT_ID, Buffer.from('%PDF'), [
        { pageIndex: 0, text: 'read' },
      ])
    ).resolves.toEqual({ available: false, saved: 0 });
  });
});

describe('ensurePageImages', () => {
  it('renders only the pages that have no image yet and stores the path', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [
      { pageIndex: 0, text: 'one', imagePath: 'user-1/1234-lecture-page-0.webp' },
      { pageIndex: 1, text: 'two' },
    ]);
    renderMock.mockResolvedValue({
      images: [{ pageIndex: 1, png: Buffer.from('png') }],
      pageCount: 2,
    });
    normalizeMock.mockResolvedValue({
      buffer: Buffer.from('webp'),
      contentType: 'image/webp',
      ext: 'webp',
      width: 800,
      height: 1000,
      passthrough: false,
    });

    const result = await ensurePageImages(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
    });
    expect(result).toEqual({ available: true, rendered: 1 });
    expect(renderMock).toHaveBeenCalledWith(expect.any(Buffer), expect.objectContaining({
      pageIndexes: [1],
    }));

    const read = await getPages(service, ATTACHMENT_ID);
    expect(read.pages[1].imagePath).toBe('user-1/1234-lecture-page-1.webp');
    // The text it already had is not lost by the image write.
    expect(read.pages[1].text).toBe('two');
  });

  it('does nothing when every page already has an image', async () => {
    const store = makeStore();
    const service = makeService(store);
    await savePages(service, ATTACHMENT_ID, [
      { pageIndex: 0, text: 'one', imagePath: 'user-1/1234-lecture-page-0.webp' },
    ]);
    const result = await ensurePageImages(service, {
      noteId: NOTE_ID,
      attachmentId: ATTACHMENT_ID,
    });
    expect(result).toEqual({ available: true, rendered: 0 });
    expect(renderMock).not.toHaveBeenCalled();
  });
});

describe('signPageImages', () => {
  it('signs stored paths and keys the result by page index', async () => {
    const service = makeService(makeStore(), {
      signStorageDisplayUrls: jest.fn(async () => new Map([[1, 'https://signed/page-5']])),
    });
    const signed = await signPageImages(service, [
      { attachmentId: ATTACHMENT_ID, pageIndex: 4, text: '', charCount: 0, imagePath: null },
      {
        attachmentId: ATTACHMENT_ID,
        pageIndex: 5,
        text: '',
        charCount: 0,
        imagePath: 'user-1/page-5.webp',
      },
    ]);
    expect(signed.get(5)).toBe('https://signed/page-5');
    expect(signed.has(4)).toBe(false);
  });

  it('does not call storage at all when no page has an image', async () => {
    const service = makeService(makeStore());
    const signed = await signPageImages(service, [
      { attachmentId: ATTACHMENT_ID, pageIndex: 0, text: 'a', charCount: 1, imagePath: null },
    ]);
    expect(signed.size).toBe(0);
    expect(service.signStorageDisplayUrls).not.toHaveBeenCalled();
  });
});
