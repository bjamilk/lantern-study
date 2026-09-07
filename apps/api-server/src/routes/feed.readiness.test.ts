/**
 * /api/v1/mastery route payloads for the readiness lane: the next action must
 * reach the clients on the readiness payload, and the unmatched-tags endpoint
 * must refuse a request with no course rather than answering for "all of them".
 */
jest.mock('../middleware/auth', () => ({ authMiddleware: (_r: any, _s: any, n: any) => n() }));
jest.mock('../services/activityFeed', () => ({ getActivityFeedService: () => ({}) }));
jest.mock('../services/learningConnections', () => ({ getLearningConnectionsService: () => ({}) }));

const courseReadiness = jest.fn();
const courseAggregate = jest.fn();
const unmatchedTags = jest.fn();
jest.mock('../services/topicMastery', () => ({
  getTopicMasteryService: () => ({ courseReadiness, courseAggregate, unmatchedTags }),
}));

import { masteryRouter } from './feed';

/** asyncHandler returns void, so a call is finished only after the microtasks. */
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

function handlerFor(path: string) {
  const layer = (masteryRouter as any).stack.find(
    (l: any) => l.route?.path === path && l.route?.methods?.get
  );
  if (!layer) throw new Error(`No GET ${path}`);
  const stack = layer.route.stack;
  const handle = stack[stack.length - 1].handle as (req: any, res: any, next: any) => unknown;
  return async (reqLike: any, resLike: any, next: any) => {
    handle(reqLike, resLike, next);
    await settle();
  };
}

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

const req = (query: Record<string, unknown> = {}) => ({ query, user: { id: 'user-1' }, params: {} });

const NEXT_ACTION = {
  kind: 'review-deck',
  targetId: 'deck-1',
  label: 'Review Krebs cards',
  reason: 'Krebs cycle is your weakest topic so far (30%).',
  topicId: 't2',
  topicTitle: 'Krebs cycle',
  suggestion: null,
};

beforeEach(() => {
  courseReadiness.mockReset();
  courseAggregate.mockReset();
  unmatchedTags.mockReset();
});

describe('GET /mastery/readiness', () => {
  it('passes the next action through to the client untouched', async () => {
    courseReadiness.mockResolvedValue([{ courseId: 'course-1', nextAction: NEXT_ACTION }]);
    const res = fakeRes();
    await handlerFor('/readiness')(req(), res, jest.fn());
    expect(res.body.data.courses[0].nextAction).toEqual(NEXT_ACTION);
    expect(res.body.data.classSignal).toBeUndefined();
  });

  it('still returns the courses when the class signal fails', async () => {
    courseReadiness.mockResolvedValue([{ courseId: 'course-1', nextAction: NEXT_ACTION }]);
    courseAggregate.mockRejectedValue(new Error('cohort rpc down'));
    const res = fakeRes();
    const next = jest.fn();
    await handlerFor('/readiness')(req({ courseId: 'course-1' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.body.data.courses[0].nextAction).toEqual(NEXT_ACTION);
    expect(res.body.data.classSignal).toEqual({ available: false });
  });
});

describe('GET /mastery/unmatched-tags', () => {
  it('requires a course', async () => {
    const res = fakeRes();
    await handlerFor('/unmatched-tags')(req(), res, jest.fn());
    expect(res.statusCode).toBe(400);
    expect(unmatchedTags).not.toHaveBeenCalled();
  });

  it('returns the drift between the student tags and the shared outline', async () => {
    unmatchedTags.mockResolvedValue({
      courseId: 'course-1',
      outlineTotal: 2,
      tags: [{ tag: 'Electron transport chain', count: 9, sources: ['cards', 'tests'] }],
    });
    const res = fakeRes();
    await handlerFor('/unmatched-tags')(req({ courseId: 'course-1' }), res, jest.fn());
    expect(unmatchedTags).toHaveBeenCalledWith('user-1', 'course-1');
    expect(res.body).toEqual({
      success: true,
      data: {
        courseId: 'course-1',
        outlineTotal: 2,
        tags: [{ tag: 'Electron transport chain', count: 9, sources: ['cards', 'tests'] }],
      },
    });
  });
});
