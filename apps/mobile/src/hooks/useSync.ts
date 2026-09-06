/**
 * Network & Sync Hooks
 * React hooks for network connectivity and sync status
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { syncService } from '../services/syncService';
import { useOfflineStore } from '../stores/offlineStore';
import { useAuthStore } from '../stores/authStore';
import { readPendingQuestionBankScores } from '../utils/pendingQuestionBankScores';
import {
  summarisePendingWork,
  type PendingWorkSummary,
} from '../utils/pendingWork';

/**
 * Replay offline test results saved in the offline store (these live outside
 * the SyncQueue). Loads the local cache first so results queued before this
 * app session are picked up too.
 */
async function syncOfflineTestResults(userId: string): Promise<void> {
  const store = useOfflineStore.getState();
  if (store.isSyncing) return;
  if (store.pendingResults.length === 0) {
    // Pass the user: pending results are stored per account, and an unscoped
    // load would neither find this student's queue nor be safe to upload.
    await store.loadOfflineData(userId);
  }
  const { pendingResults, isSyncing, syncPendingResults } = useOfflineStore.getState();
  if (isSyncing || !pendingResults.some(r => !r.synced)) return;
  try {
    await syncPendingResults(userId);
    console.log('[useAutoSync] Offline test results synced');
  } catch (error) {
    console.warn('[useAutoSync] Offline test result sync failed:', error);
  }
}

// ============================================
// useNetworkStatus Hook
// ============================================

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string;
}

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true,
    isInternetReachable: true,
    type: 'unknown',
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setStatus({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      });
    });

    // Get initial state
    NetInfo.fetch().then((state) => {
      setStatus({
        isConnected: state.isConnected ?? false,
        isInternetReachable: state.isInternetReachable,
        type: state.type,
      });
    });

    return () => unsubscribe();
  }, []);

  return status;
}

// ============================================
// useSyncStatus Hook
// ============================================

export interface SyncStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncTime: number | null;
  /** Entity type of each pending queue operation, for the pending breakdown. */
  pendingEntityTypes: string[];
}

function readSyncStatus(): SyncStatus {
  const { isOnline, queueStatus } = syncService.getStatus();
  return {
    isOnline,
    pendingCount: queueStatus.pendingOperations.length,
    isSyncing: queueStatus.isSyncing,
    lastSyncTime: queueStatus.lastSyncTime,
    pendingEntityTypes: queueStatus.pendingOperations.map(op => op.entityType),
  };
}

function sameSyncStatus(a: SyncStatus, b: SyncStatus): boolean {
  return (
    a.isOnline === b.isOnline &&
    a.pendingCount === b.pendingCount &&
    a.isSyncing === b.isSyncing &&
    a.lastSyncTime === b.lastSyncTime &&
    a.pendingEntityTypes.length === b.pendingEntityTypes.length &&
    a.pendingEntityTypes.every((t, i) => t === b.pendingEntityTypes[i])
  );
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => ({
    isOnline: true,
    pendingCount: 0,
    isSyncing: false,
    lastSyncTime: null,
    pendingEntityTypes: [],
  }));

  useEffect(() => {
    // onStatusChange returns an unsubscribe: several components mount this
    // hook at once, and each must keep receiving updates after the others
    // unmount.
    const unsubscribe = syncService.onStatusChange(() => {
      // Keep the previous object when nothing actually moved: the auto-sync
      // timer fires regularly and must not re-render every indicator.
      setStatus(prev => {
        const next = readSyncStatus();
        return sameSyncStatus(prev, next) ? prev : next;
      });
    });
    setStatus(prev => {
      const next = readSyncStatus();
      return sameSyncStatus(prev, next) ? prev : next;
    });
    return unsubscribe;
  }, []);

  return status;
}

// ============================================
// usePendingWork Hook
// ============================================

export interface UsePendingWorkResult extends PendingWorkSummary {
  /** Re-read the question-bank score queue (AsyncStorage) on demand. */
  refresh: () => void;
}

/**
 * Every piece of work waiting to upload, in one honest number.
 *
 * Three separate queues feed this — see utils/pendingWork.ts. Before it, the
 * UI counted only offline test results, so a queued flashcard or message read
 * as "Pending Sync 0" while the work sat unsent.
 */
