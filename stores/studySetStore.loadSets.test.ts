/**
 * Study's first paint must not stay on the skeleton after the list request
 * fails. A 429 or a dropped proxy used to leave `loaded` false forever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudySet } from '@lantern/shared';

const memory: Record<string, string> = {};

vi.stubGlobal('localStorage', {
  getItem: (key: string) => memory[key] ?? null,
  setItem: (key: string, value: string) => {
    memory[key] = value;
  },
  removeItem: (key: string) => {
    delete memory[key];
  },
});

const fetchMyStudySets = vi.fn();
vi.mock('../services/academic', () => ({
  fetchMyStudySets: (...args: unknown[]) => fetchMyStudySets(...args),
  createStudySet: vi.fn(),
  createStudySetFolder: vi.fn(),
  deleteStudySet: vi.fn(),
  deleteStudySetFolder: vi.fn(),
  fetchStudySetFolders: vi.fn(async () => []),
  touchStudySet: vi.fn(),
  updateStudySet: vi.fn(),
}));

vi.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ currentUser: { id: 'user-1' } }) },
}));

const { useStudySetStore, studySetCacheKey, __resetStudySetInflightForTests } = await import(
  './studySetStore'
);

const SETS = [{ id: 's1', title: 'Anatomy' } as StudySet];

const coldStart = () => {
  useStudySetStore.setState({
    sets: [],
    loaded: false,
    loading: false,
    loadError: null,
    lastOpenedId: null,
  });
};

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
  fetchMyStudySets.mockReset();
  __resetStudySetInflightForTests();
  coldStart();
});

describe('web loadSets', () => {
  it('records a load error instead of leaving the list loading forever', async () => {
    fetchMyStudySets.mockRejectedValue(new Error('Too Many Requests'));

    await expect(useStudySetStore.getState().loadSets()).rejects.toThrow('Too Many Requests');

    const state = useStudySetStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.loadError).toBe('Too Many Requests');
    expect(state.sets).toEqual([]);
  });

  it('keeps the cached list on screen when the refresh fails', async () => {
    memory[studySetCacheKey('user-1')] = JSON.stringify({
      sets: SETS,
      syncedAt: '2026-09-13T00:00:00.000Z',
    });
    fetchMyStudySets.mockRejectedValue(new Error('Too Many Requests'));

    await expect(useStudySetStore.getState().loadSets()).rejects.toThrow('Too Many Requests');

    const state = useStudySetStore.getState();
    expect(state.sets.map((row) => row.id)).toEqual(['s1']);
    expect(state.loaded).toBe(false);
    expect(state.loadError).toBe('Too Many Requests');
  });

  it('clears the error after a successful retry', async () => {
    fetchMyStudySets.mockRejectedValueOnce(new Error('Too Many Requests'));
    await expect(useStudySetStore.getState().loadSets()).rejects.toThrow('Too Many Requests');

    fetchMyStudySets.mockResolvedValueOnce(SETS);
    const rows = await useStudySetStore.getState().loadSets({ force: true });

    expect(rows.map((row) => row.id)).toEqual(['s1']);
    const state = useStudySetStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loadError).toBeNull();
  });
});
