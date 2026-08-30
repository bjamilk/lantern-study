/**
 * Emoji reactions on chat messages — shared contract for web + mobile.
 *
 * A deliberately fixed, small set rather than a full emoji picker: it keeps the
 * bundle (and the CSP surface) untouched, renders identically on both
 * platforms, and keeps counts readable instead of a long tail of one-offs.
 *
 * Reactions apply to EVERY message type, questions included. They are not a
 * second voting system: question up/down votes decide whether a question is
 * verified and reaches tests, while reactions gate nothing.
 */

export const CHAT_REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '🙏', '😮', '😢', '🔥'] as const;

export type ChatReactionEmoji = (typeof CHAT_REACTION_EMOJI)[number];

/** Counts keyed by emoji: { "👍": 3, "🔥": 1 }. Zero-count keys are omitted. */
export type MessageReactions = Record<string, number>;

/** Longest emoji accepted (the DB CHECK allows 1..16 characters). */
export const CHAT_REACTION_MAX_LENGTH = 16;

/** At most this many DISTINCT emoji per message, so the JSONB stays small. */
export const CHAT_REACTION_MAX_DISTINCT_PER_MESSAGE = 20;

export function isSupportedReactionEmoji(value: unknown): value is ChatReactionEmoji {
  return typeof value === 'string' && (CHAT_REACTION_EMOJI as readonly string[]).includes(value);
}

/** Normalise whatever the API/DB returns into a clean count map. */
export function normalizeReactions(raw: unknown): MessageReactions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MessageReactions = {};
  for (const [emoji, count] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof count === 'number' ? count : Number(count);
    if (!emoji || !Number.isFinite(n) || n <= 0) continue;
    out[emoji] = Math.floor(n);
  }
  return out;
}

/** Total reactions on a message across all emoji. */
export function totalReactionCount(reactions: unknown): number {
  return Object.values(normalizeReactions(reactions)).reduce((sum, n) => sum + n, 0);
}

/**
 * Optimistic local update so a tap feels instant; the trigger's realtime
 * UPDATE replaces it moments later with the authoritative counts.
 */
export function applyReactionLocally(
  reactions: unknown,
  emoji: string,
  added: boolean
): MessageReactions {
  const next = normalizeReactions(reactions);
  const current = next[emoji] ?? 0;
  const updated = added ? current + 1 : current - 1;
  if (updated > 0) next[emoji] = updated;
  else delete next[emoji];
  return next;
}

/** Display order: most-reacted first, ties broken by the canonical emoji order. */
export function sortedReactionEntries(reactions: unknown): Array<[string, number]> {
  const order = new Map<string, number>(
    CHAT_REACTION_EMOJI.map((emoji, index) => [emoji as string, index])
  );
  return Object.entries(normalizeReactions(reactions)).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return (order.get(a[0]) ?? 99) - (order.get(b[0]) ?? 99);
  });
}
