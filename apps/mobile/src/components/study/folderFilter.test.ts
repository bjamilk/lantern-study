/**
 * The Study hub's folder rules.
 *
 * The cases that matter are the ones a screen cannot show you: a chip left
 * pointing at a folder someone deleted on another device, a set whose
 * `folderId` is the empty string rather than null (which is what a cleared
 * field looks like coming back off the cache), and a move that empties the
 * folder the student is standing in.
 */
import type { StudySetFolder } from '@lantern/shared/types';
import {
  ALL_FOLDERS,
  emptyFolderLine,
  filterByFolder,
  folderChips,
  folderCounts,
  folderLabel,
  FOLDER_TITLE_MAX,
  isValidFolderTitle,
  movedMessage,
  moveTargets,
  normalizeFolderTitle,
  resolveFolderSelection,
  selectedFolderLabel,
  selectionAfterMove,
} from './folderFilter';

function folder(id: string, title: string): StudySetFolder {
  return { id, userId: 'u1', title, createdAt: '2026-09-01T00:00:00.000Z' };
}

const FOLDERS = [folder('f1', 'Semester 1'), folder('f2', 'Finals')];

describe('folder titles', () => {
  it('collapses whitespace and trims', () => {
    expect(normalizeFolderTitle('  Semester   1  ')).toBe('Semester 1');
  });

  it('clips to the length the server accepts', () => {
    const long = 'x'.repeat(FOLDER_TITLE_MAX + 40);
    expect(normalizeFolderTitle(long)).toHaveLength(FOLDER_TITLE_MAX);
    expect(isValidFolderTitle(long)).toBe(true);
  });

  it('rejects a name that is only whitespace', () => {
    expect(isValidFolderTitle('   ')).toBe(false);
    expect(isValidFolderTitle('')).toBe(false);
    expect(isValidFolderTitle(' A ')).toBe(true);
  });
});

describe('resolveFolderSelection', () => {
  it('keeps a selection whose folder still exists', () => {
    expect(resolveFolderSelection('f2', FOLDERS)).toBe('f2');
  });

  it('falls back to All when the folder is gone', () => {
    // Deleted on the laptop while the phone still held the chip. Without this
    // the hub filters to zero sets behind a chip it no longer draws.
    expect(resolveFolderSelection('deleted-elsewhere', FOLDERS)).toBe(ALL_FOLDERS);
  });

  it('treats null, undefined and blank as All', () => {
    expect(resolveFolderSelection(null, FOLDERS)).toBe(ALL_FOLDERS);
    expect(resolveFolderSelection(undefined, FOLDERS)).toBe(ALL_FOLDERS);
    expect(resolveFolderSelection('   ', FOLDERS)).toBe(ALL_FOLDERS);
  });

  it('falls back to All when no folders have loaded yet', () => {
    expect(resolveFolderSelection('f1', [])).toBe(ALL_FOLDERS);
  });
});

describe('folderChips', () => {
  it('leads with All and marks exactly one chip on', () => {
    const chips = folderChips(FOLDERS, 'f1');
    expect(chips.map((chip) => chip.id)).toEqual([ALL_FOLDERS, 'f1', 'f2']);
    expect(chips.map((chip) => chip.label)).toEqual(['All', 'Semester 1', 'Finals']);
    expect(chips.filter((chip) => chip.selected)).toHaveLength(1);
    expect(chips.find((chip) => chip.selected)?.id).toBe('f1');
  });

  it('selects All when the remembered folder is gone', () => {
    const chips = folderChips(FOLDERS, 'f9');
    expect(chips.find((chip) => chip.selected)?.id).toBe(ALL_FOLDERS);
  });

  it('labels a blank-titled folder rather than drawing an unreadable chip', () => {
    const chips = folderChips([folder('f3', '   ')], ALL_FOLDERS);
    expect(chips[1].label).toBe('Untitled folder');
    expect(folderLabel(null)).toBe('Untitled folder');
  });

  it('is just All when there are no folders', () => {
    expect(folderChips([], ALL_FOLDERS)).toEqual([
      { id: ALL_FOLDERS, label: 'All', selected: true },
    ]);
  });
});

