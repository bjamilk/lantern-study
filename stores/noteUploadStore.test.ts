/**
 * The upload tray's owner rules (#144).
 *
 * The bug this guards: the tray is ONE persisted list per browser, and its
 * records used to carry no owner and the store no reset. On a shared campus
 * machine the next student signing in saw the last one's file names —
 * "Pharmacology exam paper.pdf" is not a title anybody else should read.
 *
 * Two invariants, both of which fail silently rather than loudly:
 *  - every read is filtered by the signed-in student, and signing out clears
 *    the list rather than leaving it hydrated for the next account (web logout
 *    is an SPA transition with no reload);
 *  - a row written by a build BEFORE this one has no `userId` and can never be
 *    attributed, so it is dropped on load rather than shown to whoever is
 *    signed in now.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  getActiveUploadJob,
  getUploadJobsForUser,
  getVisibleUploadJobs,
  reconcilePersistedJobs,
  useNoteUploadStore,
  type NoteUploadJob,
} from './noteUploadStore';

const row = (over: Partial<NoteUploadJob> = {}): NoteUploadJob => ({
  id: 'up-1',
  userId: 'ada',
  fileName: 'Pharmacology.pdf',
  kind: 'pdf',
  status: 'uploading',
  label: 'Preparing PDF…',
  startedAt: 0,
  updatedAt: 5,
  dismissed: false,
  ...over,
});

beforeEach(() => {
  useNoteUploadStore.setState({ jobs: [] });
});

describe('startJob', () => {
  it('stamps the student who started the upload', () => {
    const id = useNoteUploadStore.getState().startJob('Slides.pptx', 'presentation', 'ada');
    const job = useNoteUploadStore.getState().jobs.find((j) => j.id === id);
    expect(job?.userId).toBe('ada');
  });

  it('leaves the owner empty when nobody is signed in, and that row is invisible', () => {
    const id = useNoteUploadStore.getState().startJob('Slides.pptx', 'presentation', null);
    const jobs = useNoteUploadStore.getState().jobs;
    expect(jobs.find((j) => j.id === id)?.userId).toBe('');
    expect(getUploadJobsForUser(jobs, 'ada')).toEqual([]);
  });
});

describe('reading the tray', () => {
  it('shows one student their own rows and none of the others', () => {
    const jobs = [row({ id: 'mine', userId: 'ada' }), row({ id: 'theirs', userId: 'grace' })];

    expect(getUploadJobsForUser(jobs, 'ada').map((j) => j.id)).toEqual(['mine']);
    expect(getVisibleUploadJobs(jobs, 'ada').map((j) => j.id)).toEqual(['mine']);
    expect(getActiveUploadJob(jobs, 'ada')?.id).toBe('mine');
  });

  it('shows a signed-out reader nothing at all', () => {
    const jobs = [row({ id: 'mine', userId: 'ada' })];

    expect(getUploadJobsForUser(jobs, null)).toEqual([]);
    expect(getVisibleUploadJobs(jobs, undefined)).toEqual([]);
    expect(getActiveUploadJob(jobs, '')).toBeUndefined();
  });

  it('never matches an ownerless row, whoever is asking', () => {
    const jobs = [row({ id: 'legacy', userId: '' })];

    expect(getUploadJobsForUser(jobs, 'ada')).toEqual([]);
    expect(getActiveUploadJob(jobs, 'ada')).toBeUndefined();
  });
});

describe('sign-out', () => {
  it('leaves nothing for the next student — an upload holds no unsynced work', () => {
    useNoteUploadStore.setState({
      jobs: [
        row({ id: 'running', userId: 'ada', status: 'uploading' }),
        row({ id: 'done', userId: 'ada', status: 'complete' }),
      ],
    });

    useNoteUploadStore.getState().reset();

    expect(useNoteUploadStore.getState().jobs).toEqual([]);
    expect(getVisibleUploadJobs(useNoteUploadStore.getState().jobs, 'grace')).toEqual([]);
  });
});

describe('reconcilePersistedJobs (what a reload keeps)', () => {
  it('drops the rows a build before #144 wrote, rather than showing them', () => {
    const kept = reconcilePersistedJobs([
      // No owner: written before this shipped, and unattributable now.
      { ...row({ id: 'legacy' }), userId: '' },
      row({ id: 'owned', userId: 'ada', status: 'complete' }),
    ]);

    expect(kept.map((j) => j.id)).toEqual(['owned']);
  });

  it('still marks an owned in-flight row as interrupted', () => {
    const kept = reconcilePersistedJobs([
      row({ id: 'owned', userId: 'ada', status: 'uploading', updatedAt: 1 }),
    ]);

    expect(kept[0]?.status).toBe('failed');
  });
});

describe('dismissAllFinished', () => {
  it("touches only the asking student's own finished rows", () => {
    useNoteUploadStore.setState({
      jobs: [
        row({ id: 'mine', userId: 'ada', status: 'complete' }),
        row({ id: 'theirs', userId: 'grace', status: 'complete' }),
      ],
    });

    useNoteUploadStore.getState().dismissAllFinished('ada');

    const byId = Object.fromEntries(
      useNoteUploadStore.getState().jobs.map((j) => [j.id, j.dismissed])
    );
    expect(byId.mine).toBe(true);
    expect(byId.theirs).toBe(false);
  });
});
