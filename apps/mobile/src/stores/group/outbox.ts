// ===========================================
// Lantern Study Mobile - Group store: outbox
// ===========================================
//
// Purpose: getting a message OUT, and everything that has to be true when it
// does not go out the first time. Two things live here: the optimistic group
// send (`createSendMessage`) and the syncService `'message'` handler that
// flushes what the send queued (`registerMessageOutboxHandler`).
//
// Touches: `group/transport.ts`, `group/mapping.ts`, `services/syncService`,
// `stores/sendOutcome`, `stores/authStore` (for the sender's own label when a
// roster has not loaded) and expo-crypto for client ids. It reaches store
// state only through the `set`/`get` it is handed, and the handler only
// through the store it is handed — so nothing here imports `state.ts`, and
// there is no cycle.
//
// Gotchas:
// - A queued send is NOT a failure: `sendMessage` resolves `'queued'` rather
//   than throwing. Throwing is what made every screen alert "Send failed" and
//   put the text back in the composer, inviting a duplicate of a message that
//   was already on its way.
// - Sends are SERIALISED per conversation, not rejected. The old Set-based
//   locks cost the user their message; `deliveryIntents` is what still guards
//   a genuine duplicate tap, by reusing the same `clientMessageId`.
// - Only the failed row is patched on failure. Restoring a pre-await snapshot
//   destroyed realtime messages that landed mid-send, and reverting the whole
//   `groups` array threw away unread counts and other groups' previews.
// - The handler is registered from the store module rather than from inside
//   syncService, because that module must not import stores.
//
// Moved verbatim out of `stores/groupStore.ts` (lane M2), comments included.

import type { StoreApi } from 'zustand';
import * as Crypto from 'expo-crypto';
import { isTransientSyncError } from '@lantern/shared';
import { isBoardPostKind } from '@lantern/shared/network';
import {
  chatMessagePreview,
  formatChatSenderLabel,
  resolveThreadRootId,
  DeliveryIntentRegistry,
  isUncertainDeliveryError,
  reconcileDeliveredItem,
} from '@lantern/shared/utils';
import type { BoardPostKind } from '@lantern/shared/network';
import { syncService } from '../../services/syncService';
import { useAuthStore } from '../authStore';
import { lastDeliveredMessage } from '../chatListPreview';
import { firstNonEmailValue } from '../../utils/senderIdentity';
import {
  isQueueableSendError,
  queuedOutcome,
  sentOutcome,
  toSendError,
  type SendOutcome,
} from '../sendOutcome';
import { mapApiMessage, mapDirectMessage, replaceOptimisticWithServer } from './mapping';
import * as transport from './transport';
import type { GroupState, Message } from './types';

// Sends are serialized per conversation rather than rejected. The old Set-based
// locks threw a user-facing Alert (groups) or returned silently (DMs, after the
// composer had already been cleared) — both cost the user their message.
// deliveryIntents still guards genuine duplicate taps.
export const sendChainByGroup = new Map<string, Promise<void>>();
export const sendChainByDmThread = new Map<string, Promise<void>>();

/** @internal — also used by `sendDirectMessageTo` in `state.ts`. */
export async function acquireSendSlot(
  chains: Map<string, Promise<void>>,
  key: string
): Promise<() => void> {
  const prior = chains.get(key);
  if (prior) await prior.catch(() => undefined);
  let release: () => void = () => undefined;
  const slot = new Promise<void>((resolve) => {
    release = resolve;
  });
  chains.set(key, slot);
  return () => {
    release();
    if (chains.get(key) === slot) chains.delete(key);
  };
}

/** @internal — shared with the DM send, so one retry cannot post twice. */
export const deliveryIntents = new DeliveryIntentRegistry();

type Set = StoreApi<GroupState>['setState'];
type Get = StoreApi<GroupState>['getState'];

/**
 * Build the store's `sendMessage` action. The body below is the shipped one,
 * moved verbatim; only its wrapper changed from an object property to a
 * factory over the store's own `set` / `get`.
 */
