/**
 * The API-row normalisers shared by the `hooks/groups/*` handler hooks and the
 * `useGroupHandlers` composer, moved verbatim out of that file.
 *
 * Exports: `mapApiGroupMembers` (roster rows), `normalizeFetchedMessages` (a page
 *  of group messages) and `mapDirectMessageFromApi` (one DM row).
 * Touches: `@lantern/shared/groups` and `@lantern/shared/utils` only — these are
 *  pure functions over API payloads, no store and no transport.
 * Gotcha: every one of these reads BOTH camelCase and snake_case, because the
 *  same row arrives in either shape depending on the endpoint that answered.
 */
import { User, Message, DirectMessage } from '../../types';
import { mapMessageFromApi } from '@lantern/shared/utils';
import { mapGroupMemberRow } from '@lantern/shared/groups';

// ── Normalisers ───────────────────────────────────────────────────────────────
// Roster rows come back in mixed camel/snake case depending on the endpoint —
// `mapGroupMemberRow` (@lantern/shared/groups) owns that, and the same call
// runs on mobile.
export function mapApiGroupMembers(fetchedMembers: any[], adminIds: readonly string[] = []): User[] {
    return (fetchedMembers || []).map((m: any) => mapGroupMemberRow(m, adminIds));
}

// Maps a page of API messages, dropping (not throwing on) any row mapMessageFromApi rejects
// — one malformed message must not blank the whole conversation.
export function normalizeFetchedMessages(raw: unknown): Message[] {
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map((item) => {
            try {
                return mapMessageFromApi(item);
            } catch (error) {
                console.warn('[Chat] Skipping malformed message from API:', error, item);
                return null;
            }
        })
        .filter((message): message is Message => message != null);
}

// DM normaliser. Reads every field in both cases, unwraps the sender whether it arrives as
// `sender`, `profiles`, or a one-element array, and blanks the text of a removed message so
// no client can render deleted content from a cached payload.
export function mapDirectMessageFromApi(raw: any, threadId: string): DirectMessage {
    const sender = raw.sender || raw.profiles || null;
    const senderObj = Array.isArray(sender) ? sender[0] : sender;
    return {
        id: raw.id,
        threadId: raw.threadId || raw.thread_id || threadId,
        senderId: raw.senderId || raw.sender_id || senderObj?.id,
        senderAvatar: senderObj?.avatarUrl || senderObj?.avatar_url || null,
        senderName: senderObj?.name || senderObj?.username || null,
        text: raw.isRemoved || raw.removed_at ? '' : raw.text || '',
        timestamp: new Date(raw.timestamp),
        editedAt: raw.editedAt || raw.edited_at,
        removedAt: raw.removedAt || raw.removed_at,
        isRemoved: raw.isRemoved || !!raw.removed_at,
        replyToMessageId: raw.replyToMessageId || raw.reply_to_message_id,
        replyTo: raw.replyTo || raw.reply_to,
        threadRootId: raw.threadRootId || raw.thread_root_id,
        replyCount: typeof raw.replyCount === 'number' ? raw.replyCount : raw.reply_count,
        receiptStatus: raw.receiptStatus || raw.receipt_status,
        clientMessageId: raw.clientMessageId || raw.client_message_id,
    };
}
