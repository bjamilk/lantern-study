/**
 * The set's plan, its "last studied" stamp, and deleting it.
 *
 * All three were phone-local before: the plan was re-derived from note titles
 * so a topic ticked on a laptop came back unticked, nothing ever posted
 * `/touch` so a set studied only on the phone had no last-studied date, and a
 * deleted set left the "reopen this one" pointer aimed at it.
 */
import type { StudySet } from '@lantern/shared/types';
import type { StudySetTopic, StudySetUnit } from '@lantern/shared/learning';

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
const deleteStudySet = jest.fn();
const touchStudySet = jest.fn();
const fetchStudySetPlan = jest.fn();
const replaceStudySetPlan = jest.fn();
const updateStudySetTopicStatus = jest.fn();
const fetchStudySetFolders = jest.fn();

jest.mock('../services/academic', () => ({
  fetchMyStudySets: (...a: unknown[]) => fetchMyStudySets(...a),
  createStudySet: jest.fn(),
  updateStudySet: jest.fn(),
  deleteStudySet: (...a: unknown[]) => deleteStudySet(...a),
  touchStudySet: (...a: unknown[]) => touchStudySet(...a),
  fetchStudySetPlan: (...a: unknown[]) => fetchStudySetPlan(...a),
  replaceStudySetPlan: (...a: unknown[]) => replaceStudySetPlan(...a),
  updateStudySetTopicStatus: (...a: unknown[]) => updateStudySetTopicStatus(...a),
  fetchStudySetFolders: (...a: unknown[]) => fetchStudySetFolders(...a),
}));

jest.mock('./authStore', () => ({
  useAuthStore: { getState: () => ({ user: { id: 'user-1' } }) },
}));

import { useStudySetStore, __resetStudySetInflightForTests } from './studySetStore';

const SET: StudySet = { id: 's1', title: 'Anatomy' } as StudySet;
const UNIT: StudySetUnit = { id: 'u1', studySetId: 's1', title: 'Unit 1', position: 1 };
const topic = (id: string, status: StudySetTopic['status'] = 'unseen'): StudySetTopic => ({
  id,
  studySetId: 's1',
  unitId: 'u1',
  title: `Topic ${id}`,
  position: 1,
  status,
  sourceNoteIds: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  for (const key of Object.keys(memory)) delete memory[key];
  __resetStudySetInflightForTests();
  useStudySetStore.setState({
    sets: [SET],
    loaded: true,
    status: 'ready',
    fromCache: false,
    syncedAt: '2026-09-12T09:00:00.000Z',
    lastOpenedId: 's1',
    plans: {},
    folders: [],
  });
});

describe('plan sync', () => {
  it('reads the server plan rather than deriving one', async () => {
    fetchStudySetPlan.mockResolvedValueOnce({ units: [UNIT], topics: [topic('t1', 'covered')] });
    const plan = await useStudySetStore.getState().loadPlan('s1');
    expect(fetchStudySetPlan).toHaveBeenCalledWith('s1');
    expect(plan.loaded).toBe(true);
    expect(plan.topics[0].status).toBe('covered');
    expect(useStudySetStore.getState().plans.s1.units).toEqual([UNIT]);
  });

  // "We could not ask" must not read as "this set has no plan" — that is what
  // sends the room back to building a local plan over a real saved one.
  it('does not claim an empty plan when the fetch fails', async () => {
    fetchStudySetPlan.mockRejectedValueOnce(new Error('Network request failed'));
    const plan = await useStudySetStore.getState().loadPlan('s1');
    expect(plan.loaded).toBe(false);
    expect(plan.topics).toEqual([]);
  });

  it('keeps a plan already held when a later fetch fails', async () => {
    fetchStudySetPlan.mockResolvedValueOnce({ units: [UNIT], topics: [topic('t1')] });
    await useStudySetStore.getState().loadPlan('s1');
    fetchStudySetPlan.mockRejectedValueOnce(new Error('offline'));
    const plan = await useStudySetStore.getState().loadPlan('s1');
    expect(plan.loaded).toBe(true);
    expect(plan.topics).toHaveLength(1);
  });

  it('replaces the plan with what the server saved, not what was sent', async () => {
    replaceStudySetPlan.mockResolvedValueOnce({
      units: [UNIT],
      topics: [topic('server-t1')],
    });
    const plan = await useStudySetStore.getState().savePlan('s1', {
      units: [{ title: 'Unit 1', position: 1 }],
      topics: [{ unitIndex: 0, title: 'Topic', position: 1, status: 'unseen', sourceNoteIds: [] }],
    });
    expect(plan.topics[0].id).toBe('server-t1');
    expect(useStudySetStore.getState().plans.s1.loaded).toBe(true);
  });

  it('ticks a topic optimistically and rolls back a refused write', async () => {
    fetchStudySetPlan.mockResolvedValueOnce({ units: [UNIT], topics: [topic('t1')] });
    await useStudySetStore.getState().loadPlan('s1');

    updateStudySetTopicStatus.mockResolvedValueOnce({});
    await useStudySetStore.getState().setTopicStatus('s1', 't1', 'covered');
    expect(updateStudySetTopicStatus).toHaveBeenCalledWith('s1', 't1', 'covered');
    expect(useStudySetStore.getState().plans.s1.topics[0].status).toBe('covered');

    updateStudySetTopicStatus.mockRejectedValueOnce(new Error('nope'));
    await expect(
      useStudySetStore.getState().setTopicStatus('s1', 't1', 'mastered')
    ).rejects.toThrow('nope');
    expect(useStudySetStore.getState().plans.s1.topics[0].status).toBe('covered');
  });
});

