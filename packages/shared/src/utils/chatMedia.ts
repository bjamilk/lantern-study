import type { Message, MessageReplyPreview, DirectMessage } from '../types';
import { MessageType } from '../types';

const AUDIO_MARKDOWN_RE = /\[audio\]\((https?:\/\/[^)\s]+)\)/i;
const IMAGE_MARKDOWN_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/i;
const FILE_MARKDOWN_RE = /\[file:([^\]]+)\]\((https?:\/\/[^)\s]+)\)/i;
const MENTION_RE = /@([a-zA-Z0-9_]{2,32})\b/g;
export const CHAT_MESSAGE_MUTATION_WINDOW_MS = 30 * 60 * 1000;

export type ChatMessageMutationCandidate = {
  id: string;
  senderId?: string;
  sender?: { id?: string };
  timestamp?: Date | string;
  createdAt?: Date | string;
  type?: string;
  text?: string;
  removedAt?: string;
  isRemoved?: boolean;
  replyToMessageId?: string;
  threadRootId?: string;
  replyCount?: number;
};

export function parseChatAudioUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.trim().match(AUDIO_MARKDOWN_RE);
  return match?.[1] || null;
}

export function isChatAudioMessage(text?: string | null): boolean {
  return !!parseChatAudioUrl(text);
}

export function buildChatAudioMarkdown(url: string): string {
  return `[audio](${url})`;
}

export function parseChatImageUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.trim().match(IMAGE_MARKDOWN_RE);
  return match?.[1] || null;
}

export function isChatImageMessage(text?: string | null): boolean {
  return !!parseChatImageUrl(text);
}

export function parseChatFileAttachment(text?: string | null): { name: string; url: string } | null {
  if (!text) return null;
  const match = text.trim().match(FILE_MARKDOWN_RE);
  if (!match?.[1] || !match[2]) return null;
  return { name: match[1], url: match[2] };
}

export function buildChatFileMarkdown(name: string, url: string): string {
  const safeName = name.replace(/[\[\]]/g, '').trim() || 'Document';
  return `[file:${safeName}](${url})`;
}

/**
 * One-line label for a message shown outside its own bubble — reply quotes,
 * composer previews, conversation lists. Media is stored as markdown in the
 * message text, so echoing the text raw shows the reader a bare signed URL
 * instead of "Voice note". Only the bubble itself should render the media.
 */
export function chatMessagePreview(text?: string | null, fallback = 'Message'): string {
  const trimmed = (text || '').trim();
  if (!trimmed) return fallback;
  if (isChatAudioMessage(trimmed)) return 'Voice note';
  if (isChatImageMessage(trimmed)) return 'Photo';
  const file = parseChatFileAttachment(trimmed);
  if (file) return file.name;
  return trimmed;
}

export function isChatMessageMutationWindowOpen(
  timestamp: Date | string,
  nowMs = Date.now()
): boolean {
  const sentAtMs = new Date(timestamp).getTime();
  if (!Number.isFinite(sentAtMs)) return false;
  const ageMs = nowMs - sentAtMs;
  return ageMs >= 0 && ageMs <= CHAT_MESSAGE_MUTATION_WINDOW_MS;
}

export function canRemoveChatMessage(
  message: ChatMessageMutationCandidate,
  currentUserId?: string | null,
  nowMs = Date.now()
): boolean {
  const senderId = message.senderId || message.sender?.id;
  const type = String(message.type || 'TEXT').toUpperCase();
  return (
    !!currentUserId &&
    senderId === currentUserId &&
    type === 'TEXT' &&
    !message.isRemoved &&
    !message.removedAt &&
    !!(message.timestamp || message.createdAt) &&
    isChatMessageMutationWindowOpen(message.timestamp || message.createdAt!, nowMs)
  );
}

/**
 * Why the viewer cannot remove their OWN message, phrased for the UI.
 * Returns undefined when removal is allowed, or when the message is not the
 * viewer's at all (other people's messages get Report, not a delete excuse).
 *
 * Exists so "Delete is missing" stops being a mystery: the same three rules
 * that gate canRemoveChatMessage are now explainable in one sentence.
 */
export function deleteBlockedReason(
  message: ChatMessageMutationCandidate,
  currentUserId?: string | null,
  nowMs = Date.now()
): string | undefined {
  const senderId = message.senderId || message.sender?.id;
  if (!currentUserId || senderId !== currentUserId) return undefined;
  if (canRemoveChatMessage(message, currentUserId, nowMs)) return undefined;
  if (message.isRemoved || message.removedAt) return undefined;
  if (String(message.type || 'TEXT').toUpperCase() !== 'TEXT') {
    return 'Questions cannot be deleted once shared — the group may already be practising with them.';
  }
  return 'Messages can only be deleted within 30 minutes of sending.';
}

export function canEditChatMessage(
  message: ChatMessageMutationCandidate,
  currentUserId?: string | null,
  nowMs = Date.now()
): boolean {
  return (
    canRemoveChatMessage(message, currentUserId, nowMs) &&
    !isChatAudioMessage(message.text) &&
    // Media messages are stored as `![image](signed-url)` text. Editing one would
    // seed the composer with the raw markdown (leaking the signed URL) and let a
    // send replace the image with plain text. Remove stays allowed.
    !isChatImageMessage(message.text)
  );
}

