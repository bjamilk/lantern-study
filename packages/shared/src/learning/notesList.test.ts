import { noteIsOwned, noteMatchesListView } from './notesList';

describe('notesList view', () => {
  it('treats a missing role as owned', () => {
    expect(noteIsOwned({})).toBe(true);
    expect(noteIsOwned({ accessRole: 'owner' })).toBe(true);
    expect(noteIsOwned({ accessRole: 'editor' })).toBe(false);
  });

  it('keeps archived notes out of Mine and Shared', () => {
    const archivedMine = { accessRole: 'owner' as const, isArchived: true };
    expect(noteMatchesListView(archivedMine, 'mine')).toBe(false);
    expect(noteMatchesListView(archivedMine, 'shared')).toBe(false);
    expect(noteMatchesListView(archivedMine, 'archived')).toBe(true);
  });

  it('splits active notes by ownership', () => {
    expect(noteMatchesListView({ accessRole: 'owner' }, 'mine')).toBe(true);
    expect(noteMatchesListView({ accessRole: 'viewer' }, 'mine')).toBe(false);
    expect(noteMatchesListView({ accessRole: 'editor' }, 'shared')).toBe(true);
    expect(noteMatchesListView({ accessRole: 'owner' }, 'shared')).toBe(false);
  });
});
