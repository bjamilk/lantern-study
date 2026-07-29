import { createClient, RedisClientType } from 'redis';
import { LRUCache } from 'lru-cache';
import { CacheConfig } from '../types';
// Don't import logger at top level - it causes circular dependency issues
// import { logger } from '../utils/logger';

interface CacheEntry {
  value: any;
  expiry?: number;
}

export class CacheService {
  private client: RedisClientType | null = null;
  private isConnected: boolean = false;
  // LRU cache with max 10,000 entries and 100MB size limit
  private memoryCache: LRUCache<string, CacheEntry>;

  constructor(private config: { url: string; keyPrefix?: string } = { url: process.env.REDIS_URL || 'redis://localhost:6379' }) {
    // Initialize LRU cache with eviction policy
    this.memoryCache = new LRUCache<string, CacheEntry>({
      max: 10000, // Maximum 10,000 entries
      maxSize: 100 * 1024 * 1024, // 100MB max total size
      sizeCalculation: (entry: CacheEntry) => {
        try {
          return JSON.stringify(entry.value).length;
        } catch {
          return 1000; // Default size estimate if serialization fails
        }
      },
      ttl: 1000 * 60 * 5, // Default 5 minute TTL
      updateAgeOnGet: true, // Refresh TTL on access
      allowStale: false,
    });
    console.log('CacheService initialized with LRU memory cache (max: 10,000 entries, 100MB)');
  }

  async connectRedis(): Promise<void> {
    if (this.client) return;
    
    try {
      this.client = createClient({
        url: this.config.url,
      });

      this.client.on('error', (err) => {
        console.warn('Redis Client Error (falling back to memory cache):', err.message);
        this.isConnected = false;
        this.client = null;
      });

      this.client.on('connect', () => {
        console.log('Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('Disconnected from Redis');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.warn('Failed to connect to Redis (using memory cache):', error);
      this.client = null;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
    }
  }

  private getKey(key: string): string {
    const prefix = this.config.keyPrefix || 'lantern:';
    return `${prefix}${key}`;
  }

  private isExpired(entry: { value: any; expiry?: number }): boolean {
    return entry.expiry ? Date.now() > entry.expiry : false;
  }

  private isProductionRedisRequired(): boolean {
    return process.env.NODE_ENV === 'production' && process.env.REDIS_ENABLED === 'true';
  }

  private shouldUseMemoryFallback(): boolean {
    return !this.isProductionRedisRequired();
  }

  async get<T>(key: string): Promise<T | null> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        const data = await this.client.get(cacheKey);
        return data ? JSON.parse(data) : null;
      } catch (error) {
        console.error('Redis get error:', error);
        if (!this.shouldUseMemoryFallback()) throw error;
      }
    }

    if (!this.shouldUseMemoryFallback()) {
      return null;
    }

    // Memory cache fallback (development only)
    const entry = this.memoryCache.get(cacheKey);
    if (entry && !this.isExpired(entry)) {
      return entry.value;
    } else if (entry) {
      this.memoryCache.delete(cacheKey);
    }

    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        const serializedValue = JSON.stringify(value);
        if (ttl) {
          await this.client.setEx(cacheKey, ttl, serializedValue);
        } else {
          await this.client.set(cacheKey, serializedValue);
        }
        return;
      } catch (error) {
        console.error('Redis set error:', error);
        if (!this.shouldUseMemoryFallback()) throw error;
      }
    }

    if (!this.shouldUseMemoryFallback()) {
      return;
    }

    // Memory cache fallback (development only)
    const expiry = ttl ? Date.now() + (ttl * 1000) : undefined;
    this.memoryCache.set(cacheKey, { value, expiry });
  }

  async delete(key: string): Promise<void> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        await this.client.del(cacheKey);
      } catch (error) {
        console.error('Redis delete error:', error);
      }
    }

    // Always clear memory cache
    this.memoryCache.delete(cacheKey);
  }

  async deletePattern(pattern: string): Promise<void> {
    const cachePattern = this.getKey(pattern);

    if (this.client && this.isConnected) {
      try {
        const keysToDelete: string[] = [];
        for await (const key of this.client.scanIterator({
          MATCH: cachePattern,
          COUNT: 100,
        })) {
          const normalized = Array.isArray(key) ? key : [key];
          keysToDelete.push(...normalized.filter((k): k is string => typeof k === 'string'));
          if (keysToDelete.length >= 500) {
            await this.client.del(keysToDelete as [string, ...string[]]);
            keysToDelete.length = 0;
          }
        }
        if (keysToDelete.length > 0) {
          await this.client.del(keysToDelete as [string, ...string[]]);
        }
      } catch (error) {
        console.error('Redis delete pattern error:', error);
      }
    }

    // Clear memory cache - simple implementation
    for (const [key] of this.memoryCache) {
      if (key.startsWith(cachePattern.replace('*', ''))) {
        this.memoryCache.delete(key);
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        const result = await this.client.exists(cacheKey);
        return result === 1;
      } catch (error) {
        console.error('Redis exists error:', error);
      }
    }

    // Memory cache fallback
    const entry = this.memoryCache.get(cacheKey);
    return !!(entry && !this.isExpired(entry));
  }

  async increment(key: string): Promise<number> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        return await this.client.incr(cacheKey);
      } catch (error) {
        console.error('Redis increment error:', error);
      }
    }

    // Memory cache fallback - simple implementation
    const entry = this.memoryCache.get(cacheKey);
    const currentValue = entry && !this.isExpired(entry) ? (entry.value || 0) : 0;
    const newValue = currentValue + 1;
    this.memoryCache.set(cacheKey, { value: newValue });
    return newValue;
  }

  async expire(key: string, ttl: number): Promise<void> {
    const cacheKey = this.getKey(key);

    if (this.client && this.isConnected) {
      try {
        await this.client.expire(cacheKey, ttl);
        return;
      } catch (error) {
        console.error('Redis expire error:', error);
      }
    }

    // Memory cache fallback
    const entry = this.memoryCache.get(cacheKey);
    if (entry) {
      entry.expiry = Date.now() + (ttl * 1000);
    }
  }

  // Cache wrapper for functions
  async cached<T>(
    key: string,
    fn: () => Promise<T>,
    config: CacheConfig = { ttl: 300 }
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Execute function and cache result
    const result = await fn();
    await this.set(key, result, config.ttl);
    return result;
  }

  // Invalidate cache by pattern
  async invalidateUserCache(userId: string): Promise<void> {
    // Exact key used by getUserById / GET /users/:id, plus any namespaced keys.
    await this.delete(`user:${userId}`);
    await this.deletePattern(`user:${userId}:*`);
    // Settings cache uses a different key shape (user:settings:${id}).
    await this.delete(`user:settings:${userId}`);
  }

  async invalidateGroupCache(groupId: string): Promise<void> {
    await this.deletePattern(`group:${groupId}:*`);
    await this.deletePattern(`group:members:${groupId}:*`);
    await this.deletePattern(`messages:group:${groupId}:*`);
  }

  async invalidateGlobalCache(pattern: string): Promise<void> {
    await this.deletePattern(pattern);
  }

  async healthCheck(): Promise<boolean> {
    if (this.client && this.isConnected) {
      try {
        await this.client.ping();
        return true;
      } catch (error) {
        console.error('Redis health check failed:', error);
      }
    }

    // Memory cache is always "healthy"
    return true;
  }
}

// Singleton instance
export const cacheService = new CacheService();