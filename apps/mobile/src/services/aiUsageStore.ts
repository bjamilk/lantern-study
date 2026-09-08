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
import type { AIUsageInfo } from '@lantern/shared';
import { AI_USAGE_UNKNOWN } from '@lantern/shared/utils/aiUsage';

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

const listeners = new Set<(usage: AIUsageInfo) => void>();

export function publishAIUsage(usage: AIUsageInfo): void {
  latestUsage = usage;
  listeners.forEach((fn) => fn(usage));
}

export function getLatestAIUsage(): AIUsageInfo {
  return latestUsage;
}

export function subscribeToAIUsage(listener: (usage: AIUsageInfo) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam: forget the counters between cases. */
export function __resetAIUsageForTests(): void {
  latestUsage = AI_USAGE_UNKNOWN;
  listeners.clear();
}
