// ===========================================
// Lantern Study - Sync System
// ===========================================
// Local-first sync queue with conflict resolution

import { IStorageAdapter } from '../storage';

// ============================================
// TYPES
// ============================================

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

const SYNC_QUEUE_KEY = 'lantern_sync_queue';
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

export class SyncQueue {
  private storage: IStorageAdapter;
  private state: SyncQueueState;
  private conflictStrategy: ConflictResolutionStrategy;
  private onSyncComplete?: (operation: SyncOperation, success: boolean) => void;
  private syncHandlers: Map<SyncEntityType, (op: SyncOperation) => Promise<boolean>>;

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

  /**
   * Initialize queue by loading from storage
   */
  async initialize(): Promise<void> {
    try {
      const stored = await this.storage.getItem(SYNC_QUEUE_KEY);
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
      await this.storage.setItem(SYNC_QUEUE_KEY, JSON.stringify({
        pendingOperations: this.state.pendingOperations,
        failedOperations: this.state.failedOperations,
        lastSyncTime: this.state.lastSyncTime,
      }));
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

    this.state.isSyncing = true;
    let success = 0;
    let failed = 0;

    // Sort by timestamp to process in order
    const operations = [...this.state.pendingOperations].sort(
      (a, b) => a.timestamp - b.timestamp
    );

    for (const op of operations) {
      const handler = this.syncHandlers.get(op.entityType);
      
      if (!handler) {
        console.warn(`[SyncQueue] No handler for ${op.entityType}`);
        continue;
      }

      try {
        const result = await handler(op);
        
        if (result) {
          // Remove from pending
          this.state.pendingOperations = this.state.pendingOperations.filter(
            p => p.id !== op.id
          );
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
    this.state.lastSyncTime = Date.now();
    await this.persistState();

    console.log(`[SyncQueue] Processed: ${success} success, ${failed} failed`);
    return { success, failed };
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
   * Clear all operations (use with caution)
   */
  async clear(): Promise<void> {
    this.state.pendingOperations = [];
    this.state.failedOperations = [];
    await this.persistState();
  }
}

// ============================================
// CONFLICT RESOLUTION
// ============================================

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

