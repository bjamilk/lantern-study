/**
 * In-flight AI generation jobs — the pure half.
 *
 * Wave G's product rule is that a student is never told their work was lost
 * while it is queued, and is never charged twice for one generation. Both of
 * those live in reducers rather than in the store, so they can be tested
 * without React Native, AsyncStorage or supabase (mobile jest runs in node and
 * never imports a store).
 *
 * Nothing here imports anything. The store (jobsStore.ts) does the I/O.
 */

/** What a job is producing. Drives the stage copy and the artefact route. */
export type JobKind =
  | 'flashcards'
  | 'quiz'
  | 'test'
  | 'summary'
  | 'import'
  /**
   * "Read it to me": the server writes a narration SCRIPT for a document. The
   * artefact is the note it hangs off — a reading has no id and no list of its
   * own — and replaying one costs nothing, so the notification's tap lands on
   * the note where the reading door is.
   */
  | 'narration';

/**
 * Lifecycle.
 *
 * - `queued`  — accepted by the server, no worker has picked it up.
 * - `running` — work in progress.
 * - `done`    — finished; `artifact` names where the result landed.
 * - `failed`  — finished badly; `error` is shown verbatim to the student.
 * - `lost`    — the app was killed while a job with no server id was running,
 *               so the client genuinely does not know how it ended. This is a
 *               separate state from `failed` on purpose: claiming failure
 *               would be a lie, and it is the one case where the honest copy
 *               is "check your library, or run it again".
 */
export type TrackedJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'lost';

/** Where a finished job's output can be opened. */
export interface JobArtifactRef {
  type: 'deck' | 'note' | 'test' | 'quiz';
  /** Empty for a quiz, which lives on the dashboard rather than at an id. */
  id: string;
  /** Deck/note/test name, for the notification title and the Home card. */
  name?: string;
}

/** One generated card, in the only two fields every generator produces. */
export interface GeneratedCard {
  front: string;
  back: string;
}

/**
 * Generated material waiting to be written to the library.
 *
 * Serialisable by construction — it is persisted with the job record and read
 * back after a cold start, so nothing here may be a function or a class.
 */
export type PendingSave =
  | {
      kind: 'deck';
      /** The new deck's title, or the existing one's. */
      deckName: string;
      description?: string;
      /** Save into a deck the student already has, instead of making one. */
      deckId?: string;
      cards: GeneratedCard[];
    }
  | {
      kind: 'test';
      title: string;
      /** The note this was generated from, for the server's own record. */
      sourceNoteId?: string;
      /** The deck this was generated from, when the source was a deck. */
      sourceDeckId?: string;
      /** Question rows, exactly as the generator produced them. */
      questions: unknown[];
    };

/** What the sheet says when a cold start finds generated work that never saved. */
export const UNSAVED_GENERATION_ERROR =
  "We made this but hadn't saved it to your library yet.";

