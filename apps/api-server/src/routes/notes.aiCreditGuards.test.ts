/**
 * Two AI-credit guards on the notes routes:
 *
 * 1. Auto-OCR on PDF upload responds `ocr_processing` BEFORE the fire-and-forget
 *    credit charge. When the charge was denied (daily AI limit) the OCR job
 *    never started, nothing reverted the metadata, and the client polled a
 *    doomed 240s "Running OCR on scanned pages…" loop. The chain must revert
 *    the attachment to `needs_ocr` (with an ocrError) on denial and on a
 *    failed job start, so status polling exits into the manual Run OCR path.
 *
 * 2. POST /:noteId/quiz generated a fresh quiz with the AI FIRST and only then
 *    let upsertNoteQuiz refuse the overwrite (quiz completed / has answers) —
 *    burning a generation and the middleware-reserved credits for questions
 *    that were thrown away. The route now checks first, refunds, and returns
 *    the existing quiz marked `reused: true`.
 */
jest.mock('../middleware/aiRateLimit', () => ({
  ...jest.requireActual('../middleware/aiRateLimit'),
  chargeAiCredits: jest.fn(),
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

jest.mock('../services/presentationPreview', () => ({
  runPresentationPreviewJob: jest.fn(),
}));
jest.mock('../services/youtubeTranscript', () => ({ fetchYoutubeMetadata: jest.fn() }));
jest.mock('../services/youtubeNote', () => ({ runYoutubeTranscriptJob: jest.fn() }));
jest.mock('../services/imageProcessing', () => ({ processImageForUpload: jest.fn() }));

jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router, { autoStartPdfOcrOrRevert, initializeNotesRoutes } from './notes';
import { chargeAiCredits, refundFeatureAiCredit } from '../middleware/aiRateLimit';
import { runSyncOrEnqueue } from '../queue/enqueue';
import { generateDailyQuiz } from '../services/aiService';
import { SupabaseService } from '../services/supabase';

const DENIED = {
  error: 'Daily AI limit reached. Try again tomorrow.',
  limit: 50,
  used: 50,
  resetsAt: '2026-08-21T00:00:00.000Z',
};

const OCR_PARAMS = {
  noteId: 'note-1',
  attachmentId: 'att-1',
  storagePath: 'u1/notes/scan.pdf',
  fileName: 'scan.pdf',
  meta: {
    storagePath: 'u1/notes/scan.pdf',
    extractionStatus: 'ocr_processing',
    ocrProvider: 'tesseract',
    ocrStartedAt: '2026-08-20T10:00:00.000Z',
  } as Record<string, unknown>,
  userId: 'u1',
  fallbackText: 'thin extracted text',
};

function initSupabase(overrides: Record<string, unknown> = {}) {
  const supabase: any = {
    getNoteAttachment: jest.fn(async () => ({
      id: 'att-1',
      noteId: 'note-1',
      metadata: { ...OCR_PARAMS.meta },
    })),
    updateNoteAttachment: jest.fn(async () => ({})),
    ...overrides,
  };
  const cache: any = {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    delete: jest.fn(async () => {}),
    deletePattern: jest.fn(async () => {}),
  };
  initializeNotesRoutes(supabase, cache);
  return supabase;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('autoStartPdfOcrOrRevert', () => {
  it('reverts the attachment to needs_ocr when the credit charge is denied', async () => {
    const supabase = initSupabase();
    (chargeAiCredits as jest.Mock).mockResolvedValue(DENIED);

    await autoStartPdfOcrOrRevert(OCR_PARAMS);

    // The doomed job was never started…
    expect(runSyncOrEnqueue).not.toHaveBeenCalled();
    // …and the metadata no longer claims OCR is running.
    expect(supabase.updateNoteAttachment).toHaveBeenCalledTimes(1);
    const [attachmentId, updates] = supabase.updateNoteAttachment.mock.calls[0];
    expect(attachmentId).toBe('att-1');
    expect(updates.extractedText).toBe('thin extracted text');
    expect(updates.metadata).toMatchObject({
      extractionStatus: 'needs_ocr',
      ocrError: 'Daily AI limit reached — run OCR manually when credits reset',
    });
    expect(updates.metadata.ocrStartedAt).toBeUndefined();
    expect(updates.metadata.ocrProvider).toBeUndefined();
  });

  it('starts the OCR job and leaves metadata alone when the charge succeeds', async () => {
    const supabase = initSupabase();
    (chargeAiCredits as jest.Mock).mockResolvedValue(null);
    (runSyncOrEnqueue as jest.Mock).mockResolvedValue({ mode: 'async', jobId: 'job-1' });

    await autoStartPdfOcrOrRevert(OCR_PARAMS);

    expect(runSyncOrEnqueue).toHaveBeenCalledWith(
      'notes.ocr.extract',
      expect.objectContaining({ noteId: 'note-1', attachmentId: 'att-1', sourceKind: 'pdf' }),
      'u1',
      expect.any(Function),
      // the charge handle is forwarded as a 5th arg (undefined in this fixture)
      undefined
    );
    expect(supabase.updateNoteAttachment).not.toHaveBeenCalled();
  });

  it('reverts to needs_ocr when starting the job throws', async () => {
    const supabase = initSupabase();
    (chargeAiCredits as jest.Mock).mockResolvedValue(null);
    (runSyncOrEnqueue as jest.Mock).mockRejectedValue(new Error('queue unavailable'));

    await autoStartPdfOcrOrRevert(OCR_PARAMS);

    expect(supabase.updateNoteAttachment).toHaveBeenCalledTimes(1);
    const [, updates] = supabase.updateNoteAttachment.mock.calls[0];
    expect(updates.metadata).toMatchObject({
      extractionStatus: 'needs_ocr',
      ocrError: 'OCR could not be started. Run OCR manually to retry.',
    });
  });

  it('never clobbers an attachment some other path already resolved', async () => {
    const supabase = initSupabase({
      getNoteAttachment: jest.fn(async () => ({
        id: 'att-1',
        noteId: 'note-1',
        metadata: { extractionStatus: 'ok', ocrProvider: 'tesseract' },
      })),
    });
    (chargeAiCredits as jest.Mock).mockResolvedValue(DENIED);

    await autoStartPdfOcrOrRevert(OCR_PARAMS);

    expect(supabase.updateNoteAttachment).not.toHaveBeenCalled();
  });

  it('falls back to the upload-time meta when the attachment cannot be re-read', async () => {
    const supabase = initSupabase({
      getNoteAttachment: jest.fn(async () => {
        throw new Error('transient read failure');
      }),
    });
    (chargeAiCredits as jest.Mock).mockResolvedValue(DENIED);

    await autoStartPdfOcrOrRevert(OCR_PARAMS);

    expect(supabase.updateNoteAttachment).toHaveBeenCalledTimes(1);
    const [, updates] = supabase.updateNoteAttachment.mock.calls[0];
    expect(updates.metadata.extractionStatus).toBe('needs_ocr');
  });
});

/**
 * asyncHandler swallows its own promise, so awaiting the handler proves
 * nothing — wait on the response. The route body is the last handler on the
 * layer (after auth + AI rate-limit middleware, which are not under test).
 */
async function runQuizRoute(req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === '/:noteId/quiz' && l.route?.methods?.post,
  );
  if (!layer) throw new Error('route POST /:noteId/quiz not found');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined, locals: {} };
  const settled = new Promise<void>((resolve, reject) => {
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: unknown) => {
      res.body = body;
      resolve();
      return res;
    };
    handler(req, res, (err: unknown) => reject(err));
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });

  await settled;
  return res;
}

describe('POST /:noteId/quiz regenerate pre-check', () => {
  const NOTE = {
    id: 'note-1',
    title: 'Biology',
    body: 'Mitochondria are the powerhouse of the cell. '.repeat(5),
    sourceType: 'text',
  };

  function initQuizSupabase(existingQuiz: any) {
    const supabase: any = {
      getNote: jest.fn(async () => NOTE),
      getNoteAttachments: jest.fn(async () => []),
      getNoteQuiz: jest.fn(async () => existingQuiz),
      isNoteQuizProtected: SupabaseService.prototype.isNoteQuizProtected,
      upsertNoteQuiz: jest.fn(async (_u: string, noteId: string, p: any) => ({
        noteId,
        questions: p.questions,
        answers: {},
        completed: false,
        studyGoal: p.studyGoal,
      })),
    };
    initializeNotesRoutes(supabase, {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {}),
    } as any);
    return supabase;
  }

  const request = () => ({
    params: { noteId: 'note-1' },
    body: { studyGoal: 'retention' },
    user: { id: 'u1' },
  });

  it('returns the protected quiz with reused:true WITHOUT calling the AI generator', async () => {
    const existing = {
      noteId: 'note-1',
      questions: [{ id: 'old-q' }],
      answers: { 'old-q': 'A' },
      completed: true,
    };
    const supabase = initQuizSupabase(existing);

    const res = await runQuizRoute(request());

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual({ ...existing, reused: true });
    expect(generateDailyQuiz).not.toHaveBeenCalled();
    expect(runSyncOrEnqueue).not.toHaveBeenCalled();
    expect(supabase.upsertNoteQuiz).not.toHaveBeenCalled();
    // The middleware reserved a generation credit up front — give it back.
    expect(refundFeatureAiCredit).toHaveBeenCalledWith('u1', 'generate_questions');
  });

  it('generates fresh questions when the existing quiz is untouched', async () => {
    const supabase = initQuizSupabase({
      noteId: 'note-1',
      questions: [{ id: 'old-q' }],
      answers: {},
      completed: false,
    });
    (generateDailyQuiz as jest.Mock).mockResolvedValue({
      questions: [
        { text: 'Q1', type: 'mcq', options: ['a', 'b'], correctAnswer: 'a', explanation: '', topic: 't' },
      ],
    });
    (runSyncOrEnqueue as jest.Mock).mockImplementation(
      async (_task: string, _payload: unknown, _userId: string, fn: () => Promise<unknown>) => ({
        mode: 'sync',
        result: await fn(),
      }),
    );

    const res = await runQuizRoute(request());

    expect(res.statusCode).toBe(200);
    expect(generateDailyQuiz).toHaveBeenCalledTimes(1);
    expect(supabase.upsertNoteQuiz).toHaveBeenCalledTimes(1);
    expect(res.body.data.questions).toHaveLength(1);
    expect(res.body.data.reused).toBeUndefined();
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();
  });

  it('generates when the note has no quiz yet', async () => {
    const supabase = initQuizSupabase(null);
    (generateDailyQuiz as jest.Mock).mockResolvedValue({ questions: [] });
    (runSyncOrEnqueue as jest.Mock).mockImplementation(
      async (_task: string, _payload: unknown, _userId: string, fn: () => Promise<unknown>) => ({
        mode: 'sync',
        result: await fn(),
      }),
    );

    const res = await runQuizRoute(request());

    expect(res.statusCode).toBe(200);
    expect(supabase.upsertNoteQuiz).toHaveBeenCalled();
    expect(refundFeatureAiCredit).not.toHaveBeenCalled();
  });
});
