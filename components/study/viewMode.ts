/**
 * Grid or list, and the order — the rules, with no React in them.
 *
 * StudyFetch lets a student switch every material list between a tile grid and
 * a compact list, and remembers which they chose. Lantern drew one hardcoded
 * shape per surface: `Recent materials` was always a four-across grid of
 * 11rem tiles, and the set room's lectures were always label-only rows. Neither
 * could be changed, so a set with twenty lectures was twenty rows with no dates
 * and no way to see more than a title, and a set with three PDFs spent a whole
 * screen on three tiles.
 *
 * PER SURFACE, NOT PER APP. The preference is keyed by surface because the two
 * lists answer different questions: the materials grid is browsed by picture,
 * the lecture list is scanned by name and date. A student who wants tiles in
 * one and rows in the other is not being inconsistent.
 *
 * Pure and store-injectable so the three things that actually go wrong — a
 * stored value from an older build, a browser that throws on `localStorage`
 * itself, and a sort that reorders equal rows on every render — are testable
 * without a browser. Modelled on `utils/boardBookmarks.ts`.
 */

export type ViewMode = 'grid' | 'list';

export const VIEW_MODES: readonly ViewMode[] = ['grid', 'list'];

/** The surfaces that own a remembered view. One key each. */
export type ViewSurface =
  | 'setRoomMaterials'
  | 'setRoomLectures'
  // The Wave 3 pages. Own keys, because the set home's eight-tile grid and the
  // whole-set Materials page are browsed for different reasons — a student who
  // wants rows on the archive page has not asked for rows on Home.
  | 'setMaterialsPage'
  | 'practiceHub';

export type MaterialSortId = 'newest' | 'oldest' | 'alpha';

export const MATERIAL_SORTS: ReadonlyArray<{ id: MaterialSortId; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'alpha', label: 'A–Z' },
];

export function materialSortLabel(sort: MaterialSortId): string {
  return MATERIAL_SORTS.find((entry) => entry.id === sort)?.label ?? 'Newest first';
}

export function isViewMode(value: unknown): value is ViewMode {
  return value === 'grid' || value === 'list';
}

export function isMaterialSortId(value: unknown): value is MaterialSortId {
  return value === 'newest' || value === 'oldest' || value === 'alpha';
}

/* ------------------------------------------------------------- the sorting */

/** What sorting needs to read. Anything with a name and a date qualifies. */
export interface SortableMaterial {
  id: string;
  title?: string | null;
  createdAt?: string | null;
}

function addedAt(item: SortableMaterial): number {
  const time = item.createdAt ? Date.parse(item.createdAt) : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * A copy of `items` in the chosen order.
 *
 * Ties break on `id`, always. `Array.prototype.sort` is stable in every engine
 * this ships to, but the INPUT is not: the notes store hands out a fresh array
 * whose order follows whatever the last sync wrote, so two lectures uploaded in
 * the same second would swap places between renders without a tiebreak. A list
 * that reorders while you are reading it is worse than one in the wrong order.
 *
 * An unparseable or missing `createdAt` sorts as the epoch rather than being
 * dropped: a material with no date is still a material you can open.
 */
export function sortMaterials<T extends SortableMaterial>(
  items: readonly T[],
  sort: MaterialSortId
): T[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (sort === 'alpha') {
      const byTitle = (a.title || '').localeCompare(b.title || '', undefined, {
        sensitivity: 'base',
        numeric: true,
      });
      if (byTitle !== 0) return byTitle;
    } else {
      const delta = sort === 'newest' ? addedAt(b) - addedAt(a) : addedAt(a) - addedAt(b);
      if (delta !== 0) return delta;
    }
    return a.id.localeCompare(b.id);
  });
  return copy;
}

/* ------------------------------------------------------------ remembering */

/** The slice of `localStorage` this module needs. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * `localStorage`, or nothing.
 *
 * The ACCESSOR itself is inside the try: an embedded webview, a private
 * window, or a browser set to block site data throws on the property read, not
 * on the call, and an uncaught throw here would take the whole set room down
 * over a remembered toggle.
 */
export function browserStore(): KeyValueStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function readKey(store: KeyValueStore | null, key: string): string | null {
  if (!store) return null;
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(store: KeyValueStore | null, key: string, value: string): void {
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // A full quota must not cost the student the click they just made.
  }
}

export function viewModeKey(surface: ViewSurface): string {
  return `lantern.viewMode.${surface}`;
}

export function materialSortKey(surface: ViewSurface): string {
  return `lantern.materialSort.${surface}`;
}

/**
 * The remembered view, or `fallback`.
 *
 * `fallback` is each surface's CURRENT shape, so a student who has never
 * touched the toggle sees exactly what they saw before it existed.
 */
export function readViewMode(
  surface: ViewSurface,
  fallback: ViewMode,
  store: KeyValueStore | null = browserStore()
): ViewMode {
  const stored = readKey(store, viewModeKey(surface));
  return isViewMode(stored) ? stored : fallback;
}

export function writeViewMode(
  surface: ViewSurface,
  mode: ViewMode,
  store: KeyValueStore | null = browserStore()
): void {
  writeKey(store, viewModeKey(surface), mode);
}

export function readMaterialSort(
  surface: ViewSurface,
  fallback: MaterialSortId,
  store: KeyValueStore | null = browserStore()
): MaterialSortId {
  const stored = readKey(store, materialSortKey(surface));
  return isMaterialSortId(stored) ? stored : fallback;
}

export function writeMaterialSort(
  surface: ViewSurface,
  sort: MaterialSortId,
  store: KeyValueStore | null = browserStore()
): void {
  writeKey(store, materialSortKey(surface), sort);
}