export interface TrackedJob {
  /** Client id. Stable across a resume; not the server's job id. */
  id: string;
  /** The server job to poll, when the request came back 202. */
  serverJobId?: string;
  /** Owner. Jobs are stored per user, and this is the second guard. */
  userId: string;
  kind: JobKind;
  /** The material this was generated from — the notification's subtitle. */
  sourceTitle: string;
  /** How many cards/questions were asked for, when a count was chosen. */
  requestedCount?: number;
  /**
   * True when `requestedCount` is a CEILING rather than a promise.
   *
   * A question generator asks for up to ten and writes what the material
   * supports: build 168 asked for 10 and saved 5, while the sheet said
   * "10-question test" and "Writing 10 questions" throughout. With this set
   * the sheet says "up to", and only the saved count is ever stated plainly.
   */
  requestedCountIsMax?: boolean;
  status: TrackedJobStatus;
  /** Server-supplied fraction 0..1, when there is one. */
  progress?: number;
  /** Server-supplied stage label, when there is one. */
  stage?: string;
  error?: string;
  /**
   * Why a failed job failed, when the reason changes what a student can do:
   * `limit` = a daily cap refused it (retrying cannot help until the reset),
   * `unavailable` = the provider was down (retry is honest). Absent = unknown.
   */
  failureKind?: 'limit' | 'unavailable' | 'other';
  artifact?: JobArtifactRef;
  /**
   * Where this job's save actually landed, recorded the moment it landed and
   * persisted with the record.
   *
   * `artifact` is set when the job SETTLES; `savedRef` is set when the write
   * finishes, which is earlier and survives everything after it. It is the
   * one-shot guard for the save itself: a job that already has a savedRef is
   * never saved again, so an airplane-mode interruption, a cold start or a
   * second settle re-opens the SAME deck instead of minting another one.
   */
  savedRef?: JobArtifactRef;
  /** How many artefacts that save actually persisted. */
  savedCount?: number;
  /**
   * What the AI produced, held until it is safely in the library.
   *
   * Generation costs a credit; saving does not. A save that fails (airplane
   * mode, a 500, the process dying between the two) used to throw the
   * generated material away with it, so "Try again" meant generating again —
   * a second wait and a second charge for work that was already done. The
   * payload is written to the job record BEFORE the save is attempted and
   * cleared the moment it lands, so a failed or interrupted save can be
   * retried as a save.
   */
  pendingSave?: PendingSave;
  /**
   * The server's machine stage word (`reading` | `generating` | `saving` …).
   * Kept apart from `stage`, which holds the student-facing wording a client
   * runner reported: mixing the two is what let the sheet's subtitle and its
   * checklist disagree.
   */
  serverStage?: string;
  /** How many artefacts were actually saved (never what was merely generated). */
  resultCount?: number;
  startedAt: number;
  updatedAt: number;
  /** The header-driven AI charge has been folded into the counter. Once only. */
  usageApplied: boolean;
  /** The completion notification has been posted. Once only. */
  notified: boolean;
  /** The student still has the sheet open. Watching stops; the job does not. */
  watching: boolean;
  /**
   * What the server did about the completion push, read back from the job
   * record when it settles. Absent until then, and on servers that predate
   * the audit — which is why every reader treats absence as "no claim".
   */
  pushAudit?: JobPushAudit;
}

/** The store's AsyncStorage key prefix. Scoped per user, as pending results are. */
export const JOBS_STORAGE_PREFIX = '@lantern_ai_jobs';

/** Storage key holding `userId`'s tracked jobs. */
export const jobsKey = (userId: string): string => `${JOBS_STORAGE_PREFIX}:${userId}`;

/** A job that has stopped moving. */
export const isTerminal = (status: TrackedJobStatus): boolean =>
  status === 'done' || status === 'failed' || status === 'lost';

/** The client-side budget after which the sheet stops promising and offers a way out. */
export const JOB_TIME_BUDGET_MS = 90_000;

/** How long a finished job stays on the Home card. */
export const RECENT_JOB_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Hard cap on stored jobs, newest kept. */
export const MAX_TRACKED_JOBS = 20;

/**
 * Parse a raw AsyncStorage value into a job list. A corrupt or non-array
 * payload yields [] rather than throwing — a bad cache must not break boot.
 */
export const parseJobs = (raw: string | null | undefined): TrackedJob[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (j): j is TrackedJob =>
        Boolean(j) && typeof j.id === 'string' && typeof j.status === 'string'
    );
  } catch {
    return [];
  }
};

/** Insert or replace by id, newest-first ordering preserved by start time. */
export const upsertJob = (jobs: TrackedJob[], job: TrackedJob): TrackedJob[] => {
  const without = jobs.filter((j) => j.id !== job.id);
  return [job, ...without].sort((a, b) => b.startedAt - a.startedAt);
};

/**
 * Apply a patch to one job.
 *
 * Terminal states are sticky: a late poll response must not move a job that
 * has already been reported as done back into `running`, which is what would
 * make a completion notification fire twice.
 */
export const patchJob = (
  jobs: TrackedJob[],
  id: string,
  patch: Partial<TrackedJob>,
  now: number
): TrackedJob[] =>
  jobs.map((job) => {
    if (job.id !== id) return job;
    if (
      isTerminal(job.status) &&
      patch.status !== undefined &&
      patch.status !== job.status &&
      // …except the one promotion that is always true: a job whose output has
      // actually reached the library IS done, whatever it was before. A save
      // retried after a failure used to be swallowed here — the write landed,
      // the material was cleared, and the card went on saying "That didn't
      // finish" over a deck the student now had (F8).
      !(patch.status === 'done' && job.status !== 'done')
    ) {
      // Keep the outcome; still let flags like `notified` be recorded.
      const { status: _ignored, ...rest } = patch;
      return { ...job, ...rest, updatedAt: now };
    }
    return { ...job, ...patch, updatedAt: now };
  });

