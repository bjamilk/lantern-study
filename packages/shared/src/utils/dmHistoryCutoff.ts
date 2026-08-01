/**
 * Per-user DM "delete for me" history cutoff helpers.
 * When a user deletes a conversation, the server stores history_cleared_at[userId].
 * Messages at or before that timestamp must not resurface for that user even after
 * the thread is resurrected by a new message (hidden_by cleared).
 */

import { isTempMessageId } from './chatMessageMerge';

export function readDmHistoryClearedAt(
  historyClearedAt: unknown,
  userId: string,
): string | null {
  if (!userId || !historyClearedAt || typeof historyClearedAt !== 'object' || Array.isArray(historyClearedAt)) {
    return null;
  }
  const value = (historyClearedAt as Record<string, unknown>)[userId];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? trimmed : null;
}

export function withDmHistoryClearedAt(
  historyClearedAt: unknown,
  userId: string,
  clearedAtIso: string,
): Record<string, string> {
  const base =
    historyClearedAt && typeof historyClearedAt === 'object' && !Array.isArray(historyClearedAt)
      ? Object.fromEntries(
          Object.entries(historyClearedAt as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1],
          ),
        )
      : {};
  return { ...base, [userId]: clearedAtIso };
}

/** Drop messages at or before the viewer's delete cutoff. Keeps in-flight optimistic temps. */
export function filterMessagesAfterDmHistoryCutoff<
  T extends { id?: string; timestamp?: Date | string | number | null },
>(
  messages: T[],
  historyClearedAtIso: string | null | undefined,
): T[] {
  if (!historyClearedAtIso) return messages;
  const cutoffMs = Date.parse(historyClearedAtIso);
  if (!Number.isFinite(cutoffMs)) return messages;
  return messages.filter((message) => {
    // Never hide an in-flight optimistic send — same-ms delete/resend must stay visible.
    if (typeof message.id === 'string' && isTempMessageId(message.id)) return true;
    if (message.timestamp == null) return true;
    const ms = new Date(message.timestamp as Date | string | number).getTime();
    if (!Number.isFinite(ms)) return true;
    return ms > cutoffMs;
  });
}

/** Remove one user's delete-for-me cutoff (e.g. when they send a new message). */
export function clearDmHistoryClearedAtForUser(
  historyClearedAt: unknown,
  userId: string,
): Record<string, string> {
  if (!userId || !historyClearedAt || typeof historyClearedAt !== 'object' || Array.isArray(historyClearedAt)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(historyClearedAt as Record<string, unknown>)) {
    if (key === userId) continue;
    if (typeof value === 'string' && value) next[key] = value;
  }
  return next;
}

/** Effective unread floor: max(lastReadAt, historyClearedAt). */
export function effectiveDmUnreadFloor(
  lastReadAtIso: string | null | undefined,
  historyClearedAtIso: string | null | undefined,
): string {
  const epoch = '1970-01-01T00:00:00.000Z';
  const lastReadMs = lastReadAtIso ? Date.parse(lastReadAtIso) : NaN;
  const clearedMs = historyClearedAtIso ? Date.parse(historyClearedAtIso) : NaN;
  const floorMs = Math.max(
    Number.isFinite(lastReadMs) ? lastReadMs : 0,
    Number.isFinite(clearedMs) ? clearedMs : 0,
  );
  return floorMs > 0 ? new Date(floorMs).toISOString() : epoch;
}
