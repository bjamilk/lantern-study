/**
 * Where "I stopped here" is remembered for a narration.
 *
 * Same reasoning as the walk-through's done marks: there is no server-side
 * listening-position table, and inventing one would be a lie about what was
 * saved. So the position lives in this browser's localStorage, keyed by
 * attachment, and the player says out loud that it is a per-device memory.
 *
 * The record is three fields — segment, speed, voice — because a resume that
 * comes back at the wrong speed in a different voice is not a resume. Every
 * read and write is wrapped: private mode, a cleared profile and a corrupted
 * value all degrade to "start from the top", never to a crash.
 */
import {
  clampNarrationRate,
  parseNarrationPosition,
  EMPTY_NARRATION_POSITION,
  type NarrationPosition,
} from '../../utils/narrationPlayerModel';

const STORAGE_KEY = 'lantern_narration_position_v1';
/** Documents remembered at once. Oldest-touched records fall off the end. */
const MAX_TRACKED_ATTACHMENTS = 40;

interface StoredPosition extends NarrationPosition {
  updatedAt: number;
}

type Store = Record<string, StoredPosition>;

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
    // Trimmed before writing: an unbounded map is how a convenience cache
    // becomes a quota error on an unrelated feature.
    const entries = Object.entries(store)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0))
      .slice(0, MAX_TRACKED_ATTACHMENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* private mode / quota — the position is a convenience, not the work */
  }
}

/** Read one document's position. Always returns something usable. */
export function loadNarrationPosition(attachmentId: string): NarrationPosition {
  if (!attachmentId) return { ...EMPTY_NARRATION_POSITION };
  return parseNarrationPosition(readStore()[attachmentId]);
}

/** Write one document's position. */
export function saveNarrationPosition(
  attachmentId: string,
  position: NarrationPosition
): void {
  if (!attachmentId) return;
  const store = readStore();
  store[attachmentId] = {
    segmentIndex: Math.max(0, Math.floor(position.segmentIndex || 0)),
    rate: clampNarrationRate(position.rate),
    voiceURI: position.voiceURI,
    updatedAt: Date.now(),
  };
  writeStore(store);
}

/** True when this browser can remember anything at all. Drives the caption. */
export function narrationPositionIsPersistent(): boolean {
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