/** Remove a job the student dismissed. */
export const dismissJob = (jobs: TrackedJob[], id: string): TrackedJob[] =>
  jobs.filter((j) => j.id !== id);

/** Find one. */
export const findJob = (jobs: TrackedJob[], id: string): TrackedJob | undefined =>
  jobs.find((j) => j.id === id);

/**
 * Find one by either id.
 *
 * A push and a deep link name the SERVER's job id; the store keys everything
 * on its own client id, which exists before the server has issued one. Both
 * are accepted so a notification about a job this device started still finds
 * it.
 */
export const findJobByAnyId = (jobs: TrackedJob[], id: string): TrackedJob | undefined =>
  jobs.find((j) => j.id === id) ?? jobs.find((j) => j.serverJobId === id);

/**
 * Claim the single credit application for a job.
 *
 * Returns `null` when the charge has already been applied — the caller then
 * does NOT touch the counter. Every path that can see a completion (the
 * in-process await, a poll, a resume after a cold start) goes through this, so
 * one generation moves the counter once no matter how many of them fire.
 */
export const claimUsage = (
  jobs: TrackedJob[],
  id: string,
  now: number
): { jobs: TrackedJob[]; claimed: boolean } => {
  const job = findJob(jobs, id);
  if (!job || job.usageApplied) return { jobs, claimed: false };
  return { jobs: patchJob(jobs, id, { usageApplied: true }, now), claimed: true };
};

/** Same one-shot guard for the completion notification. */
export const claimNotification = (
  jobs: TrackedJob[],
  id: string,
  now: number
): { jobs: TrackedJob[]; claimed: boolean } => {
  const job = findJob(jobs, id);
  if (!job || job.notified) return { jobs, claimed: false };
  return { jobs: patchJob(jobs, id, { notified: true }, now), claimed: true };
};

// ─────────────────────────────────────────────────────────────
// Saving a generation's output, exactly once
// ─────────────────────────────────────────────────────────────

/**
 * Is this an id the server actually issued?
 *
 * The flashcard store hands back an optimistic `temp_…` row whenever a write
 * could not reach the API, and nothing ever rebinds those ids. A deck saved
 * under one is therefore not a deck the student has: on the next load the list
 * comes back from the server without it, or comes back with the deck and none
 * of its cards. That is where the empty "From: …" decks came from, so a temp
 * id is treated as "not saved" rather than as success.
 */
export const isPersistedId = (id: string | undefined | null): boolean =>
  typeof id === 'string' && id.length > 0 && !id.startsWith('temp_');

/** What a save attempt should do, given what this job has already saved. */
export type SavePlan =
  | { action: 'reuse'; ref: JobArtifactRef; count: number }
  | { action: 'save' };

/**
 * Save-once, per job id.
 *
 * Every path that can reach a save — the in-process runner, a retry after the
 * app came back, a settle driven by a push — asks this first. A job that has
 * already written its output reuses that reference; only a job that has never
 * saved is allowed to create anything.
 */
export const planSave = (job: TrackedJob | undefined): SavePlan =>
  job?.savedRef
    ? { action: 'reuse', ref: job.savedRef, count: job.savedCount ?? 0 }
    : { action: 'save' };

/**
 * Is there generated material that never reached the library?
 *
 * The one question that separates "we lost your work" from "your work is
 * here, it just isn't filed yet". Everything the student is offered after a
 * failure — the button, the copy, what a retry costs — follows from it.
 */
export const hasUnsavedGeneration = (job: TrackedJob | undefined): boolean =>
  Boolean(job?.pendingSave) && !job?.savedRef;

/**
 * Jobs holding generated material that never reached the library.
 *
 * The list the app finishes by itself the moment the network comes back: the
 * work is already paid for and already on the device, so a student who turned
 * airplane mode off should not have to find the card and tap "Save to
 * library" (D7). A job that has already saved is not in it, and neither is one
 * that never generated anything — retrying either would be a second charge.
 */
