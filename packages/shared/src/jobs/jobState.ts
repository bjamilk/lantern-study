// ===========================================
// Lantern Study - Async job state machine (pure)
// ===========================================
//
// One vocabulary for background work, shared by the API server (which writes
// the job record) and every client (which reads it). Nothing in here does I/O:
// the server calls `advanceJobStage` from its processors, the client feeds
// polled records into `watchReducer`. Both sides therefore agree on what
// "62% · generating" means, and on the two rules that protect a student's
// credits: a job never leaves a terminal stage, and a refund is observed once.

/** What kind of work this job is doing — drives the client's copy. */
export type JobKind =
  | 'flashcards'
  | 'questions'
  | 'quiz'
  | 'smart_notes'
  | 'explain'
  | 'tutor'
  | 'companion'
  | 'recommendations'
  | 'enhance'
  | 'study_pack'
  | 'narration'
  | 'import'
  | 'ocr'
  | 'transcript'
  | 'presentation'
  | 'export'
  | 'maintenance'
  | 'other';

/**
 * Where the work has got to. `queued` → `reading` → `generating` → `saving`
 * → `done`, with `failed` / `timed_out` as the other terminal ends.
 */
export type JobStage =
  | 'queued'
  | 'reading'
  | 'generating'
  | 'saving'
  | 'done'
  | 'failed'
  | 'timed_out';

/** The legacy BullMQ-flavoured status kept on the wire for older clients. */
export type JobLegacyStatus = 'queued' | 'active' | 'completed' | 'failed';

export const JOB_STAGES: JobStage[] = [
  'queued',
  'reading',
  'generating',
  'saving',
  'done',
  'failed',
  'timed_out',
];

const TERMINAL_STAGES = new Set<JobStage>(['done', 'failed', 'timed_out']);

export function isTerminalJobStage(stage: JobStage): boolean {
  return TERMINAL_STAGES.has(stage);
}

/**
 * The floor each stage guarantees. Percent is monotonic, so a processor that
 * reports a finer-grained number (e.g. 3 of 5 chunks read) can only ever push
 * the bar forwards.
 */
export const JOB_STAGE_PERCENT: Record<JobStage, number> = {
  queued: 0,
  reading: 15,
  generating: 45,
  saving: 85,
  done: 100,
  failed: 100,
  timed_out: 100,
};

export function stageToLegacyStatus(stage: JobStage): JobLegacyStatus {
  switch (stage) {
    case 'queued':
      return 'queued';
    case 'done':
      return 'completed';
    case 'failed':
    case 'timed_out':
      return 'failed';
    default:
      return 'active';
  }
}

export function legacyStatusToStage(status: JobLegacyStatus | string | undefined): JobStage {
  switch (status) {
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'active':
      return 'generating';
    default:
      return 'queued';
  }
}

export interface JobError {
  code: string;
  message: string;
  /** True when trying again could plausibly work (transient/infra failures). */
  retryable: boolean;
}

/** Where the finished work landed, so the client can navigate straight to it. */
export interface JobResultRef {
  type: 'deck' | 'test' | 'note' | 'quiz' | 'studyPack' | 'export' | 'conversation' | 'other';
  id: string;
  /** App route (shared between web and mobile linking), when there is one. */
  route?: string;
}

/**
 * Why a terminal job's push never reached a device, when it did not.
 *
 * `claimed` is not a failure: another writer of the same terminal transition
 * already sent it. The rest each name a real, fixable condition, which is the
 * point — on device a quiz finished and no notification ever arrived, and the
 * job record could not say whether the server had skipped, tried, or been
 * rejected by Expo.
 */
export type JobPushSkipReason =
  | 'disabled'
  | 'no_owner'
  | 'no_token'
  | 'prefs_off'
  | 'not_pushable'
  | 'claimed'
  | 'error';

/** One Expo receipt line, as Expo returns it. */
export interface JobPushTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
}

/**
 * What the server actually did about notifying this job's owner. Written onto
 * the job record when it becomes terminal and served by GET /jobs/:id to the
 * OWNER only, so "we told you" is checkable rather than assumed.
 */
