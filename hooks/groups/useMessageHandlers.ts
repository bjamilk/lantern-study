/**
 * Group-message mutations, extracted verbatim from `hooks/useGroupHandlers.ts`.
 *
 * Exports: useMessageHandlers({ … }) — `applyChatMutation` (@internal, shared by
 *  the two mutators), `handleEditChatMessage`, `handleRemoveChatMessage`,
 *  `onPeerChatRead`, `onSendMessage` and `handleLoadMoreMessages`, all
 *  re-exported unchanged by the composer.
 * Touches: services/supabase (`sendMessage`, `fetchMessages`, `editGroupMessage`,
 *  `removeGroupMessage`, `editDirectMessage`, `removeDirectMessage`), the UI
 *  store read back through `getState()`, the shared `groupDeliveryIntents`
 *  registry and `sendingGroupIds` guard, and — through its parameters — the group
 *  store slices and `handleSendDm` from useDmHandlers.
 * Gotchas:
 *  - `onSendMessage` THROWS `MessageSendBusyError` when a send for the same group
 *    is already in flight (E3 H16); it must never return silently, because the
 *    composer clears the student's text before awaiting and restores it only from
 *    a rejection. A DM selection is forwarded to `handleSendDm`, which is why
 *    useDmHandlers has to be composed BEFORE this hook.
 *  - Edit and remove are server-first (no optimistic write) and RETHROW, so the
 *    menu can surface the failure. Both read the chat kind from the LIVE
 *    selection, not from a captured one.
 *  - `applyChatMutation` also rewrites every reply PREVIEW quoting the mutated
 *    message and re-derives the conversation preview; an edit that only patched
 *    the message itself would leave stale text in quoted bubbles.
 *  - Group read receipts are a best-effort approximation: there is no per-user
 *    seen set, so a watermark advances the count by one peer, capped at the
 *    roster size minus self.
 */
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, MessageType, ChatItem, DirectMessage } from '../../types';
import { useGroupStore } from '../../stores/groupStore';
import { useUIStore } from '../../stores/uiStore';
import {
    mapMessageFromApi,
    computeDmReceiptStatus,
    mergeChatMessagesById,
    isTempMessageId,
    createOptimisticClientMessageId,
    isUncertainDeliveryError,
    reconcileDeliveredItem,
    resolveThreadRootId,
    formatActorLabel,
} from '@lantern/shared/utils';
import {
    sendMessage, fetchMessages,
    editGroupMessage, removeGroupMessage, editDirectMessage, removeDirectMessage,
    type ChatMessageMutationPayload,
} from '../../services/supabase';
import { normalizeFetchedMessages } from './normalisers';
import { groupDeliveryIntents, sendingGroupIds, MessageSendBusyError } from './deliveryIntents';
import type { AddNotification, AuthStoreState, GroupStoreState, UIStoreState } from './types';

export interface UseMessageHandlersParams
    extends Pick<AuthStoreState, 'currentUser'>,
        Pick<
            GroupStoreState,
            'groups' | 'messages' | 'updateMessages' | 'updateGroups' | 'updateDmThreads' | 'updateDirectMessages'
        >,
        Pick<UIStoreState, 'selectedChat' | 'lowDataMode'> {
    addNotification: AddNotification;
    /** From useDmHandlers: a send into a DM selection is forwarded to it. */
    handleSendDm: (
        threadId: string,
        text: string,
        options?: { replyToMessageId?: string },
    ) => Promise<void>;
}

