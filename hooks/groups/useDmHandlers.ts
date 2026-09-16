/**
 * Direct-message mutations, extracted verbatim from `hooks/useGroupHandlers.ts`.
 *
 * Exports: useDmHandlers({ … }) — `handleInitiateDm`, `handleSendDm`,
 *  `handleDmThreadStatusChange`, `handleDeleteDmThread`, `handleArchiveDmThread`,
 *  `handleUnarchiveDmThread` and `handleLoadMoreDirectMessages`, all re-exported
 *  unchanged by the composer.
 * Touches: services/supabase (`fetchUserProfile`, `fetchDmThreads`,
 *  `sendDirectMessage`, `fetchDirectMessages`, `deleteDmThread`,
 *  `archiveDmThread`, `unarchiveDmThread`, `ensureAuthTokenReady`), the group and
 *  UI stores (read back through `getState()` where a stale closure would be
 *  wrong), the toast store, and the shared `dmDeliveryIntents` registry.
 * Gotchas:
 *  - `handleSendDm` THROWS `MessageSendBusyError` when a send for the same thread
 *    is already in flight; it must never return silently, because the composer
 *    clears the student's text before awaiting and restores it only from a
 *    rejection (F1 · E3 H16).
 *  - A thread that does not exist yet is created LOCALLY with `clientPending:
 *    true`; the server row is not written until the first message is sent. That
 *    is why the send resolves the thread from the store FIRST and then from the
 *    live selection.
 *  - Delete / archive / unarchive are optimistic-first and are NOT rolled back on
 *    failure: the list can disagree with the server until the next refresh.
 */
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { User, DMThread, DirectMessage } from '../../types';
import { useGroupStore } from '../../stores/groupStore';
import { useUIStore } from '../../stores/uiStore';
import { useToastStore } from '../../stores/toastStore';
import {
    computeDmReceiptStatus,
    resolveThreadRootId,
    mergeChatMessagesById,
    isTempMessageId,
    createOptimisticClientMessageId,
    isUncertainDeliveryError,
    reconcileDeliveredItem,
} from '@lantern/shared/utils';
import {
    fetchUserProfile, fetchDmThreads, sendDirectMessage, fetchDirectMessages,
    deleteDmThread, archiveDmThread, unarchiveDmThread, ensureAuthTokenReady,
} from '../../services/supabase';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../../utils/dmThreads';
import { mapDirectMessageFromApi } from './normalisers';
import { dmDeliveryIntents, sendingThreadIds, MessageSendBusyError } from './deliveryIntents';
import type { AuthStoreState, GroupStoreState, HandleSelectChat, UIStoreState } from './types';

export interface UseDmHandlersParams
    extends Pick<AuthStoreState, 'currentUser'>,
        Pick<GroupStoreState, 'groups' | 'dmThreads' | 'updateDmThreads' | 'updateDirectMessages'>,
        Pick<UIStoreState, 'setSelectedChat' | 'lowDataMode'> {
    users: User[];
    handleSelectChat: HandleSelectChat;
}

