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
}): Promise<JobRecord> {
  const now = new Date().toISOString();
  const record: JobRecord = {
    id: input.id,
    queue: input.queue,
    name: input.name,
    status: 'queued',
    userId: input.userId,
    createdAt: now,
    updatedAt: now,
  };
  await saveJobRecord(record);
  return record;
}