export function usePendingWork(): UsePendingWorkResult {
  const sync = useSyncStatus();
  // Primitive/array-reference selectors only — never build an object inside a
  // zustand selector.
  const userId = useAuthStore(s => s.user?.id) ?? '';
  const pendingResults = useOfflineStore(s => s.pendingResults);
  const unsyncedResults = useMemo(
    () => pendingResults.filter(r => !r.synced).length,
    [pendingResults]
  );

  const [pendingScores, setPendingScores] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);
  const refresh = useCallback(() => setRefreshToken(t => t + 1), []);

  // The score queue lives in AsyncStorage, so it is read on the events that
  // can change it — never on every render.
  const queueCount = sync.pendingCount;
  const isSyncing = sync.isSyncing;
  const lastSyncTime = sync.lastSyncTime;
  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setPendingScores(0);
      return;
    }
    readPendingQuestionBankScores(userId)
      .then(entries => {
        if (!cancelled) setPendingScores(entries.length);
      })
      .catch(() => {
        // A read failure must not blank the rest of the counter.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, queueCount, unsyncedResults, isSyncing, lastSyncTime, refreshToken]);

  // Re-read when the student comes back to the app: a score can be queued by a
  // path that touches none of the counts above.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') refreshRef.current();
    });
    return () => subscription.remove();
  }, []);

  const summary = useMemo(
    () =>
      summarisePendingWork({
        queueEntityTypes: sync.pendingEntityTypes,
        pendingResults: unsyncedResults,
        pendingScores,
      }),
    [sync.pendingEntityTypes, unsyncedResults, pendingScores]
  );

  return { ...summary, refresh };
}

// ============================================
// useSync Hook (Combined)
// ============================================

export interface UseSyncResult {
  network: NetworkStatus;
  sync: SyncStatus;
  /** Every queue folded together — total, breakdown and honest copy. */
  pendingWork: UsePendingWorkResult;
  syncNow: () => Promise<{ success: number; failed: number }>;
  hasPendingChanges: boolean;
}

export function useSync(): UseSyncResult {
  const network = useNetworkStatus();
  const sync = useSyncStatus();
  const pendingWork = usePendingWork();

  const syncNow = useCallback(async () => {
    return syncService.syncNow();
  }, []);

  return {
    network,
    sync,
    pendingWork,
    syncNow,
    // Any queue, not just the SyncQueue: results and scores are work too.
    hasPendingChanges: pendingWork.total > 0,
  };
}

// ============================================
// useOnlineEffect Hook
// ============================================

/**
 * Run an effect when coming back online
 */
export function useOnlineEffect(
  effect: () => void | Promise<void>,
  deps: React.DependencyList = []
): void {
  const [wasOffline, setWasOffline] = useState(false);
  const network = useNetworkStatus();

  useEffect(() => {
    if (!network.isConnected) {
      setWasOffline(true);
    } else if (wasOffline && network.isConnected) {
      setWasOffline(false);
      effect();
    }
  }, [network.isConnected, wasOffline, ...deps]);
}

// ============================================
// useAutoSync Hook
// ============================================

/**
 * Automatically sync when conditions are met
 */
export function useAutoSync(
  userId: string | undefined,
  options: {
    syncOnMount?: boolean;
    syncOnReconnect?: boolean;
    syncInterval?: number | null; // null to disable
  } = {}
): {
  isSyncing: boolean;
  pendingCount: number;
  lastSyncTime: number | null;
  syncNow: () => Promise<void>;
} {
  const {
    syncOnMount = true,
    syncOnReconnect = true,
    syncInterval = null,
  } = options;

  const sync = useSyncStatus();
  const network = useNetworkStatus();
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  // Initialize sync service
  useEffect(() => {
    if (userId) {
      syncService.initialize();
    }
    
    return () => {
      // Don't shutdown on unmount, just on app close
    };
  }, [userId]);

  // Sync on mount
  useEffect(() => {
    if (syncOnMount && userId && network.isConnected) {
      syncService.syncNow();
      void syncOfflineTestResults(userId);
    }
  }, [syncOnMount, userId]);

  // Sync on reconnect
  useOnlineEffect(() => {
    if (syncOnReconnect && userId) {
      syncService.syncNow();
      void syncOfflineTestResults(userId);
    }
  }, [syncOnReconnect, userId]);

  // Periodic sync
  useEffect(() => {
    if (!syncInterval || !userId) return;

    const interval = setInterval(() => {
      if (network.isConnected) {
        syncService.syncNow();
      }
    }, syncInterval);

    return () => clearInterval(interval);
  }, [syncInterval, userId, network.isConnected]);

  const syncNow = useCallback(async () => {
    if (!network.isConnected) {
      console.log('[useAutoSync] Cannot sync: offline');
      return;
    }
    
    setIsManualSyncing(true);
    try {
      await syncService.syncNow();
    } finally {
      setIsManualSyncing(false);
    }
  }, [network.isConnected]);

  return {
    isSyncing: sync.isSyncing || isManualSyncing,
    pendingCount: sync.pendingCount,
    lastSyncTime: sync.lastSyncTime,
    syncNow,
  };
}

export default {
  useNetworkStatus,
  useSyncStatus,
  usePendingWork,
  useSync,
  useOnlineEffect,
  useAutoSync,
};
