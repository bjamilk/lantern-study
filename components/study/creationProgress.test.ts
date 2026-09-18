/**
 * The Creation Progress list, from the two stores that already hold it.
 *
 * The two rules worth pinning are the ones that go wrong silently: rows are
 * filtered BY OWNER (`aiJobStore`'s list is persisted per browser, not per
 * student), and one import must not appear twice — once as an upload and once
 * as the generation job that took it over — or the header badge's count is
 * wrong.
 */
import { describe, expect, it } from 'vitest';

import { filterCreations, type CreationEntry } from '@lantern/shared/utils/importStages';
import type { AiJob } from '../../stores/aiJobStore';
import type { NoteUploadJob } from '../../stores/noteUploadStore';
import { toCreationEntries } from './creationProgress';

/** Index a result list by id, failing loudly rather than returning undefined. */
const byId = (rows: CreationEntry[], id: string): CreationEntry => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`no creation row "${id}"`);
  return row;
};

const aiJob = (over: Partial<AiJob> = {}): AiJob =>
  ({
    id: 'job-1',
    userId: 'me',
    kind: 'import_study',
    title: 'Lecture 1',
    stages: ['Reading your material', 'Writing Smart Notes'],
    stageIndex: 0,
    stageStartedAt: 0,
    status: 'running',
    startedAt: 0,
    updatedAt: 10,
    budgetUntil: 0,
    creditCost: 1,
    dismissed: false,
    notified: false,
    ...over,
  }) as AiJob;

const uploadJob = (over: Partial<NoteUploadJob> = {}): NoteUploadJob => ({
  id: 'up-1',
  fileName: 'Slides.pptx',
  kind: 'presentation',
  status: 'uploading',
  label: 'Preparing slides…',
  startedAt: 0,
  updatedAt: 5,
  dismissed: false,
  ...over,
});

describe('toCreationEntries', () => {
  it('shows only the generation jobs belonging to the signed-in student', () => {
    const rows = toCreationEntries(
      [aiJob({ id: 'a', userId: 'me' }), aiJob({ id: 'b', userId: 'someone-else' })],
      [],
      'me'
    );
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  it('shows nothing at all when nobody is signed in', () => {
    expect(toCreationEntries([aiJob()], [], undefined)).toEqual([]);
  });

  it('maps the three status words each store uses onto the three tabs', () => {
    const rows = toCreationEntries(
      [
        aiJob({ id: 'running', status: 'running' }),
        aiJob({ id: 'ok', title: 'A', status: 'succeeded' }),
        aiJob({ id: 'bad', title: 'B', status: 'failed', error: 'AI is offline' }),
        // Orphaned is not a failure of the server's — but the student has to do
        // something about it, so it belongs with Failed and says which it is.
        aiJob({ id: 'lost', title: 'C', status: 'orphaned' }),
      ],
      [],
      'me'
    );
    expect(byId(rows, 'running').status).toBe('processing');
    expect(byId(rows, 'ok').status).toBe('done');
    expect(byId(rows, 'bad').status).toBe('failed');
    expect(byId(rows, 'bad').detail).toBe('AI is offline');
    expect(byId(rows, 'lost').status).toBe('failed');
    expect(byId(rows, 'lost').detail).toBe('Still running on our servers');
  });

  it('includes an upload that has no generation job yet', () => {
    const rows = toCreationEntries([], [uploadJob()], 'me');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Slides.pptx');
    expect(rows[0]?.status).toBe('processing');
  });

  it('does not list one import twice once its generation job exists', () => {
    const rows = toCreationEntries(
      [aiJob({ id: 'job', title: 'Slides.pptx' })],
      [uploadJob({ fileName: 'slides.pptx' })],
      'me'
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('job');
  });

  it('drops dismissed rows from both stores', () => {
    const rows = toCreationEntries(
      [aiJob({ dismissed: true })],
      [uploadJob({ dismissed: true })],
      'me'
    );
    expect(rows).toEqual([]);
  });

  it('carries a route only when the artefact exists', () => {
    const rows = toCreationEntries(
      [
        aiJob({ id: 'a', title: 'A', resultRef: { type: 'deck', id: 'd1', route: '/flashcards/deck/d1' } }),
        aiJob({ id: 'b', title: 'B' }),
      ],
      [],
      'me'
    );
    expect(byId(rows, 'a').route).toBe('/flashcards/deck/d1');
    expect(byId(rows, 'b').route).toBeUndefined();
  });

  it('feeds the shared tab filter', () => {
    const rows = toCreationEntries(
      [aiJob({ id: 'a', status: 'running' }), aiJob({ id: 'b', title: 'B', status: 'succeeded' })],
      [],
      'me'
    );
    expect(filterCreations(rows, 'processing').map((r) => r.id)).toEqual(['a']);
    expect(filterCreations(rows, 'done').map((r) => r.id)).toEqual(['b']);
  });
});
