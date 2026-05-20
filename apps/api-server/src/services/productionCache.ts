interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

// LRU Cache implementation with TTL support
class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private stats = { hits: 0, misses: 0 };

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    if (entry.expiresAt < Date.now()) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlSeconds: number = 300): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttlSeconds * 1000),
      createdAt: Date.now(),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  deletePattern(pattern: string): number {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    let deleted = 0;
    
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  // Clean up expired entries
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt < now) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    
    return cleaned;
  }
}

// Production Cache Service
export class ProductionCacheService {
  private cache: LRUCache<any>;
  private cleanupInterval: NodeJS.Timeout;
  private readonly defaultTTL = 300; // 5 minutes

  constructor(maxSize: number = 10000) {
    this.cache = new LRUCache(maxSize);
    
    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      const cleaned = this.cache.cleanup();
      if (cleaned > 0 && process.env.NODE_ENV !== 'production') {
        console.log(`Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, 60000);
  }

  // ============ GENERIC CACHE METHODS ============
  
  async get<T>(key: string): Promise<T | null> {
    return this.cache.get(key) as T | null;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.cache.set(key, value, ttlSeconds || this.defaultTTL);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async deletePattern(pattern: string): Promise<number> {
    return this.cache.deletePattern(pattern);
  }

  // ============ USER SESSION CACHING ============
  
  async getUserSession(userId: string): Promise<any | null> {
    return this.get(`session:${userId}`);
  }

  async setUserSession(userId: string, session: any, ttl = 3600): Promise<void> {
    await this.set(`session:${userId}`, session, ttl);
  }

  async invalidateUserSession(userId: string): Promise<void> {
    await this.delete(`session:${userId}`);
  }

  // ============ GROUP MESSAGES CACHING ============
  
  async getGroupMessages(groupId: string, page: number = 1): Promise<any[] | null> {
    return this.get(`messages:${groupId}:${page}`);
  }

  async setGroupMessages(groupId: string, page: number, messages: any[], ttl = 60): Promise<void> {
    await this.set(`messages:${groupId}:${page}`, messages, ttl);
  }

  async invalidateGroupMessages(groupId: string): Promise<void> {
    await this.deletePattern(`messages:${groupId}:*`);
  }

  // ============ USER STATS CACHING ============
  
  async getUserStats(userId: string): Promise<any | null> {
    return this.get(`stats:${userId}`);
  }

  async setUserStats(userId: string, stats: any, ttl = 300): Promise<void> {
    await this.set(`stats:${userId}`, stats, ttl);
  }

  async invalidateUserStats(userId: string): Promise<void> {
    await this.delete(`stats:${userId}`);
  }

  // ============ FLASHCARD DECKS CACHING ============
  
  async getFlashcardDecks(userId: string): Promise<any[] | null> {
    return this.get(`decks:${userId}`);
  }

  async setFlashcardDecks(userId: string, decks: any[], ttl = 300): Promise<void> {
    await this.set(`decks:${userId}`, decks, ttl);
  }

  async invalidateFlashcardDecks(userId: string): Promise<void> {
    await this.delete(`decks:${userId}`);
  }

  // ============ GROUP MEMBERS CACHING ============
  
  async getGroupMembers(groupId: string): Promise<any[] | null> {
    return this.get(`members:${groupId}`);
  }

  async setGroupMembers(groupId: string, members: any[], ttl = 300): Promise<void> {
    await this.set(`members:${groupId}`, members, ttl);
  }

  async invalidateGroupMembers(groupId: string): Promise<void> {
    await this.delete(`members:${groupId}`);
  }

  // ============ USER PREFERENCES CACHING ============
  
  async getUserPreferences(userId: string): Promise<any | null> {
    return this.get(`preferences:${userId}`);
  }

  async setUserPreferences(userId: string, prefs: any, ttl = 1800): Promise<void> {
    await this.set(`preferences:${userId}`, prefs, ttl);
  }

  async invalidateUserPreferences(userId: string): Promise<void> {
    await this.delete(`preferences:${userId}`);
  }

  // ============ QUESTION STATS CACHING ============
  
  async getQuestionStats(userId: string, questionId: string): Promise<any | null> {
    return this.get(`qstats:${userId}:${questionId}`);
  }

  async setQuestionStats(userId: string, questionId: string, stats: any, ttl = 600): Promise<void> {
    await this.set(`qstats:${userId}:${questionId}`, stats, ttl);
  }

  async invalidateQuestionStats(userId: string, questionId?: string): Promise<void> {
    if (questionId) {
      await this.delete(`qstats:${userId}:${questionId}`);
    } else {
      await this.deletePattern(`qstats:${userId}:*`);
    }
  }

  // ============ RATE LIMITING ============
  
  async incrementRateLimit(key: string, windowSeconds: number): Promise<number> {
    const cacheKey = `ratelimit:${key}`;
    const current = await this.get<number>(cacheKey) || 0;
    const newValue = current + 1;
    await this.set(cacheKey, newValue, windowSeconds);
    return newValue;
  }

  async getRateLimitCount(key: string): Promise<number> {
    return await this.get<number>(`ratelimit:${key}`) || 0;
  }

  // ============ DISTRIBUTED LOCKING ============
  
  async acquireLock(key: string, ttlSeconds = 30): Promise<boolean> {
    const lockKey = `lock:${key}`;
    const existing = await this.get(lockKey);
    
    if (existing) {
      return false;
    }
    
    await this.set(lockKey, { lockedAt: Date.now() }, ttlSeconds);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    await this.delete(`lock:${key}`);
  }

  // ============ CACHE STATS & MANAGEMENT ============
  
  getStats(): CacheStats {
    return this.cache.getStats();
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testKey = '__health_check__';
      await this.set(testKey, 'ok', 1);
      const result = await this.get(testKey);
      await this.delete(testKey);
      return result === 'ok';
    } catch {
      return false;
    }
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.cache.clear();
  }
}

// Export singleton instance
export const productionCacheService = new ProductionCacheService();
export default productionCacheService;
