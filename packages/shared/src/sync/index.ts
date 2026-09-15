// ===========================================
// Lantern Study - Sync System
// ===========================================
// Local-first sync queue with conflict resolution
//
// PURPOSE
//   The offline queue. Work a student does with no connection is written to
//   local storage as a SyncOperation, then replayed against the API when the
//   connection returns. Two classes: `SyncQueue` (durable list + replay) and
//   `SyncManager` (the timer and online/offline supervisor around it).
//
//   The product promise this file keeps is "your work is never lost". Every
//   rule below exists because some version of it once was.
//
// CONSUMERS
//   mobile — the main consumer; the queue is the reason a review on the bus
//            still counts.
//   web    — uses it for the same offline paths, backed by its own storage
//            adapter.
//   api    — no.
//
// HOW IT WORKS
//   enqueue -> persisted under a PER-USER key -> processQueue replays each
//   operation through a handler registered by entity type -> success drops it,
//   failure either retries (up to maxRetries) or moves it to failedOperations.
//
// THE FOUR RULES THAT MUST NOT BE SOFTENED
//   1. PER-USER STORAGE. Operations live under `lantern_sync_queue:<userId>`
//      (see ./syncQueueScope). One shared key meant the next student to sign
//      in on a shared handset replayed the previous student's work under their
//      own session, and a sign-out wiped everyone's queue.
//   2. EVENTS ARE NOT DEDUPED. Flashcard reviews and test results are each
//      individually meaningful. Last-write-wins dedupe by entity id threw away
//      real work — two offline reviews of the same card synced as one.
//   3. TRANSIENT ERRORS MUST RETHROW. A handler that returns `false` for a
//      dead connection burns one of the operation's three retries. Handlers
//      must call `isTransientSyncError` and RETHROW so the operation is
//      retried later rather than exhausted while offline.
//   4. NOTHING IS DROPPED SILENTLY. An operation that cannot be replayed ends
//      up in failedOperations where the UI can surface it — it is never
//      discarded to keep the queue tidy.
//
// GOTCHAS
//   - `packages/shared` is consumed BUILT: `npm run build` in packages/shared
//     before typechecking or running web/mobile.
//   - New subpaths need a package.json `exports` entry and an api tsconfig
//     `paths` entry; mobile jest maps `@lantern/shared/*` separately, so a
//     subpath only a test imports fails CI-only with TS2307.
//   - The web turbo build enforces `noUncheckedIndexedAccess`.
//   - `setActiveUser` is re-entrant-guarded (`switching`). Sign-in fan-out can
//     call it more than once; the guard is why the queue does not get merged
//     into the wrong key mid-switch.

import { IStorageAdapter } from '../storage';
import {
  SYNC_QUEUE_LEGACY_KEY,
  emptySyncQueueSnapshot,
  mergeSyncQueueSnapshots,
  parseSyncQueueSnapshot,
  planSyncQueueLoad,
  syncQueueKey,
  type SyncQueueSnapshot,
} from './syncQueueScope';

export * from './syncQueueScope';

// ============================================
// TYPES
// ============================================

// A SyncOperation is the unit of durable offline work: what entity, which id,
// create/update/delete, the payload, and how many replay attempts remain.
// `userId` is load-bearing — it decides which storage key the operation lives
// under and which account it may ever be replayed against.

export type SyncOperationType = 'create' | 'update' | 'delete';

export type SyncEntityType = 
  | 'flashcard' 
  | 'flashcard_review'
  | 'deck' 
  | 'test_result' 
  | 'message' 
  | 'group' 
  | 'budget' 
  | 'transaction'
  | 'settings'
  | 'notification'
  | 'listing'
  | 'note';

export interface SyncOperation {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperationType;
  data: Record<string, any>;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  lastError?: string;
  userId: string;
}

export interface SyncQueueState {
  pendingOperations: SyncOperation[];
  failedOperations: SyncOperation[];
  lastSyncTime: number | null;
  isSyncing: boolean;
}