export const jobsAwaitingSave = (jobs: TrackedJob[]): TrackedJob[] =>
  jobs.filter((job) => hasUnsavedGeneration(job));

/** What "Try again" should actually do. */
export type RetryPlan = 'save' | 'generate' | 'none';

/**
 * Retry the SAVE, not the generation, whenever the material still exists.
 *
 * Regenerating spends a second credit and makes the student wait again for
 * cards the AI has already written. A job that has generated something and
 * failed on the way to the library only ever needs the second half repeating.
 */
export const planRetry = (job: TrackedJob | undefined): RetryPlan => {
  if (!job) return 'none';
  if (job.savedRef) return 'none';
  return job.pendingSave ? 'save' : 'generate';
};

/** Record where a job's output landed. Refuses a second, different save. */
export const claimSave = (
  jobs: TrackedJob[],
  id: string,
  ref: JobArtifactRef,
  count: number,
  now: number
): { jobs: TrackedJob[]; claimed: boolean } => {
  const job = findJob(jobs, id);
  if (!job || job.savedRef) return { jobs, claimed: false };
  return {
    jobs: patchJob(jobs, id, { savedRef: ref, savedCount: count }, now),
    claimed: true,
  };
};

/**
 * The patch that finishes a job whose save has just landed.
 *
 * Promotion, not a mere status change: the material is in the library, so the
 * job is `done` no matter what it was showing a moment ago. A job that had
 * already been reported as failed also gets its notification claim released,
 * or the student would be told about the failure and never about the finish.
 */
export const savedSettlePatch = (
  job: TrackedJob | undefined,
  ref: JobArtifactRef,
  count: number
): Partial<TrackedJob> => ({
  status: 'done',
  artifact: ref,
  savedRef: ref,
  savedCount: count,
  resultCount: count,
  error: undefined,
  pendingSave: undefined,
  ...(job && (job.status === 'failed' || job.status === 'lost') ? { notified: false } : {}),
});

/** What a deck write produced, as counted from the ids that came back. */
export interface DeckSaveTally {
  /** Cards the generator produced. */
  requested: number;
  /** Cards that came back with a server id. */
  saved: number;
  /** The deck's id, as the store returned it. */
  deckId: string;
}

/**
 * Keep the deck, or undo it.
 *
 * A deck is only worth keeping when the server issued its id AND at least one
 * card actually persisted. Anything else is the empty-deck failure: it must be
 * rolled back and reported as a failure the student can retry, never left in
 * the library announcing cards it does not contain.
 */
export type DeckSavePlan =
  | { action: 'keep'; resultCount: number }
  | { action: 'rollback'; reason: string };

export const planDeckSave = (tally: DeckSaveTally): DeckSavePlan => {
  if (!isPersistedId(tally.deckId)) {
    return {
      action: 'rollback',
      reason: "We couldn't save this to your library. Check your connection and try again.",
    };
  }
  if (tally.saved <= 0) {
    return {
      action: 'rollback',
      reason: tally.requested > 0
        ? "We couldn't save the cards. Check your connection and try again."
        : 'Nothing was generated to save.',
    };
  }
  return { action: 'keep', resultCount: tally.saved };
};

/** Only the jobs this account owns. An unowned entry is never assumed to be theirs. */
export const jobsOwnedBy = (jobs: TrackedJob[], userId: string): TrackedJob[] =>
  jobs.filter((j) => j.userId === userId);

/**
 * Live jobs this account owns — ADOPTING the ones that started before it was
 * known who was signed in.
 *
 * `startJob` stamps `userId: ''` when a generate button is pressed before the
 * auth store has answered, which is ordinary on a cold start: the note editor
 * is restored by nav-restore and a generation can begin before Home ever
 * mounts. The very next hydrate then filtered that RUNNING job out of memory
 * as somebody else's, so Home's card listed only finished work while a
 * generation was in flight (D6) — and the job could never be persisted either,
 * because `persist` filters by owner too.
 *
 * An empty owner is not another account's: it is this process's own job,
 * started a moment ago, and it is stamped with the account that has now
 * arrived. A job stamped with a DIFFERENT id is still never adopted.
 */