export function createSendMessage(set: Set, get: Get): GroupState['sendMessage'] {
  return async (
  groupId: string,
  text: string,
  senderId: string,
  _senderName?: string,
  options?: {
    replyToMessageId?: string;
    mentionedUserIds?: string[];
    subject?: string | null;
    plainText?: boolean;
    imageUrl?: string | null;
    postKind?: BoardPostKind;
  }
) => {
  const releaseSendSlot = await acquireSendSlot(sendChainByGroup, groupId);

  const group = get().groups.find((g) => g.id === groupId);
  // Prefer userId — member.id may be the membership row id, not the auth user id.
  const member = group?.members?.find((m) => m.userId === senderId || m.id === senderId);
  // The sender is whoever is signed in, so fall back to their own profile when
  // the group's member list has not loaded them (board posts hit this: the
  // board's roster is not fetched, so the author showed as "Member" until the
  // app was restarted and the server's copy arrived).
  const auth = useAuthStore.getState();
  const isMe = !!auth.user?.id && auth.user.id === senderId;
  const myUsername = isMe
    ? ((auth.user?.user_metadata as { username?: string | null } | undefined)?.username ?? null)
    : null;
  // Skip an email-shaped `profiles.name`/`profileName` so the stamped sender
  // name can never be an address reduced to its local part ('nimaj22@x.com' →
  // 'nimaj22'); resolution then falls to the @username or "Member".
  const senderName = formatChatSenderLabel({
    username: firstNonEmailValue(member?.username, myUsername),
    name: firstNonEmailValue(member?.name, isMe ? auth.profileName : null),
  });
  let parsed: any = {};
  if (!options?.plainText && text.trim().startsWith('{')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
  }
  const isQuestion =
    parsed.type === 'QUESTION' ||
    parsed.type === 'question' ||
    !!parsed.questionStem ||
    !!parsed.question_stem;
  const questionStem = parsed.questionStem || parsed.question_stem;

  const deliveryScope = `group:${groupId}`;
  const deliveryFingerprint = JSON.stringify({
    text,
    subject: options?.subject ?? null,
    replyToMessageId: options?.replyToMessageId || null,
    mentionedUserIds: [...(options?.mentionedUserIds || [])].sort(),
    // Part of the identity of the send: two posts with the same words but
    // different photos are two posts, and the retry path must not fold them
    // into one delivery intent.
    imageUrl: options?.imageUrl ?? null,
  });
  const clientMessageId = deliveryIntents.resolve(
    deliveryScope,
    deliveryFingerprint,
    Crypto.randomUUID
  );
  const existing = get().messagesCache[groupId] || [];
  const parent = options?.replyToMessageId
    ? existing.find((m) => m.id === options.replyToMessageId)
    : undefined;
  // A reply whose parent is not in the cache (a board post older than the
  // loaded page, opened from the pinned strip or a deep link) still belongs
  // to a thread. `undefined` made the optimistic row look top-level, so a
  // comment flashed onto the board as its own post card until the server row
  // replaced it. The server resolves the true root either way.
  const threadRootId = parent
    ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
    : (options?.replyToMessageId ?? undefined);
  const rootReplyCount = threadRootId
    ? (existing.find((m) => m.id === threadRootId)?.replyCount || 0) + 1
    : 0;
  const seenByTotal = Math.max(0, (group?.members?.length || group?.memberCount || 1) - 1);

  const newMessage: Message = {
    id: clientMessageId,
    groupId,
    senderId,
    senderName,
    senderAvatar: member?.avatarUrl,
    text: isQuestion ? questionStem || text : text,
    type: isQuestion ? 'question' : 'text',
    createdAt: new Date().toISOString(),
    subject: options?.subject ?? null,
    // The optimistic card must already read as an announcement, or a
    // moderator's post jumps from the middle of the list to the top a
    // second later.
    postKind: options?.postKind ?? null,
    questionStem,
    questionStatus: isQuestion ? 'PENDING' : undefined,
    questionType: parsed.questionType || parsed.question_type,
    options: (parsed.options || []).map((opt: any) =>
      typeof opt === 'string' ? opt : opt?.text || ''
    ).filter(Boolean),
    tags: parsed.tags,
    upvotes: 0,
    downvotes: 0,
    flaggedAsSimilarUserIds: [],
    replyToMessageId: options?.replyToMessageId,
    mentionedUserIds: options?.mentionedUserIds,
    threadRootId,
    replyCount: 0,
    // Shown on the optimistic card immediately: the photo was already
    // uploaded and signed by the composer, so there is nothing to wait for.
    ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
    receiptStatus: 'sent',
    seenByCount: 0,
    seenByTotal,
  };
  
  // Optimistic update for immediate feedback
  const previousMessages = get().messages;
  const previousGroups = get().groups;
  const previousCache = get().messagesCache[groupId] || [];
  const isActiveGroup = get().activeGroupId === groupId;
  const withOptimistic = [...previousCache, newMessage];
  // Bump the root only — matching on `threadRootId || id` also matched every
  // reply, so each reply showed its own "N replies" chip.
  const optimisticCache = threadRootId
    ? withOptimistic.map((m) =>
        m.id === threadRootId ? { ...m, replyCount: rootReplyCount } : m
      )
    : withOptimistic;
  const optimisticMessages = threadRootId
    ? (isActiveGroup ? [...previousMessages, newMessage] : previousMessages).map((m) =>
        m.id === threadRootId ? { ...m, replyCount: rootReplyCount } : m
      )
    : isActiveGroup
      ? [...previousMessages, newMessage]
      : previousMessages;
  set({
    messages: optimisticMessages,
    groups: previousGroups.map(g =>
      g.id === groupId
        ? { ...g, lastMessage: newMessage, updatedAt: new Date().toISOString() }
        : g
    ),
    messagesCache: { ...get().messagesCache, [groupId]: optimisticCache },
  });

  try {
    const serverPayload = await transport.sendGroupMessage(groupId, senderId, {
      content: text,
      clientMessageId,
      replyToMessageId: options?.replyToMessageId,
      mentionedUserIds: options?.mentionedUserIds,
      ...(options?.subject ? { subject: options.subject } : {}),
      ...(options?.imageUrl ? { imageUrl: options.imageUrl } : {}),
      ...(options?.postKind ? { postKind: options.postKind } : {}),
    });
    const serverMessage = mapApiMessage(serverPayload, groupId);
    set((state) => {
      const cache = state.messagesCache[groupId] || [];
      const updatedCache = replaceOptimisticWithServer(cache, newMessage.id, serverMessage);
      const updatedMessages =
        state.activeGroupId === groupId
          ? replaceOptimisticWithServer(state.messages, newMessage.id, serverMessage)
          : state.messages;
      const updatedGroups = state.groups.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          lastMessage: serverMessage,
          updatedAt: serverMessage.createdAt,
        };
      });
      return {
        groups: updatedGroups,
        messages: updatedMessages,
        messagesCache: { ...state.messagesCache, [groupId]: updatedCache },
      };
    });
    deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
    return sentOutcome(serverMessage);
  } catch (error: any) {
    if (isUncertainDeliveryError(error)) {
      deliveryIntents.markUncertain(deliveryScope, deliveryFingerprint, clientMessageId);
    } else {
      deliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
    }
    // Network-shaped failures go to the outbox and stay 'pending'; anything the
    // server actively rejected is 'failed' and needs the user's attention.
    const queueable = isQueueableSendError(error);
    if (queueable) {
      void syncService
        .queueOperation('message', newMessage.id, 'create', {
          kind: 'group',
          groupId,
          text,
          clientMessageId,
          replyToMessageId: options?.replyToMessageId,
          mentionedUserIds: options?.mentionedUserIds,
          // Carried so an airplane-mode board post keeps its title when the
          // queue flushes — the user never sees this send, so a dropped
          // title would be silent work loss. The photo is carried for the
          // same reason: it is ALREADY uploaded (the composer signs it
          // before Post is enabled), so dropping the reference here would
          // strand an object in storage that no row points at.
          subject: options?.subject ?? null,
          imageUrl: options?.imageUrl ?? null,
          // Carried for the same reason as the title: a queued announcement
          // that flushes as a discussion is silent work loss, and the
          // student never sees the send that dropped it.
          postKind: options?.postKind ?? null,
        }, senderId)
        .catch(() => undefined);
    }
    // Mark just the failed row. Restoring the pre-await snapshots destroyed any
    // realtime message that landed while the send was in flight, and reverting the
    // whole `groups` array also threw away unread counts and other groups' previews.
    set((state) => {
      const markFailed = (list: Message[]) =>
        list.map((m) =>
          m.id === newMessage.id
            ? { ...m, deliveryState: (queueable ? 'pending' : 'failed') as 'pending' | 'failed' }
            : m
        );
      const updatedCache = markFailed(state.messagesCache[groupId] || []);
      const latest = lastDeliveredMessage(updatedCache);
      return {
        messages: state.activeGroupId === groupId ? markFailed(state.messages) : state.messages,
        messagesCache: { ...state.messagesCache, [groupId]: updatedCache },
        groups: state.groups.map((g) =>
          g.id === groupId ? { ...g, lastMessage: latest ?? undefined } : g
        ),
      };
    });
    void get().saveToStorage();
    // Queued is NOT a failure: the row is in the outbox and stays 'pending'
    // on screen. Throwing here made every screen alert "Send failed" and put
    // the text back in the composer, inviting a duplicate of a message that
    // was already on its way.
    if (queueable) {
      const queued =
        (get().messagesCache[groupId] || []).find((m) => m.id === newMessage.id)
        || { ...newMessage, deliveryState: 'pending' as const };
      return queuedOutcome(queued);
    }
    throw toSendError(error);
  } finally {
    releaseSendSlot();
  }
  };
}