export interface ConflictResolutionResult {
  resolved: boolean;
  winner: 'local' | 'remote';
  mergedData?: Record<string, any>;
}

export type ConflictResolutionStrategy = 'local-wins' | 'remote-wins' | 'latest-wins' | 'merge';

// ============================================
// SYNC QUEUE CLASS
// ============================================

const SYNC_QUEUE_KEY = SYNC_QUEUE_LEGACY_KEY;
const MAX_RETRIES = 3;

/**
 * Event-type entities are individually meaningful — every flashcard review
 * moves FSRS scheduling, every test result is its own attempt. Deduping them
 * by entity id silently discarded real work (review card A twice offline →
 * only the second review ever synced). Only state-type entities keep
 * last-write-wins dedupe.
 */
const EVENT_ENTITY_TYPES: ReadonlySet<SyncEntityType> = new Set([
  'flashcard_review',
  'test_result',
]);

/** A failure that means "the connection is down", not "the server said no".
    Exported so sync handlers can RETHROW these instead of returning false —
    a false return burns one of the operation's retries, which a dead
    connection must never do. */
export function isTransientSyncError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error ?? '');
  return /network|failed to fetch|fetch failed|timeout|timed out|abort|offline|econn|socket/i.test(msg);
}

// The durable queue itself. Owns: the per-user storage key, enqueue/dedupe
// policy, the replay loop, retry accounting, and the legacy-key migration on
// first load. Handlers are registered per entity type by the app at boot —
// SyncQueue knows nothing about the API.

export class SyncQueue {
  private storage: IStorageAdapter;
  private state: SyncQueueState;
  private conflictStrategy: ConflictResolutionStrategy;
  private onSyncComplete?: (operation: SyncOperation, success: boolean) => void;
  private syncHandlers: Map<SyncEntityType, (op: SyncOperation) => Promise<boolean>>;
  /**
   * The account whose operations are in memory, and whose scoped key is
   * persisted to. `null` means no user has been set — the queue then reads and
   * writes the legacy unscoped key, which is the behaviour web callers that
   * never call `setActiveUser` have always had.
   */
  private activeUserId: string | null = null;
  /**
   * > 0 while `setActiveUser` is between emptying memory and loading the new
   * account's operations. `processQueue` must not run (and persist an empty
   * snapshot over the new key) in that window.
   */
  private switching = 0;

  constructor(
    storage: IStorageAdapter,
    conflictStrategy: ConflictResolutionStrategy = 'latest-wins'
  ) {
    this.storage = storage;
    this.conflictStrategy = conflictStrategy;
    this.syncHandlers = new Map();
    this.state = {
      pendingOperations: [],
      failedOperations: [],
      lastSyncTime: null,
      isSyncing: false,
    };
  }

  /** The account the in-memory queue belongs to (`null` = legacy/unscoped). */
  getActiveUserId(): string | null {
    return this.activeUserId;
  }

  /** The storage key the in-memory queue is persisted to. */
  private activeKey(): string {
    return this.activeUserId ? syncQueueKey(this.activeUserId) : SYNC_QUEUE_KEY;
  }

