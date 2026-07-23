import type { Message, MessageReplyPreview, DirectMessage } from '../types';
import { MessageType } from '../types';

const AUDIO_MARKDOWN_RE = /\[audio\]\((https?:\/\/[^)\s]+)\)/i;
const MENTION_RE = /@([a-zA-Z0-9_]{2,32})\b/g;

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
    | Pick<Message, 'id' | 'sender' | 'type' | 'text' | 'questionStem'>
    | (Pick<DirectMessage, 'id' | 'senderId' | 'text'> & {
        senderName?: string;
        type?: string;
        questionStem?: string;
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
    text: parent.text,
    questionStem: 'questionStem' in parent ? parent.questionStem : undefined,
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
