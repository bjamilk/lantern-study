// ===========================================
// Lantern Study - Storage Adapter Interface
// ===========================================
// Platform-agnostic storage interface for web and mobile

/**
 * Storage adapter interface that can be implemented by:
 * - WebStorageAdapter (localStorage)
 * - MobileStorageAdapter (AsyncStorage/WatermelonDB)
 */
export interface IStorageAdapter {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
    getAllKeys(): Promise<string[]>;
}

/**
 * Web storage adapter using localStorage
 * Use this in the web app
 */
export class WebStorageAdapter implements IStorageAdapter {
    async getItem(key: string): Promise<string | null> {
        if (typeof window === 'undefined') return null;
        return localStorage.getItem(key);
    }

    async setItem(key: string, value: string): Promise<void> {
        if (typeof window === 'undefined') return;
        localStorage.setItem(key, value);
    }

    async removeItem(key: string): Promise<void> {
        if (typeof window === 'undefined') return;
        localStorage.removeItem(key);
    }

    async clear(): Promise<void> {
        if (typeof window === 'undefined') return;
        localStorage.clear();
    }

    async getAllKeys(): Promise<string[]> {
        if (typeof window === 'undefined') return [];
        return Object.keys(localStorage);
    }
}

/**
 * JSON storage wrapper for type-safe storage operations
 */
export class TypedStorage<T> {
    constructor(
        private adapter: IStorageAdapter,
        private key: string,
        private defaultValue: T
    ) {}

    async get(): Promise<T> {
        const value = await this.adapter.getItem(this.key);
        if (value === null) return this.defaultValue;
        try {
            return JSON.parse(value) as T;
        } catch {
            return this.defaultValue;
        }
    }

    async set(value: T): Promise<void> {
        await this.adapter.setItem(this.key, JSON.stringify(value));
    }

    async remove(): Promise<void> {
        await this.adapter.removeItem(this.key);
    }

    async update(updater: (current: T) => T): Promise<T> {
        const current = await this.get();
        const updated = updater(current);
        await this.set(updated);
        return updated;
    }
}

// Storage keys constants
export const STORAGE_KEYS = {
    AUTH_TOKEN: 'auth_token',
    USER: 'current_user',
    THEME: 'app_theme',
    OFFLINE_BUNDLES: 'offline_bundles',
    PENDING_SYNC: 'pending_sync_queue',
    LAST_SYNC: 'last_sync_timestamp',
    FLASHCARDS: 'flashcards',
    DECKS: 'decks',
    TEST_RESULTS: 'test_results',
    SETTINGS: 'user_settings',
} as const;

// Default storage adapter (web)
let defaultAdapter: IStorageAdapter = new WebStorageAdapter();

export const setDefaultStorageAdapter = (adapter: IStorageAdapter): void => {
    defaultAdapter = adapter;
};

export const getDefaultStorageAdapter = (): IStorageAdapter => {
    return defaultAdapter;
};
