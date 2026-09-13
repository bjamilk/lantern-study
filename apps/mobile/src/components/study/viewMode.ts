/**
 * Grid or list, and the order — the rules, with no React in them.
 *
 * The phone's port of `components/study/viewMode.ts` (web). Same surfaces, same
 * option ids, same fallbacks, so a student who puts the set room's lectures in
 * a list on the laptop is not told a different story about what the control
 * does on the phone. The two preferences are stored separately on purpose:
 * these are per-device chrome, not account settings, and a phone screen and a
 * laptop screen genuinely want different shapes for the same list.
 *
 * ONE DIFFERENCE FROM WEB, AND IT IS THE STORE. `localStorage` is synchronous;
 * `AsyncStorage` is not. So the read returns a promise here, and the hook that
 * consumes it paints the surface's own default first and swaps once the answer
 * lands (see ViewModeToggle.tsx). Everything above the store — the sort, the
 * guards, the keys — stays pure and synchronous, which is the part worth
 * testing and the part that must not drift from the web.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export type ViewMode = 'grid' | 'list';

export const VIEW_MODES: readonly ViewMode[] = ['grid', 'list'];

/** The surfaces that own a remembered view. One key each. */
export type ViewSurface = 'setRoomMaterials' | 'setRoomLectures';

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
 * Ties break on `id`, always. The INPUT order is not stable: the notes store
 * hands out a fresh array whose order follows whatever the last sync wrote, so
 * two lectures recorded in the same second would swap places between renders
 * without a tiebreak. A list that reorders while you are reading it is worse
 * than one in the wrong order — and on a phone, where the row you were aiming
 * at moves under your thumb, it is worse still.
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

/** The slice of `AsyncStorage` this module needs. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * `AsyncStorage`, or nothing.
 *
 * The module reference itself is inside the try: a bundle where the native
 * module failed to link hands back `undefined`, and an uncaught throw here
 * would take the whole set room down over a remembered toggle.
 */
export function deviceStore(): KeyValueStore | null {
  try {
    return AsyncStorage ?? null;
  } catch {
    return null;
  }
}

async function readKey(store: KeyValueStore | null, key: string): Promise<string | null> {
  if (!store) return null;
  try {
    return await store.getItem(key);
  } catch {
    return null;
  }
}

async function writeKey(store: KeyValueStore | null, key: string, value: string): Promise<void> {
  if (!store) return;
  try {
    await store.setItem(key, value);
  } catch {
    // A full disk must not cost the student the tap they just made.
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
export async function readViewMode(
  surface: ViewSurface,
  fallback: ViewMode,
  store: KeyValueStore | null = deviceStore()
): Promise<ViewMode> {
  const stored = await readKey(store, viewModeKey(surface));
  return isViewMode(stored) ? stored : fallback;
}

export async function writeViewMode(
  surface: ViewSurface,
  mode: ViewMode,
  store: KeyValueStore | null = deviceStore()
): Promise<void> {
  await writeKey(store, viewModeKey(surface), mode);
}

export async function readMaterialSort(
  surface: ViewSurface,
  fallback: MaterialSortId,
  store: KeyValueStore | null = deviceStore()
): Promise<MaterialSortId> {
  const stored = await readKey(store, materialSortKey(surface));
  return isMaterialSortId(stored) ? stored : fallback;
}

export async function writeMaterialSort(
  surface: ViewSurface,
  sort: MaterialSortId,
  store: KeyValueStore | null = deviceStore()
): Promise<void> {
  await writeKey(store, materialSortKey(surface), sort);
}
