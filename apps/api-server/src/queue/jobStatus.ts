import { getRedisClient, redisKey } from '../services/redisStore';
import {
  advanceJobStage,
  claimCreditRefund,
  isJobStale,
  isTerminalJobStage,
  jobKindFromName,
  legacyStatusToStage,
  stageToLegacyStatus,
  timeOutJobRecord,
  type JobError,
  type JobPushAudit,
  type JobRecordView,
  type JobResultRef,
  type JobStage,
} from '@lantern/shared/jobs/jobState';
import { refundAiCredits, refundFeatureAiCredit } from '../middleware/aiRateLimit';
import { notifyJobTerminal } from '../services/jobPush';
import type { JobRecord, JobStatus, QueueName } from './jobs/types';
import type { AiJobCharge } from './enqueue';

const TTL_SECONDS = 60 * 60 * 24;

function statusKey(jobId: string): string {
  return redisKey(`job:${jobId}`);
}

export async function saveJobRecord(record: JobRecord): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.set(statusKey(record.id), JSON.stringify(record), { EX: TTL_SECONDS });
}

/**
 * Advance a job's stage and progress (reading → generating → saving → done).
 *
 * Monotonic and terminal-safe: `advanceJobStage` refuses to move a record that
 * has already finished, so a straggling attempt can neither un-fail a refunded
 * job nor un-finish one the student has already seen land.
 */
export async function setJobStage(
  jobId: string,
  stage: JobStage,
  patch: {
    percent?: number;
    result?: unknown;
    resultRef?: JobResultRef;
    error?: JobError;
  } = {}
): Promise<JobRecord | null> {
  const existing = await getJobRecord(jobId);
  if (!existing) return null;
  const updated = advanceJobStage(existing, stage, {
    now: new Date().toISOString(),
    percent: patch.percent,
    result: patch.result,
    resultRef: patch.resultRef,
    error: patch.error,
  });
  if (updated === existing) return existing;
  await saveJobRecord(updated);
  // The single writer is also the single place a job becomes terminal, so it
  // is where the student's phone is told. Fire-and-forget: a push must never
  // fail the work it is announcing (notifyJobTerminal swallows its own errors,
  // and a Redis NX claim keeps a job from buzzing twice).
  if (isTerminalJobStage(updated.stage)) void pushJobCompletion(updated);
  return updated;
}

/**
 * Write the completion push's audit onto the job record.
 *
 * Re-read first: the push runs after the terminal write, and a refund (or a
 * late resultRef stamp) may have landed in between — writing the stale blob
 * back would erase it.
 */
export async function recordJobPushAudit(jobId: string, push: JobPushAudit): Promise<void> {
  const latest = await getJobRecord(jobId);
  if (!latest) return;
  await saveJobRecord({ ...latest, push });
}

/** Announce a finished job to its owner's devices. Never throws. */
function pushJobCompletion(record: JobRecord): Promise<unknown> {
  return notifyJobTerminal(
    {
      id: record.id,
      userId: record.userId,
      kind: record.kind,
      stage: record.stage,
      result: record.result,
      resultRef: record.resultRef,
      error: record.error,
      sourceTitle: record.sourceTitle,
    },
    { recordPush: recordJobPushAudit },
  ).catch((err) => {
    console.error(`[queue] Completion push failed for job ${record.id}:`, err);
  });
}

/**
 * Point a finished job at the artefact a CLIENT saved from it.
 *
 * A note quiz is generated server-side but becomes a launchable test only when
 * the app POSTs /tests/personal, so at terminal time the record could name no
 * test and its notification fell back to `lanternstudy://jobs/<id>`. Stamping
 * the ref afterwards makes the record itself resolvable — including for a
 * student who opens the notification minutes later, and for a second device.
 *
 * Deliberately NOT `setJobStage`: that (correctly) refuses to touch a terminal
 * record. This only ever adds a pointer; stage, credit and error are untouched.
 */
export async function attachJobResultRef(
  jobId: string,
  resultRef: JobResultRef,
): Promise<JobRecord | null> {
  if (!jobId || !resultRef?.id) return null;
  const latest = await getJobRecord(jobId);
  if (!latest) return null;
  // First writer wins: a retried save must not repoint a job at a duplicate.
  if (latest.resultRef?.type === resultRef.type && latest.resultRef?.id) return latest;
  const updated: JobRecord = { ...latest, resultRef, updatedAt: new Date().toISOString() };
  await saveJobRecord(updated);
  return updated;
}

/**
 * Legacy entry point kept for callers that think in BullMQ statuses. It maps
 * onto the stage machine so every writer produces the same record shape.
 */
export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  patch: { result?: unknown; error?: string | JobError; resultRef?: JobResultRef } = {}
): Promise<void> {
  const stage = legacyStatusToStage(status);
  const error =
    typeof patch.error === 'string'
      ? ({ code: 'JOB_FAILED', message: patch.error, retryable: true } as JobError)
      : patch.error;
  await setJobStage(jobId, stage, {
    result: patch.result,
    resultRef: patch.resultRef,
    error,
  });
}

