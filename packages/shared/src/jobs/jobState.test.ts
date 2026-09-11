import {
  JOB_STALE_TIMEOUT_MS,
  JOB_TIMED_OUT_ERROR,
  advanceJobStage,
  claimCreditRefund,
  initWatchState,
  isJobStale,
  isTerminalJobStage,
  jobKindFromName,
  legacyStatusToStage,
  nextWatchDelayMs,
  stageToLegacyStatus,
  timeOutJobRecord,
  watchReducer,
  type JobRecordView,
  type WatchState,
} from './jobState';

const T0 = '2026-09-06T10:00:00.000Z';

function record(over: Partial<JobRecordView> = {}): JobRecordView {
  return {
    id: 'job-1',
    kind: 'flashcards',
    name: 'ai.generate.flashcards',
    status: 'queued',
    stage: 'queued',
    percent: 0,
    createdAt: T0,
    updatedAt: T0,
    credit: { charged: 1, refunded: 0 },
    ...over,
  };
}

describe('stage vocabulary', () => {
  it('maps stages to the legacy status older clients read', () => {
    expect(stageToLegacyStatus('queued')).toBe('queued');
    expect(stageToLegacyStatus('reading')).toBe('active');
    expect(stageToLegacyStatus('generating')).toBe('active');
    expect(stageToLegacyStatus('saving')).toBe('active');
    expect(stageToLegacyStatus('done')).toBe('completed');
    expect(stageToLegacyStatus('failed')).toBe('failed');
    expect(stageToLegacyStatus('timed_out')).toBe('failed');
  });

  it('reads a legacy-only record back into a stage', () => {
    expect(legacyStatusToStage('completed')).toBe('done');
    expect(legacyStatusToStage('active')).toBe('generating');
    expect(legacyStatusToStage(undefined)).toBe('queued');
  });

  it('knows the terminal stages', () => {
    expect(isTerminalJobStage('done')).toBe(true);
    expect(isTerminalJobStage('failed')).toBe(true);
    expect(isTerminalJobStage('timed_out')).toBe(true);
    expect(isTerminalJobStage('saving')).toBe(false);
  });

  it('derives a kind from the queue job name', () => {
    expect(jobKindFromName('ai.generate.flashcards')).toBe('flashcards');
    expect(jobKindFromName('ai.enhance.flashcard')).toBe('enhance');
    expect(jobKindFromName('notes.ai.summarize')).toBe('smart_notes');
    expect(jobKindFromName('ai.generate.lesson')).toBe('tutor');
    expect(jobKindFromName('ai.generate.recap')).toBe('tutor');
    expect(jobKindFromName('ai.generate.essay')).toBe('tutor');
    expect(jobKindFromName('notes.ai.quiz')).toBe('quiz');
    expect(jobKindFromName('cron.weeklySummary')).toBe('maintenance');
    expect(jobKindFromName(undefined)).toBe('other');
  });
});

describe('advanceJobStage', () => {
  it('walks reading → generating → saving → done with monotonic percent', () => {
    let job = record();
    job = advanceJobStage(job, 'reading', { now: '2026-09-06T10:00:01.000Z' });
    expect(job.stage).toBe('reading');
    expect(job.startedAt).toBe('2026-09-06T10:00:01.000Z');
    const afterReading = job.percent;

    job = advanceJobStage(job, 'generating', { now: '2026-09-06T10:00:02.000Z' });
    expect(job.percent).toBeGreaterThan(afterReading);

    job = advanceJobStage(job, 'saving', { now: '2026-09-06T10:00:03.000Z' });
    expect(job.status).toBe('active');

    job = advanceJobStage(job, 'done', {
      now: '2026-09-06T10:00:04.000Z',
      result: { flashcards: [] },
      resultRef: { type: 'deck', id: 'deck-9', route: '/flashcards/deck-9' },
    });
    expect(job.stage).toBe('done');
    expect(job.percent).toBe(100);
    expect(job.status).toBe('completed');
    expect(job.finishedAt).toBe('2026-09-06T10:00:04.000Z');
    expect(job.resultRef?.id).toBe('deck-9');
  });

  it('never lets percent go backwards', () => {
    let job = advanceJobStage(record(), 'generating', { percent: 70 });
    expect(job.percent).toBe(70);
    job = advanceJobStage(job, 'generating', { percent: 50 });
    expect(job.percent).toBe(70);
  });

  it('honours a finer-grained percent above the stage floor and clamps it', () => {
    const job = advanceJobStage(record(), 'reading', { percent: 250 });
    expect(job.percent).toBe(100);
    const low = advanceJobStage(record(), 'generating', { percent: 1 });
    expect(low.percent).toBe(45);
  });

  it('refuses to move a job that already finished', () => {
    const done = advanceJobStage(record(), 'done', { result: 'ok' });
    const late = advanceJobStage(done, 'failed', {
      error: { code: 'X', message: 'late', retryable: false },
    });
    expect(late).toBe(done);
    expect(late.stage).toBe('done');
  });

  it('refuses to un-fail a failed job (which would re-open the refund path)', () => {
    const failed = advanceJobStage(record(), 'failed', {
      error: { code: 'AI_DOWN', message: 'provider down', retryable: true },
    });
    const retried = advanceJobStage(failed, 'saving');
    expect(retried.stage).toBe('failed');
    expect(retried.error?.code).toBe('AI_DOWN');
  });
});

