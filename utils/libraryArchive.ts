/**
 * Pure helpers behind the Library archive (Phase 1 · B — docs/phase1-library-archive-contract.md §2):
 * the course tree built from `GET /library/overview`, grouping of
 * `GET /library/search` rows, the one-level note-folder tree and the course
 * filter semantics shared by the Notes / Flashcards / Offline screens.
 * Kept free of React/DOM so apps/web/src/libraryArchive.test.ts can exercise it.
 */
import type {
  LibraryCourseCounts,
  LibraryCourseNode,
  LibraryOverview,
  LibrarySearchResult,
  NoteFolder,
} from '../types';

/**
 * The literal the API treats as "items with no course" on
 * `GET /notes|decks|tests|offline-bundles?courseId=` and `/library/search`.
 * A filter value is therefore: a course uuid, this literal, or `null` (= all).
 */
export const UNFILED_COURSE_ID = 'null';

export type CourseFilterId = string | null;

export function isUnfiledFilter(filter: CourseFilterId | undefined): boolean {
  return filter === UNFILED_COURSE_ID;
}

/** Whether an item with `itemCourseId` belongs under the current course filter. */
export function matchesCourseFilter(itemCourseId: string | null | undefined, filter: CourseFilterId | undefined): boolean {
  if (!filter) return true;
  if (filter === UNFILED_COURSE_ID) return !itemCourseId;
  return itemCourseId === filter;
}

/**
 * The topic-level twin of UNFILED_COURSE_ID (Phase 1 · A): "filed under this
 * course but under no topic" on `?topicId=`. A topic filter only ever means
 * something *inside* a course, so it always travels with its `courseId`.
 */
export const UNTOPICED_TOPIC_ID = 'null';

export type TopicFilterId = string | null;

export function isUntopicedFilter(filter: TopicFilterId | undefined): boolean {
  return filter === UNTOPICED_TOPIC_ID;
}

/**
 * Whether an item with `itemTopicId` belongs under the current topic filter.
 * `undefined` means the API never sent the field (the column is missing while
 * the migration is unapplied), so the row passes — a column we cannot read must
 * never hide items that are really there. Kept identical to the mobile twin in
 * apps/mobile/src/utils/libraryArchive.ts.
 */
export function matchesTopicFilter(itemTopicId: string | null | undefined, filter: TopicFilterId | undefined): boolean {
  if (!filter) return true;
  if (itemTopicId === undefined) return true;
  if (filter === UNTOPICED_TOPIC_ID) return !itemTopicId;
  return itemTopicId === filter;
}

// ---------- Overview → tree ----------

export interface LibraryPastYear {
  academicYear: string;
  courses: LibraryCourseNode[];
}

export interface LibraryTree {
  /** Active enrolments (newest academic year first, API order within a year). */
  current: LibraryCourseNode[];
  /** Archived enrolments grouped by academic year, newest first; years with none are dropped. */
  past: LibraryPastYear[];
  unfiled: LibraryOverview['unfiled'];
  /** Sum over every course + unfiled — the "All items" row. */
  totals: { notes: number; decks: number; tests: number; bundles: number };
}

const EMPTY_UNFILED: LibraryOverview['unfiled'] = { notes: 0, decks: 0, tests: 0, bundles: 0 };

export function emptyLibraryTree(): LibraryTree {
  return { current: [], past: [], unfiled: { ...EMPTY_UNFILED }, totals: { notes: 0, decks: 0, tests: 0, bundles: 0 } };
}

export function buildLibraryTree(overview: LibraryOverview | null | undefined): LibraryTree {
  const tree = emptyLibraryTree();
  if (!overview) return tree;
  const unfiled = overview.unfiled || EMPTY_UNFILED;
  tree.unfiled = {
    notes: unfiled.notes || 0,
    decks: unfiled.decks || 0,
    tests: unfiled.tests || 0,
    bundles: unfiled.bundles || 0,
  };
  tree.totals = { ...tree.unfiled };

  const seenCurrent = new Set<string>();
  for (const year of overview.years || []) {
    const archived: LibraryCourseNode[] = [];
    for (const node of year.courses || []) {
      if (!node?.course?.id) continue;
      const counts = node.counts || { notes: 0, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0 };
      tree.totals.notes += counts.notes || 0;
      tree.totals.decks += counts.decks || 0;
      tree.totals.tests += counts.tests || 0;
      tree.totals.bundles += counts.bundles || 0;
      if (node.enrolment?.status === 'archived') {
        archived.push(node);
      } else if (!seenCurrent.has(node.course.id)) {
        // Years are newest-first, so the first active sighting is the live one.
        seenCurrent.add(node.course.id);
        tree.current.push(node);
      }
    }
    if (archived.length > 0) tree.past.push({ academicYear: year.academicYear, courses: archived });
  }
  return tree;
}

