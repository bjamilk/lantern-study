/**
 * Everything the student has recently made, from both places that track it.
 *
 * WHY A MAPPER AND NOT A NEW ENDPOINT. The reference's "Creation Progress"
 * popover is a global queue served from its API. Lantern already holds the same
 * facts on the client, in two stores with different vocabularies: `aiJobStore`
 * (generation runs — Smart Notes, flashcards, quizzes, a whole import), and
 * `noteUploadStore` (the transfer itself, for an upload started before any job
 * exists). Both are user-scoped, both are persisted, both already survive
 * navigation. A `GET /users/me/creations` route would return strictly less —
 * an upload in flight has no server row until it lands — and would need a
 * table that does not exist. So the popover reads what is already true.
 *
 * Both lists are filtered BY OWNER here (#144): each store's persisted list is
 * one list per browser, so on a shared machine an unfiltered read shows the
 * previous student's titles. `getJobsForUser` and `getUploadJobsForUser` are
 * the two doors, and a signed-out reader gets nothing from either.
 *
 * Touches: `stores/aiJobStore` and `stores/noteUploadStore` for their types
 * only — nothing here reads a store or renders. The filtering, ordering and
 * counting live in `@lantern/shared/utils/importStages`, shared with the phone.
 */
import type { CreationEntry, CreationStatus } from '@lantern/shared/utils/importStages';
import {
  getCurrentStageLabel,
  getJobsForUser,
  type AiJob,
} from '../../stores/aiJobStore';
import {
  getUploadJobsForUser,
  type NoteUploadJob,
} from '../../stores/noteUploadStore';

function statusOfAiJob(job: AiJob): CreationStatus {
  if (job.status === 'succeeded') return 'done';
  // 'orphaned' is a run the client lost track of, NOT a failure — the server
  // may well have finished it. It belongs under Failed rather than Done
  // because the student has to do something about it, and its detail line says
  // which of the two it is.
  if (job.status === 'failed' || job.status === 'orphaned') return 'failed';
  return 'processing';
}

function statusOfUploadJob(job: NoteUploadJob): CreationStatus {
  if (job.status === 'complete') return 'done';
  if (job.status === 'failed') return 'failed';
  return 'processing';
}

/**
 * One list, newest first, from both stores.
 *
 * An upload job whose generation run has already started is dropped: the AI job
 * carries the same title and is further along, and two rows for one import
 * would make the count in the header badge wrong.
 */
export function toCreationEntries(
  aiJobs: readonly AiJob[],
  uploadJobs: readonly NoteUploadJob[],
  userId: string | null | undefined
): CreationEntry[] {
  const mine = getJobsForUser([...aiJobs], userId).filter((job) => !job.dismissed);
  const titles = new Set(mine.map((job) => job.title.trim().toLowerCase()));

  const fromAi: CreationEntry[] = mine.map((job) => ({
    id: job.id,
    title: job.title || 'Untitled',
    status: statusOfAiJob(job),
    detail: job.error || getCurrentStageLabel(job),
    route: job.resultRef?.route ?? job.target?.path,
    updatedAt: job.updatedAt,
  }));

  const fromUploads: CreationEntry[] = getUploadJobsForUser([...uploadJobs], userId)
    .filter((job) => !job.dismissed)
    .filter((job) => !titles.has(job.fileName.trim().toLowerCase()))
    .map((job) => ({
      id: job.id,
      title: job.fileName,
      status: statusOfUploadJob(job),
      detail: job.error || job.label,
      route: job.noteId ? `/notes/${job.noteId}` : undefined,
      updatedAt: job.updatedAt,
    }));

  return [...fromAi, ...fromUploads].sort((a, b) => b.updatedAt - a.updatedAt);
}
