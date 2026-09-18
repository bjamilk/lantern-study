/**
 * The phone's Creation Progress rows.
 *
 * The same list the browser's header popover shows, from the phone's own
 * tracker: `jobsStore` holds every generation run, already user-scoped and
 * already persisted across a cold start. Only the mapping lives here — the
 * filtering, ordering, counting and every string are in
 * `@lantern/shared/utils/importStages`, so the two platforms cannot drift on
 * what "processing" means or which tabs exist.
 *
 * `lost` is deliberately grouped with Failed rather than Done: the server may
 * well have finished it, but the student has something to do about it, and the
 * row's detail line says which of the two it is.
 *
 * Touches: `stores/jobsCore` for its types and `jobsOwnedBy` only. Nothing here
 * reads a store or renders, which is what lets mobile jest (node, no native
 * modules) import it at all.
 */
import type { CreationEntry, CreationStatus } from '@lantern/shared/utils/importStages';
import { jobsOwnedBy, type TrackedJob } from '../../stores/jobsCore';

function statusOf(job: TrackedJob): CreationStatus {
  if (job.status === 'done') return 'done';
  if (job.status === 'failed' || job.status === 'lost') return 'failed';
  return 'processing';
}

function detailOf(job: TrackedJob): string {
  if (job.error) return job.error;
  if (job.status === 'lost') return 'Still running on our servers';
  if (job.status === 'done') return 'Done';
  return job.stage || 'Working…';
}

export function toCreationEntries(
  jobs: readonly TrackedJob[],
  userId: string | null | undefined
): CreationEntry[] {
  if (!userId) return [];
  // No `dismissed` filter: on the phone, dismissing REMOVES the record
  // (`dismissJob` in jobsCore), so anything still in the list is still wanted.
  return jobsOwnedBy([...jobs], userId)
    .map((job) => ({
      id: job.id,
      title: job.sourceTitle || 'Untitled',
      status: statusOf(job),
      detail: detailOf(job),
      updatedAt: job.updatedAt,
    }));
}