  /**
   * Switch the queue to `userId`.
   *
   * Runs the one-time legacy migration (each owner's operations are written to
   * their own scoped key and the shared key is deleted), loads that user's
   * operations into memory, and drops the previous user's operations from
   * memory — those stay persisted under their own key and come back when they
   * sign in again.
   *
   * Passing `null` empties memory and returns the queue to the legacy key.
   */
  async setActiveUser(userId: string | null): Promise<void> {
    if (userId === this.activeUserId) return;

    if (!userId) {
      this.activeUserId = null;
      this.state.pendingOperations = [];
      this.state.failedOperations = [];
      this.state.lastSyncTime = null;
      return;
    }

    this.activeUserId = userId;
    this.state.pendingOperations = [];
    this.state.failedOperations = [];
    this.state.lastSyncTime = null;
    this.switching++;

    try {
      const [scopedRaw, legacyRaw] = await Promise.all([
        this.storage.getItem(syncQueueKey(userId)),
        this.storage.getItem(SYNC_QUEUE_KEY),
      ]);

      const plan = planSyncQueueLoad<SyncOperation>(userId, scopedRaw, legacyRaw);

      for (const write of plan.writes) {
        if (write.key === syncQueueKey(userId)) {
          await this.writeSnapshot(write.key, write.ops);
        } else {
          // Another account's partition. Merge rather than overwrite: they may
          // already have written a scoped key of their own.
          await this.mergeIntoKey(write.key, write.ops);
        }
      }

      if (plan.removeLegacy) {
        await this.storage.removeItem(SYNC_QUEUE_KEY);
      }
      if (plan.droppedOwnerless > 0) {
        console.warn(
          `[SyncQueue] Dropped ${plan.droppedOwnerless} legacy operation(s) with no userId — they cannot be replayed under an account`
        );
      }

      this.state.pendingOperations = plan.ops.pendingOperations;
      this.state.failedOperations = plan.ops.failedOperations;
      this.state.lastSyncTime = plan.ops.lastSyncTime;
    } catch (error) {
      console.error('[SyncQueue] Failed to switch active user:', error);
    } finally {
      this.switching--;
    }
  }

  private async writeSnapshot(
    key: string,
    snapshot: SyncQueueSnapshot<SyncOperation>
  ): Promise<void> {
    await this.storage.setItem(key, JSON.stringify(snapshot));
  }

  /** Read-merge-write, so a write never clobbers operations we did not load. */
  private async mergeIntoKey(
    key: string,
    snapshot: SyncQueueSnapshot<SyncOperation>
  ): Promise<void> {
    const existing = parseSyncQueueSnapshot<SyncOperation>(await this.storage.getItem(key));
    await this.writeSnapshot(key, mergeSyncQueueSnapshots(existing, snapshot));
  }

  /**
   * Initialize queue by loading from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await this.storage.getItem(this.activeKey());
      if (stored) {
        const parsed = JSON.parse(stored);
        this.state = {
          ...this.state,
          pendingOperations: parsed.pendingOperations || [],
          failedOperations: parsed.failedOperations || [],
          lastSyncTime: parsed.lastSyncTime || null,
        };
      }
    } catch (error) {
      console.error('[SyncQueue] Failed to initialize:', error);
    }
  }

  /**
   * Persist queue state to storage
   */
  private async persistState(): Promise<void> {
    try {
      await this.writeSnapshot(this.activeKey(), {
        pendingOperations: this.state.pendingOperations,
        failedOperations: this.state.failedOperations,
        lastSyncTime: this.state.lastSyncTime,
      });
    } catch (error) {
      console.error('[SyncQueue] Failed to persist state:', error);
    }
  }

  /**
   * Register a sync handler for an entity type
   */
  registerHandler(
    entityType: SyncEntityType,
    handler: (op: SyncOperation) => Promise<boolean>
  ): void {
    this.syncHandlers.set(entityType, handler);
  }

  /**
   * Set callback for sync completion
   */
  onComplete(callback: (operation: SyncOperation, success: boolean) => void): void {
    this.onSyncComplete = callback;
  }

