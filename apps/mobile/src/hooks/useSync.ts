/**
 * Network & Sync Hooks
 * React hooks for network connectivity and sync status
 */
import { useState, useEffect, useCallback } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { syncService } from '../services/syncService';

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
}

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>({
    isOnline: true,
    pendingCount: 0,
    isSyncing: false,
    lastSyncTime: null,
  });

  useEffect(() => {
    // Set up status change listener
    syncService.onStatusChange((isOnline, pendingCount) => {
      const queueStatus = syncService.getStatus().queueStatus;
      setStatus({
        isOnline,
        pendingCount,
        isSyncing: queueStatus.isSyncing,
        lastSyncTime: queueStatus.lastSyncTime,
      });
    });

    // Get initial status
    const initialStatus = syncService.getStatus();
    setStatus({
      isOnline: initialStatus.isOnline,
      pendingCount: initialStatus.queueStatus.pendingOperations.length,
      isSyncing: initialStatus.queueStatus.isSyncing,
      lastSyncTime: initialStatus.queueStatus.lastSyncTime,
    });
  }, []);

  return status;
}

// ============================================
// useSync Hook (Combined)
// ============================================

export interface UseSyncResult {
  network: NetworkStatus;
  sync: SyncStatus;
  syncNow: () => Promise<{ success: number; failed: number }>;
  hasPendingChanges: boolean;
}

export function useSync(): UseSyncResult {
  const network = useNetworkStatus();
  const sync = useSyncStatus();

  const syncNow = useCallback(async () => {
    return syncService.syncNow();
  }, []);

  return {
    network,
    sync,
    syncNow,
    hasPendingChanges: sync.pendingCount > 0,
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
    }
  }, [syncOnMount, userId]);

  // Sync on reconnect
  useOnlineEffect(() => {
    if (syncOnReconnect && userId) {
      syncService.syncNow();
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
  useSync,
  useOnlineEffect,
  useAutoSync,
};