export interface JobPushAudit {
  attemptedAt: string;
  skippedReason?: JobPushSkipReason;
  /** How many devices the envelope went to (0 when nothing was sent). */
  tokenCount?: number;
  expoTickets?: JobPushTicket[];
  /** The deep link the notification carries, so the client can verify routing. */
  url?: string;
  error?: string;
}

/** The honest credit ledger for this job. */
export interface JobCredit {
  charged: number;
  refunded: number;
  featureKey?: string;
}

export interface JobRecordView {
  id: string;
  kind: JobKind;
  /** Internal queue job name (e.g. `ai.generate.flashcards`). */
  name?: string;
  /** Legacy field older clients still read. Derived from `stage`. */
  status: JobLegacyStatus;
  stage: JobStage;
  percent: number;
  createdAt: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
  result?: unknown;
  resultRef?: JobResultRef;
  error?: JobError;
  credit?: JobCredit;
  /** Owner-only: what happened to this job's completion push. */
  push?: JobPushAudit;
}

/** A job stuck in a non-terminal stage for this long is reported timed out. */
export const JOB_STALE_TIMEOUT_MS = 10 * 60 * 1000;

/** Client-side watching budget: after this we yield, the job keeps running. */
export const JOB_WATCH_BUDGET_MS = 90 * 1000;

export const JOB_POLL_DELAYS_MS: readonly number[] = [1000, 2000, 4000, 5000];
const FIRST_POLL_DELAY_MS = 1000;
const MAX_POLL_DELAY_MS = 5000;

/** 1s → 2s → 4s → 5s (cap). `attempt` is 0-based. */
export function nextWatchDelayMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt < 0) return FIRST_POLL_DELAY_MS;
  const index = Math.min(Math.floor(attempt), JOB_POLL_DELAYS_MS.length - 1);
  return JOB_POLL_DELAYS_MS[index] ?? MAX_POLL_DELAY_MS;
}

export function jobKindFromName(name: string | undefined): JobKind {
  switch (name) {
    case 'ai.generate.flashcards':
    case 'notes.ai.flashcards':
      return 'flashcards';
    case 'ai.enhance.flashcard':
      return 'enhance';
    case 'ai.generate.questions':
      return 'questions';
    case 'notes.ai.quiz':
      return 'quiz';
    case 'notes.ai.summarize':
      return 'smart_notes';
    case 'ai.explain.answer':
      return 'explain';
    case 'ai.generate.lesson':
    case 'ai.generate.recap':
    case 'ai.ask.tutor':
      return 'tutor';
    case 'ai.companion.message':
      return 'companion';
    case 'ai.study.recommendations':
      return 'recommendations';
    case 'ai.studyPack.generate':
      return 'study_pack';
    case 'notes.ai.narration':
      return 'narration';
    case 'deck.importApkg':
      return 'import';
    case 'notes.ocr.extract':
      return 'ocr';
    case 'notes.youtube.transcript':
      return 'transcript';
    case 'notes.presentation.preview':
      return 'presentation';
    case 'export.userData':
      return 'export';
    default:
      if (typeof name === 'string' && name.startsWith('cron.')) return 'maintenance';
      return 'other';
  }
}

export interface AdvanceStageOptions {
  now?: string;
  /** Finer-grained progress; clamped to 0..100 and never allowed to go back. */
  percent?: number;
  result?: unknown;
  resultRef?: JobResultRef;
  error?: JobError;
  credit?: JobCredit;
}

type StageBearing = {
  stage: JobStage;
  percent: number;
  status: JobLegacyStatus;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  resultRef?: JobResultRef;
  error?: JobError;
  credit?: JobCredit;
};

/**
 * Move a record to `next`, monotonically.
 *
 * A record that has already reached a terminal stage is returned untouched:
 * a late `saving` from a retried attempt must not un-fail a refunded job, and
 * a straggling `failed` must not un-finish a job the student already saw
 * complete (which would also re-open the refund path).
 */