export function countsTotal(counts: Pick<LibraryCourseCounts, 'notes' | 'decks' | 'tests' | 'bundles'> | null | undefined): number {
  if (!counts) return 0;
  return (counts.notes || 0) + (counts.decks || 0) + (counts.tests || 0) + (counts.bundles || 0);
}

/** Find a course node anywhere in the tree (current or past) by course id. */
export function findTreeCourse(tree: LibraryTree, courseId: string | null | undefined): LibraryCourseNode | null {
  if (!courseId || courseId === UNFILED_COURSE_ID) return null;
  const hit = tree.current.find((n) => n.course.id === courseId);
  if (hit) return hit;
  for (const year of tree.past) {
    const past = year.courses.find((n) => n.course.id === courseId);
    if (past) return past;
  }
  return null;
}

// ---------- Course → topics (the third level) ----------

export interface LibraryTopicRow {
  /** A topic uuid, or UNTOPICED_TOPIC_ID for the "No topic" row. */
  id: string;
  title: string;
  counts: LibraryCourseCounts;
  /** True for the synthetic "No topic" row, which has no topic record behind it. */
  untopiced: boolean;
}

const EMPTY_COUNTS: LibraryCourseCounts = { notes: 0, decks: 0, tests: 0, bundles: 0, purchasedPacks: 0 };

/**
 * The rows to render under a course: its topics in position order, then a
 * "No topic" row when anything sits in the course but outside every topic.
 *
 * Returns `[]` whenever the overview omitted `topics` — which is the state
 * every user is in until the course_topics migration is applied — so the caller
 * renders the course exactly as it did before this level existed. Whatever the
 * server does send is rendered, zero counts included: the outline is curated,
 * so which topics belong on it is the server's call, not a count threshold here.
 */
export function courseTopicRows(node: LibraryCourseNode | null | undefined): LibraryTopicRow[] {
  const topics = node?.topics;
  if (!topics || topics.length === 0) return [];
  const rows: LibraryTopicRow[] = topics
    .filter((t) => t?.topic?.id)
    // The API orders by position, but a type can only document that — sort anyway.
    .sort((a, b) => (a.topic.position || 0) - (b.topic.position || 0))
    .map((t) => ({
      id: t.topic.id,
      title: t.topic.title || 'Untitled topic',
      counts: { ...EMPTY_COUNTS, ...(t.counts || {}) },
      untopiced: false,
    }));
  const untopiced = node?.untopiced;
  if (untopiced && countsTotal(untopiced) > 0) {
    rows.push({ id: UNTOPICED_TOPIC_ID, title: 'No topic', counts: { ...EMPTY_COUNTS, ...untopiced }, untopiced: true });
  }
  return rows;
}

/** The selected topic row inside a course, for labelling the active filter. */
export function findTreeTopic(
  tree: LibraryTree,
  courseId: string | null | undefined,
  topicId: TopicFilterId | undefined
): LibraryTopicRow | null {
  if (!topicId) return null;
  const rows = courseTopicRows(findTreeCourse(tree, courseId));
  return rows.find((r) => r.id === topicId) || null;
}

// ---------- Search results → groups ----------

export interface LibrarySearchDeckGroup {
  deckId: string;
  title: string;
  /** The deck row itself when the deck matched (name/description). */
  deck: LibrarySearchResult | null;
  /** Flashcards that matched, in rank order. */
  cards: LibrarySearchResult[];
}

export interface LibrarySearchGroups {
  notes: LibrarySearchResult[];
  decks: LibrarySearchDeckGroup[];
  bundles: LibrarySearchResult[];
  total: number;
}

/**
 * Group the flat, ranked rows of GET /library/search: notes, decks (with the
 * matching flashcards nested under their deck, in first-seen order) and
 * offline bundles. Unknown types are dropped.
 */
export function groupLibrarySearchResults(results: ReadonlyArray<LibrarySearchResult> | null | undefined): LibrarySearchGroups {
  const groups: LibrarySearchGroups = { notes: [], decks: [], bundles: [], total: 0 };
  if (!results) return groups;
  const deckIndex = new Map<string, LibrarySearchDeckGroup>();
  const deckGroup = (deckId: string, title: string): LibrarySearchDeckGroup => {
    let group = deckIndex.get(deckId);
    if (!group) {
      group = { deckId, title, deck: null, cards: [] };
      deckIndex.set(deckId, group);
      groups.decks.push(group);
    }
    return group;
  };
  for (const row of results) {
    if (!row || !row.id) continue;
    switch (row.type) {
      case 'note':
        groups.notes.push(row);
        groups.total += 1;
        break;
      case 'deck': {
        const group = deckGroup(row.id, row.title);
        group.deck = row;
        if (row.title) group.title = row.title;
        groups.total += 1;
        break;
      }
      case 'flashcard': {
        const deckId = row.deckId || `deck-of-${row.id}`;
        const group = deckGroup(deckId, row.deckTitle || 'Deck');
        if (!group.deck && row.deckTitle) group.title = row.deckTitle;
        group.cards.push(row);
        groups.total += 1;
        break;
      }
      case 'bundle':
        groups.bundles.push(row);
        groups.total += 1;
        break;
      default:
        break;
    }
  }
  return groups;
}

