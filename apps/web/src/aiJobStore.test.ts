/**
 * AI job delivery state.
 *
 * These cover the honesty rules the product depends on, not just the shape of
 * the reducers: a reload must never call queued work "failed", the bar must
 * never rewind or claim 100% before the result lands, and "Keep waiting" must
 * extend the wait without implying a second charge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoryStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => (key in store ? store[key] : null),
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
vi.stubGlobal('localStorage', memoryStorage);
// zustand's persist middleware resolves storage off `window`, so the node
// suite needs both or persistence silently no-ops and the reload test below
// would prove nothing.
vi.stubGlobal('window', { localStorage: memoryStorage });

import {
  AI_JOB_BUDGET_MS,
  SUCCESS_VISIBLE_MS,
  computeJobElapsedMs,
  computeJobPercent,
  countInFlight,
  formatElapsed,
  getActiveJobs,
  getCurrentStageLabel,
  getVisibleJobs,
  isJobOverBudget,
  hasUnsavedGeneration,
  planResume,
  planRetry,
  planServerSettle,
  pruneJobs,
  targetForResultRef,
  toAiJobResultRef,
  UNSAVED_GENERATION_ERROR,
  useAiJobStore,
  type AiJob,
} from '../../../stores/aiJobStore';

const USER = 'user-1';
const OTHER = 'user-2';

function makeJob(overrides: Partial<AiJob> = {}): AiJob {
  const now = 1_000_000;
  return {
    id: 'job-1',
    userId: USER,
    kind: 'flashcards',
    title: 'Cell biology',
    stages: ['Reading', 'Writing', 'Saving'],
    stageIndex: 0,
    stageStartedAt: now,
    status: 'running',
    startedAt: now,
    updatedAt: now,
    budgetUntil: now + AI_JOB_BUDGET_MS,
    creditCost: 1,
    dismissed: false,
    notified: false,
    ...overrides,
  };
}

beforeEach(() => {
  useAiJobStore.setState({ jobs: [], tick: 0 });
});

describe('computeJobPercent', () => {
  it('never reports 0 or 100 while the work is still running', () => {
    const job = makeJob();
    expect(computeJobPercent(job, job.startedAt)).toBeGreaterThanOrEqual(1);
    expect(computeJobPercent(job, job.startedAt + 10 * 60_000)).toBeLessThanOrEqual(99);
  });

  it('reaches exactly 100 only once the job has succeeded', () => {
    const job = makeJob({ status: 'succeeded', stageIndex: 2 });
    expect(computeJobPercent(job, job.startedAt + 5_000)).toBe(100);
  });

  it('does NOT advance on the clock alone — an idle job holds still', () => {
    // The bar used to creep on a timer, so a request that had not moved for a
    // minute (or a tab with no network at all) still looked like work happening.
    const job = makeJob();
    const a = computeJobPercent(job, job.startedAt + 1_000);
    const b = computeJobPercent(job, job.startedAt + 60_000);
    expect(b).toBe(a);
  });

  it('reports the percent the SERVER gave it', () => {
    const job = makeJob({ serverPercent: 45, serverStage: 'generating' });
    expect(computeJobPercent(job, job.startedAt)).toBe(45);
  });

  it('never lets a server percent claim the work is finished', () => {
    const job = makeJob({ serverPercent: 100 });
    expect(computeJobPercent(job, job.startedAt)).toBe(99);
  });

  it('never rewinds below a stage the client already observed', () => {
    // The client reports "Writing" (stage 1 of 3) before the request goes out;
    // the server's first poll answers `queued` at 0%. The bar must hold at the
    // stage floor rather than drop to 1% and climb back.
    const job = makeJob({ stageIndex: 1, serverPercent: 0 });
    expect(computeJobPercent(job, job.startedAt)).toBe(33);
    const later = makeJob({ stageIndex: 1, serverPercent: 45 });
    expect(computeJobPercent(later, later.startedAt)).toBe(45);
  });

  it('jumps forward when the job moves to a later stage', () => {
    const now = 2_000_000;
    const early = makeJob({ stageIndex: 0, stageStartedAt: now });
    const later = makeJob({ stageIndex: 2, stageStartedAt: now });
    expect(computeJobPercent(later, now + 500)).toBeGreaterThan(
      computeJobPercent(early, now + 500)
    );
  });

  it('treats a single-stage job as one full span', () => {
    const job = makeJob({ stages: ['Working'], stageIndex: 0 });
    expect(computeJobPercent(job, job.startedAt + 60_000)).toBeLessThanOrEqual(99);
  });
});

describe('reportServerProgress', () => {
  it('never rewinds the bar when a late poll comes back low', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A', 'B'],
      creditCost: 1,
    });
    useAiJobStore.getState().reportServerProgress(id, { stage: 'generating', percent: 60 });
    useAiJobStore.getState().reportServerProgress(id, { stage: 'generating', percent: 15 });
    expect(useAiJobStore.getState().jobs[0]!.serverPercent).toBe(60);
  });

  it('ignores progress for work that already finished', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A', 'B'],
      creditCost: 1,
    });
    useAiJobStore.getState().failJob(id, 'nope');
    useAiJobStore.getState().reportServerProgress(id, { stage: 'generating', percent: 60 });
    expect(useAiJobStore.getState().jobs[0]!.serverPercent).toBeUndefined();
  });
});

describe('advanceStage', () => {
  it('never rewinds the progress bar', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Kinetics',
      stages: ['A', 'B', 'C'],
      creditCost: 1,
    });
    useAiJobStore.getState().advanceStage(id, 2);
    useAiJobStore.getState().advanceStage(id, 1);
    expect(useAiJobStore.getState().jobs[0]!.stageIndex).toBe(2);
  });

  it('clamps past the last stage rather than running off the end', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Kinetics',
      stages: ['A', 'B'],
      creditCost: 1,
    });
    useAiJobStore.getState().advanceStage(id, 99);
    expect(useAiJobStore.getState().jobs[0]!.stageIndex).toBe(1);
  });

  it('ignores stage reports for work that already finished', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Kinetics',
      stages: ['A', 'B', 'C'],
      creditCost: 1,
    });
    useAiJobStore.getState().failJob(id, 'nope');
    useAiJobStore.getState().advanceStage(id, 2);
    expect(useAiJobStore.getState().jobs[0]!.stageIndex).toBe(0);
  });
});

describe('budget and keep waiting', () => {
  it('is not over budget before 90s', () => {
    const job = makeJob();
    expect(isJobOverBudget(job, job.startedAt + AI_JOB_BUDGET_MS - 1)).toBe(false);
  });

  it('is over budget at 90s', () => {
    const job = makeJob();
    expect(isJobOverBudget(job, job.startedAt + AI_JOB_BUDGET_MS)).toBe(true);
  });

  it('never asks a finished job to keep waiting', () => {
    const job = makeJob({ status: 'succeeded' });
    expect(isJobOverBudget(job, job.startedAt + 10 * AI_JOB_BUDGET_MS)).toBe(false);
  });

  it('keepWaiting extends the deadline without touching the credit cost', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A'],
      creditCost: 3,
    });
    const before = useAiJobStore.getState().jobs[0]!;
    useAiJobStore.getState().keepWaiting(id);
    const after = useAiJobStore.getState().jobs[0]!;
    expect(after.budgetUntil).toBeGreaterThanOrEqual(before.budgetUntil);
    expect(after.creditCost).toBe(3);
    expect(after.status).toBe('running');
  });
});

describe('planResume (what a reload does with what was persisted)', () => {
  it('keeps a job with a server id running, and asks for it to be watched', () => {
    // The whole point of persisting the server's job id: the run can still be
    // asked how it ended, so calling it lost would be a lie.
    const plan = planResume([makeJob({ serverJobId: 'srv-1' })], 2_000_000);
    expect(plan.jobs[0]!.status).toBe('running');
    expect(plan.resume).toEqual(['job-1']);
    expect(plan.orphaned).toEqual([]);
  });

  it('orphans a job there is genuinely nothing left to ask about', () => {
    const plan = planResume([makeJob()], 2_000_000);
    expect(plan.jobs[0]!.status).toBe('orphaned');
    expect(plan.jobs[0]!.error).toBeUndefined();
    expect(plan.orphaned).toEqual(['job-1']);
  });

  it('says the work is still running rather than lost', () => {
    const job = planResume([makeJob()], 2_000_000).jobs[0]!;
    expect(getCurrentStageLabel(job)).toMatch(/still running/i);
  });

  it('reports generated-but-unsaved work as finishable, not as a loss', () => {
    // The cards exist in this browser and are already paid for. The student is
    // one button away from having them, so it must not read as a lost run.
    const plan = planResume(
      [
        makeJob({
          serverJobId: 'srv-1',
          pendingSave: { kind: 'deck', deckName: 'From: SDOH', cards: [{ front: 'a', back: 'b' }] },
        }),
      ],
      2_000_000
    );
    expect(plan.jobs[0]!.status).toBe('failed');
    expect(plan.jobs[0]!.error).toBe(UNSAVED_GENERATION_ERROR);
    expect(plan.unsaved).toEqual(['job-1']);
    // …and it is NOT polled: asking the server cannot put the cards in the library.
    expect(plan.resume).toEqual([]);
  });

  it('leaves already-finished jobs untouched', () => {
    const done = makeJob({ status: 'succeeded', finishedAt: 1_500_000 });
    expect(planResume([done], 2_000_000).jobs[0]).toBe(done);
  });
});

describe('planRetry (what Try again should cost)', () => {
  it('retries the SAVE when the material is still on the record', () => {
    const job = makeJob({
      status: 'failed',
      pendingSave: { kind: 'deck', deckName: 'From: SDOH', cards: [{ front: 'a', back: 'b' }] },
    });
    expect(hasUnsavedGeneration(job)).toBe(true);
    expect(planRetry(job)).toBe('save');
  });

  it('retries the generation when nothing was produced', () => {
    expect(planRetry(makeJob({ status: 'failed' }))).toBe('generate');
  });

  it('refuses to retry a job whose output is already in the library', () => {
    const job = makeJob({
      status: 'failed',
      resultRef: { type: 'deck', id: 'deck-9', route: '/flashcards/deck/deck-9' },
      pendingSave: { kind: 'deck', deckName: 'x', cards: [{ front: 'a', back: 'b' }] },
    });
    expect(planRetry(job)).toBe('none');
    expect(hasUnsavedGeneration(job)).toBe(false);
  });
});

describe('resultRef (where Open actually lands)', () => {
  it('opens the new deck, not the deck list', () => {
    const target = targetForResultRef({
      type: 'deck',
      id: 'deck-9',
      route: '/flashcards/deck/deck-9',
    });
    expect(target).toEqual({ path: '/flashcards/deck/deck-9', label: 'Open deck' });
  });

  it('routes a saved test to the Tests list, where it can be started', () => {
    expect(targetForResultRef({ type: 'test', id: 't-1', route: '/tests' })?.path).toBe('/tests');
  });

  it('offers no button at all for a reference it cannot open', () => {
    expect(targetForResultRef(undefined)).toBeUndefined();
    expect(targetForResultRef({ type: 'deck', id: '', route: '/flashcards' })).toBeUndefined();
  });

  it('derives the route when the server sent none', () => {
    expect(toAiJobResultRef({ type: 'deck', id: 'd1' })?.route).toBe('/flashcards/deck/d1');
  });

  it('never follows a server route off this origin', () => {
    const ref = toAiJobResultRef({ type: 'deck', id: 'd1', route: '//evil.example/x' });
    expect(ref?.route).toBe('/flashcards/deck/d1');
  });

  it('ignores an artefact type this client has no screen for', () => {
    expect(toAiJobResultRef({ type: 'studyPack', id: 'p1' })).toBeUndefined();
  });
});

describe('planServerSettle (settling from the server after a reload)', () => {
  it('claims the artefact the server points at', () => {
    const patch = planServerSettle(makeJob({ serverJobId: 's1' }), {
      stage: 'done',
      resultRef: { type: 'deck', id: 'deck-9' },
    });
    expect(patch).toMatchObject({ status: 'succeeded' });
    expect(patch!.target).toEqual({ path: '/flashcards/deck/deck-9', label: 'Open deck' });
  });

  it('never reports "done" as success when nothing reached the library', () => {
    // The promise that would have written the deck died with the old page. An
    // Open button here would point at a deck that does not exist.
    const patch = planServerSettle(makeJob({ serverJobId: 's1' }), { stage: 'done' });
    expect(patch).toEqual({ status: 'orphaned', error: undefined });
  });

  it('prefers a save this client already made over the server reference', () => {
    const job = makeJob({
      serverJobId: 's1',
      resultRef: { type: 'deck', id: 'mine', route: '/flashcards/deck/mine' },
    });
    const patch = planServerSettle(job, { stage: 'done', resultRef: { type: 'deck', id: 'other' } });
    expect(patch!.resultRef!.id).toBe('mine');
  });

  it('offers the held save rather than calling a finished generation lost', () => {
    const job = makeJob({
      serverJobId: 's1',
      pendingSave: { kind: 'deck', deckName: 'x', cards: [{ front: 'a', back: 'b' }] },
    });
    expect(planServerSettle(job, { stage: 'done' })).toEqual({
      status: 'failed',
      error: UNSAVED_GENERATION_ERROR,
    });
  });

  it('carries the server\'s own failure message through', () => {
    const patch = planServerSettle(makeJob({ serverJobId: 's1' }), {
      stage: 'failed',
      error: 'The model refused this note.',
    });
    expect(patch).toEqual({ status: 'failed', error: 'The model refused this note.' });
  });

  it('settles nothing while the job is still moving', () => {
    expect(planServerSettle(makeJob({ serverJobId: 's1' }), { stage: 'generating' })).toBeNull();
  });
});

describe('claimSave (save-once, per job)', () => {
  it('refuses a second artefact for the same job', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A'],
      creditCost: 1,
    });
    const first = { type: 'deck' as const, id: 'deck-1', route: '/flashcards/deck/deck-1' };
    expect(useAiJobStore.getState().claimSave(id, first, 10)).toBeNull();
    const second = { type: 'deck' as const, id: 'deck-2', route: '/flashcards/deck/deck-2' };
    expect(useAiJobStore.getState().claimSave(id, second, 10)).toEqual(first);
    expect(useAiJobStore.getState().jobs[0]!.resultRef).toEqual(first);
  });

  it('clears the held material once the save has landed', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A'],
      creditCost: 1,
    });
    useAiJobStore.getState().recordPendingSave(id, {
      kind: 'deck',
      deckName: 'From: SDOH',
      cards: [{ front: 'a', back: 'b' }],
    });
    useAiJobStore
      .getState()
      .claimSave(id, { type: 'deck', id: 'deck-1', route: '/flashcards/deck/deck-1' }, 1);
    expect(useAiJobStore.getState().jobs[0]!.pendingSave).toBeUndefined();
  });

  it('opens the deck it saved, not the route guessed when it started', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A'],
      creditCost: 1,
      target: { path: '/flashcards', label: 'Open flashcards' },
    });
    useAiJobStore
      .getState()
      .claimSave(id, { type: 'deck', id: 'deck-1', route: '/flashcards/deck/deck-1' }, 10);
    useAiJobStore.getState().succeedJob(id);
    expect(useAiJobStore.getState().jobs[0]!.target).toEqual({
      path: '/flashcards/deck/deck-1',
      label: 'Open deck',
    });
  });
});

describe('per-user scoping', () => {
  it('never shows one student the jobs of another', () => {
    const jobs = [makeJob({ id: 'a' }), makeJob({ id: 'b', userId: OTHER })];
    expect(getVisibleJobs(jobs, USER).map((j) => j.id)).toEqual(['a']);
    expect(getActiveJobs(jobs, OTHER).map((j) => j.id)).toEqual(['b']);
  });

  it('shows nothing at all when signed out', () => {
    const jobs = [makeJob()];
    expect(getVisibleJobs(jobs, null)).toEqual([]);
    expect(countInFlight(jobs, undefined)).toBe(0);
  });
});

describe('visibility and counting', () => {
  it('hides dismissed jobs but still counts running ones', () => {
    const jobs = [makeJob({ id: 'a', dismissed: true })];
    expect(getVisibleJobs(jobs, USER)).toEqual([]);
    expect(countInFlight(jobs, USER)).toBe(1);
  });

  it('counts only in-flight work', () => {
    const jobs = [
      makeJob({ id: 'a' }),
      makeJob({ id: 'b', status: 'succeeded' }),
      makeJob({ id: 'c', status: 'failed' }),
    ];
    expect(countInFlight(jobs, USER)).toBe(1);
  });
});

describe('finished-job visibility', () => {
  const finishedAt = 5_000_000;

  it('shows a fresh success so the student sees the result land', () => {
    const jobs = [makeJob({ status: 'succeeded', finishedAt })];
    expect(getVisibleJobs(jobs, USER, finishedAt + 1_000)).toHaveLength(1);
  });

  it('retires a success once it has been on screen long enough', () => {
    const jobs = [makeJob({ status: 'succeeded', finishedAt })];
    expect(getVisibleJobs(jobs, USER, finishedAt + SUCCESS_VISIBLE_MS + 1)).toHaveLength(0);
  });

  it('keeps a failure up indefinitely — the student has not seen the error yet', () => {
    const jobs = [makeJob({ status: 'failed', finishedAt, error: 'boom' })];
    expect(getVisibleJobs(jobs, USER, finishedAt + 10 * SUCCESS_VISIBLE_MS)).toHaveLength(1);
  });

  it('keeps an orphan up — credits were spent and the tab lost the result', () => {
    const jobs = [makeJob({ status: 'orphaned', finishedAt })];
    expect(getVisibleJobs(jobs, USER, finishedAt + 10 * SUCCESS_VISIBLE_MS)).toHaveLength(1);
  });
});

describe('pruneJobs', () => {
  it('keeps running jobs however old they look', () => {
    const ancient = makeJob({ startedAt: 0, updatedAt: 0 });
    expect(pruneJobs([ancient], 10 * 24 * 60 * 60 * 1000)).toHaveLength(1);
  });

  it('drops finished jobs past the retention window', () => {
    const old = makeJob({ status: 'succeeded', updatedAt: 0 });
    expect(pruneJobs([old], 10 * 24 * 60 * 60 * 1000)).toHaveLength(0);
  });
});

describe('elapsed reporting', () => {
  it('freezes elapsed time once the job finishes', () => {
    const job = makeJob({ status: 'succeeded', finishedAt: 1_030_000 });
    expect(computeJobElapsedMs(job, 9_999_999)).toBe(30_000);
  });

  it('formats sub-minute and multi-minute waits', () => {
    expect(formatElapsed(12_000)).toBe('12s');
    expect(formatElapsed(64_000)).toBe('1m 04s');
  });
});

describe('lifecycle', () => {
  it('completing a job fills the bar and records a target', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'flashcards',
      title: 'Cell biology',
      stages: ['A', 'B', 'C'],
      creditCost: 1,
    });
    useAiJobStore.getState().succeedJob(id, { path: '/flashcards', label: 'Open flashcards' });
    const job = useAiJobStore.getState().jobs[0]!;
    expect(job.status).toBe('succeeded');
    expect(computeJobPercent(job, Date.now())).toBe(100);
    expect(job.target?.path).toBe('/flashcards');
  });

  it('a failed job carries the reason it failed', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Kinetics',
      stages: ['A'],
      creditCost: 1,
    });
    useAiJobStore.getState().failJob(id, 'Model unavailable');
    expect(useAiJobStore.getState().jobs[0]!.error).toBe('Model unavailable');
    expect(getCurrentStageLabel(useAiJobStore.getState().jobs[0]!)).toBe('Failed');
  });

  it('falls back to a stage label when a caller passes no stages', () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Kinetics',
      stages: [],
      creditCost: 1,
    });
    expect(getCurrentStageLabel(useAiJobStore.getState().jobs.find((j) => j.id === id)!)).toBe(
      'Working…'
    );
  });

  it('dismissFinished leaves in-flight work visible', () => {
    const running = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Running',
      stages: ['A'],
      creditCost: 1,
    });
    const done = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'quiz',
      title: 'Done',
      stages: ['A'],
      creditCost: 1,
    });
    useAiJobStore.getState().succeedJob(done);
    useAiJobStore.getState().dismissFinished(USER);
    const visible = getVisibleJobs(useAiJobStore.getState().jobs, USER);
    expect(visible.map((j) => j.id)).toEqual([running]);
  });
});

describe('reload (real persistence round-trip)', () => {
  it('rehydrates a job that was in flight as orphaned, not failed', async () => {
    const id = useAiJobStore.getState().startJob({
      userId: USER,
      kind: 'import_study',
      title: 'Lecture 4',
      stages: ['A', 'B'],
      creditCost: 3,
    });

    // What the browser would have on disk at the moment of the reload.
    const onDisk = memoryStorage.getItem('lantern-ai-jobs');
    expect(onDisk).toContain('Lecture 4');

    // Simulate the reload. Clearing in-memory state persists an empty list, so
    // the disk snapshot has to be put back to stand in for a fresh page load.
    useAiJobStore.setState({ jobs: [], tick: 0 });
    memoryStorage.setItem('lantern-ai-jobs', onDisk!);
    await useAiJobStore.persist.rehydrate();

    const job = useAiJobStore.getState().jobs.find((j) => j.id === id);
    expect(job).toBeDefined();
    expect(job!.status).toBe('orphaned');
    expect(job!.creditCost).toBe(3);
    // The student is told the truth, not that their work failed.
    expect(getCurrentStageLabel(job!)).toMatch(/still running/i);
  });
});
