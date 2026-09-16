/**
 * Chat + group handler barrel for the web app: chat selection and message loading, group and
 * DM sending with optimistic reconciliation, message edit/remove, question submission and
 * voting, group CRUD and membership/admin management, and the notification list handlers.
 *
 * Exports: useGroupHandlers({ users }) — the handler bundle App.tsx spreads into the chat
 *  screens, plus `unreadAnchorAt` (where to draw the "new messages" divider) and
 *  `addNotification` (reused by the test/game handler barrels).
 * Touches: authStore, groupStore (groups, messages, dmThreads, directMessages, userVotes,
 *  notifications, dmHistoryClearedAtByThread), uiStore (selectedChat, modals, appMode);
 *  services/supabase for groups, messages, DMs, votes, invites, admin and notification
 *  endpoints; confirmStore and toastStore for user-facing prompts.
 * Gotchas:
 *  - Refresh merges use `mergeChatMessagesById(cached, serverList)`, which is incoming-wins
 *    and therefore SERVER-WINS only in that argument order; it keeps local-only (pending)
 *    rows. Swapping the arguments lets the cache clobber fresh server rows.
 *  - Optimistic sends are keyed by a clientMessageId minted through a DeliveryIntentRegistry,
 *    so a retry of the same text reuses the same id and the server can dedupe. On failure the
 *    error is classified: an UNCERTAIN delivery error keeps the intent (markUncertain) so a
 *    retry cannot double-post; any other error clears it.
 *  - Module-level `sendingGroupIds` / `sendingThreadIds` / `submittingQuestionGroupIds`
 *    (and `votingMessageIds`, now in hooks/groups/useVoteHandlers) are in-flight guards
 *    shared across every mount of this hook. The two SEND locks THROW `MessageSendBusyError` when held (exported here) — they must never
 *    return silently, because the composer clears its text before awaiting and restores it
 *    only from a rejection (E3 H16).
 *  - Fetches are sequence-guarded (`groupMessagesFetchSeqRef`, `dmFetchSeqRef`) and
 *    re-checked against the live selectedChat, so a slow response for a chat the user has
 *    left never writes into the chat now on screen.
 *  - Questions are messages: `type` is MessageType.QUESTION and the real kind lives in
 *    `questionType`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { User, Group, Message, MessageType, AppMode, DMThread, DirectMessage, AppNotification, GroupPermissions, ChatItem } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { initialUserStats } from '../utils/helpers';
import {
    formatActorLabel,
    mapMessagesFromApi,
    mapMessageFromApi,
    mergeChatMessagesById,
    isTempMessageId,
    createOptimisticClientMessageId,
    computeDmReceiptStatus,
    resolveThreadRootId,
    isUncertainDeliveryError,
    reconcileDeliveredItem,
} from '@lantern/shared/utils';
import { mapGroupMemberRow, mapGroupRow, mapGroupRows } from '@lantern/shared/groups';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createGroup, fetchGroups, fetchGroupMembers, addGroupMember, addGroupMembersBatch,
    uploadGroupAvatar, acceptGroupInvite, declineGroupInvite,
    sendMessage, fetchMessages, fetchUserVotesForGroup, createNotification,
    updateUserProfile, deleteGroup, updateGroup, promoteGroupAdmin, demoteGroupAdmin, fetchDirectMessages,
    sendDirectMessage, markGroupAsRead, markDMAsRead, fetchDmThreads,
    markNotificationAsRead, markAllNotificationsAsRead, deleteAllNotifications,
    deleteDmThread, archiveDmThread, unarchiveDmThread, fetchUserProfile, ensureAuthTokenReady,
    editGroupMessage, removeGroupMessage, editDirectMessage, removeDirectMessage,
    removeGroupMember,
    leaveGroup,
    type ChatMessageMutationPayload,
} from '../services/supabase';
import { confirmDialog } from '../stores/confirmStore';
import { planDeleteGroupConfirm, planRevokeInvitationConfirm } from '../utils/destructiveConfirm';
import { useToastStore } from '../stores/toastStore';
import { syncGamificationProgress } from '../services/gamificationStreak';
import { navigateForAppMode } from '../utils/appNavigation';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../utils/dmThreads';
import { mergeFetchedGroups } from '../utils/groupListMerge';
import { useVoteHandlers } from './groups/useVoteHandlers';
import { useBoardHandlers } from './groups/useBoardHandlers';

// The in-flight guards and delivery-intent registries now live in
// ./groups/deliveryIntents, because the question board and the message composer
// both post into `group:<id>` and must share ONE registry. `MessageSendBusyError`
// is re-exported from this module path: ChatWindow recognises it by identity.
export { MessageSendBusyError } from './groups/deliveryIntents';
// The API-row normalisers moved verbatim to ./groups/normalisers — every handler
// family needs them, so they are imported rather than re-declared.
import {
    mapApiGroupMembers,
    normalizeFetchedMessages,
    mapDirectMessageFromApi,
} from './groups/normalisers';
import { useDmHandlers } from './groups/useDmHandlers';
import { useMessageHandlers } from './groups/useMessageHandlers';
import { useGroupMutations } from './groups/useGroupMutations';
import {
    sendingGroupIds,
    sendingThreadIds,
    dmDeliveryIntents,
    MessageSendBusyError,
} from './groups/deliveryIntents';

interface UseGroupHandlersParams {
    users: User[];
}

export function useGroupHandlers({ users }: UseGroupHandlersParams) {
    const pendingCreatedGroupRef = useRef<any>(null);
    const groupMessagesFetchSeqRef = useRef(0);
    const dmFetchSeqRef = useRef(0);
    /** Prior last_read_at for the open chat (group or DM) — used to scroll to first unread. */
    const [chatUnreadAnchor, setChatUnreadAnchor] = useState<{
        chatId: string;
        at: string | null;
    } | null>(null);
    const markedReadChatIdRef = useRef<string | null>(null);
    const { currentUser, setCurrentUser } = useAuthStore();
    const {
        groups, updateGroups,
        messages, updateMessages,
        dmThreads, updateDmThreads,
        directMessages, updateDirectMessages,
        userVotes, updateUserVotes,
        notifications, updateNotifications, setNotifications
    } = useGroupStore();
    const {
        appMode, setAppMode, selectedChat, setSelectedChat,
        modals, openModal, closeModal,
        setSubgroupParentId, setDuplicateInfo,
        setActiveTestConfigMode,
        setChallengeOpponent,
        lowDataMode
    } = useUIStore();

    // ── Notifications ─────────────────────────────────────────────────────────
    // Creates an untyped notification for the current user and appends it locally so it shows
    // without waiting for the Realtime INSERT. Swallows failures — a notification that could
    // not be written must never fail the action that triggered it.
    const addNotification = useCallback(async (message: string) => {
        if (!currentUser) return;
        try {
            const newNotification = await createNotification({
                user_id: currentUser.id,
                message
            });
            updateNotifications(prev => [...prev, newNotification]);
        } catch (error) {
            console.error('Failed to create notification:', error);
        }
    }, [currentUser, updateNotifications]);

    /**
     * The one chat-selection path. `keepSurface` is for a channel opened from
     * INSIDE its community (founder rule: the community owns its chat): the
     * group is selected exactly as from the chats list — same votes/members
     * fetch, same read-marking through the selectedChat effect — but the app
     * stays where it is; the caller navigates to the community's channel URL.
     * Without it, selecting anything closes the community column and goes to
     * the chat screen, as it always has.
     *
     * Selecting a GROUP kicks off votes + roster fetches; mark-as-read is deliberately NOT
     * done here (the selectedChat effect below owns it, so deep links and list taps take one
     * path). Selecting a DM marks it read and loads history, sequence-guarded via
     * dmFetchSeqRef and re-checked against the live selectedChat before writing.
     */
    const handleSelectChat = useCallback((chat: ChatItem, options?: { keepSurface?: boolean }) => {
        setSelectedChat(chat);
        if (!options?.keepSurface) {
            useUIStore.getState().setActiveCommunity(null);
            if (chat.chatType === 'group') {
                navigateForAppMode(AppMode.CHAT, { groupId: chat.id });
            } else {
                navigateForAppMode(AppMode.CHAT, { threadId: chat.id });
            }
        }
        if (chat.chatType === 'group') {
            if (currentUser) {
                fetchUserVotesForGroup(chat.id, currentUser.id).then(fetchedVotes => {
                    updateUserVotes(prev => ({ ...prev, ...fetchedVotes }));
                }).catch(error => {
                    console.error('Error fetching user votes:', error);
                });
                
                // Mark-as-read (and unread anchor) runs in the selectedChat effect
                // so deep links and list taps share one path without racing.
            }
            
            fetchGroupMembers(chat.id, { bustCache: true }).then(fetchedMembers => {
                const mappedMembers = mapApiGroupMembers(fetchedMembers);
                
                setSelectedChat(prev => prev && prev.id === chat.id ? { ...prev, members: mappedMembers } : prev);
                updateGroups(prevGroups => prevGroups.map(g => 
                    g.id === chat.id ? { ...g, members: mappedMembers } : g
                ));
            }).catch(error => {
                console.error('Error fetching group members:', error);
            });
        } else if (chat.chatType === 'dm' && currentUser) {
            markDMAsRead(chat.id, currentUser.id).then(() => {
                updateDmThreads(prevThreads => prevThreads.map(t => 
                    t.id === chat.id ? { ...t, unreadCount: 0 } : t
                ));
            }).catch(error => {
                console.error('Error marking DM as read:', error);
            });
            
            const otherUserId = (chat as DMThread).participantIds.find(id => id !== currentUser.id);
            if (otherUserId) {
                const requestId = ++dmFetchSeqRef.current;
                const threadId = chat.id;
                fetchDirectMessages(currentUser.id, otherUserId).then(fetchedMessages => {
                    if (requestId !== dmFetchSeqRef.current) return;
                    if (useUIStore.getState().selectedChat?.id !== threadId) return;
                    const mappedMessages: DirectMessage[] = fetchedMessages.map((m: any) =>
                        mapDirectMessageFromApi(m, chat.id)
                    );
                    updateDirectMessages(prev => ({
                        ...prev,
                        [chat.id]: mergeChatMessagesById(
                            prev[chat.id] || [],
                            mappedMessages as any
                        ) as DirectMessage[],
                    }));
                }).catch(error => {
                    console.error('Error fetching DM messages:', error);
                });
            }
        }
    }, [currentUser, setSelectedChat, updateMessages, updateUserVotes, updateGroups, updateDmThreads, updateDirectMessages, lowDataMode]);

    /** Sync URL to chat list and clear the open conversation (mobile back). */
    const handleChatBack = useCallback(() => {
        navigateForAppMode(AppMode.CHAT, {}, { replace: true });
    }, []);

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

    // ── DM threads ────────────────────────────────────────────────────────────
    // Moved verbatim to hooks/groups/useDmHandlers — opening a conversation, the DM
    // send with its optimistic bubble and delivery intent, the local status patch,
    // delete/archive/unarchive, and DM history paging.
    const {
        handleInitiateDm,
        handleSendDm,
        handleDmThreadStatusChange,
        handleDeleteDmThread,
        handleArchiveDmThread,
        handleUnarchiveDmThread,
        handleLoadMoreDirectMessages,
    } = useDmHandlers({
        currentUser,
        users,
        groups,
        dmThreads,
        updateDmThreads,
        updateDirectMessages,
        setSelectedChat,
        lowDataMode,
        handleSelectChat,
    });

    // ── Message send / edit / remove / receipts ───────────────────────────────
    // Moved verbatim to hooks/groups/useMessageHandlers — the text send with its
    // optimistic bubble and delivery intent, server-first edit/remove, the peer
    // read-watermark projection, and group history paging. It is composed AFTER
    // useDmHandlers because a send into a DM selection is forwarded to handleSendDm.
    const {
        handleEditChatMessage,
        handleRemoveChatMessage,
        onPeerChatRead,
        onSendMessage,
        handleLoadMoreMessages,
    } = useMessageHandlers({
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
    });

    // ── Group CRUD, membership & admin ────────────────────────────────────────
    // Moved verbatim to hooks/groups/useGroupMutations — create/enter, settings and
    // avatar, invites, promote/demote, remove/leave, delete/archive and the
    // approve/reject pair for a group's join requests.
    const {
        handleCloseCreateGroupModal,
        handleCreateSubGroup,
        handleCreateGroup,
        handleEnterCreatedGroup,
        onOpenCreateSubGroupModal,
        handleUpdateGroupDetails,
        handleUpdateGroupAvatar,
        refreshGroupMembersInState,
        handleInviteMembers,
        handleAcceptGroupInvite,
        handleDeclineGroupInvite,
        handleRevokeInvitation,
        handleRevokePhoneInvitation,
        handlePromoteToAdmin,
        handleDemoteAdmin,
        handleRemoveGroupMember,
        handleLeaveGroup,
        getAllSubgroupIDs,
        handleDeleteGroup,
        handleToggleArchiveGroup,
        handleApproveMember,
        handleRejectMember,
    } = useGroupMutations({
        currentUser,
        setCurrentUser,
        users,
        groups,
        updateGroups,
        updateMessages,
        selectedChat,
        setSelectedChat,
        setAppMode,
        openModal,
        closeModal,
        setSubgroupParentId,
        handleSelectChat,
        addNotification,
    });


    // ── Questions ─────────────────────────────────────────────────────────────
    // Moved verbatim to hooks/groups/useBoardHandlers — handleQuestionSubmit posts a
    // question as a chat message, diverting to the duplicate modal on a stem match.
    const { handleQuestionSubmit } = useBoardHandlers({
        currentUser,
        setCurrentUser,
        messages,
        updateMessages,
        selectedChat,
        openModal,
        closeModal,
        setDuplicateInfo,
        addNotification,
    });


    // ── Voting / verification ─────────────────────────────────────────────────
    // Moved verbatim to hooks/groups/useVoteHandlers — onVoteQuestion (server-first
    // voting + author notification), handleUpvoteDuplicateAndClose and onFlagAsSimilar.
    const {
        onVoteQuestion,
        handleUpvoteDuplicateAndClose,
        onFlagAsSimilar,
    } = useVoteHandlers({
        currentUser,
        setCurrentUser,
        groups,
        messages,
        userVotes,
        updateMessages,
        updateUserVotes,
        selectedChat,
        closeModal,
        setDuplicateInfo,
        addNotification,
    });

    // ── Modal openers ─────────────────────────────────────────────────────────
    // Thin wrappers; the only non-trivial one is group info, which busts the roster cache on
    // open so the member sheet is never showing a stale list. The test/study/challenge
    // openers differ only in the mode they stamp before opening the shared config sheet.
    const onOpenQuestionModal = useCallback(() => openModal('question'), [openModal]);
    const onOpenGroupInfoModal = useCallback(() => {
        if (selectedChat?.chatType === 'group') {
            refreshGroupMembersInState(selectedChat.id).catch(error => {
                console.error('Failed to refresh group members:', error);
            });
        }
        openModal('groupInfo');
    }, [selectedChat, openModal, refreshGroupMembersInState]);
    
    const onOpenTestConfigModal = useCallback(() => {
        setActiveTestConfigMode('test');
        openModal('testConfig');
    }, [setActiveTestConfigMode, openModal]);

    const onOpenStudyConfigModal = useCallback(() => {
        setActiveTestConfigMode('study');
        openModal('testConfig');
    }, [setActiveTestConfigMode, openModal]);

    const handleChallengeUser = useCallback((opponent: User) => {
        setChallengeOpponent(opponent);
        setActiveTestConfigMode('game');
        openModal('testConfig');
    }, [setChallengeOpponent, setActiveTestConfigMode, openModal]);

    // ── Notification list ─────────────────────────────────────────────────────
    // Single-read is optimistic (the badge must drop instantly); mark-all and clear-all are
    // server-first so the list is only emptied once the server agrees. All three swallow
    // failures and log.
    const handleMarkNotificationAsRead = useCallback(async (notificationId: string) => {
        if (!currentUser) return;
        // Optimistically update UI immediately
        updateNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n));
        try {
            await markNotificationAsRead(notificationId, currentUser.id);
        } catch (error) { console.error('Failed to mark notification as read:', error); }
    }, [currentUser, updateNotifications]);

    const handleMarkAllNotificationsAsRead = useCallback(async () => {
        if (!currentUser) return;
        try {
            await markAllNotificationsAsRead(currentUser.id);
            updateNotifications(prev => prev.map(n => ({ ...n, read: true })));
        } catch (error) { console.error('Failed to mark all notifications as read:', error); }
    }, [currentUser, updateNotifications]);

    const handleClearAllNotifications = useCallback(async () => {
        if (!currentUser) return;
        try {
            await deleteAllNotifications(currentUser.id);
            setNotifications([]);
        } catch (error) { console.error('Failed to clear all notifications:', error); }
    }, [currentUser, setNotifications]);



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

    return {
        addNotification,
        handleLoadMoreMessages,
        handleLoadMoreDirectMessages,
        handleChatBack,
        unreadAnchorAt,
        handleSelectChat,
        handleInitiateDm,
        handleSendDm,
        handleDeleteDmThread,
        handleArchiveDmThread,
        handleUnarchiveDmThread,
        handleDmThreadStatusChange,
        handleCloseCreateGroupModal,
        handleCreateSubGroup,
        handleCreateGroup,
        handleEnterCreatedGroup,
        handleQuestionSubmit,
        onSendMessage,
        handleEditChatMessage,
        handleRemoveChatMessage,
        onPeerChatRead,
        onVoteQuestion,
        handleUpvoteDuplicateAndClose,
        onFlagAsSimilar,
        onOpenCreateSubGroupModal,
        handleUpdateGroupDetails,
        handleUpdateGroupAvatar,
        handleInviteMembers,
        handleAcceptGroupInvite,
        handleDeclineGroupInvite,
        handleRevokeInvitation,
        handleRevokePhoneInvitation,
        handlePromoteToAdmin,
        handleDemoteAdmin,
        handleRemoveGroupMember,
        handleLeaveGroup,
        getAllSubgroupIDs,
        handleDeleteGroup,
        handleToggleArchiveGroup,
        handleApproveMember,
        handleRejectMember,
        onOpenQuestionModal,
        onOpenGroupInfoModal,
        onOpenTestConfigModal,
        onOpenStudyConfigModal,
        handleChallengeUser,
        handleMarkNotificationAsRead,
        handleMarkAllNotificationsAsRead,
        handleClearAllNotifications,
    };
}
