/**
 * The rules a Practice folder's two clients must not re-derive.
 *
 * The one that matters most is the absent-vs-null rule on
 * `practiceFolderId`: 20260918120000 is hand-applied, and a client that reads
 * `undefined` as "unfiled" would empty every folder card on the day between
 * the deploy and the migration. Every other assertion here exists so the hub,
 * the breadcrumb and mobile print the same words over the same rows.
 */
import {
  PRACTICE_FOLDER_MIGRATION,
  PRACTICE_FOLDER_TITLE_MAX,
  isValidPracticeFolderTitle,
  normalizePracticeFolderTitle,
  practiceFolderMeta,
  practiceItemsInFolder,
  practiceItemsUnfiled,
  type PracticeFiledItem,
} from './practiceFolders';

const item = (id: string, practiceFolderId?: string | null): PracticeFiledItem =>
  practiceFolderId === undefined ? { id } : { id, practiceFolderId };

describe('filing', () => {
  const rows = [
    item('a', 'f1'),
    item('b', null),
    item('c', 'f2'),
    item('d', 'f1'),
  ];

  it('puts each item in exactly the folder it names', () => {
    expect(practiceItemsInFolder(rows, 'f1').map((row) => row.id)).toEqual(['a', 'd']);
    expect(practiceItemsInFolder(rows, 'f2').map((row) => row.id)).toEqual(['c']);
  });

  it('leaves the unfiled ones at the top level, and only those', () => {
    expect(practiceItemsUnfiled(rows).map((row) => row.id)).toEqual(['b']);
  });

  it('holds quizzes and tests together — one folder, both doors', () => {
    // The quiz/test split is derived on the client and is orthogonal to the
    // folder, so nothing here may partition by door.
    const mixed = [item('quiz-1', 'f1'), item('test-1', 'f1')];
    expect(practiceItemsInFolder(mixed, 'f1')).toHaveLength(2);
  });
});

describe('the absent-vs-null rule', () => {
  /**
   * A row read from a database WITHOUT the column carries no
   * `practiceFolderId` at all. That is "folders are not available here", not
   * "this item is unfiled" — but both must stay OUT of every folder, because
   * pre-migration there are no folders to be in.
   */
  it('treats a row with no field as in no folder', () => {
    const rows = [item('legacy')];
    expect(practiceItemsInFolder(rows, 'f1')).toEqual([]);
    expect(practiceItemsUnfiled(rows).map((row) => row.id)).toEqual(['legacy']);
  });

  it('never matches a folder by an absent or null value', () => {
    // `practiceItemsInFolder(rows, undefined as never)` must not collect the
    // rows that have no folder: the identity comparison is what prevents it.
    const rows = [item('legacy'), item('unfiled', null)];
    expect(practiceItemsInFolder(rows, null as never)).toEqual([]);
    expect(practiceItemsInFolder(rows, undefined as never)).toEqual([]);
  });
});

describe('titles', () => {
  it('accepts a real title and refuses blank or whitespace', () => {
    expect(isValidPracticeFolderTitle('Week 1')).toBe(true);
    expect(isValidPracticeFolderTitle('')).toBe(false);
    expect(isValidPracticeFolderTitle('   ')).toBe(false);
  });

  it('refuses one past the length the server CHECK enforces', () => {
    expect(isValidPracticeFolderTitle('x'.repeat(PRACTICE_FOLDER_TITLE_MAX))).toBe(true);
    expect(isValidPracticeFolderTitle('x'.repeat(PRACTICE_FOLDER_TITLE_MAX + 1))).toBe(false);
  });

  it('normalises to exactly what the server will store, so the optimistic card matches', () => {
    expect(normalizePracticeFolderTitle('  Week 1  ')).toBe('Week 1');
    expect(normalizePracticeFolderTitle('x'.repeat(200))).toHaveLength(
      PRACTICE_FOLDER_TITLE_MAX,
    );
  });
});

describe('the card meta line', () => {
  it('pluralises, because "1 items" is the kind of thing a founder screenshots', () => {
    expect(practiceFolderMeta(0)).toBe('Folder · 0 items');
    expect(practiceFolderMeta(1)).toBe('Folder · 1 item');
    expect(practiceFolderMeta(2)).toBe('Folder · 2 items');
  });
});

describe('the migration name', () => {
  it('is the file a 503 tells the operator to apply', () => {
    expect(PRACTICE_FOLDER_MIGRATION).toBe('20260918120000_practice_folders.sql');
  });
});
