/**
 * Offline work queues — ONE cross-platform ownership and idempotency policy.
 *
 * PURPOSE. Web and mobile both keep a local queue of work a student finished
 * without a connection (test results, flashcard reviews, question-bank scores)
 * and replay it when the network comes back. Until this module they
 * implemented OPPOSITE data-loss semantics for the same situation: web PURGED
 * a queue that belonged to another account on sign-in, mobile PRESERVED it per
 * user. One of those destroys a student's work; the other, done wrong, uploads
 * A's test into B's account. This module is the single place that decides.
 *
 * EXPORTS
 *  - `stampOwner(entry, userId)` — write the owning account onto an entry.
 *  - `resolveEntryOwner(entry)` — read it back (entry, then session payload).
 *  - `decidePurge({ entryOwner, currentUser, stampPresent, … })` — the rule.
 *  - `mintResultIdempotencyKey` / `resultIdempotencyKey` /
 *    `ensureResultIdempotencyKey` — the attempt key carried to the server.
 *  - `OfflineQueueStorage` — the get/set/remove adapter web (localStorage) and
 *    mobile (AsyncStorage) plug into, plus `createMemoryOfflineQueueStorage`.
 *  - `OFFLINE_QUEUE_OWNER_KEY`, `OFFLINE_QUEUE_ERA_KEY`,
 *    `offlineQueueQuarantineKey`, `isOfflineQueuePreservedKey`.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 *
 * 1. An entry owned by the SIGNED-IN user replays. (`own`)
 *
 * 2. An entry owned by a DIFFERENT user is PRESERVED — never purged, never
 *    replayed. It is hidden from the current account and becomes visible
 *    again the moment its owner signs back in on this device. Deleting it is
 *    not "cleanup", it is destroying a student's unsynced work; replaying it
 *    is corrupting someone else's account. Neither is acceptable, so it is put
 *    aside. (`preserve`)
 *
 * 3. An entry with NO owner stamp is adopted by the signed-in user ONLY when
 *    both hold: it was created BEFORE stamping existed (`createdBeforeStamping`
 *    — the caller proves this from a durable era marker, it never guesses),
 *    AND there is no other signed-in evidence on this device
 *    (`otherSignedInEvidence`: unattributed work sitting next to a wiped
 *    stamp, or another owner present in the same queue). Otherwise the entry is
 *    QUARANTINED: kept on disk, never replayed into any account. (`adopt` /
 *    `quarantine`)
 *
 * 4. `decidePurge` NEVER returns "delete". `purge` is typed `false`. Callers
 *    cannot accidentally drop work by mis-reading a boolean.
 *
 * LOGOUT / SIGN-OUT. The owner stamp, the era marker, the quarantine keys AND
 * the queues themselves MUST survive — `isOfflineQueuePreservedKey` is what
 * the wipe consults, and it now covers every queue key, legacy and per-user.
 * A sign-out is not permission to destroy a finished test: the student may be
 * lending the handset, or switching accounts, and their work is stamped, so
 * their next sign-in replays it and a different account's does not see it.
 * Erasing the stamp while leaving the queue it guards is precisely how the
 * cross-account replay bug (E3 C5) worked: the next account signed in, found
 * no stamp, and adopted the previous student's finished tests.
 *
 * IDEMPOTENCY. The replay key is minted ONCE, at enqueue, and stored on the
 * entry. A retry re-reads it; it is never regenerated, because a fresh key on
 * every attempt is the same as having no key at all — the server creates a
 * second session for one sitting and the score is counted twice. An entry
 * queued before keys existed gets a DETERMINISTIC key derived from its own id,
 * which is stable across retries for the same reason.
 *
 * GOTCHAS. `packages/shared` is consumed BUILT by the API (`npm run build`),
 * and a new subpath needs a package.json `exports` entry plus (only if the API
 * imports it) an `apps/api-server/tsconfig.json` paths entry. Mobile jest maps
 * `@lantern/shared/*` to `src/*` already. This module is PURE — no storage, no
 * platform imports — so every rule above is unit-testable on its own.
 */

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Names the account whose work the local queues hold. Survives logout. */
export const OFFLINE_QUEUE_OWNER_KEY = 'lantern_offline_owner';

