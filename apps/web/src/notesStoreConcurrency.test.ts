/**
 * notesStore autosave optimistic-concurrency (item 1).
 *
 * The note editor autosaves title/body. Those saves must carry the note's
 * current `version` so the server can detect a cross-user overwrite (409
 * version_conflict) — but a user's OWN rapid autosaves must never 409 against
 * themselves, which means each save has to read the freshest version the
 * previous save merged into the store. On a genuine conflict the store reloads
 * the authoritative note and bumps conflictReloadToken so the editor can show it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/notes', () => ({
  updateNote: vi.fn(),
  fetchNote: vi.fn(),
}));

import * as notesApi from '../../../services/notes';
import { useNotesStore } from '../../../stores/notesStore';

const updateNoteMock = notesApi.updateNote as unknown as ReturnType<typeof vi.fn>;
const fetchNoteMock = notesApi.fetchNote as unknown as ReturnType<typeof vi.fn>;

const makeNote = (over: Record<string, unknown> = {}) => ({
  id: 'n',
  userId: 'u1',
  title: 'T',
  body: 'B',
  sourceType: 'typed' as const,
  version: 1,
  createdAt: 't0',
  updatedAt: 't0',
  ...over,
});

beforeEach(() => {
  useNotesStore.getState().reset();
  updateNoteMock.mockReset();
  fetchNoteMock.mockReset();
});

describe('notesStore.saveNote optimistic concurrency', () => {
  it('threads the freshest version into each autosave (no self-conflict)', async () => {
    const note = makeNote({ id: 'nA', version: 1 });
    useNotesStore.setState({ notes: [note], selectedNote: note as any });
    // Server echoes the write back with the version bumped, as the real API does.
    updateNoteMock.mockImplementation(async (_id: string, updates: any) =>
      makeNote({ id: 'nA', ...updates, version: (updates.version ?? 0) + 1 }),
    );

    await useNotesStore.getState().saveNote('nA', { body: 'B1' });
    expect(updateNoteMock).toHaveBeenLastCalledWith(
      'nA',
      expect.objectContaining({ body: 'B1', version: 1 }),
    );
    expect(useNotesStore.getState().selectedNote?.version).toBe(2);

    // The next autosave must send version 2 — the value the first save merged in.
    await useNotesStore.getState().saveNote('nA', { body: 'B2' });
    expect(updateNoteMock).toHaveBeenLastCalledWith(
      'nA',
      expect.objectContaining({ body: 'B2', version: 2 }),
    );
    expect(useNotesStore.getState().selectedNote?.version).toBe(3);
  });

  it('does not attach a version to pin/archive saves (single-column, no CAS)', async () => {
    const note = makeNote({ id: 'nD', version: 3 });
    useNotesStore.setState({ notes: [note], selectedNote: note as any });
    updateNoteMock.mockResolvedValue(makeNote({ id: 'nD', version: 3, isPinned: true }));

    await useNotesStore.getState().saveNote('nD', { isPinned: true });
    expect(updateNoteMock).toHaveBeenLastCalledWith('nD', { isPinned: true });
  });

  it('on a 409 conflict, reloads the authoritative note and bumps conflictReloadToken', async () => {
    const note = makeNote({ id: 'nB', version: 1, body: 'local-old' });
    useNotesStore.setState({ notes: [note], selectedNote: note as any });
    updateNoteMock.mockRejectedValue(
      Object.assign(new Error('Note was updated elsewhere. Refresh and try again.'), {
        code: 'version_conflict',
        current: null,
      }),
    );
    fetchNoteMock.mockResolvedValue(makeNote({ id: 'nB', version: 5, body: 'server-new' }));

    const tokenBefore = useNotesStore.getState().conflictReloadToken;
    await expect(
      useNotesStore.getState().saveNote('nB', { body: 'local-typed' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    expect(fetchNoteMock).toHaveBeenCalledWith('nB');
    const state = useNotesStore.getState();
    expect(state.selectedNote?.body).toBe('server-new');
    expect(state.selectedNote?.version).toBe(5);
    expect(state.conflictReloadToken).toBe(tokenBefore + 1);
  });

  it('uses the authoritative note carried on the 409 body without a second fetch', async () => {
    const note = makeNote({ id: 'nC', version: 1 });
    useNotesStore.setState({ notes: [note], selectedNote: note as any });
    updateNoteMock.mockRejectedValue(
      Object.assign(new Error('Note was updated elsewhere.'), {
        code: 'version_conflict',
        current: makeNote({ id: 'nC', version: 9, body: 'from-error-body' }),
      }),
    );

    await expect(
      useNotesStore.getState().saveNote('nC', { body: 'x' }),
    ).rejects.toMatchObject({ code: 'version_conflict' });

    expect(fetchNoteMock).not.toHaveBeenCalled();
    expect(useNotesStore.getState().selectedNote?.body).toBe('from-error-body');
    expect(useNotesStore.getState().selectedNote?.version).toBe(9);
  });
});
