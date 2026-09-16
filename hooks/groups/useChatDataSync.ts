/**
 * The chat-data load for the open conversation, extracted verbatim from
 * `hooks/useGroupHandlers.ts`.
 *
 * Exports: useChatDataSync({ … }) → `unreadAnchorAt`, the tri-state the chat
 *  screens draw the "new messages" divider from.
 * Touches: services/supabase (`ensureAuthTokenReady`, `fetchMessages`,
 *  `fetchUserVotesForGroup`, `markGroupAsRead`, `markDMAsRead`,
 *  `fetchDirectMessages`, `fetchDmThreads`), the group store's message / vote /
 *  thread / DM caches, and `useUIStore.getState().selectedChat`, re-read rather
 *  than closed over so a slow response cannot write into the wrong chat.
 * Effect order, and why this position is safe: these two effects — the
 *  anchor-clear and the load, in that order — were the FIRST two effects the
 *  composer registered, sitting between `handleChatBack` (now in
 *  ./useChatSelection, which registers no effect) and the five mutation hooks.
 *  The composer therefore calls this hook second, before all five. None of the
 *  five reads what this hook owns: `chatUnreadAnchor`, `markedReadChatIdRef` and
 *  `groupMessagesFetchSeqRef` are private to it, and `unreadAnchorAt` is returned
 *  straight through the composer to the chat screens, so nothing downstream can
 *  observe when in the render this runs.
 * Gotchas:
 *  - `unreadAnchorAt` is TRI-state and the distinction matters: `undefined` means
 *    the mark-as-read round trip has not answered yet, so the divider must be
 *    neither drawn nor ruled out; `null` means there was no prior marker.
 *  - Mark-as-read runs HERE and only here, for both groups and DMs, so a deep
 *    link and a list tap take one path and cannot race. `markedReadChatIdRef` is
 *    what stops a re-render of the SAME chat from re-marking it and losing the
 *    divider.
 *  - Merges use `mergeChatMessagesById(cached, serverList)` — incoming-wins, and
 *    therefore SERVER-WINS only in that argument order; it keeps local-only
 *    (pending) rows. Swapping the arguments lets the cache clobber fresh rows.
 *  - `dmFetchSeqRef` is passed IN from ./useChatSelection. Both bump the one
 *    counter on purpose: a tap and a deep-link load must cancel each other.
 */
import { useEffect, useRef, useState } from 'react';
import { Message, DMThread, DirectMessage } from '../../types';
import { useGroupStore } from '../../stores/groupStore';
import { useUIStore } from '../../stores/uiStore';
import { mergeChatMessagesById } from '@lantern/shared/utils';
import {
    fetchMessages, fetchUserVotesForGroup,
    fetchDirectMessages, markGroupAsRead, markDMAsRead, fetchDmThreads,
    ensureAuthTokenReady,
} from '../../services/supabase';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../../utils/dmThreads';
import { normalizeFetchedMessages, mapDirectMessageFromApi } from './normalisers';
import type { AuthStoreState, GroupStoreState, UIStoreState } from './types';

export interface UseChatDataSyncParams
    extends Pick<AuthStoreState, 'currentUser'>,
        Pick<
            GroupStoreState,
            'updateMessages' | 'updateUserVotes' | 'updateGroups' | 'updateDmThreads' | 'updateDirectMessages'
        >,
        Pick<UIStoreState, 'selectedChat' | 'lowDataMode'> {
    /** Shared with ./useChatSelection — both bump the one counter on purpose. */
    dmFetchSeqRef: { current: number };
}

