import { describe, expect, it } from 'vitest';
import type { TestConfig, TestQuestion, TestSessionData } from '../types';
import { buildRetakeSession, planRetake, retakeSessionId, retakeTitle } from './testRetake';

const config = (over: Partial<TestConfig> = {}): TestConfig => ({
  groupId: 'g1',
  numberOfQuestions: 2,
  questionIds: [],
  allowedQuestionTypes: [],
  ...over,
});

const question = (id: string): TestQuestion => ({ id, questionStem: `Q ${id}` }) as TestQuestion;

const session = (over: Partial<TestSessionData> = {}): TestSessionData => ({
  config: config(),
  questions: [],
  userAnswers: {},
  currentQuestionIndex: 0,
  startTime: new Date('2026-09-01T10:00:00Z'),
  ...over,
});

describe('planRetake', () => {
  it('is ready when the row already carries its questions', () => {
    const plan = planRetake({
      id: 'row-1',
      session: session({ questions: [question('a'), question('b')] }),
    });
    expect(plan.kind).toBe('ready');
    if (plan.kind === 'ready') expect(plan.questions).toHaveLength(2);
  });

  it('fetches instead of refusing when a lean history row has no questions', () => {
    // The whole defect: the list returns rows with no questions, and retake
    // read them as "the data is gone" rather than "ask the server for it".
    expect(planRetake({ id: 'sess-9', session: session({ questions: [] }) })).toEqual({
      kind: 'fetch',
      sessionId: 'sess-9',
    });
  });

  it('prefers the session id over the row id when both are present', () => {
    const plan = planRetake({ id: 'row-1', session: session({ id: 'sess-1', questions: [] }) });
    expect(plan).toEqual({ kind: 'fetch', sessionId: 'sess-1' });
  });

  it('only declares a retake unavailable after the fetch has been tried', () => {
    const lean = { id: 'sess-9', session: session({ questions: [] }) };
    expect(planRetake(lean).kind).toBe('fetch');
    expect(planRetake(lean, { alreadyFetched: true }).kind).toBe('unavailable');
  });

  it('never asks the server about a session that only ever existed locally', () => {
    expect(planRetake({ id: 'local-123', session: session({ questions: [] }) }).kind).toBe(
      'unavailable'
    );
    expect(planRetake({ id: 'offline-7', session: session({ questions: [] }) }).kind).toBe(
      'unavailable'
    );
  });

  it('is unavailable with no id and no questions', () => {
    expect(planRetake({ id: '', session: session({ questions: [] }) }).kind).toBe('unavailable');
    expect(planRetake(null).kind).toBe('unavailable');
  });

  it('says what to do next in every unavailable reason', () => {
    const plan = planRetake({ id: '', session: session() });
    if (plan.kind !== 'unavailable') throw new Error('expected unavailable');
    expect(plan.reason).toMatch(/new test/i);
  });
});

describe('retakeSessionId', () => {
  it('falls back to the row id and rejects blanks', () => {
    expect(retakeSessionId({ id: 'row-1', session: session() })).toBe('row-1');
    expect(retakeSessionId({ id: '   ', session: session() })).toBe(null);
  });
});

describe('retakeTitle', () => {
  it('names the source, and never invents an unknown group', () => {
    expect(retakeTitle(session({ config: config({ groupName: 'Bio 201' }) }))).toBe('Bio 201');
    expect(
      retakeTitle(session({ config: config({ sourceNoteTitle: 'Lecture 4' }) }))
    ).toBe('Lecture 4');
    expect(retakeTitle(session({ config: config() }))).toBe('Test');
    expect(retakeTitle(session({ title: '   ', config: config() }))).toBe('Test');
  });
});

describe('buildRetakeSession', () => {
  const ready = planRetake({
    id: 'row-1',
    session: session({
      questions: [question('a'), question('b')],
      config: config({ timerDuration: 600, groupName: 'Bio 201' }),
    }),
  });

  it('starts a fresh attempt with no answers carried over', () => {
    if (ready.kind !== 'ready') throw new Error('expected ready');
    const now = new Date('2026-09-05T09:00:00Z');
    const fresh = buildRetakeSession(ready, { now });
    expect(fresh.userAnswers).toEqual({});
    expect(fresh.currentQuestionIndex).toBe(0);
    expect(fresh.status).toBe('in_progress');
    expect(fresh.sessionKind).toBe('test');
    expect(fresh.title).toBe('Bio 201');
  });

  it('re-arms the timer from the original config', () => {
    if (ready.kind !== 'ready') throw new Error('expected ready');
    const now = new Date('2026-09-05T09:00:00Z');
    expect(buildRetakeSession(ready, { now }).endTime?.toISOString()).toBe(
      '2026-09-05T09:10:00.000Z'
    );
  });

  it('leaves an untimed test untimed', () => {
    const untimed = planRetake({
      id: 'row-2',
      session: session({ questions: [question('a')], config: config() }),
    });
    if (untimed.kind !== 'ready') throw new Error('expected ready');
    expect(buildRetakeSession(untimed).endTime).toBeUndefined();
  });

  it('sits a test built as practice as a study session, never on a clock', () => {
    const practice = planRetake({
      id: 'row-3',
      session: session({
        questions: [question('a')],
        // A stale timer alongside `practice` is exactly the contradiction the
        // launch has to resolve, and practice wins: a screen that pauses on
        // every answer cannot honestly be timed.
        config: config({ attemptKind: 'practice', timerDuration: 600 }),
      }),
    });
    if (practice.kind !== 'ready') throw new Error('expected ready');
    const fresh = buildRetakeSession(practice, { now: new Date('2026-09-05T09:00:00Z') });
    expect(fresh.sessionKind).toBe('study');
    expect(fresh.endTime).toBeUndefined();
  });

  it('keeps an exam an exam, and a config with no attempt kind is an exam', () => {
    const exam = planRetake({
      id: 'row-4',
      session: session({ questions: [question('a')], config: config({ attemptKind: 'exam' }) }),
    });
    if (exam.kind !== 'ready') throw new Error('expected ready');
    expect(buildRetakeSession(exam).sessionKind).toBe('test');
    if (ready.kind !== 'ready') throw new Error('expected ready');
    expect(buildRetakeSession(ready).sessionKind).toBe('test');
  });

  it('re-shuffles through the supplied shuffler', () => {
    if (ready.kind !== 'ready') throw new Error('expected ready');
    const fresh = buildRetakeSession(ready, { shuffle: (qs) => [...qs].reverse() });
    expect(fresh.questions.map((q) => q.id)).toEqual(['b', 'a']);
  });

  it('does not mutate the questions it was handed', () => {
    if (ready.kind !== 'ready') throw new Error('expected ready');
    const before = ready.questions.map((q) => q.id);
    buildRetakeSession(ready, { shuffle: (qs) => qs.reverse() });
    expect(ready.questions.map((q) => q.id)).toEqual(before);
  });
});