/**
 * Written the first time this policy runs on a device. Its ABSENCE is the only
 * honest proof that a queue predates owner stamping; its presence with no
 * owner stamp means the stamp was wiped (a logout) and the leftover work
 * belongs to whoever was signed in before. Survives logout.
 */
export const OFFLINE_QUEUE_ERA_KEY = 'lantern_offline_owner_era';

/** Prefix of the keys holding work put aside for an account that is not signed in. */
export const OFFLINE_QUEUE_QUARANTINE_PREFIX = 'lantern_offline_quarantine';

/** Owner bucket used when an entry's account cannot be established. */
export const OFFLINE_QUEUE_UNKNOWN_OWNER = 'unknown';

/**
 * The pre-split (unscoped) key of every offline work queue, on either platform.
 *
 * Each of these may still hold work that has not been migrated to
 * `<key>:<userId>` yet — and there is no way to tell from the key alone WHOSE
 * work that is. Deleting one therefore destroys some account's unsynced tests,
 * notes or scores, which is exactly what THE RULE forbids; they are migrated
 * per user on read instead. Scoped forms (`<key>:<userId>`) are preserved too:
 * they are owner-stamped, so the next sign-in of that owner reclaims them.
 */
export const OFFLINE_QUEUE_LEGACY_KEYS = [
  // mobile: pending offline test results
  '@lantern_pending_results',
  // mobile + shared: the create/update/delete sync queue
  'lantern_sync_queue',
  // mobile: queued question-bank scores
  '@lantern_pending_qbank_scores',
  // web: the three localStorage queues (fixed keys, never scoped)
  'pendingSyncResults',
  'lantern_pending_flashcard_reviews',
  'lantern_pending_qbank_scores',
] as const;

/** Where `queueKey`'s entries wait while `owner` is signed out. */
export const offlineQueueQuarantineKey = (queueKey: string, owner: string | null | undefined): string =>
  `${OFFLINE_QUEUE_QUARANTINE_PREFIX}:${queueKey}:${owner || OFFLINE_QUEUE_UNKNOWN_OWNER}`;

/**
 * Keys a logout/session wipe must NOT remove.
 *
 * The stamp and era marker are device facts, not session data, and the
 * quarantine holds another student's unsynced work. Clearing any of them
 * re-opens the cross-account replay this module exists to close.
 *
 * FIXED (G4 · H12): the queues THEMSELVES are on this list too, legacy and
 * per-user alike. A sign-out used to delete them on mobile — including the
 * pre-split legacy keys, which can hold an account that is not even signing
 * out — while THE RULE says nothing deletes unsynced work. They are
 * owner-stamped, so leaving them costs nothing: the next sign-in of their
 * owner replays them, and any other account's sign-in quarantines them.
 */
export const isOfflineQueuePreservedKey = (key: string): boolean =>
  key === OFFLINE_QUEUE_OWNER_KEY ||
  key === OFFLINE_QUEUE_ERA_KEY ||
  key.startsWith(`${OFFLINE_QUEUE_QUARANTINE_PREFIX}:`) ||
  OFFLINE_QUEUE_LEGACY_KEYS.some((legacy) => key === legacy || key.startsWith(`${legacy}:`));

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

/** The minimum an entry must expose for this module to place it. */
export interface OwnedQueueEntry {
  id?: string;
  /** The account that produced the work. Absent on legacy entries. */
  userId?: string | null;
  /** Offline results carry the submitted session; it may name the owner. */
  sessionPayload?: unknown;
  /** Older entries carried the attempt instead. */
  attempt?: unknown;
  /** Minted at enqueue; see `resultIdempotencyKey`. */
  idempotencyKey?: string | null;
}

