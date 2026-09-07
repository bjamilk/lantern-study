/**
 * Where "I've read this page" is remembered.
 *
 * There is no server-side note-progress table on web today, and inventing a
 * fake one would be worse than saying nothing: a checkmark that silently
 * disappears on another device is a lie about what was saved. So marks live in
 * this browser's localStorage, keyed by attachment, and the screen says so out
 * loud ("Saved on this device").
 *
 * The shape is deliberately tiny — a done list, the last page opened, and the
 * student's check spacing — so the whole record for a document is a few dozen
 * bytes and a quota failure cannot take the walk-through down with it. Every
 * read and write is wrapped: private mode, a cleared profile and a corrupted
 * value all degrade to "nothing remembered", never to a crash.
 */
import { DEFAULT_CHECK_EVERY_N_PAGES } from '../../utils/walkthroughModel';

const STORAGE_KEY = 'lantern_walkthrough_progress_v1';
/** Documents remembered at once. Oldest-touched records fall off the end. */
const MAX_TRACKED_ATTACHMENTS = 40;

export interface WalkthroughRecord {
  /** 0-based page indexes the student marked done. */
  done: number[];
  /** The page they were on last, so re-opening resumes rather than restarts. */
  lastPageIndex: number;
  /** How often to OFFER a check. 0 means the student turned checks off. */
  checkEveryN: number;
  /** Checks already offered, so one is not re-offered forever. */
  checked: number[];
  updatedAt: number;
}

type Store = Record<string, WalkthroughRecord>;

export const EMPTY_RECORD: WalkthroughRecord = {
  done: [],
  lastPageIndex: 0,
  checkEveryN: DEFAULT_CHECK_EVERY_N_PAGES,
  checked: [],
  updatedAt: 0,
};

function readStore(): Store {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Trim before writing, not after: an unbounded map is how a "harmless"
    // convenience cache turns into a quota error on an unrelated feature.
    const entries = Object.entries(store)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(0, MAX_TRACKED_ATTACHMENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode / quota — the marks are a convenience, not the work */
  }
}

function sanitizeIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  for (const entry of value) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry >= 0) {
      seen.add(Math.floor(entry));
    }
  }
  return [...seen].sort((a, b) => a - b);
}

/** Read one document's marks. Always returns a usable record. */
export function loadWalkthroughRecord(attachmentId: string): WalkthroughRecord {
  if (!attachmentId) return { ...EMPTY_RECORD };
  const raw = readStore()[attachmentId];
  if (!raw || typeof raw !== 'object') return { ...EMPTY_RECORD };
  const checkEveryN =
    typeof raw.checkEveryN === 'number' && Number.isFinite(raw.checkEveryN) && raw.checkEveryN >= 0
      ? Math.floor(raw.checkEveryN)
      : DEFAULT_CHECK_EVERY_N_PAGES;
  return {
    done: sanitizeIndexes(raw.done),
    checked: sanitizeIndexes(raw.checked),
    lastPageIndex:
      typeof raw.lastPageIndex === 'number' && Number.isFinite(raw.lastPageIndex) && raw.lastPageIndex >= 0
        ? Math.floor(raw.lastPageIndex)
        : 0,
    checkEveryN,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
  };
}

/** Write one document's marks. */
export function saveWalkthroughRecord(attachmentId: string, record: WalkthroughRecord): void {
  if (!attachmentId) return;
  const store = readStore();
  store[attachmentId] = {
    done: sanitizeIndexes(record.done),
    checked: sanitizeIndexes(record.checked),
    lastPageIndex: Math.max(0, Math.floor(record.lastPageIndex || 0)),
    checkEveryN: Math.max(0, Math.floor(record.checkEveryN ?? DEFAULT_CHECK_EVERY_N_PAGES)),
    updatedAt: Date.now(),
  };
  writeStore(store);
}

/** True when this browser can remember anything at all. Drives the caption. */
export function walkthroughProgressIsPersistent(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