export function advanceJobStage<T extends StageBearing>(
  record: T,
  next: JobStage,
  options: AdvanceStageOptions = {}
): T {
  const now = options.now ?? new Date().toISOString();
  if (isTerminalJobStage(record.stage)) return record;

  const floor = JOB_STAGE_PERCENT[next];
  const requested = typeof options.percent === 'number' ? options.percent : floor;
  const clamped = Math.max(0, Math.min(100, Math.round(requested)));
  const percent = isTerminalJobStage(next)
    ? 100
    : Math.max(record.percent ?? 0, Math.max(floor, clamped));

  const updated: T = {
    ...record,
    stage: next,
    status: stageToLegacyStatus(next),
    percent,
    updatedAt: now,
  };

  if (next !== 'queued' && !updated.startedAt) updated.startedAt = now;
  if (isTerminalJobStage(next)) updated.finishedAt = now;
  if (options.result !== undefined) updated.result = options.result;
  if (options.resultRef) updated.resultRef = options.resultRef;
  if (options.error) updated.error = options.error;
  if (options.credit) updated.credit = options.credit;

  return updated;
}

/** Has this job been sitting in a non-terminal stage past the stale window? */
export function isJobStale(
  record: Pick<JobRecordView, 'stage' | 'updatedAt' | 'createdAt'>,
  now: number = Date.now(),
  staleMs: number = JOB_STALE_TIMEOUT_MS
): boolean {
  if (isTerminalJobStage(record.stage)) return false;
  const last = Date.parse(record.updatedAt || record.createdAt);
  if (!Number.isFinite(last)) return false;
  return now - last >= staleMs;
}

export const JOB_TIMED_OUT_ERROR: JobError = {
  code: 'JOB_TIMED_OUT',
  message: 'This took longer than expected and was stopped. Your credit was returned.',
  retryable: true,
};

/** The timed-out view of a stale record (does not itself issue the refund). */
export function timeOutJobRecord(record: JobRecordView, now: number = Date.now()): JobRecordView {
  if (isTerminalJobStage(record.stage)) return record;
  const iso = new Date(now).toISOString();
  return {
    ...record,
    stage: 'timed_out',
    status: 'failed',
    percent: 100,
    updatedAt: iso,
    finishedAt: iso,
    error: record.error ?? JOB_TIMED_OUT_ERROR,
  };
}

/**
 * Claim this job's single refund. Returns `refund: false` when one has already
 * been recorded — the caller must not hand credits back twice.
 */
export function claimCreditRefund(credit: JobCredit | undefined): {
  credit: JobCredit | undefined;
  refund: boolean;
} {
  if (!credit || credit.charged <= 0) return { credit, refund: false };
  if (credit.refunded > 0) return { credit, refund: false };
  return { credit: { ...credit, refunded: credit.charged }, refund: true };
}

// ===========================================
// Client-side watch state machine
// ===========================================

export type WatchPhase =
  | 'watching'
  | 'done'
  | 'failed'
  | 'still_running'
  | 'cancelled';

export interface WatchState {
  jobId: string | null;
  phase: WatchPhase;
  stage: JobStage;
  percent: number;
  /** Poll attempts made so far; drives the backoff. */
  attempt: number;
  nextDelayMs: number;
  startedAt: number;
  deadlineAt: number;
  record: JobRecordView | null;
  result?: unknown;
  error: JobError | null;
  /** Credits this job charged — set once, never accumulated across polls. */
  creditCharged: number;
  creditRefunded: number;
  consecutiveErrors: number;
}

export type WatchEvent =
  | { type: 'poll'; record: JobRecordView; now: number }
  | { type: 'poll_error'; now: number; message?: string; code?: string }
  | { type: 'tick'; now: number }
  | { type: 'sync_result'; result: unknown; now: number; record?: JobRecordView }
  | { type: 'cancel'; now?: number };

/** Give up on the server after this many consecutive transport failures. */
export const WATCH_MAX_CONSECUTIVE_ERRORS = 6;