const readUserId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const id = (value as { userId?: unknown }).userId;
  return typeof id === 'string' && id ? id : null;
};

/**
 * Who owns this entry, if it says. The entry's own `userId` wins; an offline
 * result may only name its account inside the session/attempt payload.
 */
export const resolveEntryOwner = (entry: OwnedQueueEntry | null | undefined): string | null => {
  if (!entry) return null;
  return readUserId(entry) || readUserId(entry.sessionPayload) || readUserId(entry.attempt);
};

/** Stamp the owning account onto an entry (idempotent, non-mutating). */
export const stampOwner = <T extends OwnedQueueEntry>(entry: T, userId: string): T => ({
  ...entry,
  userId,
});

/** Only the entries `userId` owns. An unowned entry is NOT assumed to be theirs. */
export const entriesOwnedBy = <T extends OwnedQueueEntry>(entries: T[], userId: string): T[] =>
  entries.filter((entry) => resolveEntryOwner(entry) === userId);

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type OfflineQueueDecision =
  /** This account's own work. Replay it. */
  | 'own'
  /** Unowned, provably pre-stamping, nothing to contradict it. Claim and replay. */
  | 'adopt'
  /** Another account's work. Put aside until they sign in. Never replay, never delete. */
  | 'preserve'
  /** Origin cannot be established. Keep on disk; replay into nobody. */
  | 'quarantine';

export interface PurgeDecisionInput {
  /** Owner recorded for the entry (or for the whole queue, on web). */
  entryOwner?: string | null;
  /** The account that is signed in right now. */
  currentUser?: string | null;
  /** Whether an owner stamp exists at all. False means legacy/unstamped. */
  stampPresent: boolean;
  /**
   * Proof — not a guess — that the entry predates owner stamping. The caller
   * establishes it from a durable era marker (`OFFLINE_QUEUE_ERA_KEY`).
   */
  createdBeforeStamping?: boolean;
  /**
   * Any sign that a different account has used this device's queue: unowned
   * work left behind by a logout, or a second owner in the same queue.
   */
  otherSignedInEvidence?: boolean;
}

export interface PurgeDecisionResult {
  decision: OfflineQueueDecision;
  /** Always false. Nothing in this policy deletes a student's unsynced work. */
  purge: false;
  /** May this entry be uploaded under `currentUser`? */
  replay: boolean;
  /** Owner to write onto the entry, when one can be established. */
  stampAs: string | null;
  /** Owner bucket to file the entry under while it is not replayable. */
  quarantineOwner: string | null;
}

/**
 * Decide what happens to one queue entry (or, on web, to the whole
 * fixed-key queue) for the account signing in. See THE RULE in the header.
 */