export function useDmHandlers({
    currentUser,
    users,
    groups,
    dmThreads,
    updateDmThreads,
    updateDirectMessages,
    setSelectedChat,
    lowDataMode,
    handleSelectChat,
}: UseDmHandlersParams) {
    // ── DM threads ────────────────────────────────────────────────────────────
    // Opens (or invents) a conversation with another user. The thread id is the two user ids
    // sorted and joined, so both sides derive the same id without a round trip. A thread that
    // does not exist yet is created LOCALLY with clientPending: true — the server row is not
    // written until the first message is sent. The peer profile is looked up in three places
    // (users list, group rosters, then a profile fetch) before giving up.
    const handleInitiateDm = useCallback(async (otherUserId: string) => {
        if (!currentUser || !otherUserId || otherUserId === currentUser.id) return;

        const sortedIds: [string, string] = [currentUser.id, otherUserId].sort() as [string, string];
        const threadId = sortedIds.join('-');

        let thread = dmThreads.find(t => t.id === threadId);

        if (!thread) {
            // Look up user from the users list first, then fall back to group members
            let otherUser = users.find(u => u.id === otherUserId);
            if (!otherUser) {
                for (const group of groups) {
                    const member = (group.members || []).find(m => m.id === otherUserId);
                    if (member) { otherUser = member; break; }
                }
            }
            if (!otherUser) {
                try {
                    const profile = await fetchUserProfile(otherUserId);
                    if (profile) {
                        otherUser = {
                            id: profile.id,
                            name: profile.name,
                            avatarUrl: profile.avatar_url ?? profile.avatarUrl,
                        } as User;
                    }
                } catch {
                    // Profile lookup failed; handled below.
                }
            }
            if (!otherUser) {
                console.error("DM opponent not found in users or group members");
                return;
            }
            const newThread: DMThread = {
                id: threadId,
                participantIds: sortedIds,
                participants: {
                    [currentUser.id]: { name: currentUser.name, avatarUrl: currentUser.avatarUrl },
                    [otherUserId]: { name: otherUser.name, avatarUrl: otherUser.avatarUrl },
                },
                clientPending: true,
            };
            updateDmThreads(prev => (prev.some((t) => t.id === threadId) ? prev : [...prev, newThread]));
            handleSelectChat({ ...newThread, chatType: 'dm' });
        } else {
            handleSelectChat({ ...thread, chatType: 'dm' });
        }

        // Sync from server, but keep optimistic local threads (not created until first send).
        try {
            const fetchedThreads = await fetchDmThreads(currentUser.id);
            if (Array.isArray(fetchedThreads)) {
                const mapped = fetchedThreads.map((t: any) => mapDmThreadFromApi(t));
                updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'soft'));
            }
        } catch (err) {
            console.warn('[DM] Failed to refresh threads after initiate:', err);
        }
    }, [currentUser, dmThreads, users, groups, updateDmThreads, handleSelectChat]);

    // DM send. Order: guard the thread against a concurrent send, resolve the thread (store
    // first, then the live selection, so a clientPending thread can still be sent to), mint a
    // clientMessageId from the delivery registry keyed on {text, replyTo}, append the
    // optimistic bubble (bumping the thread-root reply count), patch the thread preview, then
    // POST. On success reconcileDeliveredItem swaps the optimistic row for the confirmed one
    // by clientMessageId; the threads and history refetches that follow are background-only
    // so the composer is never blocked.
    const handleSendDm = useCallback(async (
        threadId: string,
        text: string,
        options?: { replyToMessageId?: string }
    ) => {
        if (!currentUser) return;
        // FIXED (F1) [E3 H16, high]: same silent-discard bug as the group path — the DM
        // composer clears its text before awaiting, so a busy return lost it.
        if (sendingThreadIds.has(threadId)) throw new MessageSendBusyError();
        sendingThreadIds.add(threadId);

        const selected = useUIStore.getState().selectedChat;
        const threadFromStore = dmThreads.find(t => t.id === threadId);
        const threadFromSelection =
            selected?.chatType === 'dm' && selected.id === threadId
                ? (selected as DMThread & { chatType: 'dm' })
                : null;
        const thread = threadFromStore || threadFromSelection;
        if (!thread) {
            sendingThreadIds.delete(threadId);
            throw new Error('Conversation not found. Open the chat again and retry.');
        }

        // Ensure optimistic thread stays listed if a refresh wiped it.
        if (!threadFromStore) {
            updateDmThreads((prev) =>
                prev.some((t) => t.id === threadId) ? prev : [...prev, thread],
            );
        }

        const otherUserId = thread.participantIds.find(id => id !== currentUser.id);
        if (!otherUserId) {
            sendingThreadIds.delete(threadId);
            throw new Error('Could not find the other person in this conversation.');
        }
        
        const deliveryScope = `dm:${threadId}`;
        const deliveryFingerprint = JSON.stringify({
            text,
            replyToMessageId: options?.replyToMessageId || null,
        });
        const clientMessageId = dmDeliveryIntents.resolve(
            deliveryScope,
            deliveryFingerprint,
            () => createOptimisticClientMessageId(uuidv4)
        );
        const existing = useGroupStore.getState().directMessages[threadId] || [];
        const parent = options?.replyToMessageId
            ? existing.find((m) => m.id === options.replyToMessageId)
            : undefined;
        const threadRootId = parent
            ? resolveThreadRootId({ id: parent.id, threadRootId: parent.threadRootId })
            : undefined;
        const rootReplyCount = threadRootId
            ? (existing.find((m) => m.id === threadRootId)?.replyCount || 0) + 1
            : 0;
        const optimisticMessage: DirectMessage = {
            id: clientMessageId,
            threadId,
            senderId: currentUser.id,
            text,
            timestamp: new Date(),
            replyToMessageId: options?.replyToMessageId,
            threadRootId,
            replyCount: threadRootId ? rootReplyCount : 0,
            receiptStatus: 'sent',
            clientMessageId,
        };
        
        updateDirectMessages(prev => {
            const list = prev[threadId] || [];
            const withOptimistic = [...list, optimisticMessage];
            if (!threadRootId) return { ...prev, [threadId]: withOptimistic };
            return {
                ...prev,
                [threadId]: withOptimistic.map((m) => {
                    if (m.id === clientMessageId) return m;
                    const rootKey = m.threadRootId || m.id;
                    if (rootKey !== threadRootId) return m;
                    return { ...m, replyCount: rootReplyCount };
                }),
            };
        });
        // Keep clientPending until a threads fetch returns this id — otherwise a
        // server merge can drop the thread right after the first local lastMessage write.
        updateDmThreads(prevThreads => prevThreads.map(t => 
            t.id === threadId
                ? {
                    ...t,
                    lastMessage: text,
                    lastMessageTimestamp: new Date(),
                    // Preserve pending only for local-first threads; never mark server threads pending.
                    ...(t.clientPending ? { clientPending: true } : {}),
                    historyClearedAt: null,
                  }
                : t
        ));
        // Sender just messaged — clear local delete-for-me cutoff so the bubble stays.
        useGroupStore.setState((state) => {
            if (!state.dmHistoryClearedAtByThread[threadId]) return state;
            const { [threadId]: _cleared, ...rest } = state.dmHistoryClearedAtByThread;
            return { dmHistoryClearedAtByThread: rest };
        });
        
        try {
            const sent = await sendDirectMessage(currentUser.id, otherUserId, text, clientMessageId, {
                replyToMessageId: options?.replyToMessageId,
            });
            const confirmed: DirectMessage = {
                ...optimisticMessage,
                id: sent.id,
                text: sent.text ?? sent.content ?? text,
                timestamp: new Date(sent.timestamp || sent.created_at || optimisticMessage.timestamp),
                editedAt: sent.editedAt || sent.edited_at,
                removedAt: sent.removedAt || sent.removed_at,
                isRemoved: !!(sent.isRemoved || sent.removedAt || sent.removed_at),
                replyToMessageId:
                    sent.replyToMessageId || sent.reply_to_message_id || optimisticMessage.replyToMessageId,
                replyTo: sent.replyTo || optimisticMessage.replyTo,
                threadRootId:
                    sent.threadRootId || sent.thread_root_id || optimisticMessage.threadRootId,
                replyCount:
                    typeof sent.replyCount === 'number'
                        ? sent.replyCount
                        : optimisticMessage.replyCount,
                receiptStatus: sent.receiptStatus || optimisticMessage.receiptStatus,
                clientMessageId:
                    sent.clientMessageId || sent.client_message_id || clientMessageId,
            };
            updateDirectMessages(prev => ({
                ...prev,
                [threadId]: reconcileDeliveredItem(
                    prev[threadId] || [],
                    confirmed,
                    [clientMessageId]
                ),
            }));
            dmDeliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
            // Don't block the composer on a full list refresh; merge in background.
            // Avoid handleSelectChat here — re-selecting remounts fetch races.
            void fetchDmThreads(currentUser.id)
                .then((fetchedThreads) => {
                    if (!Array.isArray(fetchedThreads)) return;
                    const mapped = fetchedThreads.map((t: any) => mapDmThreadFromApi(t));
                    updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'soft'));
                    const refreshed = mapped.find((t) => t.id === threadId);
                    const selected = useUIStore.getState().selectedChat;
                    if (refreshed && selected?.chatType === 'dm' && selected.id === threadId) {
                        setSelectedChat({ ...selected, ...refreshed, chatType: 'dm' });
                    }
                })
                .catch((err) => {
                    console.warn('[DM] Failed to refresh threads after send:', err);
                });
            // Ensure first-message history is on screen even if the open-chat fetch raced empty.
            void fetchDirectMessages(currentUser.id, otherUserId)
                .then((fetchedMessages) => {
                    if (useUIStore.getState().selectedChat?.id !== threadId) return;
                    const raw = Array.isArray(fetchedMessages) ? fetchedMessages : [];
                    updateDirectMessages((prev) => ({
                        ...prev,
                        [threadId]: mergeChatMessagesById(
                            prev[threadId] || [],
                            raw.map((m: any) => mapDirectMessageFromApi(m, threadId)) as any
                        ) as DirectMessage[],
                    }));
                })
                .catch((err) => {
                    console.warn('[DM] Failed to refresh messages after send:', err);
                });
        } catch (error) {
            // Error classes: an UNCERTAIN delivery error (the request may have landed —
            // timeout, aborted fetch) keeps the intent so a retry reuses the same
            // clientMessageId and the server dedupes it; any definite failure clears it so a
            // retry mints a fresh id.
            // FIXED (F9): both branches delete the optimistic bubble, and this
            // handler used to SWALLOW the error behind an alert(). The composer
            // clears `inputText` before awaiting and restores it only in its
            // catch, so a transient network failure lost the typed message
            // entirely — nothing on screen, nothing to retry from. The error is
            // now rethrown after the rollback, which is the same contract the
            // busy lock already uses (MessageSendBusyError, F1): the composer
            // puts the text and the attached photo back and shows the reason.
            // The alert is gone with it — the composer states the failure.
            console.error('Failed to send DM:', error);
            if (isUncertainDeliveryError(error)) {
                dmDeliveryIntents.markUncertain(
                    deliveryScope,
                    deliveryFingerprint,
                    clientMessageId
                );
            } else {
                dmDeliveryIntents.clear(deliveryScope, deliveryFingerprint, clientMessageId);
            }
            updateDirectMessages(prev => ({
                ...prev,
                [threadId]: (prev[threadId] || []).filter(m => m.id !== optimisticMessage.id),
            }));
            throw error instanceof Error
                ? error
                : new Error('Failed to send direct message');
        } finally {
            sendingThreadIds.delete(threadId);
        }
    }, [currentUser, dmThreads, updateDirectMessages, updateDmThreads, setSelectedChat]);

    // Local-only projection of a message-request decision (open/pending/declined) that the
    // request UI has already persisted; patches both the list row and the open selection so
    // the banner updates without a refetch.
    const handleDmThreadStatusChange = useCallback(
        (
            threadId: string,
            patch: { status: 'open' | 'pending' | 'declined'; requestedBy?: string | null }
        ) => {
            updateDmThreads((prev) =>
                prev.map((t) =>
                    t.id === threadId
                        ? {
                            ...t,
                            status: patch.status,
                            requestedBy:
                              patch.requestedBy !== undefined ? patch.requestedBy : t.requestedBy,
                          }
                        : t
                )
            );
            const selected = useUIStore.getState().selectedChat;
            if (selected?.chatType === 'dm' && selected.id === threadId) {
                setSelectedChat({
                    ...selected,
                    status: patch.status,
                    requestedBy:
                      patch.requestedBy !== undefined ? patch.requestedBy : selected.requestedBy,
                });
            }
        },
        [updateDmThreads, setSelectedChat]
    );
    // Delete / archive / unarchive a thread: all three are optimistic-first (store mutated
    // immediately), then persisted; a server failure is reported by toast but NOT rolled
    // back, so the list can disagree with the server until the next threads refresh.
    const handleDeleteDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { removeDmThread, markDmHistoryCleared } = useGroupStore.getState();

        // Delete-for-me: stamp local cutoff so pre-delete messages cannot resurface
        // from client merge caches after the same thread_id is reused.
        markDmHistoryCleared(threadId);
        removeDmThread(threadId);

        try {
            await ensureAuthTokenReady();
            const success = await deleteDmThread(threadId, currentUser.id);
            if (!success) {
                console.error('Failed to delete DM thread on server');
                useToastStore
                    .getState()
                    .showToast('Failed to delete conversation on the server. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Failed to delete DM thread:', error);
            useToastStore
                .getState()
                .showToast('Failed to delete conversation on the server. Please try again.', 'error');
        }
    }, [currentUser]);

    const handleArchiveDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { archiveDmThread: archiveInStore } = useGroupStore.getState();
        archiveInStore(threadId);
        try {
            await ensureAuthTokenReady();
            const success = await archiveDmThread(threadId, currentUser.id);
            if (!success) {
                console.error('Failed to archive DM thread on server');
                useToastStore
                    .getState()
                    .showToast('Failed to archive conversation on the server. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Failed to archive DM thread:', error);
            useToastStore
                .getState()
                .showToast('Failed to archive conversation on the server. Please try again.', 'error');
        }
    }, [currentUser]);

    const handleUnarchiveDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { unarchiveDmThread: unarchiveInStore } = useGroupStore.getState();
        unarchiveInStore(threadId);
        try {
            await ensureAuthTokenReady();
            const success = await unarchiveDmThread(threadId, currentUser.id);
            if (!success) {
                console.error('Failed to unarchive DM thread on server');
                useToastStore
                    .getState()
                    .showToast('Failed to unarchive conversation on the server. Please try again.', 'error');
            }
        } catch (error) {
            console.error('Failed to unarchive DM thread:', error);
            useToastStore
                .getState()
                .showToast('Failed to unarchive conversation on the server. Please try again.', 'error');
        }
    }, [currentUser]);
    // DM history paging. DMs previously only ever loaded page 1 (newest 50) with no
    // way to reach older messages — scrolling up was a silent dead end. Mirror the
    // group pager: page by count of loaded real messages and prepend older pages.
    const handleLoadMoreDirectMessages = useCallback(async (threadId: string) => {
        const uid = currentUser?.id;
        if (!uid) return 0;
        const currentMsgs = useGroupStore.getState().directMessages[threadId] || [];
        // Optimistic DM rows carry a client id (temp-/msg-/local-…), not "optimistic-",
        // so count only server messages to derive the next page — isTempMessageId covers
        // every optimistic prefix (else the offset inflates and skips older history).
        const realCount = currentMsgs.filter((m) => !isTempMessageId(String(m.id))).length;
        if (realCount === 0) return 0;

        // Resolve the peer the same way the initial load does.
        let otherUserId = useGroupStore
            .getState()
            .dmThreads.find((t) => t.id === threadId)
            ?.participantIds?.find((id) => id !== uid);
        if (!otherUserId) {
            const prefix = `${uid}-`;
            const suffix = `-${uid}`;
            if (threadId.startsWith(prefix)) otherUserId = threadId.slice(prefix.length);
            else if (threadId.endsWith(suffix)) otherUserId = threadId.slice(0, -suffix.length);
        }
        if (!otherUserId) return 0;

        const limit = lowDataMode ? 20 : 50;
        const page = Math.floor(realCount / limit) + 1;

        try {
            const older = await fetchDirectMessages(uid, otherUserId, { page, limit });
            const raw = Array.isArray(older) ? older : [];
            if (raw.length === 0) return 0;
            const mapped: DirectMessage[] = raw.map((m: any) => mapDirectMessageFromApi(m, threadId));
            let added = 0;
            updateDirectMessages((prev) => {
                const existing = prev[threadId] || [];
                const existingIds = new Set(existing.map((m) => m.id));
                const fresh = mapped.filter((m) => !existingIds.has(m.id));
                added = fresh.length;
                if (fresh.length === 0) return prev;
                return {
                    ...prev,
                    [threadId]: mergeChatMessagesById(existing, fresh as any) as DirectMessage[],
                };
            });
            return added;
        } catch (error) {
            console.error('Error fetching older direct messages:', error);
            return 0;
        }
    }, [currentUser?.id, lowDataMode, updateDirectMessages]);

    return {
        handleInitiateDm,
        handleSendDm,
        handleDmThreadStatusChange,
        handleDeleteDmThread,
        handleArchiveDmThread,
        handleUnarchiveDmThread,
        handleLoadMoreDirectMessages,
    };
}
