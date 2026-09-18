/**
 * `POST /notes/extract-document-text` — the Word (.docx) import route.
 *
 * It is the only upload route that writes NOTHING: it parses the bytes and
 * hands the text back, and the client turns that into an ordinary note through
 * the paste path. So what is worth pinning is the gate order — every refusal
 * must happen before officeparser ever sees the buffer — and that a document
 * with no readable text is refused with a way forward instead of becoming a
 * note containing a placeholder.
 *
 * The fixture is built here with adm-zip; see noteFiles.docx.test.ts.
 */
jest.mock('../middleware/aiRateLimit', () => ({
  ...jest.requireActual('../middleware/aiRateLimit'),
  chargeAiCredits: jest.fn(),
  chargeAiCreditsDetailed: jest.fn(),
  refundFeatureAiCredit: jest.fn(async () => {}),
  applyGlobalUsageHeaders: jest.fn(async () => {}),
}));

jest.mock('../queue/enqueue', () => ({
  runNoteAiSync: jest.fn(),
  runSyncOrEnqueue: jest.fn(),
}));

jest.mock('../services/aiService', () => ({
  summarizeNoteContent: jest.fn(),
  SMART_NOTES_GUIDANCE_MAX_CHARS: 500,
  generateDailyQuiz: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
  resolveAudioUploadMeta: jest.fn(),
  transcribeAudioBase64: jest.fn(),
  transcribeAudioBuffer: jest.fn(),
}));

jest.mock('../services/presentationPreview', () => ({ runPresentationPreviewJob: jest.fn() }));
jest.mock('../services/youtubeTranscript', () => ({ fetchYoutubeMetadata: jest.fn() }));
jest.mock('../services/youtubeNote', () => ({ runYoutubeTranscriptJob: jest.fn() }));
jest.mock('../services/imageProcessing', () => ({ processImageForUpload: jest.fn() }));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import AdmZip from 'adm-zip';

import router from './notes';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeDocx(paragraphs: string[]): Buffer {
  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/></Types>`,
      'utf8'
    )
  );
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      'utf8'
    )
  );
  const body = paragraphs
    .map((text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`)
    .join('');
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
      'utf8'
    )
  );
  return zip.toBuffer();
}

type RouteResult = { statusCode: number; body: { error?: string; data?: Record<string, unknown> } };

async function callRoute(body: unknown, user: unknown = { id: 'u1' }): Promise<RouteResult> {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/extract-document-text' && l.route?.methods?.post
  );
  expect(layer).toBeDefined();
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const req: any = { user, body };
  const res: any = { statusCode: 200, body: undefined, locals: {}, setHeader: jest.fn() };
  const settled = new Promise<void>((resolve) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (payload: unknown) => {
      res.body = payload;
      resolve();
      return res;
    };
  });
  handler(req, res, () => {});
  await settled;
  return res as RouteResult;
}

describe('POST /notes/extract-document-text', () => {
  it('reads a real .docx and returns its text and a title', async () => {
    const buffer = makeDocx([
      'Photosynthesis converts light energy into chemical energy.',
      'The light-dependent reactions occur in the thylakoid membrane.',
    ]);
    const res = await callRoute({
      fileName: 'Biology week 4.docx',
      base64Data: buffer.toString('base64'),
      contentType: DOCX_MIME,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.data?.title).toBe('Biology week 4');
    expect(String(res.body.data?.text)).toContain('thylakoid membrane');
    expect(res.body.data?.truncated).toBe(false);
    expect(res.body.data?.extractionStatus).toBe('ok');
  });

  it('accepts the docx mime with parameters, as browsers may send it', async () => {
    const buffer = makeDocx(['Photosynthesis converts light energy into chemical energy. '.repeat(4)]);
    const res = await callRoute({
      fileName: 'notes.docx',
      base64Data: buffer.toString('base64'),
      contentType: `${DOCX_MIME}; charset=utf-8`,
    });
    expect(res.statusCode).toBe(200);
  });

  it('requires a name and bytes', async () => {
    expect((await callRoute({ fileName: 'a.docx' })).statusCode).toBe(400);
    expect((await callRoute({ base64Data: 'AAAA' })).statusCode).toBe(400);
  });

  it('refuses a legacy binary .doc by name, with the fix', async () => {
    const res = await callRoute({ fileName: 'old.doc', base64Data: 'AAAA' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/save as \.docx/i);
  });

  it('refuses a mime that is not the docx mime', async () => {
    const buffer = makeDocx(['Anything at all.']);
    const res = await callRoute({
      fileName: 'notes.docx',
      base64Data: buffer.toString('base64'),
      contentType: 'application/pdf',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/must be a \.docx/i);
  });

  it('refuses bytes that are not an Office ZIP', async () => {
    const res = await callRoute({
      fileName: 'notes.docx',
      base64Data: Buffer.from('not a zip at all').toString('base64'),
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/not a valid Office file/i);
  });

  it('refuses a document with no readable text, and says what to do instead', async () => {
    const res = await callRoute({
      fileName: 'scan.docx',
      base64Data: makeDocx([]).toString('base64'),
    });
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toMatch(/could not read any text/i);
    expect(res.body.error).toMatch(/photos or a PDF/i);
  });

  it('refuses an unauthenticated caller before touching the bytes', async () => {
    const res = await callRoute(
      { fileName: 'notes.docx', base64Data: makeDocx(['Hello.']).toString('base64') },
      // `null`, not `undefined` — an explicit `undefined` would take the default.
      null
    );
    expect(res.statusCode).toBe(401);
  });
});