describe('touch', () => {
  it('tells the server the set was opened and keeps the stamp locally', async () => {
    touchStudySet.mockResolvedValueOnce({ ...SET, lastStudiedAt: '2026-09-12T10:00:00.000Z' });
    await useStudySetStore.getState().touchSet('s1');
    expect(touchStudySet).toHaveBeenCalledWith('s1');
    expect(useStudySetStore.getState().sets[0].lastStudiedAt).toBe('2026-09-12T10:00:00.000Z');
  });

  // Quiet, but NOT empty-handed. Home reads "last studied" off this row, and a
  // student who opened the set on a dead connection still opened the set.
  it('is quiet when the stamp cannot be posted, and keeps the local stamp', async () => {
    const before = Date.now();
    touchStudySet.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(useStudySetStore.getState().touchSet('s1')).resolves.toBeUndefined();
    const stamped = useStudySetStore.getState().sets[0].lastStudiedAt;
    expect(typeof stamped).toBe('string');
    expect(Date.parse(stamped as string)).toBeGreaterThanOrEqual(before);
  });

  it('stamps the local row before the server answers', async () => {
    let release: (value: unknown) => void = () => undefined;
    touchStudySet.mockReturnValueOnce(new Promise((resolve) => {
      release = resolve;
    }));
    const pending = useStudySetStore.getState().touchSet('s1');
    expect(useStudySetStore.getState().sets[0].lastStudiedAt).toBeTruthy();
    release({ ...SET, lastStudiedAt: '2026-09-12T10:00:00.000Z' });
    await pending;
    expect(useStudySetStore.getState().sets[0].lastStudiedAt).toBe('2026-09-12T10:00:00.000Z');
  });

  it('does not post for an empty id', async () => {
    await useStudySetStore.getState().touchSet('  ');
    expect(touchStudySet).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('drops the set, its plan, and the pointer at it', async () => {
    fetchStudySetPlan.mockResolvedValueOnce({ units: [UNIT], topics: [topic('t1')] });
    await useStudySetStore.getState().loadPlan('s1');
    deleteStudySet.mockResolvedValueOnce(undefined);

    await useStudySetStore.getState().removeSet('s1');

    expect(deleteStudySet).toHaveBeenCalledWith('s1');
    expect(useStudySetStore.getState().sets).toEqual([]);
    expect(useStudySetStore.getState().plans.s1).toBeUndefined();
    expect(useStudySetStore.getState().lastOpenedId).toBeNull();
  });

  it('leaves the pointer alone when a different set is deleted', async () => {
    useStudySetStore.setState({ sets: [SET, { id: 's2', title: 'Biochem' } as StudySet] });
    deleteStudySet.mockResolvedValueOnce(undefined);
    await useStudySetStore.getState().removeSet('s2');
    expect(useStudySetStore.getState().lastOpenedId).toBe('s1');
    expect(useStudySetStore.getState().sets.map((row) => row.id)).toEqual(['s1']);
  });

  it('keeps the set when the server refuses the delete', async () => {
    deleteStudySet.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(useStudySetStore.getState().removeSet('s1')).rejects.toThrow('Forbidden');
    expect(useStudySetStore.getState().sets).toHaveLength(1);
  });
});

describe('folders', () => {
  it('loads folders and survives a failure with what it had', async () => {
    fetchStudySetFolders.mockResolvedValueOnce([{ id: 'f1', userId: 'user-1', title: 'Year 1', createdAt: '' }]);
    expect(await useStudySetStore.getState().loadFolders()).toHaveLength(1);
    fetchStudySetFolders.mockRejectedValueOnce(new Error('offline'));
    expect(await useStudySetStore.getState().loadFolders()).toHaveLength(1);
  });
});