describe('timeout', () => {
  it('is stale only after the window, and never once terminal', () => {
    const base = Date.parse(T0);
    const job = record({ stage: 'generating', updatedAt: T0 });
    expect(isJobStale(job, base + JOB_STALE_TIMEOUT_MS - 1)).toBe(false);
    expect(isJobStale(job, base + JOB_STALE_TIMEOUT_MS)).toBe(true);
    expect(isJobStale({ ...job, stage: 'done' }, base + JOB_STALE_TIMEOUT_MS)).toBe(false);
  });

  it('reports a stale job as timed_out with a retryable error', () => {
    const base = Date.parse(T0);
    const out = timeOutJobRecord(record({ stage: 'generating' }), base + JOB_STALE_TIMEOUT_MS);
    expect(out.stage).toBe('timed_out');
    expect(out.status).toBe('failed');
    expect(out.percent).toBe(100);
    expect(out.error).toEqual(JOB_TIMED_OUT_ERROR);
    expect(out.error?.retryable).toBe(true);
  });

  it('leaves a finished job alone', () => {
    const done = record({ stage: 'done', status: 'completed', percent: 100 });
    expect(timeOutJobRecord(done, Date.now() + 1e9)).toBe(done);
  });
});

describe('credit refunds', () => {
  it('refunds exactly once', () => {
    const first = claimCreditRefund({ charged: 2, refunded: 0 });
    expect(first.refund).toBe(true);
    expect(first.credit).toEqual({ charged: 2, refunded: 2 });

    const second = claimCreditRefund(first.credit);
    expect(second.refund).toBe(false);
    expect(second.credit).toEqual({ charged: 2, refunded: 2 });
  });

  it('does not refund a job that was never charged', () => {
    expect(claimCreditRefund(undefined).refund).toBe(false);
    expect(claimCreditRefund({ charged: 0, refunded: 0 }).refund).toBe(false);
  });
});

describe('watch backoff', () => {
  it('backs off 1s → 2s → 4s and caps at 5s', () => {
    expect(nextWatchDelayMs(0)).toBe(1000);
    expect(nextWatchDelayMs(1)).toBe(2000);
    expect(nextWatchDelayMs(2)).toBe(4000);
    expect(nextWatchDelayMs(3)).toBe(5000);
    expect(nextWatchDelayMs(50)).toBe(5000);
  });
});