export const adoptOwnerlessJobs = (jobs: TrackedJob[], userId: string): TrackedJob[] =>
  jobs
    .filter((j) => j.userId === userId || !j.userId)
    .map((j) => (j.userId ? j : { ...j, userId }));

/**
 * Is this finished job recent enough to still be shown?
 *
 * Both clocks have to agree. `updatedAt` alone is not enough: a job that is
 * re-settled on every launch (a `lost` one is patched again each hydrate)
 * kept moving its own timestamp forward and never aged out, which is why two
 * "We lost track of this one" cards from an earlier build were still sitting
 * on Home a day later (F9). `startedAt` never moves, so it is the one that
 * decides when a card is stale.
 */
export const isRecentTerminalJob = (
  job: TrackedJob,
  now: number,
  windowMs = RECENT_JOB_WINDOW_MS
): boolean =>
  now - job.updatedAt <= windowMs && now - job.startedAt <= windowMs;

/** Drop stale finished jobs and cap the list. Running jobs are never pruned. */
export const pruneJobs = (
  jobs: TrackedJob[],
  now: number,
  windowMs = RECENT_JOB_WINDOW_MS,
  max = MAX_TRACKED_JOBS
): TrackedJob[] => {
  const kept = jobs.filter(
    (j) => !isTerminal(j.status) || isRecentTerminalJob(j, now, windowMs)
  );
  const sorted = [...kept].sort((a, b) => b.startedAt - a.startedAt);
  return sorted.slice(0, max);
};

/** Jobs still in flight. */
export const runningJobs = (jobs: TrackedJob[]): TrackedJob[] =>
  jobs.filter((j) => !isTerminal(j.status));

/**
 * What the Home card lists: everything in flight, then anything that finished
 * inside the recent window, newest first.
 */
export const visibleJobs = (jobs: TrackedJob[], now: number): TrackedJob[] => {
  const running = runningJobs(jobs);
  const recent = jobs.filter((j) => isTerminal(j.status) && isRecentTerminalJob(j, now));
  return [...running, ...recent].sort((a, b) => b.startedAt - a.startedAt);
};

/**
 * What a cold start should do with what was persisted.
 *
 * A job with a server id can be polled back to a real answer, so it resumes.
 * A job without one was being awaited in a process that no longer exists;
 * there is nothing left to ask, so it becomes `lost` rather than `failed`.
 */
export interface ResumePlan {
  /** The list as it should now be held in memory. */
  jobs: TrackedJob[];
  /** Client ids whose server job should be polled again. */
  resume: string[];
  /** Client ids that were marked `lost` by this plan. */
  lost: string[];
  /**
   * Client ids that came back holding generated material they never saved.
   * They are `failed`, not `lost`: nothing is missing, and the student is one
   * button — "Save to library" — away from having it, at no further charge.
   */
  unsaved: string[];
}

export const planResume = (jobs: TrackedJob[], now: number): ResumePlan => {
  const resume: string[] = [];
  const lost: string[] = [];
  const unsaved: string[] = [];
  const next = jobs.map((job) => {
    if (isTerminal(job.status)) return job;
    // Generated material outranks a poll: the work is on this device, and
    // asking the server about it cannot put it in the library.
    if (hasUnsavedGeneration(job)) {
      unsaved.push(job.id);
      return {
        ...job,
        status: 'failed' as const,
        error: UNSAVED_GENERATION_ERROR,
        watching: false,
        updatedAt: now,
      };
    }
    if (job.serverJobId) {
      resume.push(job.id);
      return { ...job, watching: false };
    }
    lost.push(job.id);
    return { ...job, status: 'lost' as const, watching: false, updatedAt: now };
  });
  return { jobs: pruneJobs(next, now), resume, lost, unsaved };
};

/**
 * What hydrating from disk should produce when the store is not empty.
 *
 * A job already in memory is LIVE: its runner is awaiting real work in this
 * process. It wins over its persisted copy, which must not be re-read from
 * disk and declared lost while the work is still running — a generation
 * started before Home mounted (nav restore lands the app on the note editor)
 * used to be marked lost the moment the student went Home. Only the stored
 * jobs this process has never seen go through `planResume`, and only this
 * account's jobs survive either way.
 */
