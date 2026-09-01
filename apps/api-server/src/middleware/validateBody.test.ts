import { validateBodyShape } from '../middleware/validateBody';

function runMiddleware(mw: ReturnType<typeof validateBodyShape>, body: unknown) {
  const req = { method: 'POST', body } as any;
  const res = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  mw(req, res as any, () => {
    nextCalled = true;
  });
  return { statusCode: res.statusCode, body: res.body, nextCalled };
}

describe('validateBodyShape', () => {
  it('allows shallow objects', () => {
    const result = runMiddleware(validateBodyShape(), { name: 'test' });
    expect(result.nextCalled).toBe(true);
  });

  it('rejects deeply nested objects', () => {
    let nested: any = {};
    let current = nested;
    for (let i = 0; i < 12; i++) {
      current.child = {};
      current = current.child;
    }
    const result = runMiddleware(validateBodyShape({ maxDepth: 8 }), nested);
    expect(result.nextCalled).toBe(false);
    expect(result.statusCode).toBe(400);
  });

  it('allows large test session payloads on /api/v1/tests', () => {
    const questions = Array.from({ length: 25 }, (_, i) => ({
      id: `q-${i}`,
      text: 'Question text',
      options: Array.from({ length: 4 }, (__, j) => ({
        id: `opt-${i}-${j}`,
        text: `Option ${j}`,
        metadata: { index: j },
      })),
    }));
    const req = {
      method: 'POST',
      path: '/api/v1/tests',
      body: {
        config: { numberOfQuestions: 25, groupId: 'g1' },
        questions,
        user_answers: Object.fromEntries(questions.map((q) => [q.id, { questionId: q.id, isCorrect: true }])),
        start_time: new Date().toISOString(),
        end_time: new Date().toISOString(),
        is_offline: false,
      },
    } as any;
    const res = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    let nextCalled = false;
    validateBodyShape()(req, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('allows large offline bundle payloads on /api/v1/offline-bundles', () => {
    const questions = Array.from({ length: 25 }, (_, i) => ({
      id: `q-${i}`,
      questionStem: 'Question text',
      imageUrl: 'data:image/jpeg;base64,' + 'A'.repeat(5000),
      options: Array.from({ length: 4 }, (__, j) => ({
        id: `opt-${i}-${j}`,
        text: `Option ${j}`,
      })),
    }));
    const req = {
      method: 'POST',
      path: '/api/v1/offline-bundles',
      body: {
        userId: 'user-1',
        bundle: {
          bundleId: 'bundle-1',
          config: { numberOfQuestions: 25, groupId: 'g1' },
          questions,
          groupName: 'Biology',
          downloadedAt: new Date().toISOString(),
        },
      },
    } as any;
    const res = {
      statusCode: 200,
      body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.body = payload;
        return this;
      },
    };
    let nextCalled = false;
    validateBodyShape()(req, res as any, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });
});

function runAtPath(path: string, body: unknown) {
  const req = { method: 'POST', path, body } as any;
  const res = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  let nextCalled = false;
  validateBodyShape()(req, res as any, () => {
    nextCalled = true;
  });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

/** A study pack the size a real flashcard deck produces. */
function studyPackBody(cardCount: number) {
  return {
    title: 'CHM 201 revision pack',
    campusId: 'campus-1',
    attestation: true,
    content: {
      flashcards: Array.from({ length: cardCount }, (_, i) => ({
        id: `card-${i}`,
        front: 'Front text',
        back: 'Back text',
        tags: ['organic', 'exam'],
      })),
    },
  };
}

describe('study-pack publish body limits', () => {
  it('accepts a deck-sized study pack', () => {
    // 45 cards used to 400 before the route ran: the large-payload exemption
    // listed question-banks and not study-packs, so a real deck was refused
    // with nothing published and no explanation the seller could act on.
    expect(runAtPath('/api/v1/marketplace/study-packs/publish', studyPackBody(120)).nextCalled).toBe(
      true,
    );
    expect(
      runAtPath('/api/v1/marketplace/study-packs/abc/update-content', studyPackBody(120)).nextCalled,
    ).toBe(true);
  });

  it('still caps an ordinary marketplace route', () => {
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 400; i += 1) wide[`k${i}`] = i;
    expect(runAtPath('/api/v1/marketplace/listings', wide).nextCalled).toBe(false);
  });
});