/** Stamp the enqueueing request's AI charge onto the job record (see JobRecord.charge). */
export async function attachJobCharge(
  jobId: string,
  charge: AiJobCharge
): Promise<void> {
  const existing = await getJobRecord(jobId);
  if (!existing) return;
  await saveJobRecord({
    ...existing,
    charge,
    credit: {
      charged: charge.credits,
      refunded: existing.credit?.refunded ?? 0,
      featureKey: charge.featureKey,
    },
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Claim the (single) failure refund for this job; returns false if another
 * caller already claimed it. Uses an atomic SET NX side key rather than a
 * read-modify-write of the record blob — concurrent status writes could erase
 * a flag stored there, re-opening a double-refund window.
 */
export async function markJobChargeRefunded(jobId: string): Promise<boolean> {
  const client = await getRedisClient();
  if (!client) return false; // no redis → no job records → nothing to refund
  const result = await client.set(redisKey(`job:${jobId}:refunded`), '1', {
    NX: true,
    EX: TTL_SECONDS,
  });
  return result === 'OK';
}

/**
 * Hand this job's reserved AI credits back — at most once, ever. The Redis NX
 * claim is the real lock; `claimCreditRefund` keeps the record's own ledger
 * honest so the client can see the refund it was given.
 */
export async function refundJobCreditOnce(record: JobRecord | null): Promise<boolean> {
  if (!record) return false;
  const userId = record.userId;
  const charge = record.charge;
  if (!userId || !charge || charge.credits <= 0) return false;
  if (record.credit && record.credit.refunded > 0) return false;
  if (!(await markJobChargeRefunded(record.id))) return false;

  // Back to the pool that paid. A bonus use refunded into the daily counter
  // would expire at midnight — the student would lose a reward to a job that
  // failed through no fault of theirs.
  const pool = charge.pool === 'bonus' ? 'bonus' : 'daily';
  if (charge.featureKey) {
    await refundFeatureAiCredit(userId, charge.featureKey, pool);
  } else {
    await refundAiCredits(userId, charge.credits, pool);
  }

  const latest = (await getJobRecord(record.id)) ?? record;
  const { credit } = claimCreditRefund(
    latest.credit ?? { charged: charge.credits, refunded: 0, featureKey: charge.featureKey }
  );
  await saveJobRecord({
    ...latest,
    credit,
    chargeRefunded: true,
    updatedAt: new Date().toISOString(),
  });
  console.log(
    `[queue] Refunded ${charge.credits} AI credit(s)${
      charge.featureKey ? ` (+1 ${charge.featureKey})` : ''
    } for job ${record.id}`
  );
  return true;
}

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const raw = await client.get(statusKey(jobId));
  if (!raw) return null;
  try {
    return migrateJobRecord(JSON.parse(raw) as Partial<JobRecord> & { error?: unknown });
  } catch {
    return null;
  }
}

/**
 * Records written before the stage model (or by an older deploy still running)
 * carry only `status` and a string `error`. Read them into the new shape so a
 * client never has to special-case a mid-deploy job.
 */
function migrateJobRecord(raw: Partial<JobRecord> & { error?: unknown }): JobRecord {
  const stage: JobStage = raw.stage ?? legacyStatusToStage(raw.status);
  const error: JobError | undefined =
    raw.error && typeof raw.error === 'object'
      ? (raw.error as JobError)
      : typeof raw.error === 'string' && raw.error
        ? { code: 'JOB_FAILED', message: raw.error, retryable: true }
        : undefined;
  return {
    ...(raw as JobRecord),
    kind: raw.kind ?? jobKindFromName(raw.name),
    stage,
    status: raw.status ?? stageToLegacyStatus(stage),
    percent: typeof raw.percent === 'number' ? raw.percent : stage === 'queued' ? 0 : 100,
    error,
    credit:
      raw.credit ??
      (raw.charge
        ? {
            charged: raw.charge.credits,
            refunded: raw.chargeRefunded ? raw.charge.credits : 0,
            featureKey: raw.charge.featureKey,
          }
        : undefined),
  };
}

/**
 * The record as a client should see it. A job that has sat in a non-terminal
 * stage past the stale window is reported `timed_out` — and refunded once,
 * because a student must never be charged for work that never arrived.
 */
export async function getJobRecordForClient(
  jobId: string,
  now: number = Date.now()
): Promise<JobRecord | null> {
  const record = await getJobRecord(jobId);
  return reconcileJobTimeout(record, now);
}

/**
 * Call once the caller is known to own the job: a stale record is stamped
 * `timed_out` and its credits handed back (once).
 */
export async function reconcileJobTimeout(
  record: JobRecord | null,
  now: number = Date.now()
): Promise<JobRecord | null> {
  if (!record) return null;
  const jobId = record.id;
  if (!isJobStale(record as unknown as JobRecordView, now)) return record;

  const timedOut = timeOutJobRecord(record as unknown as JobRecordView, now) as unknown as JobRecord;
  await saveJobRecord(timedOut);
  // A timeout is a terminal transition that never goes through setJobStage
  // (nothing advanced the record — it simply stopped moving), so it announces
  // itself here.
  void pushJobCompletion(timedOut);
  await refundJobCreditOnce(timedOut).catch((err) => {
    console.error(`[queue] Timeout refund failed for job ${jobId}:`, err);
  });
  return (await getJobRecord(jobId)) ?? timedOut;
}

export async function createJobRecord(input: {
  id: string;
  queue: QueueName;
  name: string;
  userId?: string;
  /** What the enqueueing request reserved, and which pool paid for it. */
  charge?: AiJobCharge;
  sourceTitle?: string;
}): Promise<JobRecord> {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id: input.id,
    queue: input.queue,
    name: input.name,
    kind: jobKindFromName(input.name),
    status: 'queued',
    stage: 'queued',
    percent: 0,
    userId: input.userId,
    sourceTitle: input.sourceTitle,
    // Stamped at enqueue (before the worker can possibly run) so the
    // failure-refund can never race a late post-response stamp.
    charge: input.charge,
    credit: input.charge
      ? { charged: input.charge.credits, refunded: 0, featureKey: input.charge.featureKey }
      : { charged: 0, refunded: 0 },
    createdAt: now,
    updatedAt: now,
  };
  await saveJobRecord(record);
  return record;
}
