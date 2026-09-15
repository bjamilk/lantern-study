/**
 * The one copy of "how many AI uses are left", and everything that watches it.
 *
 * It lives apart from `services/ai` because two modules have to write to it and
 * one of them is `services/jobWatch`, which `services/ai` itself imports. A
 * queued run is accepted with 202 — a 2xx — so the accept publishes the CHARGED
 * counters; when the job later fails the server refunds the credits and the
 * failing POLL is what carries the corrected numbers. The poller therefore has
 * to be able to publish usage, and importing `services/ai` to do it would close
 * an import cycle around the AI client.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getUserScopeId,
  readScopedWithLegacyMigration,
  registerUserScoped,
  scopedKey,
  whenUserScopeResolved,
} from '../stores/userScopedState';
import type { AIUsageInfo } from '@lantern/shared';
import { AI_USAGE_UNKNOWN, isAIUsageKnown } from '@lantern/shared/utils/aiUsage';

/**
 * The last figures the server gave us, kept across launches.
 *
 * The counters only ever arrived from a live call, so an OFFLINE cold start
 * knew nothing and the docked badge vanished entirely — the sparkle lost the
 * "95" it had been wearing all session, which reads as "you have no credits",
 * not as "we could not check". The cache restores the last known numbers and
 * marks them stale; nothing here ever invents an allowance.
 */
// FIXED (F8): the cache is per account — `lantern.aiUsage.last:<userId>` — and
// the counters are registered in stores/userScopedState, so a sign-out or an
// account switch drops both the in-memory figures and the subscriber's view.
// The cold-start hydrate waits for auth to answer before it reads anything, so
// the next student's badge starts UNKNOWN rather than restoring the previous
// account's allowance. The pre-split unscoped key is adopted once by the first
// account that reads it and is then removed.
export const AI_USAGE_CACHE_LEGACY_KEY = 'lantern.aiUsage.last';

/**
 * Before the server has said anything, the app knows NOTHING about this
 * account's allowance — so it starts at the honest unknown, not at
 * DEFAULT_AI_DAILY_LIMIT.
 *
 * This used to seed {limit: 20, remaining: 20}, which is the API's default and
 * not this account's allowance (production runs 100). Every surface reads the
 * store synchronously on mount, so a cold start printed a confident "20 / 20"
 * badge, a "20 of 20 AI credits left" screen-reader label and a "Resets at
 * midnight GMT" hint before a single byte had come back — a number nobody had
 * been told, that then jumped to 100. At limit 0 every consumer already draws
 * nothing (the badge returns null, the Me row prints "—", the reset label is
 * ''), and no generation gate fires, so the unknown state is silence rather
 * than a refusal.
 */
let latestUsage: AIUsageInfo = AI_USAGE_UNKNOWN;

/** True while `latestUsage` is the restored cache rather than this session's answer. */
let usageFromCache = false;

const listeners = new Set<(usage: AIUsageInfo) => void>();

export function publishAIUsage(usage: AIUsageInfo): void {
  latestUsage = usage;
  usageFromCache = false;
  listeners.forEach((fn) => fn(usage));
  if (isAIUsageKnown(usage)) {
    const userId = getUserScopeId();
    // Signed out, nothing to file these under — and writing the unscoped key
    // is exactly the leak this fix removes.
    if (!userId) return;
    void AsyncStorage.setItem(
      scopedKey(AI_USAGE_CACHE_LEGACY_KEY, userId),
      JSON.stringify(usage)
    ).catch(() => undefined);
  }
}

/**
 * Restore the cached counters, but only while the server has said nothing.
 * A live figure always outranks the cache, so this can never overwrite one.
 */
export async function hydrateAIUsageFromCache(): Promise<boolean> {
  if (isAIUsageKnown(latestUsage)) return false;
  try {
    // Which account's allowance this is has to be settled BEFORE the read, or
    // a cold start would restore whatever the last student on this handset had
    // left. Signed out, there is no cached allowance to restore.
    const userId = await whenUserScopeResolved();
    if (!userId) return false;
    const raw = await readScopedWithLegacyMigration(AI_USAGE_CACHE_LEGACY_KEY, userId);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as AIUsageInfo | null;
    if (!isAIUsageKnown(parsed)) return false;
    if (isAIUsageKnown(latestUsage)) return false;
    latestUsage = parsed as AIUsageInfo;
    usageFromCache = true;
    listeners.forEach((fn) => fn(latestUsage));
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the count on screen is the remembered one. The render site (the top
 * bar's docked badge, owned by another lane) can use this to mark it stale.
 */
export function isAIUsageFromCache(): boolean {
  return usageFromCache;
}

// Cold start: ask the cache immediately, so the badge is restored before any
// network call is even attempted. Self-contained on purpose — no boot file has
// to remember to call it.
void hydrateAIUsageFromCache();

export function getLatestAIUsage(): AIUsageInfo {
  return latestUsage;
}

export function subscribeToAIUsage(listener: (usage: AIUsageInfo) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * FIXED (F8): the counters belong to one account.
 *
 * `latestUsage` is a module global that survives a sign-out, so B's badge read
 * A's remaining credits and B's generation gates fired on A's numbers. The
 * registry drops it back to UNKNOWN and tells every badge on screen, then
 * re-reads the cache for whoever is signed in now (an account switch), or
 * leaves it unknown (a sign-out).
 */
registerUserScoped('aiUsage', () => {
  latestUsage = AI_USAGE_UNKNOWN;
  usageFromCache = false;
  listeners.forEach((fn) => fn(latestUsage));
  if (getUserScopeId()) void hydrateAIUsageFromCache();
});

/** Test seam: forget the counters between cases. */
export function __resetAIUsageForTests(): void {
  latestUsage = AI_USAGE_UNKNOWN;
  usageFromCache = false;
  listeners.clear();
}
