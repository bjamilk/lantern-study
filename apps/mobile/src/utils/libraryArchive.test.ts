import type {
  Course,
  LibraryCourseNode,
  LibraryOverview,
  LibrarySearchResult,
  UserCourse,
} from '@lantern/shared/types';
import {
  buildLibraryTree,
  courseNodeLabel,
  courseNodeTotal,
  courseTopicRows,
  formatTagsInput,
  groupLibrarySearchResults,
  isLibrarySearchable,
  matchesCourseFilter,
  matchesTopicFilter,
  parseTagsInput,
  UNFILED_COURSE_ID,
  UNTOPICED_TOPIC_ID,
} from './libraryArchive';

const course = (id: string, code: string, title = `${code} title`): Course => ({
  id,
  institutionId: 'inst-1',
  code,
  title,
  isCanonical: false,
});

const node = (
  c: Course,
  status: UserCourse['status'],
  academicYear: string,
  counts: Partial<LibraryCourseNode['counts']> = {}
): LibraryCourseNode => ({
  course: c,
  enrolment: { course: c, academicYear, status },
  counts: { notes: 0, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0, ...counts },
});

describe('buildLibraryTree', () => {
  const bio = course('c-bio', 'BIO 201');
  const chm = course('c-chm', 'CHM 101');
  const mth = course('c-mth', 'MTH 101');
  const overview: LibraryOverview = {
    years: [
      {
        academicYear: '2026/2027',
        courses: [node(bio, 'active', '2026/2027', { notes: 3, decks: 1 }), node(chm, 'archived', '2026/2027', { tests: 2 })],
      },
      {
        academicYear: '2025/2026',
        courses: [node(mth, 'archived', '2025/2026', { bundles: 1, purchasedPacks: 1 })],
      },
    ],
    unfiled: { notes: 4, decks: 0, tests: 1, bundles: 0 },
  };

  it('puts active enrolments under This semester and archived ones under Past semesters by year', () => {
    const tree = buildLibraryTree(overview);
    expect(tree.thisSemester.map(n => n.course.code)).toEqual(['BIO 201']);
    expect(tree.pastSemesters.map(p => p.academicYear)).toEqual(['2026/2027', '2025/2026']);
    expect(tree.pastSemesters[0].courses.map(n => n.course.code)).toEqual(['CHM 101']);
    expect(tree.pastSemesters[1].courses.map(n => n.course.code)).toEqual(['MTH 101']);
  });

  it('drops years with no archived enrolments from Past semesters', () => {
    const tree = buildLibraryTree({
      years: [{ academicYear: '2026/2027', courses: [node(bio, 'active', '2026/2027')] }],
      unfiled: { notes: 0, decks: 0, tests: 0, bundles: 0 },
    });
    expect(tree.pastSemesters).toEqual([]);
  });

  it('sums totals across courses and unfiled, and tolerates a missing overview', () => {
    expect(buildLibraryTree(overview).totals).toEqual({ notes: 7, decks: 1, tests: 3, bundles: 1 });
    expect(buildLibraryTree(overview).unfiled).toEqual({ notes: 4, decks: 0, tests: 1, bundles: 0 });
    const empty = buildLibraryTree(null);
    expect(empty.thisSemester).toEqual([]);
    expect(empty.unfiled).toEqual({ notes: 0, decks: 0, tests: 0, bundles: 0 });
  });

  it('labels and counts a node the way the tree row shows it', () => {
    const n = node(bio, 'active', '2026/2027', { notes: 2, decks: 1, tests: 1, bundles: 1 });
    expect(courseNodeTotal(n)).toBe(5);
    expect(courseNodeLabel(n)).toBe('BIO 201 · BIO 201 title');
  });
});

describe('matchesCourseFilter', () => {
  it('passes everything with no filter', () => {
    expect(matchesCourseFilter('c-1', null)).toBe(true);
    expect(matchesCourseFilter(undefined, undefined)).toBe(true);
  });
  it('treats the literal "null" as unfiled-only', () => {
    expect(matchesCourseFilter(null, UNFILED_COURSE_ID)).toBe(true);
    expect(matchesCourseFilter(undefined, UNFILED_COURSE_ID)).toBe(true);
    expect(matchesCourseFilter('c-1', UNFILED_COURSE_ID)).toBe(false);
  });
  it('matches a course id exactly', () => {
    expect(matchesCourseFilter('c-1', 'c-1')).toBe(true);
    expect(matchesCourseFilter('c-2', 'c-1')).toBe(false);
    expect(matchesCourseFilter(null, 'c-1')).toBe(false);
  });
});

