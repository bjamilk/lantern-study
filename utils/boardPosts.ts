/**
 * Board post mapping (spec §5.1) — the one place the web turns a `messages`
 * row into the shared `BoardPost` shape.
 *
 * The API returns board rows in the same shape as chat messages (camelCase,
 * with a nested `sender`), and `subject` / `pinnedAt` / `pinnedBy` are ABSENT —
 * not null — until the 20260903120000 migration is applied. Both spellings are
 * read here so a board renders identically before and after it.
 */
import type { BoardPost } from '@lantern/shared/network';

type RawBoardRow = Record<string, any>;

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** `messages` row → `BoardPost`. Never throws: a malformed row renders empty. */
export function toBoardPost(raw: RawBoardRow, fallbackGroupId = ''): BoardPost {
  const sender = raw?.sender && typeof raw.sender === 'object' ? raw.sender : null;
  const removedAt = pickString(raw?.removedAt, raw?.removed_at);
  const isQuestion = (raw?.type ?? 'TEXT') === 'QUESTION';
  const stem = pickString(raw?.questionStem, raw?.question_stem);
  const reactions =
    raw?.reactions && typeof raw.reactions === 'object' && !Array.isArray(raw.reactions)
      ? (raw.reactions as Record<string, number>)
      : {};

  return {
    id: String(raw?.id ?? ''),
    groupId: String(raw?.groupId ?? raw?.group_id ?? fallbackGroupId),
    senderId: String(raw?.senderId ?? raw?.sender_id ?? sender?.id ?? ''),
    senderName: pickString(sender?.name, sender?.username) ?? 'Member',
    senderAvatarUrl: pickString(sender?.avatarUrl, sender?.avatar_url),
    subject: removedAt ? null : pickString(raw?.subject),
    text: removedAt ? '' : String(raw?.text ?? raw?.content ?? ''),
    timestamp: pickString(raw?.timestamp, raw?.created_at) ?? new Date().toISOString(),
    editedAt: pickString(raw?.editedAt, raw?.edited_at),
    removedAt,
    replyCount: toCount(raw?.replyCount ?? raw?.reply_count),
    reactions,
    pinnedAt: pickString(raw?.pinnedAt, raw?.pinned_at),
    pinnedBy: pickString(raw?.pinnedBy, raw?.pinned_by),
    // Rows posted into this group before it became a board. They render
    // read-only (§4.2 LegacyQuestionCard) — never blank.
    isLegacyQuestion: isQuestion && !removedAt,
    legacyQuestionStem: isQuestion && !removedAt ? stem : null,
  };
}

/** Newest first, the order a board reads in (§0). */
export function sortBoardPostsNewestFirst(posts: BoardPost[]): BoardPost[] {
  return [...posts].sort((a, b) => {
    const at = Date.parse(a.timestamp);
    const bt = Date.parse(b.timestamp);
    if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return bt - at;
    return b.id.localeCompare(a.id);
  });
}

/** Merge a page (or a realtime row) into the list without duplicating ids. */
export function mergeBoardPosts(existing: BoardPost[], incoming: BoardPost[]): BoardPost[] {
  if (incoming.length === 0) return existing;
  const byId = new Map(existing.map((post) => [post.id, post]));
  for (const post of incoming) {
    const prev = byId.get(post.id);
    byId.set(post.id, prev ? { ...prev, ...post } : post);
  }
  return sortBoardPostsNewestFirst(Array.from(byId.values()));
}
