/**
 * Mobile Sync Service
 * Manages offline-first sync using the shared SyncQueue
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { AppState, AppStateStatus } from 'react-native';
import { 
  SyncQueue, 
  SyncManager, 
  SyncOperation, 
  SyncEntityType,
  IStorageAdapter,
  isTransientSyncError,
} from '@lantern/shared';
import * as api from './api';
import { supabase, saveBudgetTransaction, deleteBudgetTransaction } from './supabase';

// ============================================
// ASYNC STORAGE ADAPTER
// ============================================

class AsyncStorageAdapter implements IStorageAdapter {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    await AsyncStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    await AsyncStorage.clear();
  }

  async getAllKeys(): Promise<string[]> {
    const keys = await AsyncStorage.getAllKeys();
    return [...keys];
  }
}

// ============================================
// SYNC SERVICE SINGLETON
// ============================================

class SyncService {
  private queue: SyncQueue;
  private manager: SyncManager;
  private isInitialized: boolean = false;
  private networkUnsubscribe: (() => void) | null = null;
  private appStateSubscription: { remove: () => void } | null = null;
  private realtimeSubscriptions: Map<string, ReturnType<typeof supabase.channel>> = new Map();
  private periodicSyncInterval: ReturnType<typeof setInterval> | null = null;
  private retryAttempts: Map<string, number> = new Map();
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private readonly BASE_RETRY_DELAY = 1000; // 1 second

  constructor() {
    const storage = new AsyncStorageAdapter();
    this.queue = new SyncQueue(storage, 'latest-wins');
    this.manager = new SyncManager(this.queue, {
      autoSyncInterval: 30000, // 30 seconds
      syncOnReconnect: true,
      retryDelay: 5000,
    });
  }

  /**
   * Initialize the sync service
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    await this.queue.initialize();
    this.registerSyncHandlers();
    // Cold start online never sees an offline→online transition, so ops
    // parked in failedOperations by a previous session would sit forever.
    // Revive them now; the first sync pass picks them up.
    if (this.queue.getFailedCount() > 0) {
      await this.queue.retryFailed().catch(err =>
        console.error('[SyncService] Failed to revive failed operations at boot:', err)
      );
    }
    this.setupNetworkListener();
    this.setupAppStateListener();
    this.startPeriodicSync();
    this.manager.start();
    this.isInitialized = true;

    console.log('[SyncService] Initialized');
  }

  /**
   * Shutdown the sync service
   */
  shutdown(): void {
    this.manager.stop();
    if (this.networkUnsubscribe) {
      this.networkUnsubscribe();
    }
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    if (this.periodicSyncInterval) {
      clearInterval(this.periodicSyncInterval);
    }
    this.unsubscribeAllRealtime();
    this.isInitialized = false;
    console.log('[SyncService] Shutdown');
  }

  /**
   * Setup AppState listener for foreground sync
   */
  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        console.log('[SyncService] App came to foreground, triggering sync');
        this.syncNow().catch(err => console.error('[SyncService] Foreground sync failed:', err));
      }
    });
  }

  /**
   * Start periodic sync every 5 minutes
   */
  private startPeriodicSync(): void {
    const FIVE_MINUTES = 5 * 60 * 1000;
    this.periodicSyncInterval = setInterval(() => {
      const status = this.manager.getStatus();
      if (status.isOnline) {
        console.log('[SyncService] Periodic sync triggered');
        this.syncNow().catch(err => console.error('[SyncService] Periodic sync failed:', err));
      }
    }, FIVE_MINUTES);
  }

  /**
   * Calculate exponential backoff delay
   */
  private getRetryDelay(operationId: string): number {
    const attempts = this.retryAttempts.get(operationId) || 0;
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 16 seconds)
    const delay = Math.min(this.BASE_RETRY_DELAY * Math.pow(2, attempts), 16000);
    return delay;
  }

  /**
   * Handle retry with exponential backoff
   */
  private async retryWithBackoff(operationId: string, operation: () => Promise<boolean>): Promise<boolean> {
    const attempts = this.retryAttempts.get(operationId) || 0;
    
    if (attempts >= this.MAX_RETRY_ATTEMPTS) {
      console.error(`[SyncService] Max retry attempts reached for ${operationId}`);
      this.retryAttempts.delete(operationId);
      return false;
    }

    try {
      const result = await operation();
      if (result) {
        this.retryAttempts.delete(operationId);
        return true;
      }
      
      // Failed, schedule retry
      this.retryAttempts.set(operationId, attempts + 1);
      const delay = this.getRetryDelay(operationId);
      console.log(`[SyncService] Retrying ${operationId} in ${delay}ms (attempt ${attempts + 1})`);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryWithBackoff(operationId, operation);
    } catch (error) {
      this.retryAttempts.set(operationId, attempts + 1);
      const delay = this.getRetryDelay(operationId);
      console.error(`[SyncService] Error, retrying ${operationId} in ${delay}ms:`, error);
      
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.retryWithBackoff(operationId, operation);
    }
  }

  /**
   * Register sync handlers for each entity type
   */
  private registerSyncHandlers(): void {
    // Flashcard handler
    this.queue.registerHandler('flashcard', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
            await api.createFlashcard(
              op.userId, 
              op.data.deckId as string, 
              op.data as { type: 'BASIC' | 'CLOZE'; front?: string; back?: string; clozeText?: string; tags?: string[] }
            );
            break;
          case 'update':
            await api.updateFlashcard(op.entityId, op.data);
            break;
          case 'delete':
            await api.deleteFlashcard(op.entityId);
            break;
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:flashcard] Error:', error);
        return false;
      }
    });

    // Flashcard review handler (offline SRS replay)
    this.queue.registerHandler('flashcard_review', async (op: SyncOperation) => {
      try {
        if (op.operation === 'create') {
          const rating = op.data.rating as 'again' | 'hard' | 'good' | 'easy';
          // No CAS for queued replay: every op of a same-card double review
          // carried the same pre-sync version, so the second (and every later)
          // review 409'd and was dropped — one of N offline reviews survived.
          // Reviews are events; the server applies each on its current state.
          // Replay carries the ORIGINAL grade time so learning_events.occurred_at
          // reflects when the student actually studied, not when they synced.
          const reviewedAt =
            typeof op.data.reviewedAt === 'string' ? op.data.reviewedAt : undefined;
          await api.reviewFlashcard(
            op.entityId,
            rating,
            undefined,
            reviewedAt ? { reviewedAt } : undefined
          );
        }
        return true;
      } catch (error: any) {
        // On CAS conflict: drop this review (server already advanced); do not blind retry.
        if (error?.code === 'version_conflict' || error?.status === 409) {
          console.warn('[SyncHandler:flashcard_review] version conflict — dropping stale review', {
            flashcardId: op.entityId,
          });
          return true;
        }
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:flashcard_review] Error:', error);
        return false;
      }
    });

    // Deck handler
    this.queue.registerHandler('deck', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
            await api.createDeck(
              op.userId, 
              op.data as { name: string; description?: string }
            );
            break;
          case 'update':
            await api.updateDeck(op.entityId, op.data);
            break;
          case 'delete':
            await api.deleteDeck(op.entityId);
            break;
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:deck] Error:', error);
        return false;
      }
    });

    // Transaction handler (Supabase — same path as web)
    this.queue.registerHandler('transaction', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
            return await saveBudgetTransaction(
              op.userId,
              op.data as { id: string; type: string; amount: number; category?: string; description?: string; date: string }
            );
          case 'delete':
            return await deleteBudgetTransaction(op.entityId);
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:transaction] Error:', error);
        return false;
      }
    });

    // Budget handler
    this.queue.registerHandler('budget', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
          case 'update':
            await api.saveUserBudget(
              op.userId, 
              op.data as { monthlyLimit: number; monthYear: string }
            );
            break;
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:budget] Error:', error);
        return false;
      }
    });

    // Test result handler
    this.queue.registerHandler('test_result', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create': {
            const payload = op.data as {
              questions?: unknown[];
              userAnswers?: Record<string, unknown>;
              score: number;
              correctAnswersCount: number;
              totalQuestions: number;
              startTime?: string;
              endTime?: string;
              config?: unknown;
            };
            const savedSession = await api.saveTestResult(op.userId, payload);
            if (savedSession?.id) {
              await api.submitTestResult(savedSession.id, {
                score: payload.score,
                correctAnswersCount: payload.correctAnswersCount,
                totalQuestions: payload.totalQuestions,
              });
            }
            break;
          }
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:test_result] Error:', error);
        return false;
      }
    });

    // Marketplace listing handler
    this.queue.registerHandler('listing', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
            await api.createMarketplaceListing(
              op.data as {
                category: string;
                title: string;
                description?: string;
                price?: number;
                quantity?: number;
                location?: string;
                campus_id: string;
                images?: string[];
              }
            );
            break;
          case 'update':
            await api.updateMarketplaceListing(op.entityId, op.data);
            break;
          case 'delete':
            await api.deleteMarketplaceListing(op.entityId);
            break;
        }
        return true;
      } catch (error: any) {
        const status = error?.status;
        // REL-01: permanent client errors should not retry into failedOperations forever.
        if (typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429) {
          console.warn('[SyncHandler:listing] Dropping non-retryable error', {
            status,
            operation: op.operation,
            entityId: op.entityId,
          });
          return true;
        }
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:listing] Error:', error);
        return false;
      }
    });

    // Group handler
    this.queue.registerHandler('group', async (op: SyncOperation) => {
      try {
        switch (op.operation) {
          case 'create':
            await api.createGroup(op.data as {
              name: string;
              description?: string;
              avatar_url?: string;
              permissions?: any;
              invite_id: string;
              userId: string;
              memberIds: string[];
            });
            break;
          case 'update':
            await api.updateGroup(op.entityId, op.data);
            break;
        }
        return true;
      } catch (error) {
        // Dead connection: rethrow so the queue stops the run without burning
        // one of this operation's retries. `return false` means "server said no".
        if (isTransientSyncError(error)) throw error;
        console.error('[SyncHandler:group] Error:', error);
        return false;
      }
    });

    console.log('[SyncService] Handlers registered');
  }

  /**
   * Setup network connectivity listener
   */
  private setupNetworkListener(): void {
    let wasOnline: boolean | null = null;
    this.networkUnsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const isOnline = (state.isConnected && state.isInternetReachable !== false) ?? false;
      // Reconnect: give operations that exhausted their retries while the
      // connection was flaky another shot before the manager's sync kicks in.
      // (retryFailed existed but had NO caller — failedOperations was a black
      // hole nothing ever drained.)
      if (isOnline && wasOnline === false && this.queue.getFailedCount() > 0) {
        void this.queue
          .retryFailed()
          .catch(err => console.error('[SyncService] Failed to revive failed operations:', err));
      }
      wasOnline = isOnline;
      this.manager.setOnline(isOnline);
      console.log(`[SyncService] Network status: ${isOnline ? 'online' : 'offline'}`);
    });
  }

  // ============================================
  // PUBLIC API
  // ============================================

  /**
   * Queue an operation for sync
   */
  /**
   * Register a handler from outside this module. Chat lives in groupStore, and
   * registering its handler here would create an import cycle
   * (groupStore -> syncService -> groupStore).
   */
  registerHandler(
    entityType: SyncEntityType,
    handler: (op: SyncOperation) => Promise<boolean>
  ): void {
    this.queue.registerHandler(entityType, handler);
  }

  async queueOperation(
    entityType: SyncEntityType,
    entityId: string,
    operation: 'create' | 'update' | 'delete',
    data: Record<string, any>,
    userId: string
  ): Promise<string> {
    return this.queue.enqueue(entityType, entityId, operation, data, userId);
  }

  /**
   * Trigger immediate sync
   */
  async syncNow(): Promise<{ success: number; failed: number }> {
    return this.manager.syncNow();
  }

  /**
   * Get sync status
   */
  getStatus() {
    return this.manager.getStatus();
  }

  /**
   * Get pending operation count
   */
  getPendingCount(): number {
    return this.queue.getPendingCount();
  }

  /**
   * Check if there are pending operations
   */
  hasPendingOperations(): boolean {
    return this.queue.hasPendingOperations();
  }

  /**
   * Set status change callback
   */
  onStatusChange(callback: (isOnline: boolean, pendingCount: number) => void): void {
    this.manager.onStatus(callback);
  }

  // ============================================
  // REALTIME SUBSCRIPTIONS
  // ============================================

  /**
   * Subscribe to realtime updates for a table
   */
  subscribeToTable(
    tableName: string,
    filter: { column: string; value: string },
    onInsert?: (payload: any) => void,
    onUpdate?: (payload: any) => void,
    onDelete?: (payload: any) => void
  ): void {
    const channelName = `${tableName}:${filter.column}:${filter.value}`;
    
    if (this.realtimeSubscriptions.has(channelName)) {
      console.log(`[SyncService] Already subscribed to ${channelName}`);
      return;
    }

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
          filter: `${filter.column}=eq.${filter.value}`,
        },
        (payload) => {
          console.log(`[SyncService] Realtime event on ${tableName}:`, payload.eventType);
          
          switch (payload.eventType) {
            case 'INSERT':
              onInsert?.(payload.new);
              break;
            case 'UPDATE':
              onUpdate?.(payload.new);
              break;
            case 'DELETE':
              onDelete?.(payload.old);
              break;
          }
        }
      )
      .subscribe((status) => {
        console.log(`[SyncService] Subscription status for ${channelName}:`, status);
      });

    this.realtimeSubscriptions.set(channelName, channel);
  }

  /**
   * Subscribe to messages for a group
   */
  subscribeToGroupMessages(
    groupId: string,
    onNewMessage: (message: any) => void
  ): void {
    this.subscribeToTable(
      'messages',
      { column: 'group_id', value: groupId },
      onNewMessage,
      undefined,
      undefined
    );
  }

  /**
   * Subscribe to user's flashcards
   */
  subscribeToFlashcards(
    userId: string,
    onUpdate: (flashcard: any) => void
  ): void {
    this.subscribeToTable(
      'flashcards',
      { column: 'user_id', value: userId },
      onUpdate,
      onUpdate,
      undefined
    );
  }

  /**
   * Subscribe to user's notifications
   */
  subscribeToNotifications(
    userId: string,
    onNewNotification: (notification: any) => void
  ): void {
    this.subscribeToTable(
      'notifications',
      { column: 'user_id', value: userId },
      onNewNotification,
      undefined,
      undefined
    );
  }

  /**
   * Unsubscribe from a specific channel
   */
  unsubscribe(channelName: string): void {
    const channel = this.realtimeSubscriptions.get(channelName);
    if (channel) {
      supabase.removeChannel(channel);
      this.realtimeSubscriptions.delete(channelName);
      console.log(`[SyncService] Unsubscribed from ${channelName}`);
    }
  }

  /**
   * Unsubscribe from all realtime channels
   */
  unsubscribeAllRealtime(): void {
    for (const [name, channel] of this.realtimeSubscriptions) {
      supabase.removeChannel(channel);
    }
    this.realtimeSubscriptions.clear();
    console.log('[SyncService] Unsubscribed from all realtime channels');
  }
}

// Export singleton instance
export const syncService = new SyncService();

// Export types for use in stores
export type { SyncOperation, SyncEntityType };
