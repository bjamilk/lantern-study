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
});
