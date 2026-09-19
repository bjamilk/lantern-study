/**
 * The sign-out reset registry (F1 / E3 H14).
 *
 * The bug this guards: web logout is an SPA transition with no page reload, and
 * the teardown was a hand-maintained list of four `reset()` calls inside
 * `handleLogout`. It had drifted — testStore, flashcardStore, notesStore and
 * aiJobStore were never reset — so on a shared browser the previous student's
 * decks, flashcards, notes and test results stayed hydrated and RENDERED for
 * whoever signed in next. These tests pin the registry's membership (the thing
 * that drifts) and the two invariants: everything user-scoped is reset, and
 * unsynced work is not destroyed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory[key] ?? null,
  setItem: (key: string, value: string) => {
    memory[key] = value;
  },
  removeItem: (key: string) => {
    delete memory[key];
  },
  clear: () => {
    for (const key of Object.keys(memory)) delete memory[key];
  },
  key: (i: number) => Object.keys(memory)[i] ?? null,
  get length() {
    return Object.keys(memory).length;
  },
});

import { USER_SCOPED_STORE_RESETS, resetAllUserScopedStores } from './userScopedStoreReset';
import { useTestStore } from './testStore';
import { useFlashcardStore } from './flashcardStore';
import { useNotesStore } from './notesStore';
import { useAiJobStore } from './aiJobStore';
import { useNoteUploadStore } from './noteUploadStore';
import { getLatestAIUsage } from '../services/ai';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('registry membership', () => {
  it('covers every store the logout list used to miss', () => {
    const names = USER_SCOPED_STORE_RESETS.map((entry) => entry.name);
    for (const required of [
      'budgetStore',
      'studyGoalsStore',
      'academicStore',
      'libraryStore',
      'testStore',
      'flashcardStore',
      'notesStore',
      'aiJobStore',
      'noteUploadStore',
      'aiUsage',
    ]) {
      expect(names).toContain(required);
    }
  });

  it('registers each store only once', () => {
    const names = USER_SCOPED_STORE_RESETS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('resetAllUserScopedStores', () => {
  it('clears the four stores logout used to leave hydrated', () => {
    useTestStore.setState({ testResults: [{ id: 'r1' } as never] });
    useFlashcardStore.setState({ decks: [{ id: 'd1' } as never] });
    useNotesStore.setState({ notes: [{ id: 'n1' } as never] });

    resetAllUserScopedStores();

    expect(useTestStore.getState().testResults).toEqual([]);
    expect(useFlashcardStore.getState().decks).toEqual([]);
    expect(useNotesStore.getState().notes).toEqual([]);
  });

  it('drops finished AI jobs but keeps one still running (the student was charged for it)', () => {
    const now = Date.now();
    const base = {
      userId: 'a',
      kind: 'flashcards',
      title: 'x',
      stages: ['Working…'],
      stageIndex: 0,
      stageStartedAt: now,
      startedAt: now,
      updatedAt: now,
      budgetUntil: now + 90_000,
      creditCost: 1,
      dismissed: false,
      notified: false,
    };
    useAiJobStore.setState({
      jobs: [
        { ...base, id: 'done', status: 'succeeded' },
        { ...base, id: 'live', status: 'running' },
      ] as never,
    });

    resetAllUserScopedStores();

    const ids = useAiJobStore.getState().jobs.map((job) => job.id);
    expect(ids).toEqual(['live']);
  });

  // #144: unlike an AI job, an upload costs no credit and holds no generated
  // work, so there is nothing to keep — and a file name left on a shared
  // browser is the leak this registry exists to close.
  it('empties the upload tray, running rows included', () => {
    useNoteUploadStore.setState({
      jobs: [
        { id: 'up-1', userId: 'a', status: 'uploading' },
        { id: 'up-2', userId: 'a', status: 'complete' },
      ] as never,
    });

    resetAllUserScopedStores();

    expect(useNoteUploadStore.getState().jobs).toEqual([]);
  });

  it('puts the AI usage mirror back to the honest unknown', () => {
    resetAllUserScopedStores();
    expect(getLatestAIUsage().limit).toBe(0);
    expect(getLatestAIUsage().remaining).toBe(0);
  });

  it('never throws, and still runs later entries, when one reset fails', () => {
    const failing = USER_SCOPED_STORE_RESETS[0];
    const original = failing.reset;
    const after = vi.fn();
    failing.reset = () => {
      throw new Error('boom');
    };
    USER_SCOPED_STORE_RESETS.push({ name: 'probe', reset: after });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      expect(() => resetAllUserScopedStores()).not.toThrow();
      expect(after).toHaveBeenCalledTimes(1);
    } finally {
      failing.reset = original;
      USER_SCOPED_STORE_RESETS.pop();
    }
  });

  it('leaves the offline queues alone — unsynced work must survive a sign-out', () => {
    localStorage.setItem('pendingSyncResults', '[{"id":"pending"}]');
    localStorage.setItem('lantern_offline_owner', 'user-a');

    resetAllUserScopedStores();

    expect(localStorage.getItem('pendingSyncResults')).toBe('[{"id":"pending"}]');
    expect(localStorage.getItem('lantern_offline_owner')).toBe('user-a');
  });

  // F9: the other half of the same rule. A downloaded bundle is content the
  // next account can fetch again, not work the student would lose, and leaving
  // it behind handed the previous student's bundles to whoever signed in next —
  // `useTestStore` reads this key at construction and in `initFromStorage`.
  it('removes the downloaded offline bundles, which are not unsynced work', () => {
    localStorage.setItem('offlineBundles', '[{"id":"bundle-a"}]');

    resetAllUserScopedStores();

    expect(localStorage.getItem('offlineBundles')).toBeNull();
    expect(useTestStore.getState().offlineBundles).toEqual([]);
  });
});