  /**
   * Add an operation to the sync queue
   */
  async enqueue(
    entityType: SyncEntityType,
    entityId: string,
    operation: SyncOperationType,
    data: Record<string, any>,
    userId: string
  ): Promise<string> {
    const opId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const syncOp: SyncOperation = {
      id: opId,
      entityType,
      entityId,
      operation,
      data: {
        ...data,
        _localTimestamp: Date.now(),
      },
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries: MAX_RETRIES,
      userId,
    };

    // An operation queued for somebody other than the signed-in account is
    // persisted to THAT account's key and kept out of this session's queue, so
    // it is never replayed under the wrong user — and never silently lost.
    if (this.activeUserId && userId !== this.activeUserId) {
      console.warn(
        `[SyncQueue] Enqueued ${operation} for ${entityType}:${entityId} owned by ${userId}, not the active user ${this.activeUserId} — persisted to their queue`
      );
      await this.mergeIntoKey(syncQueueKey(userId), {
        ...emptySyncQueueSnapshot<SyncOperation>(),
        pendingOperations: [syncOp],
      });
      return opId;
    }

    // Check for existing operations on same entity and deduplicate.
    // Never for event-type entities — each of those operations is real work.
    if (!EVENT_ENTITY_TYPES.has(entityType)) {
      this.state.pendingOperations = this.state.pendingOperations.filter(
        op => !(op.entityId === entityId && op.entityType === entityType && op.operation === operation)
      );
    }

    this.state.pendingOperations.push(syncOp);
    await this.persistState();
    
    console.log(`[SyncQueue] Enqueued ${operation} for ${entityType}:${entityId}`);
    return opId;
  }

  /**
   * Process all pending operations
   */
  async processQueue(): Promise<{ success: number; failed: number }> {
    if (this.state.isSyncing) {
      console.log('[SyncQueue] Already syncing, skipping');
      return { success: 0, failed: 0 };
    }
    if (this.switching > 0) {
      // Memory is empty while the next account's operations load; running now
      // would persist that emptiness over their key.
      return { success: 0, failed: 0 };
    }

    this.state.isSyncing = true;
    let success = 0;
    let failed = 0;

    // The account this run belongs to. `setActiveUser` can swap the queue
    // underneath an `await handler(op)`; from then on nothing here may touch
    // the (now different) in-memory state or run the previous user's ops.
    const owner = this.activeUserId;
    const ownerKey = this.activeKey();
    const succeededIds = new Set<string>();
    const ownerChanged = () => this.activeUserId !== owner;

    // Sort by timestamp to process in order
    const operations = [...this.state.pendingOperations].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    for (const op of operations) {
      if (ownerChanged()) {
        console.warn('[SyncQueue] Active user changed mid-sync; abandoning the rest of the run');
        break;
      }
      const handler = this.syncHandlers.get(op.entityType);
      
      if (!handler) {
        console.warn(`[SyncQueue] No handler for ${op.entityType}`);
        continue;
      }

      try {
        const result = await handler(op);

        if (ownerChanged()) {
          // The op already ran; remember a success so it is not replayed for
          // its owner, but do not touch the new account's state.
          if (result) succeededIds.add(op.id);
          break;
        }
        
        if (result) {
          // Remove from pending
          this.state.pendingOperations = this.state.pendingOperations.filter(
            p => p.id !== op.id
          );
          succeededIds.add(op.id);
          success++;
          this.onSyncComplete?.(op, true);
        } else {
          // Increment retry count
          op.retryCount++;
          if (op.retryCount >= op.maxRetries) {
            // Move to failed
            this.state.pendingOperations = this.state.pendingOperations.filter(
              p => p.id !== op.id
            );
            this.state.failedOperations.push(op);
          }
          failed++;
          this.onSyncComplete?.(op, false);
        }
      } catch (error: any) {
        console.error(`[SyncQueue] Error processing ${op.entityType}:${op.entityId}:`, error);
        if (ownerChanged()) break;
        op.lastError = error.message;

        // A dead connection is not the operation's fault: don't burn one of
        // its attempts, and stop the run — everything behind it will fail the
        // same way. Before this, going through a tunnel three times moved an
        // op into failedOperations, which nothing ever drained.
        if (isTransientSyncError(error)) {
          failed++;
          this.onSyncComplete?.(op, false);
          break;
        }

        op.retryCount++;

        if (op.retryCount >= op.maxRetries) {
          this.state.pendingOperations = this.state.pendingOperations.filter(
            p => p.id !== op.id
          );
          this.state.failedOperations.push(op);
        }
        failed++;
        this.onSyncComplete?.(op, false);
      }
    }

    this.state.isSyncing = false;

    if (ownerChanged()) {
      // Memory now belongs to another account. Record this run's successes
      // against the previous owner's stored queue so they are not replayed
      // when that account signs back in; nothing else is written.
      await this.dropStoredOperations(ownerKey, succeededIds);
      console.log(`[SyncQueue] Processed (abandoned on user change): ${success} success, ${failed} failed`);
      return { success, failed };
    }

    this.state.lastSyncTime = Date.now();
    await this.persistState();

    console.log(`[SyncQueue] Processed: ${success} success, ${failed} failed`);
    return { success, failed };
  }

