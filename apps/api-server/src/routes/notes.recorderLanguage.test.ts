/**
 * What the recorder's settings and the enhance modal are allowed to change on
 * the server.
 *
 * Three things are asserted here, and each of them is a hole if it is not:
 *
 * 1. `POST /transcribe-audio` forwards the student's spoken language to
 *    Whisper, sends NOTHING for auto-detect (Whisper detects it itself, and
 *    "auto" is not a language code), and only asks for the translate task when
 *    the target is English and the speaker is not already speaking it.
 * 2. `POST /:noteId/summarize` carries the one-line skill hint into the
 *    generation options, capped.
 * 3. An attached material must be the caller's OWN note in the SAME study set.
 *    Anything else is a 404 and no AI work happens — the enhance control only
 *    ever lists this set's materials, so a request for another id did not come
 *    from that control.
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
  runNoteAiSync: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  runSyncOrEnqueue: jest.fn(
    async (_name: string, _payload: unknown, _userId: string, run: () => Promise<unknown>) => ({
      mode: 'sync',
      result: await run(),
    })
  ),
}));

jest.mock('../services/aiService', () => ({
  summarizeNoteContent: jest.fn(async () => ({ summary: '## Smart Notes\n- x', provider: 'test' })),
  SMART_NOTES_GUIDANCE_MAX_CHARS: 500,
  generateDailyQuiz: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
  generateQuestionsFromNotes: jest.fn(),
  resolveAudioUploadMeta: jest.fn(),
  transcribeAudioBase64: jest.fn(async () => ({
    transcript: 'hello',
    provider: 'groq-whisper-turbo',
    sniffedMimeType: 'audio/webm',
    byteLength: 1024,
  })),
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

import router, { initializeNotesRoutes } from './notes';
import { summarizeNoteContent, transcribeAudioBase64 } from '../services/aiService';

const LECTURE = {
  id: 'note-1',
  userId: 'u1',
  title: 'Cell biology',
  body: 'The mitochondrion is the powerhouse of the cell. '.repeat(20),
  studySetId: 'set-1',
  sourceType: 'text',
};

const SLIDES = {
  id: 'note-2',
  userId: 'u1',
  title: 'Week 3 slides',
  body: 'Slide 1: ATP synthase. '.repeat(20),
  studySetId: 'set-1',
  sourceType: 'document',
};

const OTHER_OWNER_NOTE = { ...SLIDES, id: 'note-3', userId: 'u2' };
const OTHER_SET_NOTE = { ...SLIDES, id: 'note-4', studySetId: 'set-2' };

const NOTES_BY_ID: Record<string, any> = {
  'note-1': LECTURE,
  'note-2': SLIDES,
  'note-3': OTHER_OWNER_NOTE,
  'note-4': OTHER_SET_NOTE,
};

function initSupabase() {
  const supabase: any = {
    notes: {
      getNote: jest.fn(async (noteId: string) => {
        const note = NOTES_BY_ID[noteId];
        if (!note) {
          const err = new Error('Note not found or access denied') as Error & { status?: number };
          err.status = 404;
          throw err;
        }
        return note;
      }),
      getNoteAttachments: jest.fn(async () => []),
      canEditNote: jest.fn(async () => true),
      updateNote: jest.fn(async (_u: string, id: string, patch: any) => ({
        ...NOTES_BY_ID[id],
        ...patch,
      })),
      addNoteAttachment: jest.fn(async () => ({})),
      downloadNoteFile: jest.fn(),
      createSignedNoteFileUrl: jest.fn(),
    },
    getClient: jest.fn(() => ({})),
  };
  initializeNotesRoutes(supabase, {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
  } as any);
  return supabase;
}

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
    res.set = () => res;
    res.setHeader = () => res;
    handler(req, res, (err: unknown) => reject(err));
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

beforeEach(() => {
  jest.clearAllMocks();
  initSupabase();
});

/** The last argument `transcribeAudioBase64` was called with. */
function lastTranscribeOptions() {
  const calls = (transcribeAudioBase64 as jest.Mock).mock.calls;
  return calls[calls.length - 1]?.[3];
}

const transcribeRequest = (body: Record<string, unknown> = {}) => ({
  params: {},
  body: { audioBase64: 'A'.repeat(4000), mimeType: 'audio/webm', noteId: 'note-1', ...body },
  user: { id: 'u1' },
});

