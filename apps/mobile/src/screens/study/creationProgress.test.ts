/**
 * The phone's Creation Progress rows.
 *
 * The rule worth pinning is the one that goes wrong silently: rows are filtered
 * BY OWNER, because the job list is per device, not per student. The tab
 * filtering itself is shared and tested in
 * `packages/shared/src/utils/importStages.test.ts` — what this proves is that
 * the phone's five status words land on the right three.
 */
import { filterCreations } from '@lantern/shared/utils/importStages';
import type { TrackedJob } from '../../stores/jobsCore';
import { toCreationEntries } from './creationProgress';

const job = (over: Partial<TrackedJob> = {}): TrackedJob =>
  ({
    id: 'job-1',
    userId: 'me',
    kind: 'import',
    sourceTitle: 'Lecture 1',
    status: 'running',
    startedAt: 0,
    updatedAt: 10,
    ...over,
  }) as TrackedJob;

describe('toCreationEntries', () => {
  it('shows only the rows this account owns', () => {
    const rows = toCreationEntries(
      [job({ id: 'a' }), job({ id: 'b', userId: 'someone-else' })],
      'me'
    );
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('shows nothing when nobody is signed in', () => {
    expect(toCreationEntries([job()], undefined)).toEqual([]);
  });

  it('maps the five status words the phone uses onto the three tabs', () => {
    const rows = toCreationEntries(
      [
        job({ id: 'queued', status: 'queued' }),
        job({ id: 'running', status: 'running' }),
        job({ id: 'done', status: 'done' }),
        job({ id: 'failed', status: 'failed', error: 'AI is offline' }),
        job({ id: 'lost', status: 'lost' }),
      ],
      'me'
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.queued.status).toBe('processing');
    expect(byId.running.status).toBe('processing');
    expect(byId.done.status).toBe('done');
    expect(byId.failed.status).toBe('failed');
    expect(byId.failed.detail).toBe('AI is offline');
    // Not 'done': the server may have finished it, but the student still has to
    // do something, and the row says which of the two it is.
    expect(byId.lost.status).toBe('failed');
    expect(byId.lost.detail).toBe('Still running on our servers');
  });

  it('shows the server stage while a job runs', () => {
    const rows = toCreationEntries([job({ stage: 'Writing quiz questions' })], 'me');
    expect(rows[0].detail).toBe('Writing quiz questions');
  });

  it('feeds the shared tab filter', () => {
    const rows = toCreationEntries(
      [job({ id: 'a', status: 'running' }), job({ id: 'b', status: 'done' })],
      'me'
    );
    expect(filterCreations(rows, 'processing').map((r) => r.id)).toEqual(['a']);
    expect(filterCreations(rows, 'done').map((r) => r.id)).toEqual(['b']);
  });
});