  /** Remove `ids` from the queue persisted under `key` without loading it into memory. */
  private async dropStoredOperations(key: string, ids: ReadonlySet<string>): Promise<void> {
    if (ids.size === 0) return;
    try {
      const raw = await this.storage.getItem(key);
      // Nothing stored (a user sign-out already removed it): do not resurrect the key.
      if (raw == null) return;
      const stored = parseSyncQueueSnapshot<SyncOperation>(raw);
      await this.writeSnapshot(key, {
        ...stored,
        pendingOperations: stored.pendingOperations.filter(op => !ids.has(op.id)),
        failedOperations: stored.failedOperations.filter(op => !ids.has(op.id)),
      });
    } catch (error) {
      console.error('[SyncQueue] Failed to record synced operations for previous user:', error);
    }
  }

  /**
   * Retry failed operations
   */
  async retryFailed(): Promise<void> {
    // Move failed back to pending with reset retry count
    for (const op of this.state.failedOperations) {
      op.retryCount = 0;
      op.lastError = undefined;
      this.state.pendingOperations.push(op);
    }
    this.state.failedOperations = [];
    await this.persistState();
  }

  /**
   * Clear a specific operation
   */
  async removeOperation(operationId: string): Promise<void> {
    this.state.pendingOperations = this.state.pendingOperations.filter(
      op => op.id !== operationId
    );
    this.state.failedOperations = this.state.failedOperations.filter(
      op => op.id !== operationId
    );
    await this.persistState();
  }

  /**
   * Get queue status
   */
  getStatus(): SyncQueueState {
    return { ...this.state };
  }

  /**
   * Get pending count
   */
  getPendingCount(): number {
    return this.state.pendingOperations.length;
  }

  /** Number of operations parked in failedOperations awaiting a retryFailed(). */
  getFailedCount(): number {
    return this.state.failedOperations.length;
  }

  /**
   * Check if there are pending operations
   */
  hasPendingOperations(): boolean {
    return this.state.pendingOperations.length > 0;
  }

  /**
   * Clear the ACTIVE user's operations (use with caution). Other accounts'
   * queues, persisted under their own keys, are untouched.
   */
  async clear(): Promise<void> {
    this.state.pendingOperations = [];
    this.state.failedOperations = [];
    await this.persistState();
  }

  /** Clear one account's queue, whether or not they are the active user. */
  async clearForUser(userId: string): Promise<void> {
    if (userId === this.activeUserId) {
      await this.clear();
      return;
    }
    try {
      await this.storage.removeItem(syncQueueKey(userId));
    } catch (error) {
      console.error('[SyncQueue] Failed to clear queue for user:', error);
    }
  }
}

// ============================================
// CONFLICT RESOLUTION
// ============================================

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------
// Applied when a replayed write collides with a newer server copy. Strategies
// are chosen per queue, not per operation. `latest-wins` is the usual pick;
// `merge` exists for documents where both sides may hold real edits.

