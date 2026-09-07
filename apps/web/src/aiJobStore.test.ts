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
  pruneJobs,
  reconcileOrphanedJobs,
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

  it('advances monotonically as time passes within a stage', () => {
    const job = makeJob();
    const a = computeJobPercent(job, job.startedAt + 1_000);
    const b = computeJobPercent(job, job.startedAt + 5_000);
    const c = computeJobPercent(job, job.startedAt + 20_000);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
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

describe('reconcileOrphanedJobs', () => {
  it('marks work that survived a reload as orphaned, never failed', () => {
    const jobs = [makeJob({ status: 'running' })];
    const job = reconcileOrphanedJobs(jobs, 2_000_000)[0]!;
    expect(job.status).toBe('orphaned');
    expect(job.error).toBeUndefined();
  });

  it('says the work is still running rather than lost', () => {
    const job = reconcileOrphanedJobs([makeJob()], 2_000_000)[0]!;
    expect(getCurrentStageLabel(job)).toMatch(/still running/i);
  });

  it('leaves already-finished jobs untouched', () => {
    const done = makeJob({ status: 'succeeded', finishedAt: 1_500_000 });
    expect(reconcileOrphanedJobs([done], 2_000_000)[0]).toBe(done);
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
