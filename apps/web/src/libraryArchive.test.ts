import { describe, expect, it } from 'vitest';
import {
  UNFILED_COURSE_ID,
  UNTOPICED_TOPIC_ID,
  buildFolderTree,
  buildLibraryTree,
  countsTotal,
  courseTopicRows,
  filterBundlesByCourse,
  findTreeCourse,
  findTreeTopic,
  folderParentOptions,
  folderScopeIds,
  groupLibrarySearchResults,
  isPurchasedBundleId,
  isSearchableQuery,
  isUntopicedFilter,
  matchesCourseFilter,
  matchesTopicFilter,
  searchMatchLabel,
} from '../../../utils/libraryArchive';
import type {
  Course,
  LibraryCourseCounts,
  LibraryCourseNode,
  LibraryOverview,
  LibrarySearchResult,
  LibraryTopicNode,
  NoteFolder,
  UserCourse,
} from '../../../types';

const course = (id: string, code: string, title = code): Course => ({
  id,
  institutionId: 'inst-1',
  code,
  title,
  isCanonical: false,
});

const enrolment = (c: Course, academicYear: string, status: 'active' | 'archived' = 'active'): UserCourse => ({
  course: c,
  academicYear,
  status,
});

const node = (
  c: Course,
  academicYear: string,
  status: 'active' | 'archived',
  counts: Partial<LibraryCourseNode['counts']> = {}
): LibraryCourseNode => ({
  course: c,
  enrolment: enrolment(c, academicYear, status),
  counts: { notes: 0, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0, ...counts },
});

const bio = course('c-bio', 'BIO 201', 'Cell Biology');
const chm = course('c-chm', 'CHM 101', 'General Chemistry');
const mth = course('c-mth', 'MTH 101', 'Calculus');

describe('matchesCourseFilter', () => {
  it('null filter matches everything', () => {
    expect(matchesCourseFilter('c-bio', null)).toBe(true);
    expect(matchesCourseFilter(null, null)).toBe(true);
    expect(matchesCourseFilter(undefined, undefined)).toBe(true);
  });

  it("the 'null' literal matches only items without a course", () => {
    expect(matchesCourseFilter(null, UNFILED_COURSE_ID)).toBe(true);
    expect(matchesCourseFilter(undefined, UNFILED_COURSE_ID)).toBe(true);
    expect(matchesCourseFilter('c-bio', UNFILED_COURSE_ID)).toBe(false);
  });

  it('a uuid matches only that course', () => {
    expect(matchesCourseFilter('c-bio', 'c-bio')).toBe(true);
    expect(matchesCourseFilter('c-chm', 'c-bio')).toBe(false);
    expect(matchesCourseFilter(null, 'c-bio')).toBe(false);
  });
});

describe('buildLibraryTree', () => {
  const overview: LibraryOverview = {
    years: [
      {
        academicYear: '2026/2027',
        courses: [
          node(bio, '2026/2027', 'active', { notes: 3, decks: 1, tests: 2, bundles: 1, purchasedPacks: 1 }),
          node(chm, '2026/2027', 'active', { notes: 1 }),
          node(mth, '2026/2027', 'archived', { decks: 2 }),
        ],
      },
      {
        academicYear: '2025/2026',
        courses: [
          node(bio, '2025/2026', 'archived', { notes: 4 }),
          node(mth, '2025/2026', 'archived', { tests: 1 }),
        ],
      },
      { academicYear: '2024/2025', courses: [] },
    ],
    unfiled: { notes: 2, decks: 0, tests: 1, bundles: 3 },
  };

  it('splits active enrolments from archived ones grouped by year (newest first)', () => {
    const tree = buildLibraryTree(overview);
    expect(tree.current.map((n) => n.course.code)).toEqual(['BIO 201', 'CHM 101']);
    expect(tree.past.map((y) => y.academicYear)).toEqual(['2026/2027', '2025/2026']);
    expect(tree.past[0]!.courses.map((n) => n.course.code)).toEqual(['MTH 101']);
    expect(tree.past[1]!.courses.map((n) => n.course.code)).toEqual(['BIO 201', 'MTH 101']);
  });

  it('drops years with no archived courses from "past" and keeps unfiled counts', () => {
    const tree = buildLibraryTree(overview);
    expect(tree.past.find((y) => y.academicYear === '2024/2025')).toBeUndefined();
    expect(tree.unfiled).toEqual({ notes: 2, decks: 0, tests: 1, bundles: 3 });
  });

  it('totals every course (active + archived) plus unfiled', () => {
    const tree = buildLibraryTree(overview);
    expect(tree.totals).toEqual({ notes: 3 + 1 + 4 + 2, decks: 1 + 2 + 0, tests: 2 + 1 + 1, bundles: 1 + 3 });
  });

  it('keeps only the newest active sighting of a course in "this semester"', () => {
    const dup: LibraryOverview = {
      years: [
        { academicYear: '2026/2027', courses: [node(bio, '2026/2027', 'active', { notes: 1 })] },
        { academicYear: '2025/2026', courses: [node(bio, '2025/2026', 'active', { notes: 9 })] },
      ],
      unfiled: { notes: 0, decks: 0, tests: 0, bundles: 0 },
    };
    const tree = buildLibraryTree(dup);
    expect(tree.current).toHaveLength(1);
    expect(tree.current[0]!.enrolment.academicYear).toBe('2026/2027');
  });

  it('tolerates a missing overview', () => {
    const tree = buildLibraryTree(null);
    expect(tree.current).toEqual([]);
    expect(tree.past).toEqual([]);
    expect(tree.totals).toEqual({ notes: 0, decks: 0, tests: 0, bundles: 0 });
  });

  it('finds courses in either section and sums counts', () => {
    const tree = buildLibraryTree(overview);
    expect(findTreeCourse(tree, 'c-chm')?.course.code).toBe('CHM 101');
    expect(findTreeCourse(tree, 'c-mth')?.enrolment.status).toBe('archived');
    expect(findTreeCourse(tree, UNFILED_COURSE_ID)).toBeNull();
    expect(findTreeCourse(tree, 'nope')).toBeNull();
    expect(countsTotal(tree.current[0]!.counts)).toBe(7);
    expect(countsTotal(null)).toBe(0);
  });
});

