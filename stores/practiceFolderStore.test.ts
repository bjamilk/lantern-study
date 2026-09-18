/**
 * The optimistic rules, and the one that is easy to get wrong.
 *
 * A failed move must roll the overlay back to what it WAS — which may be
 * `undefined` ("no local opinion, read the server's value"), not `null`
 * ("unfiled"). Writing null there silently unfiles an item whose move merely
 * failed, and nothing on screen says so: the card simply leaves the folder and
 * stays out until the next refetch agrees with it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiCreate = vi.fn();
const apiRename = vi.fn();
const apiDelete = vi.fn();
const apiMove = vi.fn();
const apiFetch = vi.fn();

vi.mock('../services/academic', () => ({
  createPracticeFolder: (...args: unknown[]) => apiCreate(...args),
  renamePracticeFolder: (...args: unknown[]) => apiRename(...args),
  deletePracticeFolder: (...args: unknown[]) => apiDelete(...args),
  movePracticeItem: (...args: unknown[]) => apiMove(...args),
  fetchPracticeFolders: (...args: unknown[]) => apiFetch(...args),
}));

const { usePracticeFolderStore, folderIdFor, withPracticeFolders } = await import(
  './practiceFolderStore'
);

const SET = 'set-1';
const folder = (id: string, title: string, itemCount = 0) => ({
  id,
  studySetId: SET,
  title,
  itemCount,
  createdAt: '2026-09-18T00:00:00.000Z',
  updatedAt: '2026-09-18T00:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  usePracticeFolderStore.getState().reset();
});

describe('the capability', () => {
  it('starts UNKNOWN, not false, so the first paint does not flash an empty folder row', () => {
    expect(usePracticeFolderStore.getState().supported).toBeNull();
  });

  it('settles to whatever the server said', async () => {
    apiFetch.mockResolvedValue({ supported: true, folders: [folder('f1', 'Week 1')] });
    await usePracticeFolderStore.getState().loadFolders(SET);
    expect(usePracticeFolderStore.getState().supported).toBe(true);
    expect(usePracticeFolderStore.getState().folders).toHaveLength(1);
  });

  it('is false, with no folders, when the migration is unapplied', async () => {
    apiFetch.mockResolvedValue({ supported: false, folders: [] });
    await usePracticeFolderStore.getState().loadFolders(SET);
    expect(usePracticeFolderStore.getState().supported).toBe(false);
    expect(usePracticeFolderStore.getState().folders).toEqual([]);
  });

  it('clears the previous set BEFORE fetching, so one room never shows another\'s folders', async () => {
    apiFetch.mockResolvedValue({ supported: true, folders: [folder('f1', 'Week 1')] });
    await usePracticeFolderStore.getState().loadFolders(SET);

    let release: (value: unknown) => void = () => {};
    apiFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = usePracticeFolderStore.getState().loadFolders('set-2');

    expect(usePracticeFolderStore.getState().folders).toEqual([]);
    expect(usePracticeFolderStore.getState().supported).toBeNull();
    release({ supported: true, folders: [] });
    await pending;
  });
});

describe('rename', () => {
  beforeEach(async () => {
    apiFetch.mockResolvedValue({ supported: true, folders: [folder('f1', 'Week 1')] });
    await usePracticeFolderStore.getState().loadFolders(SET);
  });

  it('shows the new name before the server answers', async () => {
    let release: (value: unknown) => void = () => {};
    apiRename.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = usePracticeFolderStore.getState().renameFolder(SET, 'f1', 'Week 2');

    expect(usePracticeFolderStore.getState().folders[0]?.title).toBe('Week 2');
    release(undefined);
    await pending;
  });

  it('rolls back to the EXACT previous title on failure', async () => {
    apiRename.mockRejectedValue(new Error('nope'));
    const ok = await usePracticeFolderStore.getState().renameFolder(SET, 'f1', 'Week 2');
    expect(ok).toBe(false);
    expect(usePracticeFolderStore.getState().folders[0]?.title).toBe('Week 1');
  });

  it('sends exactly what it showed, so the card does not change under the student', async () => {
    apiRename.mockResolvedValue(undefined);
    await usePracticeFolderStore.getState().renameFolder(SET, 'f1', '   Week 2   ');
    expect(apiRename).toHaveBeenCalledWith(SET, 'f1', 'Week 2');
    expect(usePracticeFolderStore.getState().folders[0]?.title).toBe('Week 2');
  });
});

describe('delete', () => {
  beforeEach(async () => {
    apiFetch.mockResolvedValue({ supported: true, folders: [folder('f1', 'Week 1', 2)] });
    await usePracticeFolderStore.getState().loadFolders(SET);
  });

  it('unfiles every local move into the folder, so nothing vanishes from both places', async () => {
    apiMove.mockResolvedValue(undefined);
    await usePracticeFolderStore.getState().moveItem(SET, 't1', 'f1');
    apiDelete.mockResolvedValue(undefined);

    await usePracticeFolderStore.getState().removeFolder(SET, 'f1');

    // Without this the overlay still says "in f1" while f1 is gone: the item
    // is in no folder card (deleted) and not at the top level (still filed).
    expect(usePracticeFolderStore.getState().moves.t1).toBeNull();
  });

  it('puts the folder back on failure', async () => {
    apiDelete.mockRejectedValue(new Error('nope'));
    const ok = await usePracticeFolderStore.getState().removeFolder(SET, 'f1');
    expect(ok).toBe(false);
    expect(usePracticeFolderStore.getState().folders.map((row) => row.id)).toEqual(['f1']);
  });
});

describe('move', () => {
  it('files the item before the server answers', async () => {
    let release: (value: unknown) => void = () => {};
    apiMove.mockReturnValue(new Promise((resolve) => (release = resolve)));
    const pending = usePracticeFolderStore.getState().moveItem(SET, 't1', 'f1');

    expect(usePracticeFolderStore.getState().moves.t1).toBe('f1');
    release(undefined);
    await pending;
  });

  it('rolls back to NO OPINION — not null — when there was none before', async () => {
    // The bug this pins: rolling back to null would unfile an item whose move
    // merely failed, and `folderIdFor` would then stop reading the server's
    // value for it.
    apiMove.mockRejectedValue(new Error('nope'));
    const ok = await usePracticeFolderStore.getState().moveItem(SET, 't1', 'f1');

    expect(ok).toBe(false);
    expect('t1' in usePracticeFolderStore.getState().moves).toBe(false);
  });

  it('rolls back to the previous OVERLAY value when there was one', async () => {
    apiMove.mockResolvedValue(undefined);
    await usePracticeFolderStore.getState().moveItem(SET, 't1', 'f1');

    apiMove.mockRejectedValue(new Error('nope'));
    await usePracticeFolderStore.getState().moveItem(SET, 't1', 'f2');

    expect(usePracticeFolderStore.getState().moves.t1).toBe('f1');
  });

  it('unfiles with null, which is a real value and not a rollback', async () => {
    apiMove.mockResolvedValue(undefined);
    await usePracticeFolderStore.getState().moveItem(SET, 't1', null);
    expect(usePracticeFolderStore.getState().moves.t1).toBeNull();
    expect(apiMove).toHaveBeenCalledWith(SET, 't1', null);
  });
});

describe('reading the overlay over the server value', () => {
  it('prefers a local move to the server\'s value', () => {
    expect(folderIdFor({ id: 't1', practiceFolderId: 'f1' }, { t1: 'f2' })).toBe('f2');
    expect(folderIdFor({ id: 't1', practiceFolderId: 'f1' }, { t1: null })).toBeNull();
  });

  it('falls through to the server\'s value with no local opinion', () => {
    expect(folderIdFor({ id: 't1', practiceFolderId: 'f1' }, {})).toBe('f1');
  });

  it('keeps ABSENT absent, so a pre-migration row stays pre-migration', () => {
    // If this returned null the hub would treat a database with no folder
    // column as one where every item is simply unfiled.
    expect(folderIdFor({ id: 't1' }, {})).toBeUndefined();
    expect(withPracticeFolders([{ id: 't1' }], {})[0]).not.toHaveProperty('practiceFolderId');
  });

  it('applies the overlay to a list without touching the untouched rows', () => {
    const rows = [
      { id: 't1', practiceFolderId: null },
      { id: 't2', practiceFolderId: 'f1' },
    ];
    expect(withPracticeFolders(rows, { t1: 'f2' })).toEqual([
      { id: 't1', practiceFolderId: 'f2' },
      { id: 't2', practiceFolderId: 'f1' },
    ]);
  });
});
