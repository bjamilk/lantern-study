// ===========================================
// Lantern Study - Offline Store (Zustand)
// ===========================================
// Cross-platform offline sync state management

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { OfflineSessionBundle, TestResult } from '../types';
import { getDefaultStorageAdapter, STORAGE_KEYS } from '../storage';

export interface SyncQueueItem {
    id: string;
    type: 'test_result' | 'flashcard_update' | 'message';
    data: any;
    timestamp: string;
    retryCount: number;
}

interface OfflineState {
    isOnline: boolean;
    offlineBundles: OfflineSessionBundle[];
    pendingSyncQueue: SyncQueueItem[];
    lastSyncTimestamp: string | null;
    isSyncing: boolean;
    syncError: string | null;

    // Online status
    setOnlineStatus: (isOnline: boolean) => void;

    // Offline bundles
    addOfflineBundle: (bundle: OfflineSessionBundle) => void;
    removeOfflineBundle: (bundleId: string) => void;
    clearOfflineBundles: () => void;

    // Sync queue
    addToSyncQueue: (item: Omit<SyncQueueItem, 'id' | 'timestamp' | 'retryCount'>) => void;
    removeFromSyncQueue: (id: string) => void;
    incrementRetryCount: (id: string) => void;
    clearSyncQueue: () => void;

    // Sync state
    setSyncing: (isSyncing: boolean) => void;
    setSyncError: (error: string | null) => void;
    setLastSyncTimestamp: (timestamp: string) => void;

    // Helpers
    hasPendingSync: () => boolean;
    getPendingSyncCount: () => number;
}

const generateId = () => Math.random().toString(36).substring(2, 15);

export const useOfflineStore = create<OfflineState>()(
    persist(
        (set, get) => ({
            isOnline: true,
            offlineBundles: [],
            pendingSyncQueue: [],
            lastSyncTimestamp: null,
            isSyncing: false,
            syncError: null,

            // Online status
            setOnlineStatus: (isOnline: boolean) => set({ isOnline }),

            // Offline bundles
            addOfflineBundle: (bundle: OfflineSessionBundle) => set((state) => ({
                offlineBundles: [...state.offlineBundles, bundle]
            })),

            removeOfflineBundle: (bundleId: string) => set((state) => ({
                offlineBundles: state.offlineBundles.filter(b => b.bundleId !== bundleId)
            })),

            clearOfflineBundles: () => set({ offlineBundles: [] }),

            // Sync queue
            addToSyncQueue: (item) => set((state) => ({
                pendingSyncQueue: [
                    ...state.pendingSyncQueue,
                    {
                        ...item,
                        id: generateId(),
                        timestamp: new Date().toISOString(),
                        retryCount: 0,
                    }
                ]
            })),

            removeFromSyncQueue: (id: string) => set((state) => ({
                pendingSyncQueue: state.pendingSyncQueue.filter(item => item.id !== id)
            })),

            incrementRetryCount: (id: string) => set((state) => ({
                pendingSyncQueue: state.pendingSyncQueue.map(item =>
                    item.id === id 
                        ? { ...item, retryCount: item.retryCount + 1 }
                        : item
                )
            })),

            clearSyncQueue: () => set({ pendingSyncQueue: [] }),

            // Sync state
            setSyncing: (isSyncing: boolean) => set({ isSyncing }),
            setSyncError: (syncError: string | null) => set({ syncError }),
            setLastSyncTimestamp: (lastSyncTimestamp: string) => set({ lastSyncTimestamp }),

            // Helpers
            hasPendingSync: () => get().pendingSyncQueue.length > 0,
            getPendingSyncCount: () => get().pendingSyncQueue.length,
        }),
        {
            name: STORAGE_KEYS.PENDING_SYNC,
            storage: createJSONStorage(() => ({
                getItem: async (name: string) => {
                    const adapter = getDefaultStorageAdapter();
                    return adapter.getItem(name);
                },
                setItem: async (name: string, value: string) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.setItem(name, value);
                },
                removeItem: async (name: string) => {
                    const adapter = getDefaultStorageAdapter();
                    await adapter.removeItem(name);
                },
            })),
            partialize: (state) => ({
                offlineBundles: state.offlineBundles,
                pendingSyncQueue: state.pendingSyncQueue,
                lastSyncTimestamp: state.lastSyncTimestamp,
            }),
        }
    )
);
