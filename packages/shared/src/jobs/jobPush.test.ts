import { DEEP_LINK_SCHEME, parseDeepLink } from '../linking';
import {
  JOB_PUSH_DEEP_LINK_SCHEME,
  buildJobPushMessage,
  isPushableJobKind,
  jobArtefactDeepLink,
  jobArtefactLabel,
  jobFallbackDeepLink,
  jobPushIdempotencyKey,
  jobResultCount,
} from './jobPush';

describe('jobPush scheme', () => {
  it('stays in step with the shared deep-link scheme', () => {
    // The constant is duplicated because the server build does not compile
    // src/linking; this is the guard that keeps the duplicate honest.
    expect(JOB_PUSH_DEEP_LINK_SCHEME).toBe(DEEP_LINK_SCHEME);
  });
});

describe('jobResultCount', () => {
  it('counts flashcards and questions', () => {
    expect(jobResultCount({ flashcards: [1, 2, 3] })).toBe(3);
    expect(jobResultCount({ questions: [1, 2] })).toBe(2);
  });

  it('looks one level in for a saved session', () => {
    expect(jobResultCount({ session: { questions: [1, 2, 3, 4] } })).toBe(4);
    expect(jobResultCount({ data: { cards: [1] } })).toBe(1);
  });

  it('returns undefined rather than guessing', () => {
    expect(jobResultCount(undefined)).toBeUndefined();
    expect(jobResultCount('nope')).toBeUndefined();
    expect(jobResultCount({ summary: 'text' })).toBeUndefined();
  });
});

describe('jobArtefactLabel', () => {
  it('pluralises honestly', () => {
    expect(jobArtefactLabel('flashcards', 1)).toBe('1 flashcard');
    expect(jobArtefactLabel('flashcards', 10)).toBe('10 flashcards');
    expect(jobArtefactLabel('flashcards')).toBe('Your flashcards');
    expect(jobArtefactLabel('questions', 12)).toBe('12-question test');
    expect(jobArtefactLabel('quiz', 5)).toBe('5-question quiz');
    expect(jobArtefactLabel('smart_notes')).toBe('Your summary');
  });

  it('never invents a count from a zero result', () => {
    expect(jobArtefactLabel('flashcards', 0)).toBe('Your flashcards');
  });
});

describe('jobArtefactDeepLink', () => {
  it('builds links that parse back through the shared parser', () => {
    const link = jobArtefactDeepLink({ type: 'deck', id: 'deck-1' });
    expect(link).toBe('lanternstudy://deck/deck-1');
    expect(parseDeepLink(link as string)).toMatchObject({ type: 'deck', id: 'deck-1' });
  });

  it('handles note and test targets', () => {
    expect(jobArtefactDeepLink({ type: 'note', id: 'n1' })).toBe('lanternstudy://note/n1');
    expect(jobArtefactDeepLink({ type: 'test', id: 't1' })).toBe('lanternstudy://test/t1');
  });

  it('refuses targets the app has no screen for', () => {
    expect(jobArtefactDeepLink(undefined)).toBeNull();
    expect(jobArtefactDeepLink({ type: 'deck', id: '' })).toBeNull();
    // A quiz lives on its note; linking there opened the wrong screen on device.
    expect(jobArtefactDeepLink({ type: 'quiz', id: 'note-1' })).toBeNull();
    expect(jobArtefactDeepLink({ type: 'studyPack', id: 'sp1' })).toBeNull();
    expect(jobArtefactDeepLink({ type: 'export', id: 'e1' })).toBeNull();
  });
});

describe('jobPushIdempotencyKey', () => {
  it('is per job and per terminal stage', () => {
    expect(jobPushIdempotencyKey('j1', 'done')).toBe('job:j1:push:done');
    expect(jobPushIdempotencyKey('j1', 'failed')).not.toBe(jobPushIdempotencyKey('j1', 'done'));
  });
});