/**
 * Outbox. Chat was the only major feature that never touched the sync queue, so
 * an offline send simply failed. Registered from the store module rather than
 * inside syncService because that module must not import stores (groupStore ->
 * syncService cycle).
 */
export function registerMessageOutboxHandler(store: StoreApi<GroupState>): void {
  syncService.registerHandler('message', async (op: { entityId: string; userId: string; data: Record<string, unknown> }) => {
    const data = op.data as {
      kind: 'group' | 'dm';
      groupId?: string;
      threadId?: string;
      recipientId?: string;
      text: string;
      clientMessageId: string;
      replyToMessageId?: string;
      mentionedUserIds?: string[];
      subject?: string | null;
      imageUrl?: string | null;
      postKind?: string | null;
    };
    try {
      if (data.kind === 'group' && data.groupId) {
        const payload = await transport.sendGroupMessage(data.groupId, op.userId, {
          content: data.text,
          clientMessageId: data.clientMessageId,
          replyToMessageId: data.replyToMessageId,
          mentionedUserIds: data.mentionedUserIds,
          ...(data.subject ? { subject: data.subject } : {}),
          ...(data.imageUrl ? { imageUrl: data.imageUrl } : {}),
          // A queued announcement flushes as an announcement. The value is
          // re-validated against the shared vocabulary because it has been
          // through AsyncStorage since it was chosen.
          ...(isBoardPostKind(data.postKind) ? { postKind: data.postKind } : {}),
        });
        const server = mapApiMessage(payload, data.groupId);
        store.setState((state) => ({
          messagesCache: {
            ...state.messagesCache,
            [data.groupId!]: replaceOptimisticWithServer(
              state.messagesCache[data.groupId!] || [],
              op.entityId,
              server
            ),
          },
          messages:
            state.activeGroupId === data.groupId
              ? replaceOptimisticWithServer(state.messages, op.entityId, server)
              : state.messages,
          // The optimistic send reverted the list preview when it was queued
          // (a pending row is not delivered), so nothing put the flushed message
          // back on the Chat list — it kept previewing the previous message until
          // the next cold fetch. Advance it here, now that the server has it.
          groups: state.groups.map((group) =>
            group.id === data.groupId
              ? { ...group, lastMessage: server, updatedAt: server.createdAt }
              : group
          ),
        }));
      } else if (data.kind === 'dm' && data.threadId && data.recipientId) {
        const sent = await transport.sendDirectMessage(
          op.userId,
          data.recipientId,
          data.text,
          data.clientMessageId,
          { replyToMessageId: data.replyToMessageId }
        );
        const confirmed = mapDirectMessage(sent, data.threadId);
        store.setState((state) => ({
          directMessages: {
            ...state.directMessages,
            [data.threadId!]: reconcileDeliveredItem(
              state.directMessages[data.threadId!] || [],
              { ...confirmed, clientMessageId: data.clientMessageId },
              [op.entityId]
            ),
          },
          // Same reason as the group case: the queued send reverted the inbox
          // preview, so the flush has to advance it.
          dmThreads: state.dmThreads.map((t) =>
            t.id === data.threadId
              ? {
                  ...t,
                  lastMessage: chatMessagePreview(confirmed.text, ''),
                  lastMessageTimestamp: confirmed.timestamp,
                }
              : t
          ),
        }));
      }
      void store.getState().saveToStorage();
      return true;
    } catch (error) {
      // Permanent rejections must not retry forever — mark the row and drop the op.
      if (!isQueueableSendError(error)) {
        store.setState((state) => {
          const markFailed = <T extends { id: string }>(list: T[]) =>
            list.map((m) =>
              m.id === op.entityId ? { ...m, deliveryState: 'failed' as const } : m
            );
          const gid = data.groupId;
          const tid = data.threadId;
          return {
            messagesCache: gid
              ? { ...state.messagesCache, [gid]: markFailed(state.messagesCache[gid] || []) }
              : state.messagesCache,
            directMessages: tid
              ? { ...state.directMessages, [tid]: markFailed(state.directMessages[tid] || []) }
              : state.directMessages,
          };
        });
        return true;
      }
      // Dead connection: rethrow so the queue halts the run without burning one
      // of this message's retries (a false return counts as a server rejection).
      if (isTransientSyncError(error)) throw error;
      console.warn('[SyncHandler:message] send failed, will retry:', error);
      return false;
    }
  });
}