describe('filterByFolder', () => {
  const rows = [
    { id: 's1', folderId: 'f1' },
    { id: 's2', folderId: null },
    { id: 's3', folderId: 'f2' },
    { id: 's4' },
    { id: 's5', folderId: '' },
  ];

  it('returns everything under All, in the order given', () => {
    expect(filterByFolder(rows, ALL_FOLDERS, FOLDERS).map((row) => row.id)).toEqual([
      's1',
      's2',
      's3',
      's4',
      's5',
    ]);
  });

  it('keeps only the folder members', () => {
    expect(filterByFolder(rows, 'f1', FOLDERS).map((row) => row.id)).toEqual(['s1']);
  });

  it('never files an unfiled set under a folder', () => {
    // null, absent and '' are all "unfiled" — the '' case is what a cleared
    // column looks like coming back off the cached list.
    for (const selection of ['f1', 'f2']) {
      const ids = filterByFolder(rows, selection, FOLDERS).map((row) => row.id);
      expect(ids).not.toContain('s2');
      expect(ids).not.toContain('s4');
      expect(ids).not.toContain('s5');
    }
  });

  it('does not mutate the input', () => {
    const input = [...rows];
    filterByFolder(input, 'f1', FOLDERS);
    expect(input).toHaveLength(rows.length);
  });

  it('still honours the selection before the folder list has arrived', () => {
    // Folders load after the sets do. During that gap there is nothing to
    // validate the id against, so the filter trusts it rather than resolving
    // every selection to All and flashing the full list for one frame.
    expect(filterByFolder(rows, 'f1', []).map((row) => row.id)).toEqual(['s1']);
    expect(filterByFolder(rows, ALL_FOLDERS, []).map((row) => row.id)).toHaveLength(rows.length);
  });
});

describe('folderCounts', () => {
  it('counts each folder and pools the unfiled under All', () => {
    const counts = folderCounts([
      { folderId: 'f1' },
      { folderId: 'f1' },
      { folderId: null },
      {},
      { folderId: '' },
    ]);
    expect(counts).toEqual({ f1: 2, [ALL_FOLDERS]: 3 });
  });
});

describe('moveTargets', () => {
  it('always offers No folder first, and ticks the current home', () => {
    const targets = moveTargets(FOLDERS, 'f2');
    expect(targets.map((target) => target.label)).toEqual(['No folder', 'Semester 1', 'Finals']);
    expect(targets[0].folderId).toBeNull();
    expect(targets.filter((target) => target.current)).toHaveLength(1);
    expect(targets.find((target) => target.current)?.folderId).toBe('f2');
  });

  it('ticks No folder for an unfiled set', () => {
    for (const current of [null, undefined, '']) {
      expect(moveTargets(FOLDERS, current)[0].current).toBe(true);
    }
  });

  it('still offers No folder when there are no folders at all', () => {
    expect(moveTargets([], null)).toEqual([
      { folderId: null, label: 'No folder', current: true },
    ]);
  });
});

describe('movedMessage', () => {
  it('names the destination', () => {
    expect(movedMessage({ folderId: 'f1', label: 'Semester 1', current: false })).toBe(
      'Moved to Semester 1.'
    );
    expect(movedMessage({ folderId: null, label: 'No folder', current: false })).toBe(
      'Removed from its folder.'
    );
  });
});

describe('selectionAfterMove', () => {
  it('follows the set out of the folder you were standing in', () => {
    expect(
      selectionAfterMove('f1', { folderId: 'f2', label: 'Finals', current: false })
    ).toBe('f2');
    expect(selectionAfterMove('f1', { folderId: null, label: 'No folder', current: false })).toBe(
      ALL_FOLDERS
    );
  });

  it('leaves All alone — nothing vanished', () => {
    expect(
      selectionAfterMove(ALL_FOLDERS, { folderId: 'f2', label: 'Finals', current: false })
    ).toBe(ALL_FOLDERS);
  });
});

describe('the empty-folder line', () => {
  it('is drawn only inside a folder', () => {
    expect(emptyFolderLine(FOLDERS, ALL_FOLDERS)).toBeNull();
    expect(emptyFolderLine(FOLDERS, 'f1')).toContain('Semester 1');
    expect(selectedFolderLabel(FOLDERS, 'f1')).toBe('Semester 1');
    expect(selectedFolderLabel(FOLDERS, ALL_FOLDERS)).toBeNull();
  });

  it('says nothing for a folder that is already gone', () => {
    expect(emptyFolderLine(FOLDERS, 'f9')).toBeNull();
  });
});
