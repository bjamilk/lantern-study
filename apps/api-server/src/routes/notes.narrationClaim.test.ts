/**
 * The narration claim, where the route puts it: between resolving the price and
 * reserving the credits.
 *
 * Two properties are wired here rather than in the service, and both are about
 * money. A request that LOSES the claim is answered as reuse and never reaches
 * the credit middleware at all — that is what stops a double tap being charged
 * twice. And a request that WINS the claim but is then refused the charge must
 * hand the row back before the response is done, or a 429 would lock the
 * student out of their own document until the stale window passed.
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

jest.mock('../services/narrationService', () => ({
  NARRATION_IMAGE_URL_TTL_SECONDS: 86400,
  buildNarrationScript: jest.fn(),
  claimNarrationRun: jest.fn(),
  getNarrationBundle: jest.fn(async () => ({ available: true, reason: 'ok', bundle: null })),
  narrationApiPayload: jest.fn((attachmentId: string, _bundle: unknown, extra: any) => ({
    attachmentId,
    ...(extra || {}),
  })),
  markNarrationFailed: jest.fn(async () => {}),
  markStatus: jest.fn(async () => ({ available: true })),
  releaseNarrationClaim: jest.fn(async () => {}),
  resolveNarrationTarget: jest.fn(),
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

import { EventEmitter } from 'events';
import { initializeNotesRoutes, resolveNarrationCharge } from './notes';
import {
  claimNarrationRun,
  releaseNarrationClaim,
  resolveNarrationTarget,
} from '../services/narrationService';

const claimMock = claimNarrationRun as jest.MockedFunction<any>;
const releaseMock = releaseNarrationClaim as jest.MockedFunction<any>;
const resolveMock = resolveNarrationTarget as jest.MockedFunction<any>;

const PREVIOUS = { sourceId: 'att-1', version: 1, status: 'failed', pageCount: 6 };

/** A response that behaves like the real one for the two things this needs. */
function makeRes() {
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.body = undefined;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  res.setHeader = jest.fn();
  res.getHeader = jest.fn();
  return res;
}

function makeReq() {
  return {
    params: { noteId: 'note-1', attachmentId: 'att-1' },
    body: {},
    user: { id: 'user-1' },
  } as any;
}

/** Run the middleware and let its awaited work settle. */
async function run(req: any, res: any) {
  const next = jest.fn();
  await (resolveNarrationCharge as any)(req, res, next);
  await new Promise((resolve) => setImmediate(resolve));
  return next;
}

beforeEach(() => {
  jest.clearAllMocks();
  initializeNotesRoutes(
    {
      notes: {
        getNoteAttachment: jest.fn(async () => ({ id: 'att-1' })),
        getNote: jest.fn(async () => ({ id: 'note-1', title: 'Lecture 4' })),
      },
      getClient: () => ({}),
      // `narrationService` is mocked whole here; it only ever receives this
      // handle, so an empty object stands in for the facade the route still
      // hands it (`dataLayer.legacyService`).
      legacyService: {},
    } as any,
    { get: jest.fn(), set: jest.fn(), delete: jest.fn(), deletePattern: jest.fn() } as any
  );
  resolveMock.mockResolvedValue({
    ok: true,
    attachmentId: 'att-1',
    pageCount: 6,
    cost: 2,
    truncated: false,
    existing: PREVIOUS,
    reuse: false,
  });
});

describe('the narration claim on the POST chain', () => {
  it('sends a request that lost the claim to reuse, not to the credit middleware', async () => {
    claimMock.mockResolvedValue({ available: true, claimed: false, version: 2, previous: PREVIOUS });
    const res = makeRes();

    const next = await run(makeReq(), res);

    // The second of two taps never reaches the limiter, so it is never charged.
    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({ success: true, data: { reused: true } });
  });

  it('hands the row back when the charge is refused', async () => {
    claimMock.mockResolvedValue({ available: true, claimed: true, version: 2, previous: PREVIOUS });
    const req = makeReq();
    const res = makeRes();

    const next = await run(req, res);
    expect(next).toHaveBeenCalled();

    // The limiter answers 429 and never reaches the handler, so the claim was
    // never consumed.
    res.statusCode = 429;
    res.emit('finish');

    expect(releaseMock).toHaveBeenCalledWith(expect.anything(), {
      attachmentId: 'att-1',
      userId: 'user-1',
      previous: PREVIOUS,
    });
  });

  it('keeps the row once the charge went through', async () => {
    claimMock.mockResolvedValue({ available: true, claimed: true, version: 2, previous: PREVIOUS });
    const req = makeReq();
    const res = makeRes();

    await run(req, res);
    // What the handler does the moment it is reached.
    req.narrationClaimConsumed = true;
    res.emit('finish');

    expect(releaseMock).not.toHaveBeenCalled();
  });

  it('says reading aloud is not switched on when the claim finds no table', async () => {
    claimMock.mockResolvedValue({ available: false, claimed: false, version: 1, previous: null });
    const res = makeRes();

    const next = await run(makeReq(), res);

    expect(next).not.toHaveBeenCalled();
    expect(res.body).toMatchObject({
      success: true,
      data: { available: false, reason: 'schema_missing' },
    });
    expect(releaseMock).not.toHaveBeenCalled();
  });
});