export function resolveConflict(
  localData: Record<string, any>,
  remoteData: Record<string, any>,
  strategy: ConflictResolutionStrategy
): ConflictResolutionResult {
  const localTimestamp = localData._localTimestamp || localData.updated_at || 0;
  const remoteTimestamp = remoteData.updated_at || remoteData._serverTimestamp || 0;

  switch (strategy) {
    case 'local-wins':
      return { resolved: true, winner: 'local' };

    case 'remote-wins':
      return { resolved: true, winner: 'remote' };

    case 'latest-wins':
      if (localTimestamp > remoteTimestamp) {
        return { resolved: true, winner: 'local' };
      }
      return { resolved: true, winner: 'remote' };

    case 'merge':
      // Simple merge: combine fields, prefer local for conflicts
      const merged = { ...remoteData };
      for (const key of Object.keys(localData)) {
        if (key.startsWith('_')) continue; // Skip internal fields
        if (localData[key] !== undefined && localData[key] !== null) {
          // If local has a value and it was modified after remote, use local
          if (localTimestamp > remoteTimestamp) {
            merged[key] = localData[key];
          }
        }
      }
      return { resolved: true, winner: 'local', mergedData: merged };

    default:
      return { resolved: true, winner: 'remote' };
  }
}

// ============================================
// SYNC MANAGER
// ============================================

// ---------------------------------------------------------------------------
// SyncManager: when the queue actually runs
// ---------------------------------------------------------------------------
// Wraps a SyncQueue with an auto-sync interval and an online/offline flag the
// app feeds from its connectivity listener. Going online triggers a drain;
// going offline stops the timer rather than letting operations burn retries
// against a connection that is not there (see rule 3 above).

export interface SyncManagerConfig {
  autoSyncInterval: number; // ms between auto-syncs
  syncOnReconnect: boolean;
  retryDelay: number; // ms between retries
}

const DEFAULT_CONFIG: SyncManagerConfig = {
  autoSyncInterval: 30000, // 30 seconds
  syncOnReconnect: true,
  retryDelay: 5000,
};

export class SyncManager {
  private queue: SyncQueue;
  private config: SyncManagerConfig;
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private isOnline: boolean = true;
  private onStatusChange?: (isOnline: boolean, pendingCount: number) => void;

  constructor(queue: SyncQueue, config: Partial<SyncManagerConfig> = {}) {
    this.queue = queue;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Start auto-sync
   */
  start(): void {
    if (this.autoSyncTimer) return;
    
    this.autoSyncTimer = setInterval(async () => {
      if (this.isOnline && this.queue.hasPendingOperations()) {
        await this.queue.processQueue();
        this.notifyStatusChange();
      }
    }, this.config.autoSyncInterval);

    console.log('[SyncManager] Started auto-sync');
  }

  /**
   * Stop auto-sync
   */
  stop(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    console.log('[SyncManager] Stopped auto-sync');
  }

  /**
   * Handle online status change
   */
  setOnline(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (online && wasOffline && this.config.syncOnReconnect) {
      console.log('[SyncManager] Back online, syncing...');
      this.syncNow();
    }

    this.notifyStatusChange();
  }

  /**
   * Trigger immediate sync
   */
  async syncNow(): Promise<{ success: number; failed: number }> {
    if (!this.isOnline) {
      console.log('[SyncManager] Offline, skipping sync');
      return { success: 0, failed: 0 };
    }

    const result = await this.queue.processQueue();
    this.notifyStatusChange();
    return result;
  }

  /**
   * Set status change callback
   */
  onStatus(callback: (isOnline: boolean, pendingCount: number) => void): void {
    this.onStatusChange = callback;
  }

  private notifyStatusChange(): void {
    this.onStatusChange?.(this.isOnline, this.queue.getPendingCount());
  }

  /**
   * Get current status
   */
  getStatus(): { isOnline: boolean; queueStatus: SyncQueueState } {
    return {
      isOnline: this.isOnline,
      queueStatus: this.queue.getStatus(),
    };
  }
}