export const planHydration = (
  live: TrackedJob[],
  stored: TrackedJob[],
  userId: string,
  now: number
): ResumePlan => {
  // Live jobs win, and an ownerless one is adopted rather than dropped: it is
  // this process's own in-flight generation (see adoptOwnerlessJobs).
  const owned = adoptOwnerlessJobs(live, userId);
  const liveIds = new Set(owned.map((j) => j.id));
  const plan = planResume(
    jobsOwnedBy(stored, userId).filter((j) => !liveIds.has(j.id)),
    now
  );
  return { ...plan, jobs: pruneJobs([...owned, ...plan.jobs], now) };
};

/**
 * Why the server did not push about a job — its own words, mirrored here so
 * this module keeps its "imports nothing" rule.
 *
 * `packages/shared/src/jobs/jobState.ts` is the source; a reason this client
 * has never heard of is carried through as a string and mapped to plain words
 * in utils/pushDiagnostics.
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
 * What the server actually did about notifying this job's owner.
 *
 * Served by `GET /api/v1/jobs/:id` to the owner alone. It is the only way the
 * device can tell "the server never sent one" from "it sent one and the OS
 * dropped it", which is precisely the question build 161 could not answer.
 */
export interface JobPushAudit {
  attemptedAt: string;
  skippedReason?: JobPushSkipReason;
  /** How many devices the envelope went to (0 when nothing was sent). */
  tokenCount?: number;
  expoTickets?: JobPushTicket[];
  /** The deep link the notification carried. */
  url?: string;
  error?: string;
}

/** A fresh job record. */
export const createJob = (input: {
  id: string;
  userId: string;
  kind: JobKind;
  sourceTitle: string;
  requestedCount?: number;
  requestedCountIsMax?: boolean;
  serverJobId?: string;
  now: number;
}): TrackedJob => ({
  id: input.id,
  serverJobId: input.serverJobId,
  userId: input.userId,
  kind: input.kind,
  sourceTitle: input.sourceTitle,
  requestedCount: input.requestedCount,
  requestedCountIsMax: input.requestedCountIsMax,
  status: 'queued',
  startedAt: input.now,
  updatedAt: input.now,
  usageApplied: false,
  notified: false,
  watching: true,
});


// ─────────────────────────────────────────────────────────────
// The job status wire format
// ─────────────────────────────────────────────────────────────

/** Legacy and current status words the API has served. */
export type ServerJobStatus = 'queued' | 'active' | 'running' | 'completed' | 'failed';

/** What the store reasons about after normalisation. */
export interface JobStatusSnapshot {
  status: ServerJobStatus;
  /** The server's machine stage word, verbatim (`reading`, `generating`, …). */
  stage?: string;
  /** Fraction 0..1. */
  progress?: number;
  error?: string;
  result?: unknown;
  /** Where the server says the work landed, when it says so. */
  artifact?: JobArtifactRef;
  /** What the server did about the completion push, when it says. */
  push?: JobPushAudit;
}

/** The `GET /api/v1/jobs/:id` body, across both shapes it has had. */
export interface WireJobRecord {
  status?: string;
  /** The job state machine: queued | reading | generating | saving | done | failed | timed_out. */
  stage?: string;
  /** Monotonic 0..100. */
  percent?: number;
  /** The older 0..1 field. */
  progress?: number;
  error?: string | { message?: string };
  errorMessage?: string;
  result?: unknown;
  /** Where the finished work landed. */
  resultRef?: { type?: string; id?: string; route?: string; name?: string };
  /** The owner-only push audit. Only present once the job is terminal. */
  push?: unknown;
}

/** Artefact types this client knows how to open. */
const ARTIFACT_TYPES = new Set(['deck', 'note', 'test', 'quiz']);

/**
 * The server's `resultRef` as an artefact this client can route to.
 *
 * A type the app has no screen for yields `undefined` rather than a reference
 * that would put an "Open" button on a link to nowhere.
 */
