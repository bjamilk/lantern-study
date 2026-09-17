/**
 * The page model is an ADDITION to OCR, not a change to it.
 *
 * These pin the property the walk-through work must not break: whatever ends up
 * in `note_attachments.extracted_text` after an OCR run is exactly what it was
 * before pages existed — the text layer merged with the page rasters, as one
 * blob — and a failure while storing pages cannot touch it. Smart Notes and
 * quiz generation read that blob, so this is what keeps them unchanged.
 */
import type { DataLayer } from './data';

jest.mock('./pdfPageOcr', () => ({
  ocrPdfPagesFromBuffer: jest.fn(),
  ocrImageBuffer: jest.fn(),
}));
jest.mock('./notePages', () => ({ persistPagesAfterPdfOcr: jest.fn() }));
jest.mock('./noteFiles', () => {
  const actual = jest.requireActual('./noteFiles');
  return { ...actual, extractPdfTextDetailsFromBuffer: jest.fn() };
});

import { runNoteOcrJob } from './noteOcr';
import { ocrPdfPagesFromBuffer } from './pdfPageOcr';
import { persistPagesAfterPdfOcr } from './notePages';
import { extractPdfTextDetailsFromBuffer } from './noteFiles';

const rasterMock = ocrPdfPagesFromBuffer as jest.MockedFunction<typeof ocrPdfPagesFromBuffer>;
const layerMock = extractPdfTextDetailsFromBuffer as jest.MockedFunction<
  typeof extractPdfTextDetailsFromBuffer
>;
const persistMock = persistPagesAfterPdfOcr as jest.MockedFunction<typeof persistPagesAfterPdfOcr>;

const LAYER_TEXT = 'Chapter one. '.repeat(20);
const OCR_TEXT = 'A scanned figure caption the text layer never had. '.repeat(6);

function makeService() {
  const updateNoteAttachment = jest.fn(async () => ({}) as never);
  return {
    service: {
      notes: {
        updateNoteAttachment,
        getNoteAttachment: jest.fn(async () => ({ id: 'att-1', metadata: {} })),
        downloadNoteFile: jest.fn(async () => ({
          buffer: Buffer.from('%PDF-1.4'),
          contentType: 'application/pdf',
        })),
      },
    } as unknown as DataLayer,
    updateNoteAttachment,
  };
}

function lastExtractedText(updateNoteAttachment: jest.Mock): string {
  const calls = updateNoteAttachment.mock.calls.filter(
    (call) => typeof call[1]?.extractedText === 'string'
  );
  return calls.length ? String(calls[calls.length - 1][1].extractedText) : '';
}

beforeEach(() => {
  jest.clearAllMocks();
  layerMock.mockResolvedValue({
    text: LAYER_TEXT.trim(),
    pageCount: 2,
    assessment: { status: 'ok', charsPerPage: 200 } as never,
  });
  rasterMock.mockResolvedValue({
    text: OCR_TEXT.trim(),
    pageCount: 2,
    ocrPageCount: 2,
    capped: false,
    pages: [
      { pageIndex: 0, text: 'page one' },
      { pageIndex: 1, text: 'page two' },
    ],
  });
  persistMock.mockResolvedValue({ available: true, saved: 2 });
});

it('writes the same merged blob to extracted_text as before pages existed', async () => {
  const { service, updateNoteAttachment } = makeService();
  const result = await runNoteOcrJob(service, {
    noteId: 'note-1',
    attachmentId: 'att-1',
    storagePath: 'user-1/doc.pdf',
    fileName: 'doc.pdf',
    sourceKind: 'pdf',
    meta: {},
  });

  expect(result.status).toBe('ok');
  const written = lastExtractedText(updateNoteAttachment as jest.Mock);
  expect(written).toContain(LAYER_TEXT.trim());
  expect(written).toContain(OCR_TEXT.trim());
});

it('hands OCR its own per-page text so pages come from the same read', async () => {
  const { service } = makeService();
  await runNoteOcrJob(service, {
    noteId: 'note-1',
    attachmentId: 'att-1',
    storagePath: 'user-1/doc.pdf',
    fileName: 'doc.pdf',
    sourceKind: 'pdf',
    meta: {},
  });

  expect(persistMock).toHaveBeenCalledWith(
    service,
    'att-1',
    expect.any(Buffer),
    [
      { pageIndex: 0, text: 'page one' },
      { pageIndex: 1, text: 'page two' },
    ],
    { noteId: 'note-1' }
  );
});

it('still completes the OCR run when storing pages reports the table is missing', async () => {
  persistMock.mockResolvedValue({ available: false, saved: 0 });
  const { service, updateNoteAttachment } = makeService();

  const result = await runNoteOcrJob(service, {
    noteId: 'note-1',
    attachmentId: 'att-1',
    storagePath: 'user-1/doc.pdf',
    fileName: 'doc.pdf',
    sourceKind: 'pdf',
    meta: {},
  });

  expect(result.status).toBe('ok');
  expect(lastExtractedText(updateNoteAttachment as jest.Mock)).toContain(LAYER_TEXT.trim());
});

it('does not touch the page model for a photograph', async () => {
  const { service } = makeService();
  await runNoteOcrJob(service, {
    noteId: 'note-1',
    attachmentId: 'att-1',
    storagePath: 'user-1/photo.jpg',
    fileName: 'photo.jpg',
    sourceKind: 'image',
    meta: {},
  });
  expect(persistMock).not.toHaveBeenCalled();
});