describe('watchReducer', () => {
  const start = (now = 0): WatchState => initWatchState('job-1', now, 90_000);

  it('tracks progress and finishes on done', () => {
    let s = start();
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'reading', percent: 15 }), now: 1000 });
    expect(s.phase).toBe('watching');
    expect(s.percent).toBe(15);
    s = watchReducer(s, {
      type: 'poll',
      record: record({ stage: 'done', percent: 100, result: { ok: true } }),
      now: 3000,
    });
    expect(s.phase).toBe('done');
    expect(s.result).toEqual({ ok: true });
    expect(s.percent).toBe(100);
  });

  it('keeps percent monotonic even if the server reports less', () => {
    let s = start();
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'generating', percent: 60 }), now: 1000 });
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'generating', percent: 20 }), now: 2000 });
    expect(s.percent).toBe(60);
  });

  it('never doubles the charge no matter how many times it polls', () => {
    let s = start();
    for (let i = 0; i < 20; i += 1) {
      s = watchReducer(s, {
        type: 'poll',
        record: record({ stage: 'generating', credit: { charged: 1, refunded: 0 } }),
        now: 1000 * (i + 1),
      });
    }
    expect(s.creditCharged).toBe(1);
    expect(s.creditRefunded).toBe(0);
  });

  it('observes the refund on a failed job', () => {
    let s = start();
    s = watchReducer(s, {
      type: 'poll',
      record: record({
        stage: 'failed',
        error: { code: 'AI_DOWN', message: 'The tutor is offline.', retryable: true },
        credit: { charged: 1, refunded: 1 },
      }),
      now: 2000,
    });
    expect(s.phase).toBe('failed');
    expect(s.error?.code).toBe('AI_DOWN');
    expect(s.creditCharged).toBe(1);
    expect(s.creditRefunded).toBe(1);
  });

  it('treats a timed_out record as failed with the timeout error', () => {
    let s = start();
    s = watchReducer(s, {
      type: 'poll',
      record: record({ stage: 'timed_out', credit: { charged: 1, refunded: 1 } }),
      now: 2000,
    });
    expect(s.phase).toBe('failed');
    expect(s.error).toEqual(JOB_TIMED_OUT_ERROR);
    expect(s.creditRefunded).toBe(1);
  });

  it('yields still_running (not an error) once the client budget is spent', () => {
    let s = start();
    s = watchReducer(s, { type: 'tick', now: 89_999 });
    expect(s.phase).toBe('watching');
    s = watchReducer(s, { type: 'tick', now: 90_000 });
    expect(s.phase).toBe('still_running');
    expect(s.error).toBeNull();
  });

  it('yields still_running when a poll lands after the budget without finishing', () => {
    let s = start();
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'generating' }), now: 95_000 });
    expect(s.phase).toBe('still_running');
  });

  it('still reports a job that finished on the last poll, budget or not', () => {
    let s = start();
    s = watchReducer(s, {
      type: 'poll',
      record: record({ stage: 'done', result: 'late but done' }),
      now: 120_000,
    });
    expect(s.phase).toBe('done');
    expect(s.result).toBe('late but done');
  });

  it('rides out transient poll errors, then yields still_running', () => {
    let s = start();
    for (let i = 0; i < 5; i += 1) {
      s = watchReducer(s, { type: 'poll_error', now: 1000 * (i + 1) });
      expect(s.phase).toBe('watching');
    }
    s = watchReducer(s, { type: 'poll_error', now: 6000 });
    expect(s.phase).toBe('still_running');
  });

  it('resets the error streak after a good poll', () => {
    let s = start();
    s = watchReducer(s, { type: 'poll_error', now: 1000 });
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'reading' }), now: 2000 });
    expect(s.consecutiveErrors).toBe(0);
  });

  it('presents a synchronous 200 as a job that went queued → done instantly', () => {
    let s = start();
    expect(s.stage).toBe('queued');
    expect(s.percent).toBe(0);
    s = watchReducer(s, { type: 'sync_result', result: { answer: '42' }, now: 5 });
    expect(s.phase).toBe('done');
    expect(s.stage).toBe('done');
    expect(s.percent).toBe(100);
    expect(s.result).toEqual({ answer: '42' });
  });

  it('cancels, and then ignores late events', () => {
    let s = start();
    s = watchReducer(s, { type: 'cancel' });
    expect(s.phase).toBe('cancelled');
    const late = watchReducer(s, { type: 'poll', record: record({ stage: 'done' }), now: 9000 });
    expect(late).toBe(s);
  });

  it('backs the delay off as attempts accumulate', () => {
    let s = start();
    expect(s.nextDelayMs).toBe(1000);
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'reading' }), now: 1000 });
    expect(s.nextDelayMs).toBe(2000);
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'generating' }), now: 3000 });
    expect(s.nextDelayMs).toBe(4000);
    s = watchReducer(s, { type: 'poll', record: record({ stage: 'generating' }), now: 7000 });
    expect(s.nextDelayMs).toBe(5000);
  });
});
