// @vitest-environment jsdom
/**
 * The staged import modal, the completion fork and the Creation Progress
 * popover, as a student meets them.
 *
 * What is pinned here is what would rot silently:
 *  - the three cards exist and carry the state the pipeline reported, with the
 *    middle one showing NO progress bar (the server reports none, and a bar
 *    there would be invented);
 *  - a failure lands on its own card, with the real message and a Retry;
 *  - the fork's second card is the plan when there is one and the set's home
 *    when there is not — never a dead "View study plan";
 *  - the popover's tabs filter, and its empty state is the reference's line.
 */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const aiJobs: unknown[] = [];
const uploadJobs: unknown[] = [];

vi.mock('../../stores/aiJobStore', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    useAiJobStore: (selector: (state: { jobs: unknown[] }) => unknown) =>
      selector({ jobs: aiJobs }),
  };
});

vi.mock('../../stores/noteUploadStore', () => ({
  useNoteUploadStore: (selector: (state: { jobs: unknown[] }) => unknown) =>
    selector({ jobs: uploadJobs }),
  // The mapper filters uploads by owner (#144), so the mock has to carry the
  // selector it calls, not only the hook.
  getUploadJobsForUser: (jobs: { userId?: string }[], userId: string | null | undefined) =>
    userId ? jobs.filter((job) => Boolean(job.userId) && job.userId === userId) : [],
}));

vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (state: { currentUser: { id: string } }) => unknown) =>
    selector({ currentUser: { id: 'me' } }),
}));

import { emptyImportRunState } from '@lantern/shared/utils/importStages';
import { ImportStages, WhereNextFork } from './ImportProgress';
import CreationProgressButton from './CreationProgressButton';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  aiJobs.length = 0;
  uploadJobs.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const render = (node: React.ReactElement) => act(() => root.render(node));

const stage = (id: string) =>
  container.querySelector<HTMLElement>(`[data-testid="import-stage-${id}"]`);

const buttonNamed = (label: RegExp) =>
  Array.from(container.querySelectorAll('button')).find((b) => label.test(b.textContent || ''));

