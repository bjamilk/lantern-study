/**
 * The two page-scoped AI doors on the notes routes.
 *
 * 1. `POST /transcribe-audio` now serves two different things down one route:
 *    a lecture, priced by its length, and a spoken QUESTION, which is free and
 *    capped. The flag that picks between them arrives in the request body, so
 *    every rule that keeps the free door narrow is enforced here rather than
 *    trusted: a clip must claim to be short AND be short, and it is never
 *    written into the student's note.
 *
 * 2. `POST /:noteId/generate-questions` quizzes ONE page. It costs the same one
 *    AI use as a whole-note test and shares its cap, and when the page cannot
 *    be quizzed it says which of the four reasons it is instead of failing
 *    vaguely.
 */
jest.mock('../middleware/aiRateLimit', () => ({
  ...jest.requireActual('../middleware/aiRateLimit'),
  aiRateLimitWithCost: jest.fn(() => (_req: any, _res: any, next: any) => next()),
  aiRateLimitForFeature: jest.fn(() => (_req: any, _res: any, next: any) => next()),
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
  generateQuestionsFromNotes: jest.fn(),
  resolveAudioUploadMeta: jest.fn(),
  transcribeAudioBase64: jest.fn(),
  transcribeAudioBuffer: jest.fn(),
}));

jest.mock('../services/notePages', () => ({
  ensurePageImages: jest.fn(),
  ensurePages: jest.fn(),
  getPageText: jest.fn(),
  signPageImages: jest.fn(),
}));

jest.mock('../services/learningEvents', () => ({
  recordLearningEvent: jest.fn(async () => {}),
  surfaceFromRequest: jest.fn(() => 'web'),
}));