export const toArtifactRef = (
  ref: WireJobRecord['resultRef']
): JobArtifactRef | undefined => {
  if (!ref || typeof ref.type !== 'string' || !ARTIFACT_TYPES.has(ref.type)) return undefined;
  if (!ref.id) return undefined;
  return { type: ref.type as JobArtifactRef['type'], id: ref.id, name: ref.name };
};

const PUSH_SKIP_REASONS = new Set<string>([
  'disabled',
  'no_owner',
  'no_token',
  'prefs_off',
  'not_pushable',
  'claimed',
  'error',
]);

/**
 * The wire `push` field as an audit this client will show.
 *
 * Validated rather than cast: the caption it feeds is shown to the student as
 * fact, so a malformed record must produce NO claim (undefined) rather than a
 * half-filled one that reads as "we told you".
 */
export const toPushAudit = (raw: unknown): JobPushAudit | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.attemptedAt !== 'string') return undefined;
  const reason = typeof record.skippedReason === 'string' ? record.skippedReason : undefined;
  const tickets = Array.isArray(record.expoTickets)
    ? record.expoTickets
        .filter((t): t is Record<string, unknown> => Boolean(t) && typeof t === 'object')
        .map((t) => ({
          status: t.status === 'error' ? ('error' as const) : ('ok' as const),
          id: typeof t.id === 'string' ? t.id : undefined,
          message: typeof t.message === 'string' ? t.message : undefined,
        }))
    : undefined;
  return {
    attemptedAt: record.attemptedAt,
    // An unrecognised reason is still shown, not swallowed: a newer server
    // naming a condition this build has never heard of is news, not noise.
    ...(reason ? { skippedReason: reason as JobPushSkipReason } : {}),
    ...(typeof record.tokenCount === 'number' ? { tokenCount: record.tokenCount } : {}),
    ...(tickets && tickets.length > 0 ? { expoTickets: tickets } : {}),
    ...(typeof record.url === 'string' ? { url: record.url } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
  };
};

/** Is this a reason this build has copy for? */
export const isKnownPushSkipReason = (reason: string | undefined): boolean =>
  typeof reason === 'string' && PUSH_SKIP_REASONS.has(reason);

const TERMINAL_DONE = new Set(['done', 'completed']);
const TERMINAL_FAILED = new Set(['failed', 'timed_out']);

/**
 * Normalise the wire record into what this store reasons about.
 *
 * `percent` is carried through as a 0..1 fraction, and the stage word is
 * carried through VERBATIM — as the machine word it is. It is stored on
 * `serverStage`, never on `stage`: jobSheetModel turns one of the two into the
 * student's wording, and putting "generating" where "Writing 20 cards" belongs
 * is what made the sheet's subtitle contradict its own checklist.
 */
export const toJobStatusSnapshot = (record: WireJobRecord): JobStatusSnapshot => {
  const stage = record.stage;
  const status: ServerJobStatus =
    stage && TERMINAL_DONE.has(stage)
      ? 'completed'
      : stage && TERMINAL_FAILED.has(stage)
        ? 'failed'
        : stage === 'queued'
          ? 'queued'
          : stage
            ? 'running'
            : ((record.status as ServerJobStatus) ?? 'queued');

  const percent = typeof record.percent === 'number' ? record.percent / 100 : undefined;
  const error =
    record.errorMessage ??
    (typeof record.error === 'string' ? record.error : record.error?.message);

  return {
    status,
    stage,
    progress: percent ?? record.progress,
    error,
    result: record.result,
    artifact: toArtifactRef(record.resultRef),
    push: toPushAudit(record.push),
  };
};

// ─────────────────────────────────────────────────────────────
// Settling a job from the SERVER record, when the runner is gone
// ─────────────────────────────────────────────────────────────

/**
 * What a server snapshot means for a job whose runner is not in this process
 * (a resumed poll after a cold start, or a push that arrived first).
 *
 * The server's `completed` is not the whole story for a kind the CLIENT saves
 * (flashcards, the daily quiz, an import's materials): the runner that would
 * have written them is gone, so unless the job already recorded a save, or
 * the server itself points at an artefact, nothing is in the library. That is
 * `lost` — "check your library before retrying" — never `done`, which would
 * post "10 flashcards ready" over a deck that does not exist.
 */