describe('matchesTopicFilter', () => {
  it('null filter matches every item in the course', () => {
    expect(matchesTopicFilter('t-1', null)).toBe(true);
    expect(matchesTopicFilter(null, null)).toBe(true);
    expect(matchesTopicFilter(undefined, undefined)).toBe(true);
  });

  it("the 'null' literal matches only items under no topic", () => {
    expect(isUntopicedFilter(UNTOPICED_TOPIC_ID)).toBe(true);
    expect(isUntopicedFilter('t-1')).toBe(false);
    expect(matchesTopicFilter(null, UNTOPICED_TOPIC_ID)).toBe(true);
    expect(matchesTopicFilter(undefined, UNTOPICED_TOPIC_ID)).toBe(true);
    expect(matchesTopicFilter('t-1', UNTOPICED_TOPIC_ID)).toBe(false);
  });

  it('a uuid matches only that topic', () => {
    expect(matchesTopicFilter('t-1', 't-1')).toBe(true);
    expect(matchesTopicFilter('t-2', 't-1')).toBe(false);
    expect(matchesTopicFilter(null, 't-1')).toBe(false);
  });

  it('passes a row whose topic the API never sent (migration unapplied)', () => {
    expect(matchesTopicFilter(undefined, 't-1')).toBe(true);
  });
});