/**
 * Removed rows normally disappear. Keep a redacted placeholder only when
 * hiding the row would orphan an existing reply or make a thread unreachable.
 */
export function shouldRenderRemovedMessage(
  message: ChatMessageMutationCandidate,
  conversationMessages: ChatMessageMutationCandidate[]
): boolean {
  if (!message.isRemoved && !message.removedAt) return true;
  if ((message.replyCount || 0) > 0) return true;
  return conversationMessages.some(
    (candidate) =>
      candidate.id !== message.id &&
      !candidate.isRemoved &&
      !candidate.removedAt &&
      (candidate.replyToMessageId === message.id || candidate.threadRootId === message.id)
  );
}

export function extractMentionUsernames(text?: string | null): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(MENTION_RE)) {
    const username = match[1];
    if (username) found.add(username.toLowerCase());
  }
  return [...found];
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'mention'; value: string; username: string };

/** Split message text into plain text and @mention segments for highlighting. */
export function segmentMentions(text: string): MentionSegment[] {
  if (!text) return [];
  const segments: MentionSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(MENTION_RE.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'mention',
      value: match[0],
      username: match[1]!.toLowerCase(),
    });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments.length ? segments : [{ type: 'text', value: text }];
}

export function buildReplyPreview(
  parent:
    | Pick<Message, 'id' | 'sender' | 'type' | 'text' | 'questionStem' | 'isRemoved'>
    | (Pick<DirectMessage, 'id' | 'senderId' | 'text'> & {
        senderName?: string;
        type?: string;
        questionStem?: string;
        isRemoved?: boolean;
      })
    | null
    | undefined
): MessageReplyPreview | null {
  if (!parent?.id) return null;
  const sender = 'sender' in parent ? parent.sender : undefined;
  return {
    id: parent.id,
    senderId: sender?.id || ('senderId' in parent ? parent.senderId : undefined),
    senderName:
      sender?.username ||
      sender?.name ||
      ('senderName' in parent ? parent.senderName : undefined),
    type: ('type' in parent ? parent.type : MessageType.TEXT) as MessageType | string,
    text: parent.isRemoved ? undefined : parent.text,
    questionStem:
      parent.isRemoved || !('questionStem' in parent) ? undefined : parent.questionStem,
    isRemoved: !!parent.isRemoved,
  };
}

export function findFirstUnreadMessageId<T extends { id: string; timestamp: Date | string; senderId?: string; sender?: { id?: string } }>(
  messages: T[],
  previousLastReadAt: string | null | undefined,
  currentUserId?: string | null
): string | null {
  if (!previousLastReadAt || !messages.length) return null;
  const cutoff = new Date(previousLastReadAt).getTime();
  if (!Number.isFinite(cutoff)) return null;
  const first = messages.find((m) => {
    const ts = new Date(m.timestamp).getTime();
    if (!Number.isFinite(ts) || ts <= cutoff) return false;
    const senderId = m.senderId || m.sender?.id;
    if (currentUserId && senderId === currentUserId) return false;
    return true;
  });
  return first?.id ?? null;
}

/** Resolve thread root when replying: parent's root, else parent id. */
export function resolveThreadRootId(parent: {
  id: string;
  threadRootId?: string | null;
  thread_root_id?: string | null;
} | null | undefined): string | undefined {
  if (!parent?.id) return undefined;
  return parent.threadRootId || parent.thread_root_id || parent.id;
}

/** DM / simple receipt: read when peer watermark is at or after message time. */
export function computeDmReceiptStatus(
  messageTimestamp: Date | string,
  peerLastReadAt: string | null | undefined
): 'sent' | 'read' {
  if (!peerLastReadAt) return 'sent';
  const msgMs = new Date(messageTimestamp).getTime();
  const readMs = new Date(peerLastReadAt).getTime();
  if (!Number.isFinite(msgMs) || !Number.isFinite(readMs)) return 'sent';
  return readMs >= msgMs ? 'read' : 'sent';
}

/** Group receipt from other members' last_read_at watermarks. */
export function computeGroupReceipt(
  messageTimestamp: Date | string,
  otherMemberLastReadAts: Array<string | null | undefined>
): { receiptStatus: 'sent' | 'read'; seenByCount: number; seenByTotal: number } {
  const msgMs = new Date(messageTimestamp).getTime();
  const total = otherMemberLastReadAts.length;
  if (!Number.isFinite(msgMs) || total === 0) {
    return { receiptStatus: 'sent', seenByCount: 0, seenByTotal: total };
  }
  let seenByCount = 0;
  for (const at of otherMemberLastReadAts) {
    if (!at) continue;
    const readMs = new Date(at).getTime();
    if (Number.isFinite(readMs) && readMs >= msgMs) seenByCount += 1;
  }
  return {
    receiptStatus: seenByCount >= total ? 'read' : 'sent',
    seenByCount,
    seenByTotal: total,
  };
}