jest.mock('../services/aiInferenceLog', () => ({ logAIInference: jest.fn(async () => {}) }));
jest.mock('../services/presentationPreview', () => ({ runPresentationPreviewJob: jest.fn() }));
jest.mock('../services/youtubeTranscript', () => ({ fetchYoutubeMetadata: jest.fn() }));
jest.mock('../services/youtubeNote', () => ({ runYoutubeTranscriptJob: jest.fn() }));
jest.mock('../services/imageProcessing', () => ({ processImageForUpload: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import router, {
  initializeNotesRoutes,
  isVoiceAskRequest,
  transcribeAudioLimiter,
  voiceAskRejection,
} from './notes';
import { aiRateLimitForFeature, aiRateLimitWithCost } from '../middleware/aiRateLimit';
import { generateQuestionsFromNotes } from '../services/aiService';
import { getPageText } from '../services/notePages';

/** A base64 payload of roughly `bytes` bytes. */
const audioOf = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

const CLIP = { featureKey: 'voice_ask', durationMs: 4000, audioBase64: audioOf(40_000) };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('which price a transcription request pays', () => {
  it('recognises a spoken question only by the flag the client sends', () => {
    expect(isVoiceAskRequest({ body: CLIP })).toBe(true);
    expect(isVoiceAskRequest({ body: { durationMs: 4000 } })).toBe(false);
    expect(isVoiceAskRequest({})).toBe(false);
    expect(isVoiceAskRequest({ body: 'not-an-object' })).toBe(false);
  });

  it('sends a lecture to the length-priced limiter and a question to the free one', () => {
    const next = jest.fn();
    const res: any = { status: () => res, json: () => res };

    transcribeAudioLimiter({ body: { durationMs: 3_600_000 } } as any, res, next);
    expect(aiRateLimitWithCost).toHaveBeenCalledTimes(1);
    expect(aiRateLimitForFeature).not.toHaveBeenCalled();

    transcribeAudioLimiter({ body: CLIP } as any, res, next);
    expect(aiRateLimitForFeature).toHaveBeenCalledWith('voice_ask');
    // The lecture path was not touched a second time: a spoken question pays
    // no per-15-minute charge at all.
    expect(aiRateLimitWithCost).toHaveBeenCalledTimes(1);
  });

  it('refuses a long clip before either limiter runs', () => {
    const next = jest.fn();
    const res: any = {
      statusCode: 200,
      body: undefined,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };

    transcribeAudioLimiter({ body: { ...CLIP, durationMs: 20_000 } } as any, res, next);

    expect(res.statusCode).toBe(400);
    expect(String((res.body as { error: string }).error)).toContain('15 seconds');
    expect(next).not.toHaveBeenCalled();
    // Nothing was reserved, so there is nothing to refund: the guard runs
    // first precisely so a refused clip cannot eat one of the day's questions.
    expect(aiRateLimitForFeature).not.toHaveBeenCalled();
  });
});

describe('what a voice question is allowed to be', () => {
  it('accepts a short clip sent inline', () => {
    expect(voiceAskRejection({ body: CLIP })).toBeNull();
    expect(voiceAskRejection({ body: { ...CLIP, durationMs: 15_000 } })).toBeNull();
  });

  it('will not take the client\'s word for the length', () => {
    // The duration is a claim; the payload is a measurement. An hour of audio
    // labelled "12 seconds" would otherwise transcribe a whole lecture free.
    const rejection = voiceAskRejection({
      body: { ...CLIP, durationMs: 12_000, audioBase64: audioOf(5_000_000) },
    });
    expect(rejection).toContain('15 seconds');
  });

  it('refuses a clip that claims nothing about its length', () => {
    expect(voiceAskRejection({ body: { featureKey: 'voice_ask', audioBase64: audioOf(1000) } }))
      .toContain('length of the clip');
    expect(voiceAskRejection({ body: { ...CLIP, durationMs: 0 } })).toContain('length of the clip');
  });

  it('refuses a stored file, which is a recording wearing the wrong flag', () => {
    expect(
      voiceAskRejection({
        body: { featureKey: 'voice_ask', durationMs: 5000, storagePath: 'u1/notes/lecture.webm' },
      })
    ).toContain('15 seconds');
  });

  it('refuses an empty request rather than charging a cap for nothing', () => {
    expect(voiceAskRejection({ body: { featureKey: 'voice_ask', durationMs: 5000 } })).toContain(
      'recording itself'
    );
  });
});

/**
 * The route body is the last handler on the layer; the limiters above it are
 * mocked through.
 */
async function runRoute(path: string, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post
  );
  if (!layer) throw new Error(`route POST ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);
  const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

  const res: any = { statusCode: 200, body: undefined, locals: {} };
  await new Promise<void>((resolve, reject) => {
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
  return res;
}

describe('POST /:noteId/generate-questions (one page)', () => {
  const NOTE = { id: 'note-1', title: 'Biology', courseId: null };

  function initSupabase(attachment: unknown = { id: 'att-1', noteId: 'note-1' }) {
    const supabase: any = {
      getNote: jest.fn(async () => NOTE),
      getNoteAttachment: jest.fn(async () => attachment),
      getClient: jest.fn(() => ({})),
    };
    initializeNotesRoutes(supabase, {
      get: jest.fn(async () => null),
      set: jest.fn(async () => {}),
    } as any);
    return supabase;
  }

  const request = (body: Record<string, unknown> = {}) => ({
    params: { noteId: 'note-1' },
    body: { attachmentId: 'att-1', pageIndex: 2, ...body },
    user: { id: 'u1' },
  });

  it('makes questions from that page alone', async () => {
    initSupabase();
    (getPageText as jest.Mock).mockResolvedValue({
      available: true,
      reason: 'ok',
      text: 'The Krebs cycle happens in the mitochondrial matrix. '.repeat(4),
      pageCount: 12,
    });
    (generateQuestionsFromNotes as jest.Mock).mockResolvedValue({
      questions: [{ text: 'Where does the Krebs cycle happen?' }],
      provider: 'test',
    });

    const res = await runRoute('/:noteId/generate-questions', request());

    expect(res.statusCode).toBe(200);
    expect(res.body.data.pageIndex).toBe(2);
    expect(res.body.data.questions).toHaveLength(1);
    // The source text is the page, not the note — that is the whole feature.
    const [source] = (generateQuestionsFromNotes as jest.Mock).mock.calls[0];
    expect(source).toContain('Krebs');
    expect(source.length).toBeLessThan(500);
  });

  it('says the document has not been split rather than failing vaguely', async () => {
    initSupabase();
    (getPageText as jest.Mock).mockResolvedValue({
      available: false,
      reason: 'schema_missing',
      text: '',
      pageCount: 0,
    });

    const res = await runRoute('/:noteId/generate-questions', request());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('This document has not been split into pages yet.');
    expect(res.body.reason).toBe('schema_missing');
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
  });

  it('refuses a blank page instead of quizzing on nothing', async () => {
    initSupabase();
    (getPageText as jest.Mock).mockResolvedValue({
      available: true,
      reason: 'ok',
      text: '   ',
      pageCount: 12,
    });

    const res = await runRoute('/:noteId/generate-questions', request());

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toContain('page 3');
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
  });

  it('404s an attachment that belongs to another note', async () => {
    initSupabase(null);
    const res = await runRoute('/:noteId/generate-questions', request());
    expect(res.statusCode).toBe(404);
    expect(getPageText).not.toHaveBeenCalled();
  });

  it('requires a page to be named at all', async () => {
    initSupabase();
    const res = await runRoute(
      '/:noteId/generate-questions',
      { params: { noteId: 'note-1' }, body: { attachmentId: 'att-1' }, user: { id: 'u1' } }
    );
    expect(res.statusCode).toBe(400);
    expect(generateQuestionsFromNotes).not.toHaveBeenCalled();
  });
});