describe('courseTopicRows', () => {
  const counts = (partial: Partial<LibraryCourseCounts> = {}): LibraryCourseCounts => ({
    notes: 0,
    decks: 0,
    tests: 0,
    bundles: 0,
    purchasedPacks: 0,
    ...partial,
  });
  const topic = (id: string, title: string, position: number, c: Partial<LibraryCourseCounts> = {}): LibraryTopicNode => ({
    topic: { id, courseId: bio.id, title, position },
    counts: counts(c),
  });
  const withTopics = (topics: LibraryTopicNode[], untopiced?: LibraryCourseCounts): LibraryCourseNode => ({
    ...node(bio, '2026/2027', 'active', { notes: 5 }),
    topics,
    ...(untopiced ? { untopiced } : {}),
  });

  it('is empty while the migration is unapplied, so the course renders flat', () => {
    expect(courseTopicRows(node(bio, '2026/2027', 'active', { notes: 5 }))).toEqual([]);
    expect(courseTopicRows(null)).toEqual([]);
    expect(courseTopicRows(withTopics([]))).toEqual([]);
    // `untopiced` alone is not a third level — without topics there is nothing to be outside of.
    expect(courseTopicRows(withTopics([], counts({ notes: 5 })))).toEqual([]);
  });

  it('orders topics by position and keeps whatever the server sent, zero counts included', () => {
    const rows = courseTopicRows(
      withTopics([
        topic('t-30', 'Genetics', 30, { notes: 1 }),
        topic('t-10', 'Cell structure', 10, { notes: 2, decks: 1 }),
        topic('t-20', 'Membranes', 20),
      ])
    );
    expect(rows.map((r) => r.id)).toEqual(['t-10', 't-20', 't-30']);
    expect(rows.map((r) => r.title)).toEqual(['Cell structure', 'Membranes', 'Genetics']);
    expect(rows.every((r) => r.untopiced)).toBe(false);
    expect(countsTotal(rows[1]!.counts)).toBe(0);
    expect(rows[0]!.counts.purchasedPacks).toBe(0);
  });

  it('appends a "No topic" row only when something sits outside every topic', () => {
    const withNone = courseTopicRows(withTopics([topic('t-10', 'Cell structure', 10)], counts({ notes: 3 })));
    expect(withNone.map((r) => r.id)).toEqual(['t-10', UNTOPICED_TOPIC_ID]);
    expect(withNone[1]!.untopiced).toBe(true);
    expect(withNone[1]!.title).toBe('No topic');
    expect(withNone[1]!.counts.notes).toBe(3);

    const empty = courseTopicRows(withTopics([topic('t-10', 'Cell structure', 10)], counts()));
    expect(empty.map((r) => r.id)).toEqual(['t-10']);
  });

  it('drops malformed topics and labels a blank title', () => {
    const rows = courseTopicRows(
      withTopics([{ topic: { id: '', courseId: bio.id, title: 'Broken', position: 5 }, counts: counts() }, topic('t-10', '', 10)])
    );
    expect(rows.map((r) => r.id)).toEqual(['t-10']);
    expect(rows[0]!.title).toBe('Untitled topic');
  });

  it('finds the selected topic inside its course only', () => {
    const overview: LibraryOverview = {
      years: [
        {
          academicYear: '2026/2027',
          courses: [withTopics([topic('t-10', 'Cell structure', 10)], counts({ decks: 1 })), node(chm, '2026/2027', 'active')],
        },
      ],
      unfiled: { notes: 0, decks: 0, tests: 0, bundles: 0 },
    };
    const tree = buildLibraryTree(overview);
    expect(findTreeTopic(tree, bio.id, 't-10')?.title).toBe('Cell structure');
    expect(findTreeTopic(tree, bio.id, UNTOPICED_TOPIC_ID)?.untopiced).toBe(true);
    // A topic never resolves against a different course, and "no topic" is not a selection.
    expect(findTreeTopic(tree, chm.id, 't-10')).toBeNull();
    expect(findTreeTopic(tree, bio.id, null)).toBeNull();
    expect(findTreeTopic(tree, UNFILED_COURSE_ID, 't-10')).toBeNull();
  });
});

