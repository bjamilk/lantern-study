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
import { DEFAULT_AI_DAILY_LIMIT } from '@lantern/shared/utils/aiUsage';

let latestUsage: AIUsageInfo = {
  used: 0,
  limit: DEFAULT_AI_DAILY_LIMIT,
  remaining: DEFAULT_AI_DAILY_LIMIT,
  resetsAt: '',
};

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
  latestUsage = {
    used: 0,
    limit: DEFAULT_AI_DAILY_LIMIT,
    remaining: DEFAULT_AI_DAILY_LIMIT,
    resetsAt: '',
  };
  listeners.clear();
}
