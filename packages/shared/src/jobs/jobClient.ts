// ===========================================
// Lantern Study - Async job client
// ===========================================
//
// Replaces the old blind `pollAiJob` loop. The difference that matters to a
// student: when the client's own budget runs out we do NOT report an error and
// we do NOT retry the request (that would charge twice) — we return
// `still_running` with the jobId, because the work is still going on the
// server and can be reattached to later with `resumeJob`.

import {
  JOB_WATCH_BUDGET_MS,
  initWatchState,
  jobKindFromName,
  legacyStatusToStage,
  watchReducer,
  type JobError,
  type JobKind,
  type JobRecordView,
  type WatchState,
} from './jobState';

export interface JobFetchInit {
  headers?: Record<string, string>;
  method?: string;
  body?: string;
}

export type JobFetch = (input: string, init?: JobFetchInit) => Promise<{
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
}>;

export interface JobClientConfig {
  getBaseUrl: () => string;
  getAuthHeaders: () => Promise<Record<string, string>>;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: JobFetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Client watching budget (default 90s). */
  budgetMs?: number;
}

export interface JobProgress {
  jobId: string | null;
  kind: JobKind;
  stage: WatchState['stage'];
  percent: number;
  record: JobRecordView | null;
}

export type JobUpdateHandler = (progress: JobProgress) => void;

export type StartJobOutcome<T> =
  | { mode: 'sync'; result: T; jobId: null }
  | { mode: 'async'; jobId: string };

export type WatchOutcome<T> =
  | { status: 'done'; result: T; jobId: string | null; record: JobRecordView | null }
  | { status: 'failed'; error: JobError; jobId: string | null; record: JobRecordView | null }
  /** Not an error: the job is still running server-side. */
  | { status: 'still_running'; jobId: string | null; record: JobRecordView | null }
  | { status: 'cancelled'; jobId: string | null; record: JobRecordView | null };

/** Thrown by helpers whose callers must return a single value. Carries the jobId. */
export class JobStillRunningError extends Error {
  readonly jobId: string | null;
  readonly stillRunning = true;
  constructor(jobId: string | null, message?: string) {
    super(
      message ||
        'Still working on this. It keeps running in the background — we will let you know when it lands.'
    );
    this.name = 'JobStillRunningError';
    this.jobId = jobId;
  }
}

export function isJobStillRunningError(err: unknown): err is JobStillRunningError {
  return Boolean(err && typeof err === 'object' && (err as { stillRunning?: boolean }).stillRunning);
}

