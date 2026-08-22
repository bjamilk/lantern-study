/**
 * Library archive — web wrappers over `GET /library/overview` and
 * `GET /library/search` (docs/phase1-library-archive-contract.md §1). Mirrors
 * the shared client in packages/shared/src/api/endpoints.ts but rides the
 * web's own fetch / auth-header / session-expiry plumbing (services/academic.ts).
 */
import type { LibraryOverview, LibrarySearchResult, LibrarySearchType } from '../types';
import { academicRequest } from './academic';
import { LIBRARY_SEARCH_MIN_CHARS } from '../utils/libraryArchive';

const EMPTY_OVERVIEW: LibraryOverview = { years: [], unfiled: { notes: 0, decks: 0, tests: 0, bundles: 0 } };

/** The Library tree: years → courses (with enrolment + counts) + unfiled counts, in one round trip. */
export const fetchLibraryOverview = async (): Promise<LibraryOverview> => {
  const data = await academicRequest<LibraryOverview | null>('/library/overview', {}, 15000);
  if (!data) return EMPTY_OVERVIEW;
  return {
    years: Array.isArray(data.years) ? data.years : [],
    unfiled: { ...EMPTY_OVERVIEW.unfiled, ...(data.unfiled || {}) },
  };
};

export interface LibrarySearchParams {
  q: string;
  /** Course uuid, the literal `'null'` for unfiled items, or null/undefined for everything. */
  courseId?: string | null;
  types?: LibrarySearchType[];
  /** Capped at 50 server-side. */
  limit?: number;
}

/**
 * Cross-artefact search over the caller's notes (incl. attachment text),
 * decks, flashcards (grouped by deck client-side) and offline bundles.
 * Resolves to `[]` for queries under the server minimum instead of 400-ing.
 */
export const searchLibrary = async (params: LibrarySearchParams): Promise<LibrarySearchResult[]> => {
  const q = (params.q || '').trim();
  if (q.length < LIBRARY_SEARCH_MIN_CHARS) return [];
  const search = new URLSearchParams();
  search.set('q', q);
  if (params.courseId) search.set('courseId', params.courseId);
  if (params.types && params.types.length > 0) search.set('types', params.types.join(','));
  if (params.limit) search.set('limit', String(Math.min(50, Math.max(1, params.limit))));
  const rows = await academicRequest<LibrarySearchResult[] | null>(`/library/search?${search.toString()}`, {}, 10000);
  return Array.isArray(rows) ? rows : [];
};
