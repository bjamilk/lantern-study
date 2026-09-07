/**
 * GET /tests/:id — the fallback a retake depends on.
 *
 * The tests list drops questions from completed rows (a page of history would
 * otherwise carry every question twice), so a retake launched straight off a
 * history row had nothing to launch and every one failed with "Question data
 * is no longer available for this test". This route is where the questions
 * still live; these tests pin that, plus the provenance and the three-way
 * tally the results screen reads.
 */
import router, {
  initializeTestRoutes,
  defaultPersonalTestTitle,
  normalizePersonalTestQuestions,
  readPersonalTestSource,
} from './tests';

jest.mock('../middleware/authorizeResource', () => ({
  requireTestOwner: () => (_req: any, _res: any, next: any) => next(),
}));

// Replay-on-retry is pinned in tests.personal.test.ts; here it is just a
// passthrough so the title and provenance rules can be read on their own.
jest.mock('../middleware/idempotency', () => ({
  idempotencyMiddleware: () => (req: any, _res: any, next: any) => {
    req.runIdempotent = (handler: () => Promise<unknown>) => handler();
    next();
  },
}));

async function runGet(path: string, req: any) {
  return runRoute('get', path, req);
}

async function runPost(path: string, req: any) {
  return runRoute('post', path, req);
}

async function runRoute(method: 'get' | 'post', path: string, req: any) {
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.[method],
  );
  if (!layer) throw new Error(`route ${method.toUpperCase()} ${path} not found`);
  const handlers = layer.route.stack.map((s: any) => s.handle);

  const res: any = { statusCode: 200, body: undefined };
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
    // Index 0 is authMiddleware; req.user is supplied directly.
    let index = 1;
    const next = (err?: unknown) => {
      if (err) return reject(err);
      const handler = handlers[index++];
      if (!handler) return reject(new Error('route never responded'));
      try {
        const out = handler(req, res, next);
        if (out && typeof out.catch === 'function') out.catch(reject);
      } catch (thrown) {
        reject(thrown);
      }
    };
    next();
    setTimeout(() => reject(new Error('route never responded')), 2000).unref?.();
  });
  return res;
}

const question = (id: string, explanation?: string) => ({
  id,
  question: `Question ${id}`,
  type: 'multiple_choice_single',
  options: ['yes', 'no'],
  correctAnswer: 'yes',
  ...(explanation ? { explanation } : {}),
});

/** A finished attempt from yesterday: two of three answered, one never reached. */
const completedRow = {
  id: 'test-1',
  user_id: 'user-1',
  status: 'completed',
  session_kind: 'test',
  title: 'Test · Cardiology',
  start_time: '2026-09-04T09:00:00.000Z',
  end_time: '2026-09-04T09:20:00.000Z',
  current_question_index: 2,
  config: {
    name: 'Test · Cardiology',
    sourceNoteId: 'note-9',
    sourceNoteTitle: 'Cardiology',
    numberOfQuestions: 3,
  },
  questions: [question('q1', 'Because the ventricle contracts.'), question('q2'), question('q3')],
  user_answers: {
    q1: { questionId: 'q1', selectedOptionIds: ['1'], confidence: 'sure' },
    q2: { questionId: 'q2', selectedOptionIds: ['2'], confidence: 'unsure' },
  },
};

/**
 * The real mapper is what every client reads, so the fake service delegates to
 * it rather than inventing a shape the server does not actually send. It reads
 * only its argument, so the prototype method stands alone.
 */
const { SupabaseService } = jest.requireActual('../services/supabase');
const mapTestSessionRowToClient = SupabaseService.prototype.mapTestSessionRowToClient;

function initWith(resolve: jest.Mock, extra: Record<string, unknown> = {}) {
  const supabase: any = {
    resolveTestSessionForCaller: resolve,
    mapTestSessionRowToClient,
    attachSourceNoteTitles: async (rows: any[]) => rows,
    resolvePersonalTestSourceTitle: async () => null,
    ...extra,
  };
  const cache: any = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    deletePattern: async () => {},
  };
  initializeTestRoutes(supabase, cache);
  return supabase;
}

const request = (testId: string, userId = 'user-1') => ({
  user: { id: userId },
  params: { testId },
  query: {},
  body: {},
  headers: {},
});