/** Normalise whatever the status route returned into a JobRecordView. */
export function normalizeJobRecord(raw: unknown): JobRecordView | null {
  if (!raw || typeof raw !== 'object') return null;
  const job = raw as Record<string, unknown>;
  const id = typeof job.id === 'string' ? job.id : '';
  const name = typeof job.name === 'string' ? job.name : undefined;
  const stage =
    typeof job.stage === 'string' && job.stage
      ? (job.stage as JobRecordView['stage'])
      : legacyStatusToStage(job.status as string | undefined);
  const percent =
    typeof job.percent === 'number' && Number.isFinite(job.percent)
      ? Math.max(0, Math.min(100, job.percent))
      : stage === 'done' || stage === 'failed' || stage === 'timed_out'
        ? 100
        : 0;
  let error: JobError | undefined;
  if (job.error && typeof job.error === 'object') {
    const e = job.error as Record<string, unknown>;
    error = {
      code: typeof e.code === 'string' ? e.code : 'JOB_FAILED',
      message: typeof e.message === 'string' ? e.message : 'That did not finish.',
      retryable: e.retryable !== false,
    };
  } else if (typeof job.error === 'string' && job.error) {
    // Older servers sent a bare message.
    error = { code: 'JOB_FAILED', message: job.error, retryable: true };
  }

  return {
    id,
    kind: (typeof job.kind === 'string' ? job.kind : jobKindFromName(name)) as JobKind,
    name,
    status: (typeof job.status === 'string' ? job.status : 'queued') as JobRecordView['status'],
    stage,
    percent,
    createdAt: typeof job.createdAt === 'string' ? job.createdAt : '',
    startedAt: typeof job.startedAt === 'string' ? job.startedAt : undefined,
    updatedAt: typeof job.updatedAt === 'string' ? job.updatedAt : '',
    finishedAt: typeof job.finishedAt === 'string' ? job.finishedAt : undefined,
    result: job.result,
    resultRef: (job.resultRef as JobRecordView['resultRef']) ?? undefined,
    error,
    credit: (job.credit as JobRecordView['credit']) ?? undefined,
  };
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createJobClient(config: JobClientConfig) {
  const now = config.now ?? (() => Date.now());
  const sleep = config.sleep ?? defaultSleep;
  const budgetMs = config.budgetMs ?? JOB_WATCH_BUDGET_MS;
  const doFetch: JobFetch =
    config.fetchImpl ?? ((input, init) => (fetch as unknown as JobFetch)(input, init));

  /** jobIds whose watch the caller cancelled. */
  const cancelled = new Set<string>();

  const emit = (onUpdate: JobUpdateHandler | undefined, state: WatchState) => {
    if (!onUpdate) return;
    onUpdate({
      jobId: state.jobId,
      kind: state.record?.kind ?? 'other',
      stage: state.stage,
      percent: state.percent,
      record: state.record,
    });
  };

  const fetchJob = async (jobId: string): Promise<JobRecordView> => {
    const headers = await config.getAuthHeaders();
    const response = await doFetch(`${config.getBaseUrl()}/api/v1/jobs/${jobId}`, { headers });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: unknown;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(payload?.error || `Job status check failed (${response.status})`);
    }
    const record = normalizeJobRecord(payload?.data ?? payload);
    if (!record) throw new Error('Job status check returned nothing.');
    return record;
  };

  async function watchJob<T>(
    jobId: string,
    onUpdate?: JobUpdateHandler
  ): Promise<WatchOutcome<T>> {
    cancelled.delete(jobId);
    let state = initWatchState(jobId, now(), budgetMs);
    emit(onUpdate, state);

    while (state.phase === 'watching') {
      if (cancelled.has(jobId)) {
        state = watchReducer(state, { type: 'cancel' });
        break;
      }
      await sleep(state.nextDelayMs);
      if (cancelled.has(jobId)) {
        state = watchReducer(state, { type: 'cancel' });
        break;
      }
      try {
        const record = await fetchJob(jobId);
        state = watchReducer(state, { type: 'poll', record, now: now() });
      } catch (err) {
        state = watchReducer(state, {
          type: 'poll_error',
          now: now(),
          message: err instanceof Error ? err.message : String(err),
        });
      }
      emit(onUpdate, state);
    }

    cancelled.delete(jobId);

    switch (state.phase) {
      case 'done':
        return { status: 'done', result: state.result as T, jobId, record: state.record };
      case 'failed':
        return {
          status: 'failed',
          error: state.error ?? {
            code: 'JOB_FAILED',
            message: 'That did not finish.',
            retryable: true,
          },
          jobId,
          record: state.record,
        };
      case 'cancelled':
        return { status: 'cancelled', jobId, record: state.record };
      default:
        return { status: 'still_running', jobId, record: state.record };
    }
  }

  return {
    /**
     * POST a request that may answer 200 (done immediately) or 202 (queued).
     * A 200 is still presented as a job — one that went queued → done.
     */
    startJob: async <T>(
      kind: JobKind,
      request: {
        url: string;
        method?: 'POST' | 'GET';
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
        onUpdate?: JobUpdateHandler;
      }
    ): Promise<StartJobOutcome<T>> => {
      const authHeaders = await config.getAuthHeaders();
      const response = await doFetch(request.url, {
        headers: { ...authHeaders, ...(request.headers || {}) },
        ...(request.method === 'GET'
          ? {}
          : { method: 'POST', body: JSON.stringify(request.body ?? {}) }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        error?: string;
      };

      if (response.status === 202 && typeof json.jobId === 'string') {
        request.onUpdate?.({
          jobId: json.jobId,
          kind,
          stage: 'queued',
          percent: 0,
          record: null,
        });
        return { mode: 'async', jobId: json.jobId };
      }
      if (!response.ok) {
        throw new Error(json.error || `Request failed (${response.status})`);
      }
      // Synchronous 200: queued → done, instantly.
      request.onUpdate?.({ jobId: null, kind, stage: 'queued', percent: 0, record: null });
      request.onUpdate?.({ jobId: null, kind, stage: 'done', percent: 100, record: null });
      return { mode: 'sync', result: json as unknown as T, jobId: null };
    },

    watchJob,

    /** Reattach to a job after an app restart — identical to watching it. */
    resumeJob: <T>(jobId: string, onUpdate?: JobUpdateHandler) => watchJob<T>(jobId, onUpdate),

    /** Stop watching. The job itself keeps running; nothing is refunded. */
    cancelWatch: (jobId: string) => {
      cancelled.add(jobId);
    },

    fetchJob,

    /** Present a synchronous result as a completed job (for 200 responses). */
    presentSyncResult: <T>(result: T, onUpdate?: JobUpdateHandler, kind: JobKind = 'other'): WatchOutcome<T> => {
      let state = initWatchState(null, now(), budgetMs);
      emit(onUpdate, state);
      state = watchReducer(state, { type: 'sync_result', result, now: now() });
      emit(onUpdate, state);
      return { status: 'done', result, jobId: null, record: null };
    },
  };
}

export type LanternJobClient = ReturnType<typeof createJobClient>;