export function initWatchState(
  jobId: string | null,
  now: number = Date.now(),
  budgetMs: number = JOB_WATCH_BUDGET_MS
): WatchState {
  return {
    jobId,
    phase: 'watching',
    stage: 'queued',
    percent: 0,
    attempt: 0,
    nextDelayMs: nextWatchDelayMs(0),
    startedAt: now,
    deadlineAt: now + budgetMs,
    record: null,
    error: null,
    creditCharged: 0,
    creditRefunded: 0,
    consecutiveErrors: 0,
  };
}

function isSettled(phase: WatchPhase): boolean {
  return phase !== 'watching';
}

/**
 * Fold one observation into the watch state.
 *
 * Invariants the tests pin:
 *  - percent never goes backwards, and a settled watch ignores late events;
 *  - `creditCharged` is taken from the record, never summed, so a job that is
 *    polled twenty times still only ever charged once;
 *  - running out of the client budget yields `still_running`, NOT a failure —
 *    the work continues on the server and the student is told so.
 */
export function watchReducer(state: WatchState, event: WatchEvent): WatchState {
  if (isSettled(state.phase)) return state;

  if (event.type === 'cancel') {
    return { ...state, phase: 'cancelled' };
  }

  if (event.type === 'sync_result') {
    // A synchronous 200 is still a job: it went queued → done instantly.
    return {
      ...state,
      phase: 'done',
      stage: 'done',
      percent: 100,
      record: event.record ?? state.record,
      result: event.result,
      error: null,
      consecutiveErrors: 0,
    };
  }

  if (event.type === 'tick') {
    if (event.now >= state.deadlineAt) {
      return { ...state, phase: 'still_running' };
    }
    return state;
  }

  if (event.type === 'poll_error') {
    const consecutiveErrors = state.consecutiveErrors + 1;
    const attempt = state.attempt + 1;
    const base: WatchState = {
      ...state,
      attempt,
      nextDelayMs: nextWatchDelayMs(attempt),
      consecutiveErrors,
    };
    if (consecutiveErrors >= WATCH_MAX_CONSECUTIVE_ERRORS) {
      return {
        ...base,
        phase: 'still_running',
      };
    }
    if (event.now >= state.deadlineAt) {
      return { ...base, phase: 'still_running' };
    }
    return base;
  }

  // event.type === 'poll'
  const record = event.record;
  const attempt = state.attempt + 1;
  const credit = record.credit;
  const next: WatchState = {
    ...state,
    attempt,
    nextDelayMs: nextWatchDelayMs(attempt),
    consecutiveErrors: 0,
    record,
    stage: record.stage,
    percent: Math.max(state.percent, Math.min(100, Math.max(0, record.percent ?? 0))),
    creditCharged: credit ? Math.max(state.creditCharged, credit.charged) : state.creditCharged,
    creditRefunded: credit ? Math.max(state.creditRefunded, credit.refunded) : state.creditRefunded,
  };

  if (record.stage === 'done') {
    return {
      ...next,
      phase: 'done',
      percent: 100,
      result: record.result,
      error: null,
    };
  }
  if (record.stage === 'failed' || record.stage === 'timed_out') {
    return {
      ...next,
      phase: 'failed',
      percent: 100,
      error:
        record.error ??
        (record.stage === 'timed_out'
          ? JOB_TIMED_OUT_ERROR
          : { code: 'JOB_FAILED', message: 'That did not finish.', retryable: true }),
    };
  }
  if (event.now >= state.deadlineAt) {
    return { ...next, phase: 'still_running' };
  }
  return next;
}

/** Progress copy that never lies about what is happening. */
export function jobStageLabel(stage: JobStage, kind: JobKind = 'other'): string {
  switch (stage) {
    case 'queued':
      return 'Queued';
    case 'reading':
      return kind === 'import' || kind === 'ocr' ? 'Reading your file' : 'Reading your notes';
    case 'generating':
      return 'Generating';
    case 'saving':
      return 'Saving';
    case 'done':
      return 'Done';
    case 'timed_out':
      return 'Stopped';
    case 'failed':
    default:
      return 'Failed';
  }
}
