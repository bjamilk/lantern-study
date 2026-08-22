/**
 * Pure helpers behind the mobile Library archive (Phase 1 · B):
 * the course tree built from GET /library/overview, grouping of
 * GET /library/search rows, the course filter predicate every list shares,
 * and the comma-separated flashcard tag input. Kept free of React so the
 * shapes can be unit-tested.
 */
import type {
  LibraryCourseNode,
  LibraryOverview,
  LibrarySearchResult,
} from '@lantern/shared/types';
import { formatCourseLabel } from './courseSelection';

/** The API's literal for "items whose course_id is null". */
export const UNFILED_COURSE_ID = 'null';

export interface LibraryPastSemester {
  academicYear: string;
  courses: LibraryCourseNode[];
}

export interface LibraryTree {
  /** Active enrolments, every academic year, newest year first then by code. */
  thisSemester: LibraryCourseNode[];
  /** Archived enrolments grouped by academic year (newest first); years without any are dropped. */
  pastSemesters: LibraryPastSemester[];
  unfiled: LibraryOverview['unfiled'];
  /** Sum of everything filed under any course plus unfiled — for the header chip. */
  totals: { notes: number; decks: number; tests: number; bundles: number };
}

const EMPTY_UNFILED: LibraryOverview['unfiled'] = { notes: 0, decks: 0, tests: 0, bundles: 0 };

/** Split the overview into the three sections the Library tree renders. */
export function buildLibraryTree(overview: LibraryOverview | null | undefined): LibraryTree {
  const years = Array.isArray(overview?.years) ? overview!.years : [];
  const unfiled = { ...EMPTY_UNFILED, ...(overview?.unfiled ?? {}) };
  const thisSemester: LibraryCourseNode[] = [];
  const pastSemesters: LibraryPastSemester[] = [];
  const totals = { ...unfiled };

  for (const year of years) {
    const archived: LibraryCourseNode[] = [];
    for (const node of year.courses ?? []) {
      if (!node?.course) continue;
      totals.notes += node.counts?.notes ?? 0;
      totals.decks += node.counts?.decks ?? 0;
      totals.tests += node.counts?.tests ?? 0;
      totals.bundles += node.counts?.bundles ?? 0;
      if (node.enrolment?.status === 'archived') archived.push(node);
      else thisSemester.push(node);
    }
    if (archived.length > 0) pastSemesters.push({ academicYear: year.academicYear, courses: archived });
  }

  return { thisSemester, pastSemesters, unfiled, totals };
}

/** Everything filed under a course node (the number shown next to its name). */
export function courseNodeTotal(node: Pick<LibraryCourseNode, 'counts'>): number {
  const c = node.counts;
  if (!c) return 0;
  return (c.notes ?? 0) + (c.decks ?? 0) + (c.tests ?? 0) + (c.bundles ?? 0);
}

/** Label for the course chip / filter from a tree node. */
export function courseNodeLabel(node: Pick<LibraryCourseNode, 'course'>): string {
  return formatCourseLabel(node.course);
}

/**
 * Does an item with `itemCourseId` pass the Library course filter?
 * `filter` null = no filter; `'null'` = unfiled only; otherwise exact match.
 */
export function matchesCourseFilter(
  itemCourseId: string | null | undefined,
  filter: string | null | undefined
): boolean {
  if (!filter) return true;
  if (filter === UNFILED_COURSE_ID) return !itemCourseId;
  return itemCourseId === filter;
}

export interface LibraryDeckGroup {
  deckId: string;
  title: string;
  /** Present when the deck itself matched (name/description). */
  deck?: LibrarySearchResult;
  /** Flashcards that matched, nested under their deck. */
  cards: LibrarySearchResult[];
}

export interface GroupedLibrarySearch {
  notes: LibrarySearchResult[];
  decks: LibraryDeckGroup[];
  bundles: LibrarySearchResult[];
  total: number;
}

/**
 * Group search rows for display: notes, decks (with their matching flashcards
 * nested — a flashcard whose deck did not itself match still gets a group,
 * titled from `deckTitle`), bundles. Input order (rank, then recency) is kept.
 */
export function groupLibrarySearchResults(
  results: LibrarySearchResult[] | null | undefined
): GroupedLibrarySearch {
  const notes: LibrarySearchResult[] = [];
  const bundles: LibrarySearchResult[] = [];
  const decks: LibraryDeckGroup[] = [];
  const deckIndex = new Map<string, LibraryDeckGroup>();

  const groupFor = (deckId: string, title: string): LibraryDeckGroup => {
    let group = deckIndex.get(deckId);
    if (!group) {
      group = { deckId, title, cards: [] };
      deckIndex.set(deckId, group);
      decks.push(group);
    } else if (!group.title && title) {
      group.title = title;
    }
    return group;
  };

  for (const row of results ?? []) {
    if (!row) continue;
    switch (row.type) {
      case 'note':
        notes.push(row);
        break;
      case 'bundle':
        bundles.push(row);
        break;
      case 'deck': {
        const group = groupFor(row.id, row.title);
        group.deck = row;
        if (row.title) group.title = row.title;
        break;
      }
      case 'flashcard': {
        const deckId = row.deckId || `orphan:${row.id}`;
        const group = groupFor(deckId, row.deckTitle || 'Deck');
        group.cards.push(row);
        break;
      }
      default:
        break;
    }
  }

  const total = notes.length + bundles.length + decks.reduce((n, g) => n + (g.deck ? 1 : 0) + g.cards.length, 0);
  return { notes, decks, bundles, total };
}

/** "anatomy, week 3,  ,ANATOMY" → ["anatomy", "week 3"] (trimmed, de-duplicated case-insensitively, order kept). */
export function parseTagsInput(value: string | null | undefined): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,\n]/)) {
    const tag = raw.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

/** Inverse of parseTagsInput for pre-filling the editor. */
export function formatTagsInput(tags: string[] | null | undefined): string {
  return Array.isArray(tags) ? tags.filter(Boolean).join(', ') : '';
}

/** Search needs at least this many characters (server rejects shorter). */
export const LIBRARY_SEARCH_MIN_CHARS = 2;

export function isLibrarySearchable(query: string): boolean {
  return query.trim().length >= LIBRARY_SEARCH_MIN_CHARS;
}