describe('groupLibrarySearchResults', () => {
  const row = (partial: Partial<LibrarySearchResult> & Pick<LibrarySearchResult, 'type' | 'id'>): LibrarySearchResult => ({
    title: partial.id,
    snippet: '',
    courseId: null,
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...partial,
  });

  it('groups notes, decks (with nested flashcards) and bundles in rank order', () => {
    const groups = groupLibrarySearchResults([
      row({ type: 'flashcard', id: 'f1', deckId: 'd2', deckTitle: 'Enzymes', matchedIn: 'front' }),
      row({ type: 'note', id: 'n1', title: 'Krebs cycle' }),
      row({ type: 'deck', id: 'd1', title: 'Glycolysis' }),
      row({ type: 'bundle', id: 'qbank-1', title: 'Past questions' }),
      row({ type: 'flashcard', id: 'f2', deckId: 'd1', deckTitle: 'Glycolysis', matchedIn: 'back' }),
      row({ type: 'deck', id: 'd2', title: 'Enzymes (renamed)' }),
      row({ type: 'note', id: 'n2' }),
    ]);
    expect(groups.total).toBe(7);
    expect(groups.notes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(groups.bundles.map((b) => b.id)).toEqual(['qbank-1']);
    // Deck groups appear in first-seen order: d2 (via its flashcard) then d1.
    expect(groups.decks.map((d) => d.deckId)).toEqual(['d2', 'd1']);
    expect(groups.decks[0]!.cards.map((c) => c.id)).toEqual(['f1']);
    // The deck row, when it shows up later, attaches to the existing group and wins the title.
    expect(groups.decks[0]!.deck?.id).toBe('d2');
    expect(groups.decks[0]!.title).toBe('Enzymes (renamed)');
    expect(groups.decks[1]!.deck?.id).toBe('d1');
    expect(groups.decks[1]!.cards.map((c) => c.id)).toEqual(['f2']);
  });

  it('drops unknown types and empty input', () => {
    expect(groupLibrarySearchResults(null).total).toBe(0);
    const groups = groupLibrarySearchResults([row({ type: 'concept' as any, id: 'x' })]);
    expect(groups.total).toBe(0);
  });

  it('labels matched fields for flashcards and attachments only when informative', () => {
    expect(searchMatchLabel({ type: 'flashcard', matchedIn: 'front' })).toBe('Front');
    expect(searchMatchLabel({ type: 'flashcard', matchedIn: 'back' })).toBe('Back');
    expect(searchMatchLabel({ type: 'note', matchedIn: 'attachment' })).toBe('Attachment text');
    expect(searchMatchLabel({ type: 'note', matchedIn: 'title' })).toBeNull();
    expect(searchMatchLabel({ type: 'deck' })).toBeNull();
  });

  it('enforces the server minimum query length', () => {
    expect(isSearchableQuery('a')).toBe(false);
    expect(isSearchableQuery(' a ')).toBe(false);
    expect(isSearchableQuery('ab')).toBe(true);
    expect(isSearchableQuery(null)).toBe(false);
  });
});

describe('folder tree', () => {
  const folder = (id: string, name: string, parentId?: string): NoteFolder => ({
    id,
    userId: 'u1',
    name,
    color: '#000',
    parentId,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  });

  it('nests direct children under their parent and promotes orphans', () => {
    const tree = buildFolderTree([
      folder('a', 'Anatomy'),
      folder('a1', 'Upper limb', 'a'),
      folder('b', 'Biochem'),
      folder('orphan', 'Lost', 'missing-parent'),
      folder('a2', 'Lower limb', 'a'),
    ]);
    expect(tree.map((n) => n.folder.id)).toEqual(['a', 'b', 'orphan']);
    expect(tree[0]!.children.map((f) => f.id)).toEqual(['a1', 'a2']);
    expect(tree[1]!.children).toEqual([]);
  });

  it('flattens deeper nesting onto the nearest root and survives cycles', () => {
    const tree = buildFolderTree([
      folder('a', 'A'),
      folder('b', 'B', 'a'),
      folder('c', 'C', 'b'),
      folder('x', 'X', 'y'),
      folder('y', 'Y', 'x'),
    ]);
    const a = tree.find((n) => n.folder.id === 'a')!;
    expect(a.children.map((f) => f.id)).toEqual(['b', 'c']);
    // Cycle members are still listed somewhere (as roots) rather than vanishing.
    const ids = tree.flatMap((n) => [n.folder.id, ...n.children.map((f) => f.id)]);
    expect(ids).toContain('x');
    expect(ids).toContain('y');
  });

  it('scope ids cover the folder plus its direct children; parent options are roots minus self', () => {
    const folders = [folder('a', 'A'), folder('a1', 'A1', 'a'), folder('b', 'B')];
    expect(folderScopeIds(folders, 'a')).toEqual(['a', 'a1']);
    expect(folderScopeIds(folders, 'b')).toEqual(['b']);
    expect(folderScopeIds(folders, null)).toEqual([]);
    expect(folderParentOptions(folders).map((f) => f.id)).toEqual(['a', 'b']);
    expect(folderParentOptions(folders, 'a').map((f) => f.id)).toEqual(['b']);
  });
});

describe('offline bundles', () => {
  it('filters by bundle.courseId, falling back to config.courseId', () => {
    const bundles = [
      { bundleId: 'b1', courseId: 'c-bio', config: { courseId: 'c-bio' } },
      { bundleId: 'b2', courseId: undefined, config: { courseId: 'c-chm' } },
      { bundleId: 'qbank-3', courseId: null, config: { courseId: null } },
    ];
    expect(filterBundlesByCourse(bundles, null).map((b) => b.bundleId)).toEqual(['b1', 'b2', 'qbank-3']);
    expect(filterBundlesByCourse(bundles, 'c-bio').map((b) => b.bundleId)).toEqual(['b1']);
    expect(filterBundlesByCourse(bundles, 'c-chm').map((b) => b.bundleId)).toEqual(['b2']);
    expect(filterBundlesByCourse(bundles, UNFILED_COURSE_ID).map((b) => b.bundleId)).toEqual(['qbank-3']);
  });

  it('recognises purchased packs by the qbank- prefix', () => {
    expect(isPurchasedBundleId('qbank-abc')).toBe(true);
    expect(isPurchasedBundleId('bundle-1')).toBe(false);
    expect(isPurchasedBundleId(null)).toBe(false);
  });
});