describe('POST /transcribe-audio — the spoken language', () => {
  it('sends no language at all for auto-detect', async () => {
    await runRoute('/transcribe-audio', transcribeRequest({ language: 'auto' }));
    expect(lastTranscribeOptions()).toEqual({ language: undefined, translate: false });
  });

  it('sends no language when the client says nothing', async () => {
    await runRoute('/transcribe-audio', transcribeRequest());
    expect(lastTranscribeOptions()).toEqual({ language: undefined, translate: false });
  });

  it('forwards a language the recorder offers', async () => {
    await runRoute('/transcribe-audio', transcribeRequest({ language: 'yo' }));
    expect(lastTranscribeOptions()).toEqual({ language: 'yo', translate: false });
  });

  it('drops a language that is not on the list rather than forwarding it', async () => {
    await runRoute('/transcribe-audio', transcribeRequest({ language: 'klingon' }));
    expect(lastTranscribeOptions()?.language).toBeUndefined();
    await runRoute('/transcribe-audio', transcribeRequest({ language: { id: 'en' } }));
    expect(lastTranscribeOptions()?.language).toBeUndefined();
  });

  it('asks for the translate task only when the target is English and the speaker is not', async () => {
    await runRoute('/transcribe-audio', transcribeRequest({ language: 'yo', translateTo: 'en' }));
    expect(lastTranscribeOptions()).toEqual({ language: 'yo', translate: true });

    await runRoute('/transcribe-audio', transcribeRequest({ language: 'en', translateTo: 'en' }));
    expect(lastTranscribeOptions()?.translate).toBe(false);

    await runRoute('/transcribe-audio', transcribeRequest({ language: 'yo', translateTo: 'same' }));
    expect(lastTranscribeOptions()?.translate).toBe(false);
  });

  it('ignores a translate target Whisper cannot produce', async () => {
    // "Transcribe to Yoruba" is not a thing the model can do. It must degrade
    // to the transcription task, not silently become English.
    await runRoute('/transcribe-audio', transcribeRequest({ language: 'en', translateTo: 'yo' }));
    expect(lastTranscribeOptions()?.translate).toBe(false);
  });
});

const summarizeRequest = (body: Record<string, unknown> = {}) => ({
  params: { noteId: 'note-1' },
  body: { depth: 'standard', ...body },
  user: { id: 'u1' },
});

describe('POST /:noteId/summarize — the enhance hints', () => {
  it('carries the skill-level hint into the generation options', async () => {
    const res = await runRoute(
      '/:noteId/summarize',
      summarizeRequest({ skillLevelHint: 'I am new to this — explain the basics.' })
    );
    expect(res.statusCode).toBe(200);
    const options = (summarizeNoteContent as jest.Mock).mock.calls[0]?.[1];
    expect(options.skillLevelHint).toBe('I am new to this — explain the basics.');
  });

  it('caps the hint at 200 characters', async () => {
    await runRoute('/:noteId/summarize', summarizeRequest({ skillLevelHint: 'x'.repeat(900) }));
    const options = (summarizeNoteContent as jest.Mock).mock.calls[0]?.[1];
    expect(options.skillLevelHint).toHaveLength(200);
  });

  it('passes no hint when the field is blank or not a string', async () => {
    await runRoute('/:noteId/summarize', summarizeRequest({ skillLevelHint: '   ' }));
    expect((summarizeNoteContent as jest.Mock).mock.calls[0]?.[1].skillLevelHint).toBeUndefined();
    await runRoute('/:noteId/summarize', summarizeRequest({ skillLevelHint: { a: 1 } }));
    expect((summarizeNoteContent as jest.Mock).mock.calls[1]?.[1].skillLevelHint).toBeUndefined();
  });

  it('reads an attached material from the same set', async () => {
    const res = await runRoute('/:noteId/summarize', summarizeRequest({ contextNoteId: 'note-2' }));
    expect(res.statusCode).toBe(200);
    const options = (summarizeNoteContent as jest.Mock).mock.calls[0]?.[1];
    expect(options.contextMaterial.title).toBe('Week 3 slides');
    expect(options.contextMaterial.text).toContain('ATP synthase');
    expect(options.contextMaterial.text.length).toBeLessThanOrEqual(4000);
  });

  it("refuses another owner's note with a 404, and generates nothing", async () => {
    const res = await runRoute('/:noteId/summarize', summarizeRequest({ contextNoteId: 'note-3' }));
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('That material is not in this study set.');
    expect(summarizeNoteContent).not.toHaveBeenCalled();
  });

  it('refuses a note from another study set with the same 404', async () => {
    const res = await runRoute('/:noteId/summarize', summarizeRequest({ contextNoteId: 'note-4' }));
    expect(res.statusCode).toBe(404);
    expect(summarizeNoteContent).not.toHaveBeenCalled();
  });

  it('refuses a note id that does not exist without confirming it', async () => {
    const res = await runRoute(
      '/:noteId/summarize',
      summarizeRequest({ contextNoteId: 'no-such-note' })
    );
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe('That material is not in this study set.');
  });

  it('ignores an attach of the note being enhanced', async () => {
    const res = await runRoute('/:noteId/summarize', summarizeRequest({ contextNoteId: 'note-1' }));
    expect(res.statusCode).toBe(200);
    expect((summarizeNoteContent as jest.Mock).mock.calls[0]?.[1].contextMaterial).toBeUndefined();
  });
});
