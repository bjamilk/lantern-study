/**
 * F7a: two client-supplied numbers that used to drive server work unchecked.
 *
 * 1. Transcription price came solely from `durationMs`. A 90-minute upload
 *    declaring `durationMs: 1000` paid 1 credit while Whisper billed the real
 *    length. The bytes actually submitted now imply a minimum duration and the
 *    charge is the larger of the two.
 * 2. `images[]` was unbounded, so one ~2-credit request could buy thousands of
 *    sharp decodes and storage objects. Every route that takes an image array
 *    now refuses an over-long one with 400 before any decode happens.
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

import router, {
  LECTURE_MAX_AUDIO_BYTES_PER_SECOND,
  MAX_NOTE_IMAGES_PER_REQUEST,
  lectureTranscriptionCostFromRequest,
  noteImageBatchRejection,
} from './notes';

const min = (n: number) => n * 60 * 1000;

/** Base64 for `bytes` bytes of audio, padding ignored (4 chars per 3 bytes). */
function base64OfBytes(bytes: number): string {
  return 'A'.repeat(Math.ceil((bytes * 4) / 3));
}

describe('lecture transcription price is not the client’s word alone', () => {
  it('still honours an honest claim', () => {
    expect(lectureTranscriptionCostFromRequest({ body: { durationMs: min(10) } })).toBe(1);
    expect(lectureTranscriptionCostFromRequest({ body: { durationMs: min(90) } })).toBe(6);
  });

  it('rejects an understated duration by pricing from the bytes submitted', () => {
    // 90 minutes of audio, even at the highest bitrate the floor assumes, is
    // far more than one 15-minute block.
    const bytes = LECTURE_MAX_AUDIO_BYTES_PER_SECOND * 90 * 60;
    const understated = lectureTranscriptionCostFromRequest({
      body: { durationMs: 1000, audioBase64: base64OfBytes(bytes) },
    });
    expect(understated).toBe(6);
  });

  it('uses the declared size when the clip went straight to storage', () => {
    const bytes = LECTURE_MAX_AUDIO_BYTES_PER_SECOND * 30 * 60;
    expect(
      lectureTranscriptionCostFromRequest({
        body: { durationMs: 5, storagePath: 'u1/notes/lecture.m4a', clientByteLength: bytes },
      }),
    ).toBe(2);
  });

  it('never overcharges an honest client: a small clip stays at the minimum', () => {
    expect(
      lectureTranscriptionCostFromRequest({
        body: { durationMs: min(3), audioBase64: base64OfBytes(120_000) },
      }),
    ).toBe(1);
  });

  it('keeps the old fallbacks: no duration and no audio prices at one use', () => {
    expect(lectureTranscriptionCostFromRequest({})).toBe(1);
    expect(lectureTranscriptionCostFromRequest({ body: {} })).toBe(1);
    expect(lectureTranscriptionCostFromRequest({ body: { durationMs: 'lots' } })).toBe(1);
    expect(lectureTranscriptionCostFromRequest({ body: { durationMs: -min(30) } })).toBe(1);
  });
});

describe('image batch cap', () => {
  it('accepts a real photo note and refuses an amplifier', () => {
    expect(noteImageBatchRejection(1)).toBeNull();
    expect(noteImageBatchRejection(MAX_NOTE_IMAGES_PER_REQUEST)).toBeNull();
    expect(noteImageBatchRejection(MAX_NOTE_IMAGES_PER_REQUEST + 1)).toMatch(/Too many images/);
    expect(noteImageBatchRejection(5000)).toMatch(/at most/);
  });

  it('POST /upload-images answers 400 before any decode happens', async () => {
    const { processImageForUpload } = await import('../services/imageProcessing');
    (processImageForUpload as jest.Mock).mockClear();

    const layer = (router as any).stack.find(
      (l: any) => l.route?.path === '/upload-images' && l.route?.methods?.post,
    );
    expect(layer).toBeDefined();
    const handlers = layer.route.stack.map((s: any) => s.handle);
    const handler = handlers[handlers.length - 1] as (req: any, res: any, next: any) => void;

    const req: any = {
      user: { id: 'u1' },
      body: {
        images: Array.from({ length: MAX_NOTE_IMAGES_PER_REQUEST + 5 }, (_, i) => ({
          fileName: `p${i}.jpg`,
          base64Data: 'AAAA',
        })),
      },
    };
    const res: any = { statusCode: 200, body: undefined, locals: {}, setHeader: jest.fn() };
    const settled = new Promise<void>((resolve) => {
      res.status = (code: number) => {
        res.statusCode = code;
        return res;
      };
      res.json = (body: unknown) => {
        res.body = body;
        resolve();
        return res;
      };
    });
    handler(req, res, () => {});
    await settled;

    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/Too many images/);
    expect(processImageForUpload as jest.Mock).not.toHaveBeenCalled();
  });
});