/** Human label for the field a search row matched in. */
export function searchMatchLabel(row: Pick<LibrarySearchResult, 'matchedIn' | 'type'>): string | null {
  switch (row.matchedIn) {
    case 'front':
      return 'Front';
    case 'back':
      return 'Back';
    case 'attachment':
      return 'Attachment text';
    case 'summary':
      return 'Summary';
    case 'body':
      return 'Body';
    case 'description':
      return 'Description';
    case 'groupName':
      return 'Group';
    case 'title':
    case 'name':
    case 'displayName':
      return null;
    default:
      return null;
  }
}

/** Server-side minimum for `q` (GET /library/search). */
export const LIBRARY_SEARCH_MIN_CHARS = 2;

export function isSearchableQuery(query: string | null | undefined): boolean {
  return Boolean(query && query.trim().length >= LIBRARY_SEARCH_MIN_CHARS);
}

// ---------- Note folders → one-level tree ----------

export interface FolderTreeNode {
  folder: NoteFolder;
  children: NoteFolder[];
}

/**
 * One-level folder tree: roots are folders without a parent (or whose parent
 * is not in the list — orphans are promoted rather than hidden); children are
 * listed under their parent in the input order. Deeper nesting is flattened to
 * the nearest root so every folder stays reachable.
 */
export function buildFolderTree(folders: ReadonlyArray<NoteFolder> | null | undefined): FolderTreeNode[] {
  if (!folders || folders.length === 0) return [];
  const byId = new Map<string, NoteFolder>();
  folders.forEach((f) => {
    if (f?.id) byId.set(f.id, f);
  });
  const rootOf = (folder: NoteFolder): { root: NoteFolder; cyclic: boolean } => {
    // Walk up while the parent exists; a parent we have already visited means a cycle.
    let current = folder;
    const seen = new Set<string>([folder.id]);
    while (current.parentId && byId.has(current.parentId)) {
      if (seen.has(current.parentId)) return { root: folder, cyclic: true };
      seen.add(current.parentId);
      current = byId.get(current.parentId)!;
    }
    return { root: current, cyclic: false };
  };
  const roots: FolderTreeNode[] = [];
  const nodeByRootId = new Map<string, FolderTreeNode>();
  const ensureRoot = (folder: NoteFolder): FolderTreeNode => {
    let node = nodeByRootId.get(folder.id);
    if (!node) {
      node = { folder, children: [] };
      nodeByRootId.set(folder.id, node);
      roots.push(node);
    }
    return node;
  };
  // First pass: roots in input order (no parent, or a parent that is not in the list).
  folders.forEach((folder) => {
    if (!folder?.id) return;
    if (!folder.parentId || !byId.has(folder.parentId)) ensureRoot(folder);
  });
  // Second pass: children under their nearest root; cycle members become roots themselves.
  folders.forEach((folder) => {
    if (!folder?.id) return;
    if (!folder.parentId || !byId.has(folder.parentId)) return;
    const { root, cyclic } = rootOf(folder);
    if (cyclic || root.id === folder.id) {
      ensureRoot(folder);
      return;
    }
    ensureRoot(root).children.push(folder);
  });
  return roots;
}

/** Folder ids that a folder selection covers: the folder itself plus its direct children. */
export function folderScopeIds(folders: ReadonlyArray<NoteFolder> | null | undefined, selectedFolderId: string | null | undefined): string[] {
  if (!selectedFolderId) return [];
  const ids = [selectedFolderId];
  (folders || []).forEach((f) => {
    if (f?.parentId === selectedFolderId && f.id !== selectedFolderId) ids.push(f.id);
  });
  return ids;
}

/**
 * Folders that may be chosen as a parent (v1 = one level): roots only, minus
 * the folder being edited (a folder cannot be its own parent).
 */
export function folderParentOptions(folders: ReadonlyArray<NoteFolder> | null | undefined, excludeFolderId?: string | null): NoteFolder[] {
  return buildFolderTree(folders)
    .map((node) => node.folder)
    .filter((f) => f.id !== excludeFolderId);
}

// ---------- Offline bundles ----------

export function isPurchasedBundleId(bundleId: string | null | undefined): boolean {
  return typeof bundleId === 'string' && bundleId.startsWith('qbank-');
}

/** Client-side course filter for the Offline screen (bundle.courseId, falling back to config.courseId). */
export function filterBundlesByCourse<T extends { courseId?: string | null; config?: { courseId?: string | null } | null }>(
  bundles: ReadonlyArray<T> | null | undefined,
  filter: CourseFilterId | undefined
): T[] {
  const list = bundles ? [...bundles] : [];
  if (!filter) return list;
  return list.filter((b) => matchesCourseFilter(b.courseId ?? b.config?.courseId ?? null, filter));
}
