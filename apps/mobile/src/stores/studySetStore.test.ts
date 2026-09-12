/**
 * Home's set list must never confuse "we could not ask" with "you have none".
 *
 * An offline cold start showed a student with four sets the empty-library
 * invitation, and neither pull-to-refresh nor reconnect brought the list back.
 * These cover the four states the card renders off.
 */
import type { StudySet } from '@lantern/shared/types';

const memory: Record<string, string> = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => memory[k] ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    memory[k] = v;
  }),
  removeItem: jest.fn(async (k: string) => {
    delete memory[k];
  }),
}));

const fetchMyStudySets = jest.fn();
jest.mock('../services/academic', () => ({
  fetchMyStudySets: (...args: unknown[]) => fetchMyStudySets(...args),
  createStudySet: jest.fn(),
  updateStudySet: jest.fn(),
  deleteStudySet: jest.fn(),
}));

jest.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

import {
  useStudySetStore,
  studySetCacheKey,
  looksOffline,
  __resetStudySetInflightForTests,
} from './studySetStore';

const SETS: StudySet[] = [
  { id: 's1', title: 'Anatomy' } as StudySet,
  { id: 's2', title: 'Biochem' } as StudySet,
];

const seedCache = (sets: StudySet[]) => {
  memory[studySetCacheKey('user-1')] = JSON.stringify({
    sets,
    syncedAt: '2026-09-11T10:00:00.000Z',
  });
};

const coldStart = () => {
  useStudySetStore.setState({
    sets: [],
    loaded: false,
    status: 'loading',
    fromCache: false,
    syncedAt: null,
    lastOpenedId: null,
  });
};

beforeEach(() => {
  for (const key of Object.keys(memory)) delete memory[key];
  fetchMyStudySets.mockReset();
  __resetStudySetInflightForTests();
  coldStart();
});

describe('loadSets cold start', () => {
  it('hydrates from cache and reports offline, not an empty library', async () => {
    seedCache(SETS);
    fetchMyStudySets.mockRejectedValue(new Error('Network request failed'));

    const result = await useStudySetStore.getState().loadSets();

    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
    const state = useStudySetStore.getState();
    expect(state.sets).toHaveLength(2);
    expect(state.status).toBe('offline');
    expect(state.fromCache).toBe(true);
    // The card's empty-library branch is gated on `ready`, so this can never
    // render "Level up your library" over four real sets.
    expect(state.status === 'ready' && state.sets.length === 0).toBe(false);
  });

  it('reports error, not offline, when the server refused', async () => {
    fetchMyStudySets.mockRejectedValue(new Error('Forbidden'));
    await useStudySetStore.getState().loadSets();
    expect(useStudySetStore.getState().status).toBe('error');
    expect(useStudySetStore.getState().sets).toHaveLength(0);
  });

  it('caches a successful list for the next cold start', async () => {
    fetchMyStudySets.mockResolvedValue(SETS);
    await useStudySetStore.getState().loadSets();
    const raw = memory[studySetCacheKey('user-1')];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw).sets.map((s: StudySet) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('refresh failures', () => {
  it('keeps the cached list when a forced refresh fails', async () => {
    fetchMyStudySets.mockResolvedValueOnce(SETS);
    await useStudySetStore.getState().loadSets();
    expect(useStudySetStore.getState().status).toBe('ready');

    fetchMyStudySets.mockRejectedValueOnce(new Error('Network request failed'));
    __resetStudySetInflightForTests();
    await useStudySetStore.getState().loadSets({ force: true });

    const state = useStudySetStore.getState();
    expect(state.sets.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(state.status).toBe('offline');
  });
});

describe('a real empty library', () => {
  it('reports ready with zero sets when the server answered "none"', async () => {
    fetchMyStudySets.mockResolvedValue([]);
    await useStudySetStore.getState().loadSets();
    const state = useStudySetStore.getState();
    expect(state.sets).toEqual([]);
    expect(state.status).toBe('ready');
    expect(state.fromCache).toBe(false);
  });
});

describe('notifyReconnected', () => {
  it('refetches after an offline load and lands on the live list', async () => {
    seedCache(SETS);
    fetchMyStudySets.mockRejectedValueOnce(new Error('Network request failed'));
    await useStudySetStore.getState().loadSets();
    expect(useStudySetStore.getState().status).toBe('offline');

    const fresh = [...SETS, { id: 's3', title: 'Physiology' } as StudySet];
    fetchMyStudySets.mockResolvedValueOnce(fresh);
    __resetStudySetInflightForTests();
    await useStudySetStore.getState().notifyReconnected();

    const state = useStudySetStore.getState();
    expect(fetchMyStudySets).toHaveBeenCalledTimes(2);
    expect(state.sets.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(state.status).toBe('ready');
    expect(state.fromCache).toBe(false);
  });

  it('does not refetch when this session already holds a live list', async () => {
    fetchMyStudySets.mockResolvedValueOnce(SETS);
    await useStudySetStore.getState().loadSets();
    __resetStudySetInflightForTests();
    await useStudySetStore.getState().notifyReconnected();
    expect(fetchMyStudySets).toHaveBeenCalledTimes(1);
  });
});

describe('looksOffline', () => {
  it('separates transport failures from server refusals', () => {
    expect(looksOffline(new Error('Network request failed'))).toBe(true);
    expect(looksOffline(new Error('Request timed out'))).toBe(true);
    expect(looksOffline(new Error('Forbidden'))).toBe(false);
    expect(looksOffline(new Error('Study set not found'))).toBe(false);
  });
});