export function useMessageHandlers({
    currentUser,
    groups,
    messages,
    updateMessages,
    updateGroups,
    updateDmThreads,
    updateDirectMessages,
    selectedChat,
    lowDataMode,
    addNotification,
    handleSendDm,
}: UseMessageHandlersParams) {
    // ── Message edit / remove ─────────────────────────────────────────────────
    // Applies an already-persisted edit/removal to local state for either chat kind. Besides
    // patching the message itself it rewrites every reply PREVIEW that quotes it (so an edit
    // or deletion propagates into quoted bubbles) and re-derives the conversation preview
    // from the newest still-visible message, skipping removed and archived ones.
    const applyChatMutation = useCallback((
        chat: ChatItem,
        payload: ChatMessageMutationPayload
    ) => {
        if (chat.chatType === 'group') {
            let nextMessages: Message[] = [];
            updateMessages((prev) => {
                nextMessages = (prev[chat.id] || []).map((message) => {
                    const replyTo = message.replyTo?.id === payload.id
                        ? {
                            ...message.replyTo,
                            text: payload.isRemoved ? undefined : payload.text,
                            isRemoved: !!payload.isRemoved,
                        }
                        : message.replyTo;
                    if (message.id !== payload.id) return { ...message, replyTo };
                    return {
                        ...message,
                        ...(!payload.isRemoved ? { text: payload.text } : { text: undefined }),
                        editedAt: payload.editedAt,
                        removedAt: payload.removedAt,
                        isRemoved: !!payload.isRemoved,
                        replyTo,
                    };
                });
                return { ...prev, [chat.id]: nextMessages };
            });

            const latest = [...nextMessages].reverse().find(
                (message) => !message.isRemoved && !message.removedAt && !message.isArchived
            );
            updateGroups((prev) => prev.map((group) =>
                group.id === chat.id
                    ? {
                        ...group,
                        lastMessage: latest?.text || latest?.questionStem,
                        lastMessageTime: latest?.timestamp,
                    }
                    : group
            ));
            return;
        }

        let nextMessages: DirectMessage[] = [];
        updateDirectMessages((prev) => {
            nextMessages = (prev[chat.id] || []).map((message) => {
                const replyTo = message.replyTo?.id === payload.id
                    ? {
                        ...message.replyTo,
                        text: payload.isRemoved ? undefined : payload.text,
                        isRemoved: !!payload.isRemoved,
                    }
                    : message.replyTo;
                if (message.id !== payload.id) return { ...message, replyTo };
                return {
                    ...message,
                    text: payload.isRemoved ? '' : payload.text || '',
                    editedAt: payload.editedAt,
                    removedAt: payload.removedAt,
                    isRemoved: !!payload.isRemoved,
                    replyTo,
                };
            });
            return { ...prev, [chat.id]: nextMessages };
        });

        const latest = [...nextMessages].reverse().find(
            (message) => !message.isRemoved && !message.removedAt
        );
        updateDmThreads((prev) => prev.map((thread) =>
            thread.id === chat.id
                ? {
                    ...thread,
                    lastMessage: latest?.text,
                    lastMessageTimestamp: latest?.timestamp,
                }
                : thread
        ));
    }, [updateDirectMessages, updateDmThreads, updateGroups, updateMessages]);

    // Edit and remove are server-first (no optimistic write) and rethrow, so the composer /
    // menu can surface the failure; the chat kind is read from the LIVE selection.
    const handleEditChatMessage = useCallback(async (
        messageId: string,
        content: string
    ) => {
        const chat = useUIStore.getState().selectedChat;
        if (!chat) throw new Error('No conversation selected');
        const payload = chat.chatType === 'group'
            ? await editGroupMessage(messageId, content)
            : await editDirectMessage(messageId, content);
        applyChatMutation(chat, payload);
        return payload;
    }, [applyChatMutation]);

    const handleRemoveChatMessage = useCallback(async (messageId: string) => {
        const chat = useUIStore.getState().selectedChat;
        if (!chat) throw new Error('No conversation selected');
        const payload = chat.chatType === 'group'
            ? await removeGroupMessage(messageId)
            : await removeDirectMessage(messageId);
        applyChatMutation(chat, payload);
        return payload;
    }, [applyChatMutation]);


    // ── Read receipts ─────────────────────────────────────────────────────────
    // Applies a peer's read watermark to the messages THIS user sent in the open chat.
    // DMs are exact (one peer, so the watermark decides sent/read). Groups have no per-user
    // seen set, so the count is advanced by one peer per watermark, capped at the roster size
    // minus self — a best-effort approximation, not an exact seen-by list.
    const onPeerChatRead = useCallback((payload: { userId: string; lastReadAt: string }) => {
        const chat = useUIStore.getState().selectedChat;
        if (!chat || !currentUser) return;
        const { userId, lastReadAt } = payload;
        if (!userId || userId === currentUser.id || !lastReadAt) return;

        if (chat.chatType === 'dm') {
            updateDirectMessages((prev) => {
                const list = prev[chat.id] || [];
                if (!list.length) return prev;
                return {
                    ...prev,
                    [chat.id]: list.map((m) => {
                        if (m.senderId !== currentUser.id) return m;
                        return {
                            ...m,
                            receiptStatus: computeDmReceiptStatus(m.timestamp, lastReadAt),
                        };
                    }),
                };
            });
            return;
        }

        updateMessages((prev) => {
            const list = prev[chat.id] || [];
            if (!list.length) return prev;
            return {
                ...prev,
                [chat.id]: list.map((m) => {
                    if (m.sender?.id !== currentUser.id) return m;
                    const msgMs = new Date(m.timestamp).getTime();
                    const readMs = new Date(lastReadAt).getTime();
                    if (!Number.isFinite(msgMs) || !Number.isFinite(readMs) || readMs < msgMs) {
                        return m;
                    }
                    const total = typeof m.seenByTotal === 'number'
                        ? m.seenByTotal
                        : Math.max(0, (groups.find((g) => g.id === chat.id)?.members?.length || 1) - 1);
                    const prevCount = m.seenByCount || 0;
                    // Advance by one peer when watermark covers this message (best-effort without per-user set).
                    const seenByCount = m.receiptStatus === 'read'
                        ? total
                        : Math.max(prevCount, Math.min(total, prevCount + 1));
                    return {
                        ...m,
                        seenByCount,
                        seenByTotal: total,
                        receiptStatus: seenByCount >= total && total > 0 ? 'read' : 'sent',
                    };
                }),
            };
        });
    }, [currentUser, groups, updateDirectMessages, updateMessages]);

    // ── Text send ─────────────────────────────────────────────────────────────
    // Group path: snapshot the previous preview for rollback, mint/reuse the optimistic id
    // from the delivery registry (fingerprinted on text + replyTo + mentions), append the
    // bubble and bump the sidebar preview, then POST. On success the optimistic row is
    // replaced via reconcileDeliveredItem, keeping the local sender when the API response
    // omits the joined profile. DM path just delegates to handleSendDm.
    const onSendMessage = useCallback(async (
        text: string,
        options?: { replyToMessageId?: string; mentionedUserIds?: string[] }
    ) => {
        if (!currentUser || !selectedChat) return;

        if (selectedChat.chatType === 'group') {
            // Per-group send lock, held for the whole optimistic-send round trip.
            // FIXED (F1) [E3 H16, high]: the lock now THROWS MessageSendBusyError
            // instead of returning silently. MessageInputBar clears the composer text
            // before awaiting and restores it in `catch`, and ChatWindow binds two
            // composers (main + thread) to this one handler — so the silent return used
            // to discard typed text outright when a send from the thread raced a main
            // send: no message, no error, no restore. Throwing restores the text and
            // shows the reason. (Keying the lock per client message id instead of per
            // group is still the better shape and is deliberately NOT done here.)
            if (sendingGroupIds.has(selectedChat.id)) throw new MessageSendBusyError();
            sendingGroupIds.add(selectedChat.id);

            const groupBefore = groups.find(g => g.id === selectedChat.id);
            const prevLastMessage = groupBefore?.lastMessage;
            const prevLastMessageTime = groupBefore?.lastMessageTime;

            // Optimistic update - show message immediately
            const deliveryScope = `group:${selectedChat.id}`;
            const deliveryFingerprint = JSON.stringify({
                text,
                replyToMessageId: options?.replyToMessageId || null,
                mentionedUserIds: [...(options?.mentionedUserIds || [])].sort(),
            });
            // FIXED (F1) [E3 M3, medium]: the id factory is now
            // `createOptimisticClientMessageId` (temp- prefix), matching the DM path.
            // Every merge path recognises a local row by `isTempMessageId`, so the old
            // bare `uuidv4` produced optimistic rows indistinguishable from server rows:
            // mergeChatMessagesById kept them, and a lost or raced send confirmation left
            // a PERMANENT duplicate. See the matching paging fix in
            // handleLoadMoreMessages, which now filters with isTempMessageId.
            //
            // The `temp-` prefix is LOCAL ONLY. `sendMessage` (services/supabase.ts)
            // normalises it with `toWireClientMessageId` before it hits the wire,
            // because the API validates `clientMessageId` as a strict UUID and was
            // rejecting every send with 400 INVALID_CLIENT_MESSAGE_ID. The server
            // echoes back the bare UUID, so every reconcile path compares with
            // `matchesClientMessageId` rather than `===`.
            const optimisticId = groupDeliveryIntents.resolve(
                deliveryScope,
                deliveryFingerprint,
                () => createOptimisticClientMessageId(uuidv4)
            );
            const existingGroupMsgs = useGroupStore.getState().messages[selectedChat.id] || [];
            const parent = options?.replyToMessageId
                ? existingGroupMsgs.find((m) => m.id === options.replyToMessageId)
                : undefined;
            const threadRootId = parent
                ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
                : undefined;
            const rootReplyCount = threadRootId
                ? (existingGroupMsgs.find((m) => m.id === threadRootId)?.replyCount || 0) + 1
                : 0;
            const newMessage: Message = {
                id: optimisticId,
                groupId: selectedChat.id,
                sender: currentUser,
                timestamp: new Date(),
                type: MessageType.TEXT,
                text,
                upvotes: 0,
                downvotes: 0,
                replyToMessageId: options?.replyToMessageId,
                mentionedUserIds: options?.mentionedUserIds,
                threadRootId,
                replyCount: threadRootId ? rootReplyCount : 0,
                receiptStatus: 'sent',
                seenByCount: 0,
                seenByTotal: Math.max(0, (groupBefore?.members?.length || 1) - 1),
            };
            updateMessages(prev => {
                const list = prev[selectedChat.id] || [];
                const withOptimistic = [...list, newMessage];
                if (!threadRootId) return { ...prev, [selectedChat.id]: withOptimistic };
                return {
                    ...prev,
                    [selectedChat.id]: withOptimistic.map((m) => {
                        if (m.id === optimisticId) return m;
                        const rootKey = m.threadRootId || m.id;
                        if (rootKey !== threadRootId) return m;
                        return { ...m, replyCount: rootReplyCount };
                    }),
                };
            });
            updateGroups(prev => prev.map(g => g.id === selectedChat.id ? { ...g, lastMessage: text, lastMessageTime: new Date().toISOString() } : g));

            // Send to API in background
            try {
                const sentMessage = await sendMessage(selectedChat.id, currentUser.id, text, optimisticId, {
                    replyToMessageId: options?.replyToMessageId,
                    mentionedUserIds: options?.mentionedUserIds,
                });
                if (!sentMessage) {
                    throw new Error('Message failed to send. Please try again.');
                }
                const confirmed = mapMessageFromApi(sentMessage);
                // Replace optimistic message with server-confirmed one (keep sender if API omits profile)
                updateMessages(prev => {
                    const list = prev[selectedChat.id] || [];
                    const optimistic = list.find((message) => message.id === optimisticId);
                    const confirmedSender = confirmed.sender;
                    const optimisticSender = optimistic?.sender || currentUser;
                    const reconciledSender = confirmedSender?.id
                        ? {
                            ...optimisticSender,
                            ...confirmedSender,
                            id: confirmedSender.id,
                            username: confirmedSender.username || optimisticSender?.username,
                            name:
                              confirmedSender.name &&
                              confirmedSender.name !== 'Member' &&
                              confirmedSender.name !== 'Unknown'
                                ? confirmedSender.name
                                : optimisticSender?.name || confirmedSender.name,
                          }
                        : optimisticSender;
                    const reconciled = {
                        ...optimistic,
                        ...confirmed,
                        id: confirmed.id,
                        sender: reconciledSender,
                    };
                    return {
                        ...prev,
                        [selectedChat.id]: reconcileDeliveredItem(
                            list,
                            reconciled,
                            [optimisticId]
                        ),
                    };
                });
                groupDeliveryIntents.clear(
                    deliveryScope,
                    deliveryFingerprint,
                    optimisticId
                );

                // Group message notifications are created server-side after the message is persisted.
            } catch (error) {
                // Same error split as the DM path: uncertain delivery keeps the intent so a
                // retry reuses the id; anything else clears it. The sidebar preview is rolled
                // back to the pre-send values captured above.
                // FIXED (F9): the optimistic message is deleted, and the only
                // signal used to be a notification — the handler swallowed the
                // error, so the composer (which clears its box before awaiting
                // and restores only in `catch`) lost the typed text with no
                // failed bubble to retry from. The error is rethrown after the
                // rollback, the same contract the busy lock uses; the composer
                // restores the text and the photo and shows the reason.
                console.error('Error sending message to server:', error);
                if (isUncertainDeliveryError(error)) {
                    groupDeliveryIntents.markUncertain(
                        deliveryScope,
                        deliveryFingerprint,
                        optimisticId
                    );
                } else {
                    groupDeliveryIntents.clear(
                        deliveryScope,
                        deliveryFingerprint,
                        optimisticId
                    );
                }
                updateMessages(prev => ({
                    ...prev,
                    [selectedChat.id]: (prev[selectedChat.id] || []).filter(m => m.id !== optimisticId),
                }));
                updateGroups(prev => prev.map(g =>
                    g.id === selectedChat.id
                        ? { ...g, lastMessage: prevLastMessage, lastMessageTime: prevLastMessageTime }
                        : g
                ));
                throw error instanceof Error ? error : new Error('Message failed to send. Please try again.');
            } finally {
                sendingGroupIds.delete(selectedChat.id);
            }
        } else if (selectedChat.chatType === 'dm') {
            await handleSendDm(selectedChat.id, text, {
                replyToMessageId: options?.replyToMessageId,
            });
        }
    }, [currentUser, selectedChat, groups, updateMessages, updateGroups, handleSendDm, addNotification]);

    // ── History paging ────────────────────────────────────────────────────────
    // Group pager: cursor-based on the timestamp of the oldest NON-optimistic message, then
    // prepends only ids not already present. Returns the page size so the scroller knows
    // whether it hit the top.
    const handleLoadMoreMessages = useCallback(async (groupId: string) => {
        const currentMsgs = messages[groupId] || [];
        if (currentMsgs.length === 0) return 0;
        
        // FIXED (F1) [E3 M3]: `startsWith('optimistic-')` matched nothing the app ever
        // mints — group optimistic rows carry a temp- id now, DM rows always did — so an
        // optimistic row could become the paging cursor and re-fetch the newest page
        // forever. isTempMessageId covers every local-row prefix.
        const oldestRealMessage = currentMsgs.find(m => !isTempMessageId(String(m.id)));
        if (!oldestRealMessage) return 0;

        const beforeCursor = oldestRealMessage.timestamp instanceof Date 
            ? oldestRealMessage.timestamp.toISOString() 
            : new Date(oldestRealMessage.timestamp).toISOString();

        const limit = lowDataMode ? 20 : 50;

        try {
            console.log('Loading more messages before:', beforeCursor);
            const olderMessages = await fetchMessages(groupId, undefined, limit, beforeCursor);
            if (olderMessages && olderMessages.length > 0) {
                const mappedOlder = normalizeFetchedMessages(olderMessages);
                updateMessages(prev => {
                    const prevGroupMsgs = prev[groupId] || [];
                    const existingIds = new Set(prevGroupMsgs.map(m => m.id));
                    const filteredOlder = mappedOlder.filter((m) => !existingIds.has(m.id));
                    
                    return {
                        ...prev,
                        [groupId]: [...filteredOlder, ...prevGroupMsgs]
                    };
                });
                return mappedOlder.length;
            }
            return 0;
        } catch (error) {
            console.error('Error fetching older messages:', error);
            return 0;
        }
    }, [messages, lowDataMode, updateMessages]);

    return {
        applyChatMutation,
        handleEditChatMessage,
        handleRemoveChatMessage,
        onPeerChatRead,
        onSendMessage,
        handleLoadMoreMessages,
    };
}