describe('buildJobPushMessage', () => {
  it('names the artefact and the source it came from', () => {
    const message = buildJobPushMessage({
      jobId: 'j1',
      kind: 'flashcards',
      stage: 'done',
      result: { flashcards: new Array(10).fill({}) },
      resultRef: { type: 'deck', id: 'deck-9' },
      sourceTitle: 'SDOH',
    });
    expect(message).not.toBeNull();
    expect(message?.title).toBe('10 flashcards ready · SDOH');
    expect(message?.data.url).toBe('lanternstudy://deck/deck-9');
    expect(message?.data.pending).toBeUndefined();
  });

  it('omits the separator when the job carried no source title', () => {
    const message = buildJobPushMessage({
      jobId: 'j1',
      kind: 'flashcards',
      stage: 'done',
      result: { flashcards: [{}] },
      resultRef: { type: 'deck', id: 'd1' },
    });
    expect(message?.title).toBe('1 flashcard ready');
  });

  it('sends a client-saved result to the job link, flagged pending', () => {
    // ai.generate.questions returns questions the APP saves as a test: the
    // server has no artefact id, so it must not pretend to have one.
    const message = buildJobPushMessage({
      jobId: 'j2',
      kind: 'questions',
      stage: 'done',
      result: { questions: new Array(12).fill({}) },
    });
    expect(message?.title).toBe('12-question test generated');
    expect(message?.data.url).toBe('lanternstudy://jobs/j2');
    expect(message?.data.pending).toBe(true);
  });

  it('routes a saved note-quiz through the job link too', () => {
    const message = buildJobPushMessage({
      jobId: 'j3',
      kind: 'quiz',
      stage: 'done',
      result: { questions: new Array(5).fill({}) },
      resultRef: { type: 'quiz', id: 'note-1', route: '/notes/note-1/quiz' },
    });
    expect(message?.data.url).toBe('lanternstudy://jobs/j3');
    expect(message?.data.pending).toBe(true);
  });

  it('reports a failure with the error verbatim and no credit claim', () => {
    const message = buildJobPushMessage({
      jobId: 'j4',
      kind: 'flashcards',
      stage: 'failed',
      error: { code: 'JOB_FAILED', message: 'The note was empty.', retryable: false },
      sourceTitle: 'SDOH',
    });
    expect(message?.title).toBe("That didn't finish · SDOH");
    expect(message?.body).toBe('The note was empty.');
    expect(message?.data.url).toBe('lanternstudy://jobs/j4');
    expect(message?.data.pending).toBeUndefined();
  });

  it('reports a timeout as stopped, not failed', () => {
    const message = buildJobPushMessage({ jobId: 'j5', kind: 'quiz', stage: 'timed_out' });
    expect(message?.title).toBe('That took too long');
    expect(message?.body).toContain('credit was returned');
    expect(message?.data.stage).toBe('timed_out');
  });

  it('never pushes for a non-terminal stage', () => {
    for (const stage of ['queued', 'reading', 'generating', 'saving'] as const) {
      expect(buildJobPushMessage({ jobId: 'j6', kind: 'flashcards', stage })).toBeNull();
    }
  });

  it('never pushes for in-screen answers or cron work', () => {
    for (const kind of ['tutor', 'explain', 'companion', 'recommendations', 'enhance', 'maintenance', 'other'] as const) {
      expect(isPushableJobKind(kind)).toBe(false);
      expect(buildJobPushMessage({ jobId: 'j7', kind, stage: 'done' })).toBeNull();
    }
  });

  it('has a fallback link for every job', () => {
    expect(jobFallbackDeepLink('a b')).toBe('lanternstudy://jobs/a%20b');
  });
});

/**
 * The note-quiz journey, end to end on the pure half.
 *
 * On device a quiz generated from a note finished, was saved as a personal
 * test, and its notification still pointed at `jobs/<id>` — the app had to
 * resolve it from its own store, and if that store had been cleared the
 * student landed nowhere. The server now stamps the saved test onto the job
 * record (POST /tests/personal → attachJobResultRef), so the SAME job record
 * produces a link straight to the test.
 */
describe('quiz job → personal test', () => {
  const record = {
    jobId: 'job-quiz-1',
    kind: 'quiz' as const,
    stage: 'done' as const,
    sourceTitle: 'SDOH',
    result: { questions: new Array(5).fill({ text: 'q' }) },
  };

  it('is a kind students are told about', () => {
    expect(isPushableJobKind('quiz')).toBe(true);
  });

  it('links straight to the test once the record names one', () => {
    const message = buildJobPushMessage({
      ...record,
      resultRef: { type: 'test', id: 'test-77', route: '/tests/test-77' },
    });
    expect(message?.data.url).toBe('lanternstudy://test/test-77');
    expect(message?.data.kind).toBe('quiz');
    expect(message?.data.pending).toBeUndefined();
    // The count comes off the result, and the note names it.
    expect(message?.title).toBe('5-question quiz ready · SDOH');
  });

  it('routes that link to the test screen', () => {
    const url = jobArtefactDeepLink({ type: 'test', id: 'test-77' });
    expect(url).toBe('lanternstudy://test/test-77');
    // The app's own parser has to recognise it as a test, not a stray host.
    expect(parseDeepLink(url!)).toMatchObject({ type: 'test', id: 'test-77' });
  });

  it('promises only generation while no test id exists yet', () => {
    // The window between "job done" and "the app saved it": the server has
    // made questions but nothing is launchable, so the copy must not say
    // "ready" and the link must not point at a test that does not exist.
    const message = buildJobPushMessage(record);
    expect(message?.data.url).toBe('lanternstudy://jobs/job-quiz-1');
    expect(message?.data.pending).toBe(true);
    expect(message?.title).toBe('5-question quiz generated · SDOH');
  });

  it('does not point at the note the quiz came from', () => {
    // A quiz notification that opened the note editor read as the wrong
    // screen on device; a `quiz` ref carries the NOTE id, so it stays unlinked.
    expect(jobArtefactDeepLink({ type: 'quiz', id: 'note-1' })).toBeNull();
  });
});
