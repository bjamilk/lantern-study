/**
 * Segmented lecture recording, on the server.
 *
 * The four things that must be true, and each of them is either a lost lecture
 * or a wrong bill if it is not:
 *
 * 1. A segment is written into the note IN RECORDED ORDER with its `[mm:ss]`
 *    stamp — including a segment retried after later ones already landed.
 * 2. The same segment sent twice is transcribed once, charged once and written
 *    once. The idempotency key is `noteId:sessionId:seq`, never the storage
 *    path, because a retried upload writes a different object for the same
 *    segment.
 * 3. A segment is priced on the take's RUNNING TOTAL, so a lecture in segments
 *    costs what the same lecture costs in one take — and the prior total is read
 *    from the server's own rows, never from the request.
 * 4. Another owner's note is refused before any credit is reserved and before
 *    any provider is called.
 *
 * Unlike `notes.recorderLanguage.test.ts`, this harness runs the WHOLE handler
 * chain rather than the last handler: the limiter is where the price and the
 * access check live, so skipping it would test the half that does not decide
 * anything.
 */
jest.mock('../middleware/aiRateLimit', () => {
  const actual = jest.requireActual('../middleware/aiRateLimit');
  return {
    ...actual,
    // Records what each request reserved, then lets it through. The real
    // middleware's clamp-to-1 is deliberately NOT simulated: the point of the
    // segment limiter is that it does not reach this for a free segment.
    aiRateLimitWithCost: jest.fn((getCost: (req: any) => number) => (req: any, _res: any, next: any) => {
      (globalThis as any).__reserved.push(getCost(req));
      next();
    }),
    aiRateLimitForFeature: jest.fn(() => (_req: any, _res: any, next: any) => next()),
    chargeAiCredits: jest.fn(),
    chargeAiCreditsDetailed: jest.fn(),
    refundFeatureAiCredit: jest.fn(async () => {}),
    applyGlobalUsageHeaders: jest.fn(async () => {}),
  };
});

// The auth and burst middlewares are not what this file is about, and standing
// them up would need an API-key service and a Redis. Pass-through: the LIMITER
// is the middleware under test, and it is the real one.
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../middleware/rateLimit', () => ({
  aiPostBurstRateLimit: (_req: any, _res: any, next: any) => next(),
  collaboratorInviteRateLimit: (_req: any, _res: any, next: any) => next(),
  uploadBurstRateLimit: (_req: any, _res: any, next: any) => next(),
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
  summarizeNoteContent: jest.fn(),
  SMART_NOTES_GUIDANCE_MAX_CHARS: 500,
  generateDailyQuiz: jest.fn(),
  generateFlashcardsFromNotes: jest.fn(),
  generateQuestionsFromNotes: jest.fn(),
  resolveAudioUploadMeta: jest.fn((_buf: Buffer, mimeType: string) => ({
    mimeType: mimeType || 'audio/webm',
    extension: 'webm',
  })),
  transcribeAudioBase64: jest.fn(async () => ({
    transcript: (globalThis as any).__nextTranscript ?? 'said words',
    provider: 'groq-whisper-turbo',
    sniffedMimeType: 'audio/webm',
    byteLength: 1024,
  })),
  transcribeAudioBuffer: jest.fn(async () => ({
    transcript: (globalThis as any).__nextTranscript ?? 'said words',
    provider: 'groq-whisper-turbo',
    sniffedMimeType: 'audio/webm',
    byteLength: 1024,
  })),
}));