export function decidePurge(input: PurgeDecisionInput): PurgeDecisionResult {
  const currentUser = input.currentUser || null;
  const entryOwner = input.entryOwner || null;

  const result = (
    decision: OfflineQueueDecision,
    replay: boolean,
    stampAs: string | null,
    quarantineOwner: string | null
  ): PurgeDecisionResult => ({ decision, purge: false, replay, stampAs, quarantineOwner });

  // Nobody is signed in: there is no account to replay into, and no basis to
  // attribute anything. Hold everything.
  if (!currentUser) {
    return result('quarantine', false, null, entryOwner);
  }

  if (input.stampPresent && entryOwner) {
    if (entryOwner === currentUser) return result('own', true, currentUser, null);
    // Rule 2: another student's work. Preserved, hidden, reclaimable by them.
    return result('preserve', false, null, entryOwner);
  }

  // Rule 3: unstamped. Adoption needs BOTH proofs.
  if (input.createdBeforeStamping && !input.otherSignedInEvidence) {
    return result('adopt', true, currentUser, null);
  }
  return result('quarantine', false, null, entryOwner);
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/** The API caps `Idempotency-Key` at 128 chars (services/idempotency.ts). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;

const IDEMPOTENCY_PREFIX = 'test-result';

const randomUuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Not a security token — only uniqueness within one device's queue.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
};

const cap = (key: string): string =>
  key.length <= MAX_IDEMPOTENCY_KEY_LENGTH ? key : key.slice(0, MAX_IDEMPOTENCY_KEY_LENGTH);

/**
 * Mint the key for ONE attempt. Call exactly once, when the result is queued —
 * never on a retry. A fresh key per attempt is the same as no key: the server
 * writes a second session for one sitting and the score is counted twice.
 */
export const mintResultIdempotencyKey = (): string =>
  cap(`${IDEMPOTENCY_PREFIX}:${randomUuid()}`);

/**
 * The key to send for `entry`. Returns the stored one; for an entry queued
 * before keys existed, derives a DETERMINISTIC key from the entry's own id, so
 * the value is identical on every retry. Never random for a given entry.
 */
export function resultIdempotencyKey(
  entry: OwnedQueueEntry | null | undefined,
  options?: { userId?: string | null }
): string {
  const stored = entry?.idempotencyKey;
  if (typeof stored === 'string' && stored.trim()) return cap(stored.trim());
  const owner = resolveEntryOwner(entry) || options?.userId || 'anon';
  const id = (entry && typeof entry.id === 'string' && entry.id) || 'no-id';
  return cap(`${IDEMPOTENCY_PREFIX}:legacy:${owner}:${id}`);
}

/**
 * Stamp a key onto an entry at enqueue time if it has none. Idempotent: an
 * entry that already carries a key is returned untouched, which is what makes
 * a retry reuse the first attempt's key.
 */
export function ensureResultIdempotencyKey<T extends OwnedQueueEntry>(
  entry: T
): T & { idempotencyKey: string } {
  if (typeof entry.idempotencyKey === 'string' && entry.idempotencyKey.trim()) {
    return entry as T & { idempotencyKey: string };
  }
  return { ...entry, idempotencyKey: mintResultIdempotencyKey() };
}

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

/**
 * The only thing a platform has to supply. Web wraps localStorage (sync),
 * mobile wraps AsyncStorage (async) — both satisfy this, so every caller
 * awaits and neither platform needs its own copy of the policy above.
 */
export interface OfflineQueueStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/** In-memory adapter for tests. */
export function createMemoryOfflineQueueStorage(
  seed?: Record<string, string>
): OfflineQueueStorage & { dump(): Record<string, string> } {
  const map = new Map<string, string>(Object.entries(seed || {}));
  return {
    get: (key) => (map.has(key) ? (map.get(key) as string) : null),
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    dump: () => Object.fromEntries(map.entries()),
  };
}

/** Parse a stored queue. Corrupt payloads read as empty rather than throwing. */
export function parseQueue<T extends OwnedQueueEntry>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter(Boolean) as T[]) : [];
  } catch {
    return [];
  }
}

/** Merge queues by entry id, last occurrence winning; id-less entries are kept. */
export function mergeQueues<T extends OwnedQueueEntry>(...lists: T[][]): T[] {
  const byId = new Map<string, T>();
  const unkeyed: T[] = [];
  for (const list of lists) {
    for (const entry of list) {
      if (typeof entry?.id === 'string' && entry.id) byId.set(entry.id, entry);
      else unkeyed.push(entry);
    }
  }
  return [...byId.values(), ...unkeyed];
}

/**
 * Move `entries` into the quarantine bucket for `owner`, merging with whatever
 * is already there. Returns the new bucket contents; the caller writes it.
 */
export function quarantineEntries<T extends OwnedQueueEntry>(
  existingRaw: string | null | undefined,
  entries: T[]
): T[] {
  return mergeQueues(parseQueue<T>(existingRaw), entries);
}