export function useChatDataSync({
    currentUser,
    updateMessages,
    updateUserVotes,
    updateGroups,
    updateDmThreads,
    updateDirectMessages,
    selectedChat,
    lowDataMode,
    dmFetchSeqRef,
}: UseChatDataSyncParams) {
    const groupMessagesFetchSeqRef = useRef(0);
    /** Prior last_read_at for the open chat (group or DM) — used to scroll to first unread. */
    const [chatUnreadAnchor, setChatUnreadAnchor] = useState<{
        chatId: string;
        at: string | null;
    } | null>(null);
    const markedReadChatIdRef = useRef<string | null>(null);

    // Clear unread anchor when leaving or switching chats so the next open re-anchors.
    // Re-runs on selectedChat.id / .chatType; markedReadChatIdRef is what stops a re-render
    // of the SAME chat from re-marking it read and losing the "new messages" divider.
    useEffect(() => {
        if (!selectedChat) {
            markedReadChatIdRef.current = null;
            setChatUnreadAnchor(null);
            return;
        }
        if (markedReadChatIdRef.current !== selectedChat.id) {
            setChatUnreadAnchor(null);
        }
    }, [selectedChat?.id, selectedChat?.chatType]);

    // Load messages when a chat is selected (covers deep links / refresh, not only list taps).
    // Re-runs on selectedChat.id / .chatType / currentUser.id / lowDataMode (lowDataMode
    // changes the page size). This is the single mark-as-read + unread-anchor path.
    useEffect(() => {
        if (!selectedChat || !currentUser) return;

        let cancelled = false;

        // A deep link can land before session bootstrap finishes, so poll for a usable token
        // (24 x 250 ms) plus one late retry rather than failing the load outright. Giving up
        // is silent and non-destructive — the next selection or tab focus retries.
        const waitForAuthToken = async (): Promise<boolean> => {
            for (let attempt = 0; attempt < 24; attempt += 1) {
                if (cancelled) return false;
                if (await ensureAuthTokenReady()) return true;
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
            // One delayed retry after session bootstrap settles
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (cancelled) return false;
            return ensureAuthTokenReady();
        };

        const loadSelectedChat = async () => {
            const tokenReady = await waitForAuthToken();
            if (cancelled) return;
            if (!tokenReady) {
                console.warn('[selectedChat] Auth token not ready after retries — will retry on next selection/focus');
                return;
            }

            if (selectedChat.chatType === 'group') {
                const chatId = selectedChat.id;
                const limit = lowDataMode ? 20 : 50;
                const requestId = ++groupMessagesFetchSeqRef.current;

                try {
                    const fetchedMessages = await fetchMessages(chatId, undefined, limit);
                    if (requestId !== groupMessagesFetchSeqRef.current) return;
                    if (useUIStore.getState().selectedChat?.id !== chatId) return;
                    const list = normalizeFetchedMessages(fetchedMessages);
                    updateMessages((prev) => ({
                        ...prev,
                        [chatId]: mergeChatMessagesById(prev[chatId] || [], list as any) as Message[],
                    }));
                } catch (error) {
                    console.error('[selectedChat] Error fetching messages:', error);
                }

                fetchUserVotesForGroup(chatId, currentUser.id)
                    .then((fetchedVotes) => {
                        updateUserVotes((prev) => ({ ...prev, ...fetchedVotes }));
                    })
                    .catch((error) => {
                        console.error('[selectedChat] Error fetching user votes:', error);
                    });

                if (markedReadChatIdRef.current !== chatId) {
                    markedReadChatIdRef.current = chatId;
                    markGroupAsRead(chatId, currentUser.id)
                        .then((result) => {
                            if (cancelled) return;
                            setChatUnreadAnchor({
                                chatId,
                                at: result.previousLastReadAt,
                            });
                            updateGroups((prevGroups) =>
                                prevGroups.map((g) => (g.id === chatId ? { ...g, unreadCount: 0 } : g))
                            );
                        })
                        .catch((error) => {
                            console.error('[selectedChat] Error marking group as read:', error);
                        });
                }
            } else if (selectedChat.chatType === 'dm') {
                const threadId = selectedChat.id;
                if (markedReadChatIdRef.current !== threadId) {
                    markedReadChatIdRef.current = threadId;
                    markDMAsRead(threadId, currentUser.id)
                        .then((result) => {
                            if (cancelled) return;
                            setChatUnreadAnchor({
                                chatId: threadId,
                                at: result.previousLastReadAt ?? null,
                            });
                            updateDmThreads((prevThreads) =>
                                prevThreads.map((t) => (t.id === threadId ? { ...t, unreadCount: 0 } : t))
                            );
                        })
                        .catch((error) => {
                            console.error('[selectedChat] Error marking DM as read:', error);
                        });
                }

                // Peer resolution, three fallbacks deep: the selection's own participantIds,
                // then the store's thread row, then the composite thread id itself
                // (`<idA>-<idB>`) for the case where the threads list has not loaded yet.
                // If all three fail, refresh the threads list and retry the fetch once.
                const threadFromStore = useGroupStore.getState().dmThreads.find((t) => t.id === threadId);
                const participantIds =
                    (Array.isArray((selectedChat as DMThread).participantIds) &&
                    (selectedChat as DMThread).participantIds.length > 0
                        ? (selectedChat as DMThread).participantIds
                        : threadFromStore?.participantIds) || [];
                let otherUserId = participantIds.find((id) => id !== currentUser.id);

                // Threads list may still be loading; derive peer from composite id.
                if (!otherUserId) {
                    const prefix = `${currentUser.id}-`;
                    const suffix = `-${currentUser.id}`;
                    if (threadId.startsWith(prefix)) otherUserId = threadId.slice(prefix.length);
                    else if (threadId.endsWith(suffix)) otherUserId = threadId.slice(0, -suffix.length);
                }

                if (otherUserId) {
                    const requestId = ++dmFetchSeqRef.current;
                    // One retry after 400 ms: a DM fetch racing session bootstrap fails once
                    // and succeeds on the second attempt. A second failure is only logged —
                    // the cached thread stays on screen rather than being blanked.
                    const loadMessages = async () => {
                        try {
                            return await fetchDirectMessages(currentUser.id, otherUserId!);
                        } catch (firstError) {
                            console.warn('[selectedChat] DM fetch failed, retrying once:', firstError);
                            await new Promise((resolve) => setTimeout(resolve, 400));
                            return fetchDirectMessages(currentUser.id, otherUserId!);
                        }
                    };
                    loadMessages()
                        .then((fetchedMessages) => {
                            if (cancelled) return;
                            if (requestId !== dmFetchSeqRef.current) return;
                            if (useUIStore.getState().selectedChat?.id !== threadId) return;
                            const raw = Array.isArray(fetchedMessages) ? fetchedMessages : [];
                            const mappedMessages: DirectMessage[] = raw.map((m: any) =>
                                mapDirectMessageFromApi(m, threadId)
                            );
                            // Merge by id — never replace with empty/stale page.
                            updateDirectMessages((prev) => ({
                                ...prev,
                                [threadId]: mergeChatMessagesById(
                                    prev[threadId] || [],
                                    mappedMessages as any
                                ) as DirectMessage[],
                            }));
                        })
                        .catch((error) => {
                            console.error('[selectedChat] Error fetching DM messages:', error);
                        });
                } else {
                    // Peer unknown — refresh threads then retry once when list arrives.
                    void fetchDmThreads(currentUser.id)
                        .then((fetchedThreads) => {
                            if (cancelled || !Array.isArray(fetchedThreads)) return;
                            const mapped = fetchedThreads.map((t: any) => mapDmThreadFromApi(t));
                            updateDmThreads((prev) => mergeDmThreadLists(prev, mapped, 'soft'));
                            const refreshed = useGroupStore
                                .getState()
                                .dmThreads.find((t) => t.id === threadId);
                            const peer = refreshed?.participantIds?.find((id) => id !== currentUser.id);
                            if (!peer || useUIStore.getState().selectedChat?.id !== threadId) return;
                            const requestId = ++dmFetchSeqRef.current;
                            return fetchDirectMessages(currentUser.id, peer).then((fetchedMessages) => {
                                if (cancelled || requestId !== dmFetchSeqRef.current) return;
                                if (useUIStore.getState().selectedChat?.id !== threadId) return;
                                const raw = Array.isArray(fetchedMessages) ? fetchedMessages : [];
                                updateDirectMessages((prev) => ({
                                    ...prev,
                                    [threadId]: mergeChatMessagesById(
                                        prev[threadId] || [],
                                        raw.map((m: any) => mapDirectMessageFromApi(m, threadId)) as any
                                    ) as DirectMessage[],
                                }));
                            });
                        })
                        .catch((error) => {
                            console.error('[selectedChat] Error resolving DM peer:', error);
                        });
                }
            }
        };

        void loadSelectedChat();

        return () => {
            cancelled = true;
        };
    }, [selectedChat?.id, selectedChat?.chatType, currentUser?.id, lowDataMode, updateMessages, updateUserVotes, updateGroups, updateDmThreads, updateDirectMessages]);

    // Tri-state, and the distinction matters: `undefined` means the mark-as-read round trip
    // has not answered yet, so the divider must not be drawn OR ruled out; `null` means there
    // was no prior marker (nothing unread); a string is the watermark to anchor on.
    // undefined = mark-as-read still pending; null = no prior marker / fully read.
    const unreadAnchorAt: string | null | undefined =
        selectedChat && chatUnreadAnchor?.chatId === selectedChat.id
            ? chatUnreadAnchor.at
            : selectedChat
              ? undefined
              : null;

    return { unreadAnchorAt };
}
