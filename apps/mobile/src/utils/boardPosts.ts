import { parseChatAudioUrl, parseChatImageUrl } from '@lantern/shared/utils';
import {
  boardFavoriteCount,
  boardRepostOriginalId,
  isBoardRepostRow,
  type BoardPost,
} from '@lantern/shared/network';
import type { Message } from '../stores/groupStore';

/**
 * The board's view of `groupStore.messagesCache`.
 *
 * A board post is a `messages` row with no `thread_root_id`; a comment is the
 * same row with one set (§1 — `messages.type` is deliberately not widened).
 * The board therefore never forks the message cache: it reads the same rows
 * the realtime subscription and the optimistic send already write, and simply
 * splits them into roots and comments.
 *
 * Pure on purpose — no store imports beyond the types, so this is the part of
 * the board that unit tests can hold onto.
 */

/** A reply folded under a post, not a card of its own. */
export function isBoardComment(message: Pick<Message, 'threadRootId'>): boolean {
  return !!message.threadRootId;
}

const createdMs = (m: Pick<Message, 'createdAt'>): number => {
  const ms = Date.parse(m.createdAt);
  return Number.isFinite(ms) ? ms : 0;
};

/** Roots only, newest first — the board opens at the top and never auto-scrolls. */
export function selectBoardPosts(messages: readonly Message[] | undefined): Message[] {
  if (!messages || messages.length === 0) return [];
  return messages
    .filter((m) => !isBoardComment(m))
    .slice()
    .sort((a, b) => createdMs(b) - createdMs(a));
}

/** One post's comments, oldest first — a flat list, never a nested tree. */
export function selectPostComments(
  messages: readonly Message[] | undefined,
  rootId: string
): Message[] {
  if (!messages || !rootId) return [];
  return messages
    .filter((m) => m.threadRootId === rootId)
    .slice()
    .sort((a, b) => createdMs(a) - createdMs(b));
}

/**
 * Merge two comment lists (the fetched thread and whatever the cache already
 * holds from realtime/optimistic sends) by id, keeping the fetched row when
 * both have it, and stays oldest-first.
 */
export function mergeComments(fetched: readonly Message[], local: readonly Message[]): Message[] {
  const byId = new Map<string, Message>();
  for (const m of local) byId.set(m.id, m);
  for (const m of fetched) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => createdMs(a) - createdMs(b));
}

/**
 * A row posted before this board existed. Rendered read-only by
 * `LegacyQuestionCard`; without it these rows render blank (§4.2).
 */
export function isLegacyQuestionPost(message: Pick<Message, 'type' | 'questionStem'>): boolean {
  // Keyed off the row's TYPE, exactly as web's `toBoardPost` does. A stem
  // alone is not enough: a board post whose body merely looks like a question
  // is a `type='TEXT'` row (§3.4) and must render as an ordinary post.
  return message.type === 'question';
}

/**
 * The shared `BoardPost` shape, so the shared a11y/copy helpers can read it.
 *
 * `viewer` carries the two flags the group store's normalised `Message` may
 * not hold. `favorited` never rides the row at all — it comes from the board's
 * own `user-reactions` map, which both boards already fetch on mount — and
 * `bookmarked` is absent (not false) whenever the page that filled the cache
 * was a chat page or a comment thread. Passing them in beats defaulting: a
 * `repostedByMe: false` invented here would make `canRepostBoardPost` offer a
 * repost the server is about to answer 409 to.
 */
export function toBoardPost(
  message: Message,
  viewer?: { favorited?: boolean; bookmarked?: boolean },
): BoardPost {
  const legacy = isLegacyQuestionPost(message);
  return {
    id: message.id,
    groupId: message.groupId,
    senderId: message.senderId,
    senderName: message.senderName || 'Someone',
    senderAvatarUrl: message.senderAvatar ?? null,
    subject: message.subject ?? null,
    text: message.text ?? '',
    timestamp: message.createdAt,
    editedAt: message.editedAt ?? null,
    removedAt: message.removedAt ?? null,
    replyCount: typeof message.replyCount === 'number' ? message.replyCount : 0,
    reactions: message.reactions ?? {},
    pinnedAt: message.pinnedAt ?? null,
    pinnedBy: message.pinnedBy ?? null,
    isLegacyQuestion: legacy,
    legacyQuestionStem: legacy ? (message.questionStem || message.text || null) : null,
    /**
     * `messages.image_url` is the FIRST encoding for a board photo, not a
     * third one: legacy posts keep theirs as markdown inside `text`, which
     * `splitBoardBody` still parses, so a card reads `imageUrl ?? split.imageUrl`.
     */
    imageUrl: message.imageUrl ?? null,
    favoriteCount: boardFavoriteCount(message.reactions),
    favorited: !!viewer?.favorited,
    /**
     * `bookmarked` prefers the caller's answer (the board's per-group bookmark
     * map, which is one request and is correct even on a page the API could
     * not hydrate) and falls back to the flag the board page attached.
     */
    bookmarked: viewer?.bookmarked ?? message.bookmarked ?? false,
    repostCount: message.repostCount ?? 0,
    repostedByMe: message.repostedByMe ?? false,
    repostOf: message.repostOf ?? null,
  };
}

/**
 * Is this row a repost — a bump of another post onto the SAME board?
 *
 * Answered from the hydrated embed when the API supplied one, and otherwise
 * from the row's own three columns via the shared discriminator, so a card
 * built out of an optimistic or realtime row (neither of which carries
 * `repostOf`) still knows what it is.
 */
export function isBoardRepost(message: Message): boolean {
  if (message.repostOf) return true;
  return isBoardRepostRow({
    replyToMessageId: message.replyToMessageId ?? null,
    threadRootId: message.threadRootId ?? null,
    clientMessageId: message.clientMessageId ?? null,
  });
}

/**
 * Which post an action on this card must hit.
 *
 * Favorite, Comment, Bookmark and Report on a REPOST card all act on the
 * ORIGINAL (§6.5), so counts never fragment across copies and no comment ever
 * attaches to a repost row. Only Undo repost acts on the repost row itself.
 */
export function boardActionTargetId(message: Message): string {
  if (!isBoardRepost(message)) return message.id;
  return (
    boardRepostOriginalId(message.clientMessageId) ||
    message.repostOf?.id ||
    message.replyToMessageId ||
    message.id
  );
}

const AUDIO_MARKDOWN_RE = /\[audio\]\((https?:\/\/[^)\s]+)\)/i;
const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i;

/**
 * Media is markdown inside `messages.text` (trap 6 — do not add a third
 * encoding). The board list must know a post HAS a photo without downloading
 * it, so split the row into its media urls and the text that is left.
 */
export function splitBoardBody(text?: string | null): {
  imageUrl: string | null;
  audioUrl: string | null;
  body: string;
} {
  const raw = text ?? '';
  return {
    imageUrl: parseChatImageUrl(raw),
    audioUrl: parseChatAudioUrl(raw),
    body: raw.replace(IMAGE_MARKDOWN_RE, '').replace(AUDIO_MARKDOWN_RE, '').trim(),
  };
}
