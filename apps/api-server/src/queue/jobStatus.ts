import { getRedisClient, redisKey } from '../services/redisStore';
import type { JobRecord, JobStatus, QueueName } from './jobs/types';

const TTL_SECONDS = 60 * 60 * 24;

function statusKey(jobId: string): string {
  return redisKey(`job:${jobId}`);
}

export async function saveJobRecord(record: JobRecord): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.set(statusKey(record.id), JSON.stringify(record), { EX: TTL_SECONDS });
}

export async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  patch: Partial<Pick<JobRecord, 'result' | 'error'>> = {}
): Promise<void> {
  const existing = await getJobRecord(jobId);
  if (!existing) return;
  const updated: JobRecord = {
    ...existing,
    ...patch,
    status,
    updatedAt: new Date().toISOString(),
  };
  await saveJobRecord(updated);
}

/** Stamp the enqueueing request's AI charge onto the job record (see JobRecord.charge). */
export async function attachJobCharge(
  jobId: string,
  charge: { credits: number; featureKey?: string }
): Promise<void> {
  const existing = await getJobRecord(jobId);
  if (!existing) return;
  await saveJobRecord({ ...existing, charge, updatedAt: new Date().toISOString() });
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

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const raw = await client.get(statusKey(jobId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export async function createJobRecord(input: {
  id: string;
  queue: QueueName;
  name: string;
  userId?: string;
  charge?: { credits: number; featureKey?: string };
}): Promise<JobRecord> {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id: input.id,
    queue: input.queue,
    name: input.name,
    status: 'queued',
    userId: input.userId,
    // Stamped at enqueue (before the worker can possibly run) so the
    // failure-refund can never race a late post-response stamp.
    charge: input.charge,
    createdAt: now,
    updatedAt: now,
  };
  await saveJobRecord(record);
  return record;
}