describe('GET /tests/:testId — what a retake reads', () => {
  it('returns the questions a completed session still holds', async () => {
    initWith(jest.fn().mockResolvedValue({ session: completedRow, access: 'owner' }));

    const res = await runGet('/:testId', request('test-1'));

    expect(res.statusCode).toBe(200);
    // The list omits these on a completed row; this is the only place left.
    expect(res.body.data.questions).toHaveLength(3);
    expect(res.body.data.questionCount).toBe(3);
    expect(res.body.data.status).toBe('completed');
  });

  it('carries each question rationale so review needs no second AI call', async () => {
    initWith(jest.fn().mockResolvedValue({ session: completedRow, access: 'owner' }));

    const res = await runGet('/:testId', request('test-1'));

    expect(res.body.data.questions[0].explanation).toBe('Because the ventricle contracts.');
  });

  it('names where the test came from, so the retake can say what it is relaunching', async () => {
    initWith(jest.fn().mockResolvedValue({ session: completedRow, access: 'owner' }));

    const res = await runGet('/:testId', request('test-1'));

    expect(res.body.data.provenance).toEqual({
      noteId: 'note-9',
      deckId: null,
      groupId: null,
      title: 'Cardiology',
    });
  });

  it('tallies the unanswered question apart from the wrong one', async () => {
    initWith(jest.fn().mockResolvedValue({ session: completedRow, access: 'owner' }));

    const res = await runGet('/:testId', request('test-1'));

    expect(res.body.data.tally).toMatchObject({
      total: 3,
      answered: 2,
      correct: 1,
      incorrect: 1,
      // Never folded into `incorrect`: the student did not get this wrong,
      // they never saw it.
      unanswered: 1,
    });
    expect(res.body.data.tally.byConfidence.sure).toEqual({ correct: 1, incorrect: 0, answered: 1 });
    expect(res.body.data.tally.byConfidence.unsure).toEqual({ correct: 0, incorrect: 1, answered: 1 });
  });

  it('404s a session the caller neither owns nor shares a group with', async () => {
    initWith(jest.fn().mockResolvedValue(null));

    const res = await runGet('/:testId', request('test-1', 'stranger'));

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('gives a group peer the questions but never the owner’s attempt', async () => {
    const groupRow = {
      ...completedRow,
      user_id: 'user-1',
      config: { ...completedRow.config, groupId: 'group-7', groupName: 'Physiology II' },
    };
    initWith(jest.fn().mockResolvedValue({ session: groupRow, access: 'group' }));

    const res = await runGet('/:testId', request('test-1', 'member-2'));

    expect(res.body.data.access).toBe('group');
    expect(res.body.data.questions).toHaveLength(3);
    // Someone else's answers are not this member's to read.
    expect(res.body.data.userAnswers).toEqual({});
    expect(res.body.data.currentQuestionIndex).toBe(0);
    expect(res.body.data.tally).toBeNull();
  });
});

describe('personal test provenance and titling', () => {
  it('reads a deck source in both the nested and flat shapes', () => {
    expect(readPersonalTestSource({ source: { deckId: 'deck-1' } })).toEqual({
      noteId: null,
      deckId: 'deck-1',
    });
    expect(readPersonalTestSource({ sourceDeckId: 'deck-2' })).toEqual({
      noteId: null,
      deckId: 'deck-2',
    });
    expect(readPersonalTestSource({ sourceNoteId: 'note-3' })).toEqual({
      noteId: 'note-3',
      deckId: null,
    });
  });

  it('ignores a blank source rather than storing an empty id', () => {
    expect(readPersonalTestSource({ source: { deckId: '   ' } })).toEqual({
      noteId: null,
      deckId: null,
    });
  });

  it('titles a titleless deck save "Test · <deck>" instead of rejecting it', async () => {
    const created = jest.fn().mockResolvedValue({ id: 'test-2', title: 'Test · Pharm cards' });
    initWith(jest.fn(), {
      createPersonalTest: created,
      resolvePersonalTestSourceTitle: async () => 'Pharm cards',
    });

    const res = await runPost('/personal', {
      user: { id: 'user-1' },
      params: {},
      query: {},
      headers: {},
      body: { source: { deckId: 'deck-1' }, questions: [{ question: 'Why?' }] },
    });

    expect(res.statusCode).toBe(201);
    expect(created.mock.calls[0][0]).toMatchObject({
      title: 'Test · Pharm cards',
      sourceDeckId: 'deck-1',
    });
  });

  it('still refuses a titleless save that names no source at all', async () => {
    initWith(jest.fn(), { createPersonalTest: jest.fn() });

    const res = await runPost('/personal', {
      user: { id: 'user-1' },
      params: {},
      query: {},
      headers: {},
      body: { questions: [{ question: 'Why?' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INVALID_TITLE');
  });

  it('titles a sourced test "Test · <source>" — never "Quiz"', () => {
    expect(defaultPersonalTestTitle('Cardiology')).toBe('Test · Cardiology');
    expect(defaultPersonalTestTitle('  Cardiology  ')).toBe('Test · Cardiology');
  });

  it('has no default title when there is no source to name', () => {
    expect(defaultPersonalTestTitle(null)).toBeNull();
    expect(defaultPersonalTestTitle('')).toBeNull();
  });

  it('canonicalises a question rationale written under another key', () => {
    const result = normalizePersonalTestQuestions([
      { question: 'Why?', rationale: 'Because the ventricle contracts.' },
      { question: 'And?', explanation: 'No explanation available.' },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.questions[0].explanation).toBe('Because the ventricle contracts.');
    // Generator placeholder text is not a rationale; review must be free to
    // say so rather than print it.
    expect(result.questions[1].explanation).toBeUndefined();
  });
});
