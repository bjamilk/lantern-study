/**
 * DataLoader pattern for N+1 query prevention
 * Batches multiple individual queries into single bulk queries
 */

interface BatchLoader<K, V> {
  load: (key: K) => Promise<V | null>;
  loadMany: (keys: K[]) => Promise<(V | null)[]>;
  clear: (key: K) => void;
  clearAll: () => void;
}

// Simple batch loader implementation (can be replaced with dataloader package)
function createBatchLoader<K, V>(
  batchFn: (keys: K[]) => Promise<Map<K, V>>,
  options?: { maxBatchSize?: number; cacheKeyFn?: (key: K) => string }
): BatchLoader<K, V> {
  const cache = new Map<string, V>();
  const pending = new Map<string, Promise<V | null>>();
  const batch: { key: K; resolve: (v: V | null) => void; reject: (e: Error) => void }[] = [];
  let batchScheduled = false;
  
  const maxBatchSize = options?.maxBatchSize || 100;
  const cacheKeyFn = options?.cacheKeyFn || ((k: K) => String(k));
  
  async function dispatchBatch() {
    const currentBatch = batch.splice(0, maxBatchSize);
    if (currentBatch.length === 0) return;
    
    try {
      const keys = currentBatch.map(b => b.key);
      const results = await batchFn(keys);
      
      for (const { key, resolve } of currentBatch) {
        const cacheKey = cacheKeyFn(key);
        const value = results.get(key) || null;
        if (value !== null) {
          cache.set(cacheKey, value);
        }
        resolve(value);
        pending.delete(cacheKey);
      }
    } catch (error) {
      for (const { key, reject } of currentBatch) {
        const cacheKey = cacheKeyFn(key);
        reject(error as Error);
        pending.delete(cacheKey);
      }
    }
    
    batchScheduled = false;
    if (batch.length > 0) {
      scheduleBatch();
    }
  }
  
  function scheduleBatch() {
    if (!batchScheduled) {
      batchScheduled = true;
      process.nextTick(dispatchBatch);
    }
  }
  
  return {
    load: (key: K): Promise<V | null> => {
      const cacheKey = cacheKeyFn(key);
      
      // Return cached value
      if (cache.has(cacheKey)) {
        return Promise.resolve(cache.get(cacheKey)!);
      }
      
      // Return pending promise
      if (pending.has(cacheKey)) {
        return pending.get(cacheKey)!;
      }
      
      // Create new promise and add to batch
      const promise = new Promise<V | null>((resolve, reject) => {
        batch.push({ key, resolve, reject });
        scheduleBatch();
      });
      
      pending.set(cacheKey, promise);
      return promise;
    },
    
    loadMany: async (keys: K[]): Promise<(V | null)[]> => {
      return Promise.all(keys.map(k => createBatchLoader<K, V>(batchFn, options).load(k)));
    },
    
    clear: (key: K): void => {
      cache.delete(cacheKeyFn(key));
    },
    
    clearAll: (): void => {
      cache.clear();
    },
  };
}

// ============================================================
// USER LOADER
// ============================================================

import { createClient } from '@supabase/supabase-js';

const getSupabase = () => createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export function createUserLoader() {
  return createBatchLoader<string, any>(async (userIds) => {
    const supabase = getSupabase();
    const { data: users, error } = await supabase
      .from('profiles')
      .select('*')
      .in('id', userIds);
    
    if (error) throw error;
    
    const map = new Map<string, any>();
    users?.forEach(user => map.set(user.id, user));
    return map;
  });
}

// ============================================================
// GROUP LOADER
// ============================================================

export function createGroupLoader() {
  return createBatchLoader<string, any>(async (groupIds) => {
    const supabase = getSupabase();
    const { data: groups, error } = await supabase
      .from('groups')
      .select('*')
      .in('id', groupIds);
    
    if (error) throw error;
    
    const map = new Map<string, any>();
    groups?.forEach(group => map.set(group.id, group));
    return map;
  });
}

// ============================================================
// GROUP MEMBERS LOADER
// ============================================================

export function createGroupMembersLoader() {
  return createBatchLoader<string, any[]>(async (groupIds) => {
    const supabase = getSupabase();
    const { data: memberships, error } = await supabase
      .from('group_members')
      .select(`
        group_id,
        role,
        joined_at,
        profiles:user_id (*)
      `)
      .in('group_id', groupIds);
    
    if (error) throw error;
    
    const map = new Map<string, any[]>();
    groupIds.forEach(id => map.set(id, []));
    
    memberships?.forEach(m => {
      const existing = map.get(m.group_id) || [];
      existing.push({
        ...m.profiles,
        role: m.role,
        joinedAt: m.joined_at,
      });
      map.set(m.group_id, existing);
    });
    
    return map;
  });
}

// ============================================================
// QUESTION STATS LOADER
// ============================================================

export function createQuestionStatsLoader(userId: string) {
  return createBatchLoader<string, any>(async (questionIds) => {
    const supabase = getSupabase();
    const { data: stats, error } = await supabase
      .from('user_question_stats')
      .select('*')
      .eq('user_id', userId)
      .in('question_id', questionIds);
    
    if (error) throw error;
    
    const map = new Map<string, any>();
    stats?.forEach(stat => map.set(stat.question_id, stat));
    return map;
  });
}

// ============================================================
// FLASHCARD DECK LOADER
// ============================================================

export function createFlashcardDeckLoader() {
  return createBatchLoader<string, any>(async (deckIds) => {
    const supabase = getSupabase();
    const { data: decks, error } = await supabase
      .from('flashcard_decks')
      .select('*')
      .in('id', deckIds);
    
    if (error) throw error;
    
    const map = new Map<string, any>();
    decks?.forEach(deck => map.set(deck.id, deck));
    return map;
  });
}

// ============================================================
// REQUEST CONTEXT WITH LOADERS
// ============================================================

export interface RequestContext {
  loaders: {
    users: ReturnType<typeof createUserLoader>;
    groups: ReturnType<typeof createGroupLoader>;
    groupMembers: ReturnType<typeof createGroupMembersLoader>;
    questionStats?: ReturnType<typeof createQuestionStatsLoader>;
    flashcardDecks: ReturnType<typeof createFlashcardDeckLoader>;
  };
  userId?: string;
}

export function createRequestContext(userId?: string): RequestContext {
  return {
    loaders: {
      users: createUserLoader(),
      groups: createGroupLoader(),
      groupMembers: createGroupMembersLoader(),
      questionStats: userId ? createQuestionStatsLoader(userId) : undefined,
      flashcardDecks: createFlashcardDeckLoader(),
    },
    userId,
  };
}

// ============================================================
// CONTEXT MIDDLEWARE
// ============================================================

import { Request, Response, NextFunction } from 'express';

export function dataLoaderMiddleware(req: Request, res: Response, next: NextFunction) {
  const userId = (req as any).user?.userId || (req as any).user?.id;
  (req as any).context = createRequestContext(userId);
  next();
}

export default {
  createUserLoader,
  createGroupLoader,
  createGroupMembersLoader,
  createQuestionStatsLoader,
  createFlashcardDeckLoader,
  createRequestContext,
  dataLoaderMiddleware,
};