describe('ImportStages', () => {
  it('draws three cards, named for the kind and for what will be generated', () => {
    render(<ImportStages state={emptyImportRunState('pdf', ['flashcards', 'quiz'])} />);
    expect(container.textContent).toContain('Importing PDF');
    expect(container.textContent).toContain("We're reading it and creating your study materials");
    expect(stage('uploaded')).toBeTruthy();
    expect(stage('processing')?.textContent).toContain('Processing material');
    expect(stage('generating')?.textContent).toContain('Generating flashcards and quiz');
  });

  it('shows a bar for the upload and never one for the server read', () => {
    render(
      <ImportStages
        state={{
          ...emptyImportRunState('pdf'),
          upload: { phase: 'uploading', percent: 37 },
        }}
      />
    );
    expect(stage('uploaded')?.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe(
      '37'
    );

    render(
      <ImportStages
        state={{
          ...emptyImportRunState('pdf'),
          upload: { phase: 'processing', percent: 100 },
        }}
      />
    );
    expect(stage('processing')?.dataset.status).toBe('active');
    // The guard against a fabricated "Processing Progress" bar.
    expect(stage('processing')?.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('gives a range instead of a countdown', () => {
    render(<ImportStages state={emptyImportRunState('youtube', ['quiz'], false)} />);
    expect(container.textContent).toContain('A video takes longer than a document');
    expect(container.textContent).not.toMatch(/remaining/i);
  });

  it('lands a failure on the card that broke, with a Retry', () => {
    const onRetry = vi.fn();
    render(
      <ImportStages
        state={{
          ...emptyImportRunState('pdf'),
          upload: { phase: 'complete', percent: 100 },
          failure: { stage: 'processing', message: 'No text could be read out of this PDF.' },
        }}
        onRetry={onRetry}
      />
    );
    expect(stage('uploaded')?.dataset.status).toBe('done');
    expect(stage('processing')?.dataset.status).toBe('failed');
    expect(stage('processing')?.textContent).toContain('No text could be read out of this PDF.');
    expect(stage('generating')?.dataset.status).toBe('pending');

    const retry = buttonNamed(/Retry/);
    expect(retry).toBeTruthy();
    act(() => {
      retry!.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides the wait hint and the background button once it has failed', () => {
    render(
      <ImportStages
        state={{
          ...emptyImportRunState('pdf'),
          failure: { stage: 'uploaded', message: 'Upload failed — check your connection.' },
        }}
        onBackground={vi.fn()}
      />
    );
    expect(container.textContent).not.toContain('This usually takes');
    expect(buttonNamed(/Continue in background/)).toBeUndefined();
  });
});

describe('WhereNextFork', () => {
  it('offers the plan when the set has one', () => {
    const onViewPlan = vi.fn();
    render(
      <WhereNextFork onViewMaterial={vi.fn()} onViewPlan={onViewPlan} onOpenSetHome={vi.fn()} />
    );
    expect(container.textContent).toContain('Where would you like to go next?');
    expect(container.textContent).toContain('You can always switch later.');
    expect(container.querySelector('[data-testid="where-next-material"]')?.textContent).toContain(
      'Recommended'
    );
    const plan = container.querySelector<HTMLButtonElement>('[data-testid="where-next-plan"]');
    expect(plan).toBeTruthy();
    act(() => plan!.click());
    expect(onViewPlan).toHaveBeenCalled();
  });

  it('offers the set home instead when it does not — never a dead plan door', () => {
    render(<WhereNextFork onViewMaterial={vi.fn()} onOpenSetHome={vi.fn()} />);
    expect(container.querySelector('[data-testid="where-next-plan"]')).toBeNull();
    expect(container.querySelector('[data-testid="where-next-setHome"]')?.textContent).toContain(
      'Set home'
    );
  });
});

describe('CreationProgressButton', () => {
  const openPopover = () => {
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="creation-progress-button"]'
    );
    act(() => button!.click());
  };

  it('is labelled, not a bare glyph', () => {
    render(<CreationProgressButton />);
    const button = container.querySelector('[data-testid="creation-progress-button"]');
    expect(button?.getAttribute('aria-label')).toBe('Creation progress');
  });

  it('counts the in-flight runs in its badge and its accessible name', () => {
    aiJobs.push(
      { id: 'a', userId: 'me', title: 'Lecture 1', stages: ['Reading'], stageIndex: 0, status: 'running', updatedAt: 2, dismissed: false },
      { id: 'b', userId: 'me', title: 'Lecture 2', stages: ['Reading'], stageIndex: 0, status: 'succeeded', updatedAt: 1, dismissed: false }
    );
    render(<CreationProgressButton />);
    const button = container.querySelector('[data-testid="creation-progress-button"]');
    expect(button?.getAttribute('aria-label')).toBe('Creation progress — 1 still processing');
    expect(button?.textContent).toContain('1');
  });

  it('shows the empty state when there is nothing to report', () => {
    render(<CreationProgressButton />);
    openPopover();
    expect(container.textContent).toContain('No recent creations');
    expect(container.textContent).toContain('0 processing, 0 done');
  });

  it('filters by tab', () => {
    aiJobs.push(
      { id: 'a', userId: 'me', title: 'Running one', stages: ['Reading'], stageIndex: 0, status: 'running', updatedAt: 2, dismissed: false },
      { id: 'b', userId: 'me', title: 'Finished one', stages: ['Reading'], stageIndex: 0, status: 'succeeded', updatedAt: 1, dismissed: false },
      { id: 'c', userId: 'me', title: 'Broken one', stages: ['Reading'], stageIndex: 0, status: 'failed', error: 'AI is offline', updatedAt: 3, dismissed: false }
    );
    render(<CreationProgressButton />);
    openPopover();

    const list = () =>
      container.querySelector('[data-testid="creation-progress-popover"]')!.textContent || '';
    const tab = (name: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (b) => b.textContent === name
      )!;

    expect(list()).toContain('Running one');
    expect(list()).toContain('Finished one');

    act(() => tab('processing').click());
    expect(list()).toContain('Running one');
    expect(list()).not.toContain('Finished one');

    act(() => tab('failed').click());
    expect(list()).toContain('Broken one');
    expect(list()).toContain('AI is offline');
    expect(list()).not.toContain('Running one');

    act(() => tab('done').click());
    expect(list()).toContain('Finished one');
    expect(list()).not.toContain('Broken one');
  });
});