export const planServerSettle = (
  job: TrackedJob,
  snapshot: JobStatusSnapshot
): Partial<TrackedJob> | null => {
  const plan = planServerOutcome(job, snapshot);
  // The push audit rides along with whatever the outcome is: the server writes
  // it when the job goes terminal, which is the same read that settles it.
  return plan && snapshot.push ? { ...plan, pushAudit: snapshot.push } : plan;
};

/**
 * How many artefacts the server's own result blob holds, when it says.
 *
 * Mirrors the shape the completion push reads (`@lantern/shared/jobs/jobPush`
 * `jobResultCount`): the questions/cards array, at the top level or one level
 * inside `session`/`data`, which is where a note quiz's session keeps them.
 */
const serverResultCount = (result: unknown): number | undefined => {
  const read = (value: unknown): number | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    for (const key of ['questions', 'flashcards', 'cards']) {
      const list = record[key];
      if (Array.isArray(list)) return list.length;
    }
    return undefined;
  };
  const top = read(result);
  if (typeof top === 'number') return top;
  const record = (result ?? {}) as Record<string, unknown>;
  return read(record.session) ?? read(record.data);
};

const planServerOutcome = (
  job: TrackedJob,
  snapshot: JobStatusSnapshot
): Partial<TrackedJob> | null => {
  if (snapshot.status === 'completed') {
    const artifact = job.savedRef ?? snapshot.artifact;
    if (artifact) {
      // The COUNT travels with the settle, not just the artefact. Without it a
      // job settled from the server (a cold start, a poll after the app was
      // backgrounded) had no result count, and every done surface fell back to
      // what was ASKED for — which is how a 5-question test was announced as a
      // "10-question test ready" push on build 168.
      const resultCount = job.savedCount ?? job.resultCount ?? serverResultCount(snapshot.result);
      return {
        status: 'done',
        artifact,
        ...(typeof resultCount === 'number' ? { resultCount } : {}),
      };
    }
    // The generation itself is on this device, unsaved. That is a failure the
    // student can finish in one tap, and it must not be reported as a loss.
    if (hasUnsavedGeneration(job)) {
      return { status: 'failed', error: UNSAVED_GENERATION_ERROR };
    }
    return {
      status: 'lost',
      error: 'The app closed before this was saved.',
    };
  }
  if (snapshot.status === 'failed') {
    return { status: 'failed', error: snapshot.error || 'The generation failed.' };
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Undoing a deck that never reached the server
// ─────────────────────────────────────────────────────────────

/** The fields of a queued sync operation this rule reads. */
export interface QueuedSyncOpView {
  entityType: string;
  entityId: string;
  operation: string;
  data?: Record<string, unknown> | null;
}

/**
 * Is this queued write made moot by deleting `deckId`?
 *
 * The flashcard store queues a deck `create` when the network is down and
 * hands back a `temp_` deck; every card written into it queues a `create`
 * carrying that deck id. Rolling the deck back only removed the local rows:
 * the queued create still replayed on reconnect and minted an EMPTY deck on
 * the server — the "From: SDOH" shells with no cards. Deleting a deck must
 * therefore also drop its own queued create and the card creates aimed at it.
 */
export const isSyncOpOrphanedByDeckDelete = (op: QueuedSyncOpView, deckId: string): boolean => {
  if (!deckId) return false;
  if (op.entityType === 'deck' && op.entityId === deckId) return true;
  if (op.entityType === 'flashcard' && op.operation === 'create') {
    return op.data?.deckId === deckId;
  }
  return false;
};

/**
 * Classify a thrown generation error for the job record. A 429 is a daily
 * cap: the Usage & limits copy already tells the student when it resets, so
 * the sheet must not offer a Retry that can only fail again.
 */
export function classifyJobFailure(error: unknown): 'limit' | 'unavailable' | 'other' {
  const e = error as { status?: number; code?: string; message?: string } | null;
  if (!e) return 'other';
  if (e.status === 429 || e.code === 'RATE_LIMIT' || e.code === 'AI_LIMIT_REACHED') return 'limit';
  if (e.status === 503 || e.status === 502 || /temporarily unavailable/i.test(e.message ?? '')) return 'unavailable';
  return 'other';
}
