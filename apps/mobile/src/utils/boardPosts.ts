import { parseChatAudioUrl, parseChatImageUrl } from '@lantern/shared/utils';
import type { BoardPost } from '@lantern/shared/network';
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

/** The shared `BoardPost` shape, so the shared a11y/copy helpers can read it. */
export function toBoardPost(message: Message): BoardPost {
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
  };
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