jest.mock('../services/notePages', () => ({
  ensurePageImages: jest.fn(),
  ensurePages: jest.fn(),
  getPageText: jest.fn(),
  getPages: jest.fn(),
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
import { transcribeAudioBuffer } from '../services/aiService';
import { getLectureTranscriptionCost } from '@lantern/shared/utils/aiCredits';

const MIN = 60_000;
const OWNER = 'u1';

type AttachmentRow = {
  id: string;
  noteId: string;
  type: string;
  fileName?: string;
  fileUrl?: string;
  extractedText?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

let notes: Record<string, { id: string; userId: string; title: string; body: string }>;
let attachments: AttachmentRow[];
let nextAttachmentId: number;
let layer: any;

function initLayer() {
  notes = {
    'note-1': { id: 'note-1', userId: OWNER, title: 'Cell biology', body: '' },
    'note-9': { id: 'note-9', userId: 'someone-else', title: 'Not yours', body: '' },
  };
  attachments = [];
  nextAttachmentId = 1;
  (globalThis as any).__reserved = [];
  (globalThis as any).__nextTranscript = undefined;

  layer = {
    notes: {
      getNote: jest.fn(async (noteId: string, userId: string) => {
        const note = notes[noteId];
        if (!note || note.userId !== userId) {
          const err = new Error('Note not found or access denied') as Error & { status?: number };
          err.status = 404;
          throw err;
        }
        return note;
      }),
      canEditNote: jest.fn(async (userId: string, noteId: string) => notes[noteId]?.userId === userId),
      updateNote: jest.fn(async (_userId: string, noteId: string, patch: any) => {
        notes[noteId] = { ...notes[noteId]!, ...patch };
        return notes[noteId];
      }),
      getNoteAttachments: jest.fn(async (noteId: string) =>
        attachments.filter((row) => row.noteId === noteId).map((row) => ({ ...row }))
      ),
      addNoteAttachment: jest.fn(async (noteId: string, payload: any) => {
        const row: AttachmentRow = {
          id: `att-${nextAttachmentId++}`,
          noteId,
          type: payload.type,
          fileName: payload.fileName,
          fileUrl: payload.fileUrl,
          extractedText: payload.extractedText,
          metadata: payload.metadata || {},
          createdAt: new Date(2026, 8, 18, 9, nextAttachmentId).toISOString(),
        };
        attachments.push(row);
        return { ...row };
      }),
      updateNoteAttachment: jest.fn(async (attachmentId: string, updates: any) => {
        const row = attachments.find((r) => r.id === attachmentId);
        if (!row) throw new Error('no such attachment');
        if (updates.metadata !== undefined) row.metadata = updates.metadata;
        if (updates.extractedText !== undefined) row.extractedText = updates.extractedText;
        return { ...row };
      }),
      downloadNoteFile: jest.fn(async () => ({
        buffer: Buffer.alloc(4096),
        contentType: 'audio/webm',
      })),
      createSignedNoteFileUrl: jest.fn(async (path: string) => `https://signed.example/${path}`),
      createSignedNoteFileUploadUrl: jest.fn(async (path: string) => ({
        path,
        signedUrl: `https://upload.example/${path}`,
        token: 'tok',
      })),
      uploadNoteFile: jest.fn(async () => ({ path: 'x' })),
    },
    getClient: jest.fn(() => ({})),
  };
  initializeNotesRoutes(layer, { get: jest.fn(async () => null), set: jest.fn(async () => {}) } as any);
}

/** Run the whole POST chain for a path: middleware, limiter and handler. */
async function post(path: string, req: any) {
  const routeLayer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.post
  );
  if (!routeLayer) throw new Error(`route POST ${path} not found`);
  const handlers = routeLayer.route.stack.map((s: any) => s.handle);

  const res: any = { statusCode: 200, body: undefined, locals: {}, headers: {} };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.set = () => res;
  res.setHeader = (name: string, value: unknown) => {
    res.headers[name] = value;
    return res;
  };
  res.on = () => res;

  await new Promise<void>((resolve, reject) => {
    res.json = (payload: unknown) => {
      res.body = payload;
      resolve();
      return res;
    };
    let index = 0;
    const next = (err?: unknown) => {
      if (err) {
        reject(err);
        return;
      }
      const handler = handlers[index++];
      if (!handler) {
        reject(new Error('chain ended without a response'));
        return;
      }
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (error) {
        reject(error);
      }
    };
    next();
    setTimeout(() => reject(new Error('route never responded')), 3000).unref?.();
  });
  return res;
}

const segmentRequest = (over: {
  seq: number;
  startOffsetMs: number;
  durationMs?: number;
  sessionId?: string;
  noteId?: string;
  userId?: string;
  clientByteLength?: number;
}) => ({
  params: {},
  user: { id: over.userId ?? OWNER },
  body: {
    storagePath: `${over.userId ?? OWNER}/lecture-${over.noteId ?? 'note-1'}-${over.seq}.webm`,
    mimeType: 'audio/webm',
    noteId: over.noteId ?? 'note-1',
    fileName: `lecture-${over.noteId ?? 'note-1'}-${over.seq}.webm`,
    durationMs: over.durationMs ?? 5 * MIN,
    clientByteLength: over.clientByteLength ?? 1200 * 1024,
    lectureSegment: {
      sessionId: over.sessionId ?? 'sA',
      seq: over.seq,
      startOffsetMs: over.startOffsetMs,
      durationMs: over.durationMs ?? 5 * MIN,
    },
  },
});

/** Prepare, then transcribe — what a client actually does per segment. */
async function recordSegment(over: Parameters<typeof segmentRequest>[0] & { transcript?: string }) {
  const request = segmentRequest(over);
  await post('/lecture-segments/prepare', {
    ...request,
    body: { ...request.body, byteLength: request.body.clientByteLength },
  });
  (globalThis as any).__nextTranscript = over.transcript ?? `words ${over.seq}`;
  return post('/transcribe-audio', request);
}

const reserved = (): number[] => (globalThis as any).__reserved;
const totalReserved = () => reserved().reduce((sum, n) => sum + n, 0);

beforeEach(() => {
  jest.clearAllMocks();
  initLayer();
});

describe('POST /notes/lecture-segments/prepare', () => {
  it('mints an upload url and registers the segment as pending', async () => {
    const res = await post('/lecture-segments/prepare', {
      ...segmentRequest({ seq: 1, startOffsetMs: 0 }),
      body: { ...segmentRequest({ seq: 1, startOffsetMs: 0 }).body, byteLength: 4096 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.signedUrl).toContain('upload.example');
    // The client never names the key: it is built under the caller's own folder.
    expect(res.body.data.storagePath).toContain(`${OWNER}/`);
    expect(res.body.data.fileName).toBe('lecture-note-1-1.webm');
    expect(attachments).toHaveLength(1);
    expect(attachments[0]!.metadata.lectureSegment).toMatchObject({
      sessionId: 'sA',
      seq: 1,
      status: 'pending',
    });
  });

  it('updates the same row rather than growing a second one on a re-prepare', async () => {
    const req = segmentRequest({ seq: 1, startOffsetMs: 0 });
    await post('/lecture-segments/prepare', { ...req, body: { ...req.body, byteLength: 4096 } });
    await post('/lecture-segments/prepare', { ...req, body: { ...req.body, byteLength: 4096 } });
    expect(attachments).toHaveLength(1);
  });

  it('refuses another owner’s note', async () => {
    const req = segmentRequest({ seq: 1, startOffsetMs: 0, noteId: 'note-9' });
    const res = await post('/lecture-segments/prepare', { ...req, body: { ...req.body, byteLength: 4096 } });
    expect(res.statusCode).toBe(403);
    expect(attachments).toHaveLength(0);
  });

  it('refuses a request that does not say where in the lecture it is', async () => {
    const res = await post('/lecture-segments/prepare', {
      params: {},
      user: { id: OWNER },
      body: { noteId: 'note-1', mimeType: 'audio/webm' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /notes/transcribe-audio with a segment', () => {
  it('writes each segment into the note with its stamp, in order', async () => {
    await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });
    await recordSegment({ seq: 2, startOffsetMs: 5 * MIN, transcript: 'Two.' });
    await recordSegment({ seq: 3, startOffsetMs: 10 * MIN, transcript: 'Three.' });

    expect(notes['note-1']!.body).toContain('[0:00] One.');
    expect(notes['note-1']!.body).toContain('[5:00] Two.');
    expect(notes['note-1']!.body).toContain('[10:00] Three.');
    expect(notes['note-1']!.body.indexOf('[0:00]')).toBeLessThan(
      notes['note-1']!.body.indexOf('[5:00]')
    );
    expect(notes['note-1']!.body.indexOf('[5:00]')).toBeLessThan(
      notes['note-1']!.body.indexOf('[10:00]')
    );
  });

  it('puts a retried segment back where it belongs, not at the end', async () => {
    await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });
    await recordSegment({ seq: 3, startOffsetMs: 10 * MIN, transcript: 'Three.' });
    // Segment 2 failed at the time and only lands now.
    await recordSegment({ seq: 2, startOffsetMs: 5 * MIN, transcript: 'Two.' });

    const body = notes['note-1']!.body;
    expect(body.indexOf('[5:00] Two.')).toBeGreaterThan(body.indexOf('[0:00] One.'));
    expect(body.indexOf('[5:00] Two.')).toBeLessThan(body.indexOf('[10:00] Three.'));
  });

  it('keeps the student’s typed notes above the transcript', async () => {
    notes['note-1']!.body = 'My own notes about ATP.';
    await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });
    expect(notes['note-1']!.body).toContain('My own notes about ATP.');
    expect(notes['note-1']!.body.indexOf('My own notes')).toBeLessThan(
      notes['note-1']!.body.indexOf('[0:00]')
    );
  });

  it('never lets the client’s currentBody delete earlier segments', async () => {
    await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });
    // A live recorder sends only the TYPED half as currentBody. On the
    // whole-take path that is the body; on the segment path it must be ignored.
    const request = segmentRequest({ seq: 2, startOffsetMs: 5 * MIN });
    (globalThis as any).__nextTranscript = 'Two.';
    await post('/transcribe-audio', {
      ...request,
      body: { ...request.body, currentBody: 'just what I typed' },
    });
    expect(notes['note-1']!.body).toContain('[0:00] One.');
    expect(notes['note-1']!.body).toContain('[5:00] Two.');
  });

  it('stores one attachment row per segment, carrying its place in the take', async () => {
    await recordSegment({ seq: 1, startOffsetMs: 0 });
    await recordSegment({ seq: 2, startOffsetMs: 5 * MIN });
    const audio = attachments.filter((row) => row.type === 'audio');
    expect(audio).toHaveLength(2);
    expect(audio.map((row) => (row.metadata.lectureSegment as any).seq)).toEqual([1, 2]);
    expect(audio.every((row) => (row.metadata.lectureSegment as any).status === 'done')).toBe(true);
    expect(audio[0]!.extractedText).toBe('words 1');
  });

  describe('idempotency — the same segment twice', () => {
    it('charges nothing, calls no provider and writes no second copy', async () => {
      await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });
      const firstReserved = totalReserved();
      const callsBefore = (transcribeAudioBuffer as jest.Mock).mock.calls.length;
      const bodyBefore = notes['note-1']!.body;
      const rowsBefore = attachments.length;

      const res = await recordSegment({ seq: 1, startOffsetMs: 0, transcript: 'One.' });

      expect(res.statusCode).toBe(200);
      expect(res.body.data.transcript).toBe('One.');
      expect(res.body.data.segment.replayed).toBe(true);
      expect(totalReserved()).toBe(firstReserved);
      expect((transcribeAudioBuffer as jest.Mock).mock.calls.length).toBe(callsBefore);
      expect(notes['note-1']!.body).toBe(bodyBefore);
      expect(attachments).toHaveLength(rowsBefore);
      expect(bodyBefore.match(/\[0:00\]/g)).toHaveLength(1);
    });

    it('re-transcribes a segment whose audio landed but whose words never did', async () => {
      // Registered pending by prepare, then the transcription failed.
      const req = segmentRequest({ seq: 1, startOffsetMs: 0 });
      await post('/lecture-segments/prepare', { ...req, body: { ...req.body, byteLength: 4096 } });
      expect((attachments[0]!.metadata.lectureSegment as any).status).toBe('pending');

      (globalThis as any).__nextTranscript = 'One, at last.';
      const res = await post('/transcribe-audio', req);
      expect(res.body.data.segment.replayed).toBe(false);
      expect(notes['note-1']!.body).toContain('[0:00] One, at last.');
      expect(attachments).toHaveLength(1);
      expect((attachments[0]!.metadata.lectureSegment as any).status).toBe('done');
    });

    it('treats the same seq in a different take as a different segment', async () => {
      await recordSegment({ seq: 1, startOffsetMs: 0, sessionId: 'sA', transcript: 'Monday.' });
      const res = await recordSegment({ seq: 1, startOffsetMs: 0, sessionId: 'sB', transcript: 'Tuesday.' });
      expect(res.body.data.segment.replayed).toBe(false);
      expect(attachments.filter((row) => row.type === 'audio')).toHaveLength(2);
    });
  });

  describe('the price', () => {
    it('charges the first segment and nothing for the rest of its block', async () => {
      await recordSegment({ seq: 1, startOffsetMs: 0 });
      await recordSegment({ seq: 2, startOffsetMs: 5 * MIN });
      await recordSegment({ seq: 3, startOffsetMs: 10 * MIN });
      expect(totalReserved()).toBe(1);
      // The free ones never reach the variable-cost limiter at all, which is
      // what stops a student at zero being refused a segment that costs nothing.
      expect(reserved()).toEqual([1]);
    });

    it('charges again only when a segment opens the next 15-minute block', async () => {
      for (let seq = 1; seq <= 4; seq += 1) {
        await recordSegment({ seq, startOffsetMs: (seq - 1) * 5 * MIN });
      }
      expect(reserved()).toEqual([1, 1]);
    });

    it('costs a 47-minute lecture exactly what one 47-minute take costs', async () => {
      const plan = [5, 5, 5, 5, 5, 5, 5, 5, 5, 2].map((m) => m * MIN);
      let offset = 0;
      for (let index = 0; index < plan.length; index += 1) {
        await recordSegment({ seq: index + 1, startOffsetMs: offset, durationMs: plan[index]! });
        offset += plan[index]!;
      }
      expect(offset).toBe(47 * MIN);
      expect(totalReserved()).toBe(getLectureTranscriptionCost(47 * MIN));
      expect(totalReserved()).toBe(4);
    });

    it('reads the prior total from its own rows, not from the request', async () => {
      await recordSegment({ seq: 1, startOffsetMs: 0, durationMs: 14 * MIN });
      // A client claiming this segment starts at zero cannot re-buy the first
      // block: the server adds it to the 14 minutes it already holds.
      await recordSegment({ seq: 2, startOffsetMs: 0, durationMs: 5 * MIN });
      expect(totalReserved()).toBe(getLectureTranscriptionCost(19 * MIN));
      expect(totalReserved()).toBe(2);
    });

    it('floors an understated segment by the bytes it actually carries', async () => {
      // 30 MB of audio claiming to be one second. The byte floor prices it.
      await recordSegment({
        seq: 1,
        startOffsetMs: 0,
        durationMs: 1000,
        clientByteLength: 30 * 1024 * 1024,
      });
      expect(totalReserved()).toBeGreaterThan(1);
    });

    it('does not charge a segment that is only a replay', async () => {
      await recordSegment({ seq: 1, startOffsetMs: 0 });
      const before = totalReserved();
      await recordSegment({ seq: 1, startOffsetMs: 0 });
      expect(totalReserved()).toBe(before);
    });
  });

  describe('access', () => {
    it('refuses another owner’s note before anything is reserved or called', async () => {
      const res = await post('/transcribe-audio', segmentRequest({ seq: 1, startOffsetMs: 0, noteId: 'note-9' }));
      expect(res.statusCode).toBe(403);
      expect(reserved()).toEqual([]);
      expect((transcribeAudioBuffer as jest.Mock).mock.calls).toHaveLength(0);
      expect(attachments).toHaveLength(0);
    });

    it('refuses a segment with no note at all', async () => {
      const request = segmentRequest({ seq: 1, startOffsetMs: 0 });
      const res = await post('/transcribe-audio', {
        ...request,
        body: { ...request.body, noteId: undefined },
      });
      expect(res.statusCode).toBe(400);
      expect(reserved()).toEqual([]);
    });
  });

  it('leaves a whole-take recording on the old path, priced as before', async () => {
    (globalThis as any).__nextTranscript = 'the whole lecture';
    const res = await post('/transcribe-audio', {
      params: {},
      user: { id: OWNER },
      body: {
        storagePath: `${OWNER}/lecture-1.webm`,
        mimeType: 'audio/webm',
        noteId: 'note-1',
        durationMs: 47 * MIN,
        clientByteLength: 1024,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.segment).toBeUndefined();
    expect(totalReserved()).toBe(getLectureTranscriptionCost(47 * MIN));
    expect(attachments[0]!.metadata.lectureSegment).toBeUndefined();
  });

  it('ignores a malformed segment block rather than pricing it as a segment', async () => {
    const request = segmentRequest({ seq: 1, startOffsetMs: 0 });
    const res = await post('/transcribe-audio', {
      ...request,
      body: {
        ...request.body,
        durationMs: 47 * MIN,
        lectureSegment: { sessionId: 'sA', seq: 0, startOffsetMs: 0, durationMs: 5 * MIN },
      },
    });
    expect(res.statusCode).toBe(200);
    // It fell through to the whole-take price — the safe direction to fail in.
    expect(totalReserved()).toBe(getLectureTranscriptionCost(47 * MIN));
  });
});