describe('courseTopicRows', () => {
  const bio = course('c-bio', 'BIO 201');
  const counts = (partial: Partial<LibraryCourseNode['counts']> = {}): LibraryCourseNode['counts'] => ({
    notes: 0,
    decks: 0,
    tests: 0,
    bundles: 0,
    purchasedPacks: 0,
    ...partial,
  });
  const topic = (id: string, title: string, position: number, c: Partial<LibraryCourseNode['counts']> = {}) => ({
    topic: { id, courseId: bio.id, title, position },
    counts: counts(c),
  });
  const outlined = (
    topics: LibraryCourseNode['topics'],
    untopiced: LibraryCourseNode['untopiced']
  ): LibraryCourseNode => ({ ...node(bio, 'active', '2026/2027'), topics, untopiced });

  it('has no rows while the migration is unapplied, so the course renders flat', () => {
    expect(courseTopicRows(node(bio, 'active', '2026/2027'))).toEqual([]);
    expect(courseTopicRows(null)).toEqual([]);
  });

  it('orders by position and appends "No topic" only when something sits there', () => {
    const rows = courseTopicRows(
      outlined([topic('t-2', 'Week 2', 20, { decks: 1 }), topic('t-1', 'Week 1', 10, { notes: 3 })], counts({ notes: 2 }))
    );
    expect(rows.map(r => r.title)).toEqual(['Week 1', 'Week 2', 'No topic']);
    expect(rows[2].id).toBe(UNTOPICED_TOPIC_ID);
    expect(rows[2].untopiced).toBe(true);
    expect(rows[0].counts.notes).toBe(3);
  });

  it('drops the "No topic" row when the course has nothing outside its topics', () => {
    const rows = courseTopicRows(outlined([topic('t-1', 'Week 1', 10, { notes: 1 })], counts()));
    expect(rows.map(r => r.id)).toEqual(['t-1']);
  });

  it('keeps an empty topic — the outline is curated, not derived from what is filed', () => {
    const rows = courseTopicRows(outlined([topic('t-1', 'Week 1', 10)], counts()));
    expect(rows.map(r => r.id)).toEqual(['t-1']);
    expect(rows[0].counts).toEqual(counts());
  });
});

describe('matchesTopicFilter', () => {
  it('passes everything with no filter', () => {
    expect(matchesTopicFilter('t-1', null)).toBe(true);
    expect(matchesTopicFilter(undefined, undefined)).toBe(true);
  });
  it('treats the literal "null" as untopiced-only', () => {
    expect(matchesTopicFilter(null, UNTOPICED_TOPIC_ID)).toBe(true);
    expect(matchesTopicFilter('t-1', UNTOPICED_TOPIC_ID)).toBe(false);
  });
  it('matches a topic id exactly', () => {
    expect(matchesTopicFilter('t-1', 't-1')).toBe(true);
    expect(matchesTopicFilter('t-2', 't-1')).toBe(false);
    expect(matchesTopicFilter(null, 't-1')).toBe(false);
  });
  it('keeps rows whose topicId the API did not send (column missing)', () => {
    expect(matchesTopicFilter(undefined, 't-1')).toBe(true);
    expect(matchesTopicFilter(undefined, UNTOPICED_TOPIC_ID)).toBe(true);
  });
});

describe('groupLibrarySearchResults', () => {
  const row = (partial: Partial<LibrarySearchResult> & Pick<LibrarySearchResult, 'type' | 'id'>): LibrarySearchResult => ({
    title: partial.id,
    snippet: '',
    courseId: null,
    updatedAt: '2026-08-22T00:00:00Z',
    ...partial,
  });

  it('groups notes, decks with nested flashcards, and bundles, keeping rank order', () => {
    const grouped = groupLibrarySearchResults([
      row({ type: 'flashcard', id: 'f1', deckId: 'd1', deckTitle: 'Anatomy' }),
      row({ type: 'note', id: 'n1' }),
      row({ type: 'deck', id: 'd1', title: 'Anatomy deck' }),
      row({ type: 'flashcard', id: 'f2', deckId: 'd1', deckTitle: 'Anatomy' }),
      row({ type: 'flashcard', id: 'f3', deckId: 'd2', deckTitle: 'Physio' }),
      row({ type: 'bundle', id: 'qbank-1' }),
      row({ type: 'note', id: 'n2' }),
    ]);
    expect(grouped.notes.map(n => n.id)).toEqual(['n1', 'n2']);
    expect(grouped.bundles.map(b => b.id)).toEqual(['qbank-1']);
    expect(grouped.decks.map(d => d.deckId)).toEqual(['d1', 'd2']);
    // The deck hit upgrades the group title and attaches itself.
    expect(grouped.decks[0].title).toBe('Anatomy deck');
    expect(grouped.decks[0].deck?.id).toBe('d1');
    expect(grouped.decks[0].cards.map(c => c.id)).toEqual(['f1', 'f2']);
    // A flashcard-only group still renders with the deck's name.
    expect(grouped.decks[1].deck).toBeUndefined();
    expect(grouped.decks[1].title).toBe('Physio');
    expect(grouped.total).toBe(7);
  });

  it('returns empty groups for no results', () => {
    expect(groupLibrarySearchResults(undefined)).toEqual({ notes: [], decks: [], bundles: [], total: 0 });
  });
});

describe('flashcard tag input', () => {
  it('splits on commas/newlines, trims, drops blanks and case-insensitive duplicates', () => {
    expect(parseTagsInput('anatomy, week 3,  ,ANATOMY\nlimbs')).toEqual(['anatomy', 'week 3', 'limbs']);
    expect(parseTagsInput('')).toEqual([]);
    expect(parseTagsInput(undefined)).toEqual([]);
  });
  it('round-trips through formatTagsInput', () => {
    expect(formatTagsInput(['a', 'b'])).toBe('a, b');
    expect(parseTagsInput(formatTagsInput(['a', 'b c']))).toEqual(['a', 'b c']);
    expect(formatTagsInput(undefined)).toBe('');
  });
});

describe('isLibrarySearchable', () => {
  it('needs at least two non-space characters', () => {
    expect(isLibrarySearchable(' a ')).toBe(false);
    expect(isLibrarySearchable('ab')).toBe(true);
  });
});
