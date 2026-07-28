import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { User, Group, Message, MessageType, QuestionType, QuestionOption, AppMode, DMThread, DirectMessage, AppNotification, GroupPermissions, QuestionStatus, ChatItem, MatchingItem, DiagramLabel } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';
import { initialUserStats } from '../utils/helpers';
import {
    resolveQuestionStatusAfterVote,
    formatActorLabel,
    mapMessagesFromApi,
    mapMessageFromApi,
    computeDmReceiptStatus,
    resolveThreadRootId,
    DeliveryIntentRegistry,
    isUncertainDeliveryError,
    reconcileDeliveredItem,
} from '@lantern/shared/utils';
import { BADGE_DEFINITIONS } from '../gamification';
import {
    createGroup, fetchGroups, fetchGroupMembers, addGroupMember, addGroupMembersBatch,
    uploadGroupAvatar, acceptGroupInvite, declineGroupInvite,
    sendMessage, fetchMessages, fetchUserVotesForGroup, voteQuestion,
    removeVote, updateMessage, updateQuestionStatus, createNotification,
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
import { useToastStore } from '../stores/toastStore';
import { syncGamificationProgress } from '../services/gamificationStreak';
import { navigateForAppMode } from '../utils/appNavigation';
import { mapDmThreadFromApi, mergeDmThreadLists } from '../utils/dmThreads';

const sendingGroupIds = new Set<string>();
const sendingThreadIds = new Set<string>();
const submittingQuestionGroupIds = new Set<string>();
const votingMessageIds = new Set<string>();
const groupDeliveryIntents = new DeliveryIntentRegistry();
const dmDeliveryIntents = new DeliveryIntentRegistry();

interface UseGroupHandlersParams {
    users: User[];
}

function mapApiGroupMembers(fetchedMembers: any[]): User[] {
    return (fetchedMembers || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        username: m.username,
        email: m.email,
        avatarUrl: m.avatar_url || m.avatarUrl,
        points: m.points || 0,
        badges: m.badges || [],
        stats: m.stats || {},
    }));
}

function normalizeFetchedMessages(raw: unknown): Message[] {
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

function mapDirectMessageFromApi(raw: any, threadId: string): DirectMessage {
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
    };
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
        groups, setGroups, updateGroups,
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

    const handleSelectChat = useCallback((chat: ChatItem) => {
        setSelectedChat(chat);
        if (chat.chatType === 'group') {
            navigateForAppMode(AppMode.CHAT, { groupId: chat.id });
        } else {
            navigateForAppMode(AppMode.CHAT, { threadId: chat.id });
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
                    updateDirectMessages(prev => ({ ...prev, [chat.id]: mappedMessages }));
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
    useEffect(() => {
        if (!selectedChat || !currentUser) return;

        let cancelled = false;

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
                    updateMessages((prev) => ({ ...prev, [chatId]: list }));
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

                const otherUserId = Array.isArray((selectedChat as DMThread).participantIds)
                    ? (selectedChat as DMThread).participantIds.find((id) => id !== currentUser.id)
                    : undefined;
                if (otherUserId) {
                    const requestId = ++dmFetchSeqRef.current;
                    fetchDirectMessages(currentUser.id, otherUserId)
                        .then((fetchedMessages) => {
                            if (requestId !== dmFetchSeqRef.current) return;
                            if (useUIStore.getState().selectedChat?.id !== threadId) return;
                            const raw = Array.isArray(fetchedMessages) ? fetchedMessages : [];
                            const mappedMessages: DirectMessage[] = raw.map((m: any) =>
                                mapDirectMessageFromApi(m, threadId)
                            );
                            updateDirectMessages((prev) => ({ ...prev, [threadId]: mappedMessages }));
                        })
                        .catch((error) => {
                            console.error('[selectedChat] Error fetching DM messages:', error);
                        });
                }
            }
        };

        void loadSelectedChat();

        return () => {
            cancelled = true;
        };
    }, [selectedChat?.id, selectedChat?.chatType, currentUser?.id, lowDataMode, updateMessages, updateUserVotes, updateGroups, updateDmThreads, updateDirectMessages]);

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
                }
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
                updateDmThreads((prev) => mergeDmThreadLists(prev, mapped));
            }
        } catch (err) {
            console.warn('[DM] Failed to refresh threads after initiate:', err);
        }
    }, [currentUser, dmThreads, users, groups, updateDmThreads, handleSelectChat]);

    const handleSendDm = useCallback(async (
        threadId: string,
        text: string,
        options?: { replyToMessageId?: string }
    ) => {
        if (!currentUser) return;
        if (sendingThreadIds.has(threadId)) return;
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
            uuidv4
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
        updateDmThreads(prevThreads => prevThreads.map(t => 
            t.id === threadId ? { ...t, lastMessage: text, lastMessageTimestamp: new Date() } : t
        ));
        
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
            void fetchDmThreads(currentUser.id)
                .then((fetchedThreads) => {
                    if (!Array.isArray(fetchedThreads)) return;
                    const mapped = fetchedThreads.map((t: any) => mapDmThreadFromApi(t));
                    updateDmThreads((prev) => mergeDmThreadLists(prev, mapped));
                    const refreshed = mapped.find((t) => t.id === threadId);
                    if (refreshed && useUIStore.getState().selectedChat?.id === threadId) {
                        handleSelectChat({ ...refreshed, chatType: 'dm' });
                    }
                })
                .catch((err) => {
                    console.warn('[DM] Failed to refresh threads after send:', err);
                });
        } catch (error) {
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
            const message = error instanceof Error ? error.message : 'Failed to send direct message';
            alert(message);
        } finally {
            sendingThreadIds.delete(threadId);
        }
    }, [currentUser, dmThreads, updateDirectMessages, updateDmThreads, handleSelectChat]);

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

    const handleDeleteDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { removeDmThread } = useGroupStore.getState();
        
        // Optimistically remove from UI
        removeDmThread(threadId);
        
        try {
            const success = await deleteDmThread(threadId, currentUser.id);
            if (!success) {
                console.error('Failed to delete DM thread on server');
                // Could re-fetch threads here, but deletion is destructive anyway
            }
        } catch (error) {
            console.error('Failed to delete DM thread:', error);
        }
    }, [currentUser]);

    const handleArchiveDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { archiveDmThread: archiveInStore } = useGroupStore.getState();
        archiveInStore(threadId);
        try {
            const success = await archiveDmThread(threadId, currentUser.id);
            if (!success) console.error('Failed to archive DM thread on server');
        } catch (error) {
            console.error('Failed to archive DM thread:', error);
        }
    }, [currentUser]);

    const handleUnarchiveDmThread = useCallback(async (threadId: string) => {
        if (!currentUser) return;
        const { unarchiveDmThread: unarchiveInStore } = useGroupStore.getState();
        unarchiveInStore(threadId);
        try {
            const success = await unarchiveDmThread(threadId, currentUser.id);
            if (!success) console.error('Failed to unarchive DM thread on server');
        } catch (error) {
            console.error('Failed to unarchive DM thread:', error);
        }
    }, [currentUser]);

    const handleCloseCreateGroupModal = useCallback(() => {
        closeModal('createGroup');
        setSubgroupParentId(undefined);
    }, [closeModal, setSubgroupParentId]);

    const handleCreateSubGroup = useCallback(async (name: string, description: string, memberEmailsStr: string, parentId?: string) => {
        if (!currentUser) return;
      
        try {
            const groupData = {
                name,
                description,
                avatar_url: undefined,
                permissions: {},
                invite_id: uuidv4().substring(0, 8),
                parent_id: parentId
            };
            
            const newGroup = await createGroup(groupData, currentUser.id, []);
            
            const mappedGroup: Group = {
                id: newGroup.id,
                name: newGroup.name,
                description: newGroup.description,
                avatarUrl: newGroup.avatarUrl,
                members: [currentUser],
                adminIds: newGroup.adminIds || [currentUser.id],
                parentId: newGroup.parentId,
                memberEmails: [currentUser.email!, ...memberEmailsStr.split(',').map(e => e.trim()).filter(Boolean)],
                inviteId: newGroup.inviteId,
                unreadCount: 0,
                pendingMembers: [],
                isArchived: newGroup.isArchived,
            };
            
            updateGroups(prev => [...prev, mappedGroup]);
            handleSelectChat({ ...mappedGroup, chatType: 'group' });
            updateMessages(prev => ({...prev, [mappedGroup.id]: []}));
            handleCloseCreateGroupModal();
        } catch (error) {
            console.error('Failed to create subgroup:', error);
            alert('Failed to create subgroup. Please try again.');
        }
    }, [currentUser, updateGroups, handleSelectChat, updateMessages, handleCloseCreateGroupModal]);

    const handleCreateGroup = useCallback(async (details: { name: string; description: string; avatarFile: File | null; memberIds: string[]; permissions: GroupPermissions; }) => {
        if (!currentUser) return;

        try {
            const groupData = {
                name: details.name,
                description: details.description,
                avatar_url: undefined as string | undefined,
                permissions: details.permissions,
                invite_id: uuidv4().substring(0, 8),
                parent_id: undefined
            };
            const newGroup = await createGroup(groupData, currentUser.id, details.memberIds);

            if (details.avatarFile) {
                try {
                    const { compressImage } = await import('../utils/imageCompression');
                    const base64Avatar = await compressImage(details.avatarFile, {
                        maxWidth: 150,
                        maxHeight: 150,
                        quality: 0.7,
                        outputType: 'base64',
                    }) as string;
                    await uploadGroupAvatar(
                        newGroup.id,
                        'avatar.webp',
                        base64Avatar.includes(',') ? base64Avatar.split(',')[1]! : base64Avatar,
                        'image/webp'
                    );
                } catch (avatarError) {
                    console.warn('Group created but avatar upload failed:', avatarError);
                }
            }
            
            // Fetch groups and members for the new group in parallel
            const [fetchedGroups, fetchedMembers] = await Promise.all([
                fetchGroups(currentUser.id),
                fetchGroupMembers(newGroup.id, { bustCache: details.memberIds.length > 0 }),
            ]);

            const mappedMembers = mapApiGroupMembers(fetchedMembers);

            updateGroups((prev) => {
                const prevById = new Map(prev.map((g) => [g.id, g]));
                return fetchedGroups.map((g: any) => {
                    const existing = prevById.get(g.id);
                    return {
                        id: g.id,
                        name: g.name,
                        avatarUrl: g.avatar_url || g.avatarUrl,
                        description: g.description,
                        lastMessage: g.last_message || g.lastMessage,
                        lastMessageTime: g.last_message_time || g.lastMessageTime,
                        adminIds: g.admin_ids || g.adminIds || [],
                        permissions: g.permissions || {},
                        parentId: g.parent_id || g.parentId,
                        isArchived: g.is_archived ?? g.isArchived ?? false,
                        inviteId: g.invite_id || g.inviteId,
                        unreadCount: existing?.unreadCount || 0,
                        pendingMembers: existing?.pendingMembers || [],
                        invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
                        members: g.id === newGroup.id
                            ? mappedMembers
                            : (existing?.members?.length ? existing.members : []),
                    };
                });
            });
            
            const mappedNewGroup = {
                id: newGroup.id,
                name: newGroup.name,
                avatarUrl: newGroup.avatar_url || newGroup.avatarUrl,
                description: newGroup.description,
                lastMessage: newGroup.last_message || newGroup.lastMessage,
                lastMessageTime: newGroup.last_message_time || newGroup.lastMessageTime,
                adminIds: newGroup.admin_ids || newGroup.adminIds || [currentUser.id],
                permissions: newGroup.permissions,
                parentId: newGroup.parent_id || newGroup.parentId,
                isArchived: newGroup.is_archived || newGroup.isArchived || false,
                inviteId: newGroup.invite_id || newGroup.inviteId,
                unreadCount: 0,
                pendingMembers: [],
                invitedPhoneNumbers: [],
                members: mappedMembers,
                chatType: 'group' as const
            };

            // Defer navigation so CreateGroupScreen can show invite link success step
            updateMessages(prev => ({ ...prev, [newGroup.id]: [] }));
            pendingCreatedGroupRef.current = mappedNewGroup;

            if (currentUser) {
                const updatedStats = {
                    ...currentUser.stats,
                    groupsCreated: (currentUser.stats.groupsCreated || 0) + 1,
                };

                void syncGamificationProgress()
                    .then((synced) => {
                        setCurrentUser({
                            ...currentUser,
                            points: synced.points,
                            badges: synced.badges,
                            stats: synced.stats,
                        });
                        (synced.awardedBadges || []).forEach(badge => {
                            const badgeDef = BADGE_DEFINITIONS[badge.id];
                            const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                            addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                        });
                    })
                    .catch(error => console.error('Failed to sync gamification after group create:', error));
            }

            return {
                id: mappedNewGroup.id,
                name: mappedNewGroup.name,
                inviteId: mappedNewGroup.inviteId || groupData.invite_id,
            };
        } catch (error) {
            console.error('Error creating group:', error);
            alert('Failed to create group. Please try again.');
            throw error;
        }
    }, [currentUser, setCurrentUser, updateGroups, updateMessages, addNotification]);

    const handleEnterCreatedGroup = useCallback((summary: { id: string; name: string; inviteId: string }) => {
        const pending = pendingCreatedGroupRef.current;
        const group =
            pending && pending.id === summary.id
                ? pending
                : {
                      id: summary.id,
                      name: summary.name,
                      inviteId: summary.inviteId,
                      members: currentUser ? [currentUser] : [],
                      adminIds: currentUser ? [currentUser.id] : [],
                      unreadCount: 0,
                      pendingMembers: [],
                      invitedPhoneNumbers: [],
                      chatType: 'group' as const,
                  };
        pendingCreatedGroupRef.current = null;
        handleSelectChat(group);
        setAppMode(AppMode.CHAT);
    }, [currentUser, handleSelectChat, setAppMode]);

    const handleQuestionSubmit = useCallback(async (
        stem: string, 
        explanation: string, 
        questionType: QuestionType, 
        options?: QuestionOption[], 
        correctAnswerIds?: string[], 
        imageUrl?: string,
        tags?: string[],
        acceptableAnswers?: string[], 
        matchingPromptItems?: MatchingItem[],
        matchingAnswerItems?: MatchingItem[],
        correctMatches?: { promptItemId: string; answerItemId: string }[],
        diagramLabels?: DiagramLabel[]
    ) => {
        if (!currentUser || !selectedChat || selectedChat.chatType !== 'group') return;
        const groupId = selectedChat.id;
        if (submittingQuestionGroupIds.has(groupId)) return;
        submittingQuestionGroupIds.add(groupId);
        let deliveryFingerprint: string | undefined;
        let clientMessageId: string | undefined;
        try {
            const existingMessages = messages[groupId] || [];
            const trimmedStem = stem.trim().toLowerCase();
            const existingQuestion = existingMessages.find(
                msg => msg.type === MessageType.QUESTION && msg.questionStem?.trim().toLowerCase() === trimmedStem
            );

            const newQuestionData = {
                groupId,
                type: MessageType.QUESTION,
                questionStem: stem,
                explanation,
                questionType,
                options,
                correctAnswerIds,
                imageUrl,
                tags,
                questionStatus: QuestionStatus.PENDING,
                acceptableAnswers,
                matchingPromptItems,
                matchingAnswerItems,
                correctMatches,
                diagramLabels,
            };

            if (existingQuestion) {
                setDuplicateInfo({ newQuestionData, existingQuestion });
                openModal('duplicateQuestion');
                closeModal('question');
                return;
            }

            const content = JSON.stringify({
                type: MessageType.QUESTION,
                ...newQuestionData
            });
            deliveryFingerprint = JSON.stringify({
                ...newQuestionData,
                imageUrl: imageUrl ? 'attached' : undefined,
            });
            clientMessageId = groupDeliveryIntents.resolve(
                `group:${groupId}`,
                deliveryFingerprint,
                uuidv4
            );
            const sent = await sendMessage(groupId, currentUser.id, content, clientMessageId);
            if (!sent) {
                throw new Error('Failed to send message');
            }
            const savedQuestion: Message = {
                id: sent.id,
                sender: currentUser,
                timestamp: new Date(sent.timestamp || new Date()),
                upvotes: 0,
                downvotes: 0,
                ...newQuestionData,
            };
            updateMessages(prev => ({
                ...prev,
                [groupId]: reconcileDeliveredItem(prev[groupId] || [], savedQuestion)
            }));
            groupDeliveryIntents.clear(`group:${groupId}`, deliveryFingerprint, clientMessageId);
            
            if (currentUser) {
                const updatedStats = {
                    ...currentUser.stats,
                    questionsCreated: (currentUser.stats.questionsCreated || 0) + 1,
                };

                void syncGamificationProgress()
                    .then((synced) => {
                        setCurrentUser({
                            ...currentUser,
                            points: synced.points,
                            badges: synced.badges,
                            stats: synced.stats,
                        });
                        (synced.awardedBadges || []).forEach(badge => {
                            const badgeDef = BADGE_DEFINITIONS[badge.id];
                            const levelInfo = badgeDef?.levels.find(l => l.level === badge.level);
                            addNotification(`Badge Unlocked: ${badge.name}! You've earned ${levelInfo?.points || 0} points.`);
                        });
                    })
                    .catch(error => console.error('Failed to sync gamification after question submit:', error));
            }
            
            closeModal('question');
        } catch (error) {
            console.error('Error submitting question:', error);
            if (deliveryFingerprint && clientMessageId) {
                if (isUncertainDeliveryError(error)) {
                    groupDeliveryIntents.markUncertain(
                        `group:${groupId}`,
                        deliveryFingerprint,
                        clientMessageId
                    );
                } else {
                    groupDeliveryIntents.clear(
                        `group:${groupId}`,
                        deliveryFingerprint,
                        clientMessageId
                    );
                }
            }
            alert('Failed to submit question. Please try again.');
        } finally {
            submittingQuestionGroupIds.delete(groupId);
        }
    }, [currentUser, selectedChat, messages, updateMessages, setCurrentUser, openModal, closeModal, setDuplicateInfo, addNotification]);

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

    const onSendMessage = useCallback(async (
        text: string,
        options?: { replyToMessageId?: string; mentionedUserIds?: string[] }
    ) => {
        if (!currentUser || !selectedChat) return;

        if (selectedChat.chatType === 'group') {
            if (sendingGroupIds.has(selectedChat.id)) return;
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
            const optimisticId = groupDeliveryIntents.resolve(
                deliveryScope,
                deliveryFingerprint,
                uuidv4
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
                void addNotification('Message failed to send. Please try again.');
            } finally {
                sendingGroupIds.delete(selectedChat.id);
            }
        } else if (selectedChat.chatType === 'dm') {
            await handleSendDm(selectedChat.id, text, {
                replyToMessageId: options?.replyToMessageId,
            });
        }
    }, [currentUser, selectedChat, groups, updateMessages, updateGroups, handleSendDm, addNotification]);

    const onVoteQuestion = useCallback(async (messageId: string, voteType: 'up' | 'down') => {
        if (!selectedChat || selectedChat.chatType !== 'group' || !currentUser) return;
        if (votingMessageIds.has(messageId)) return;
        votingMessageIds.add(messageId);

        const groupMessages = messages[selectedChat.id] || [];
        const messageIndex = groupMessages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) {
            votingMessageIds.delete(messageId);
            return;
        }

        const message = groupMessages[messageIndex];
        const currentUserVote = userVotes[messageId];
        
        let newUpvotes = message.upvotes;
        let newDownvotes = message.downvotes;
        let newUserVote: 'up' | 'down' | undefined = undefined;

        let serverQuestionStatus: string | undefined;
        try {
            if (currentUserVote === voteType) {
                const removeResult = await removeVote(messageId, currentUser.id);
                if (removeResult?.upvotes !== undefined) {
                    newUpvotes = removeResult.upvotes;
                    newDownvotes = removeResult.downvotes;
                } else {
                    if (voteType === 'up') newUpvotes--;
                    else newDownvotes--;
                }
                serverQuestionStatus = removeResult?.questionStatus;
                newUserVote = undefined;
            } else {
                const voteResult = await voteQuestion(messageId, currentUser.id, voteType);
                if (voteResult?.upvotes !== undefined) {
                    newUpvotes = voteResult.upvotes;
                    newDownvotes = voteResult.downvotes;
                } else {
                    if (currentUserVote === 'up') newUpvotes--;
                    if (currentUserVote === 'down') newDownvotes--;
                    if (voteType === 'up') newUpvotes++;
                    else newDownvotes++;
                }
                serverQuestionStatus = voteResult?.questionStatus;
                newUserVote = voteType;
            }
        } catch (error) {
            console.error('Error voting:', error);
            alert('Failed to vote. Please try again.');
            return;
        } finally {
            votingMessageIds.delete(messageId);
        }

        const updatedMessage = { ...message, upvotes: newUpvotes, downvotes: newDownvotes };
        
        if (updatedMessage.type === MessageType.QUESTION) {
            const group = groups.find(g => g.id === selectedChat.id);
            const memberCount = group?.members?.length ?? 0;
            // Prefer server-persisted status (any member's vote can verify); fall back to local resolve.
            const resolvedStatus =
                (serverQuestionStatus as QuestionStatus | undefined) ||
                resolveQuestionStatusAfterVote({
                    upvotes: newUpvotes,
                    downvotes: newDownvotes,
                    memberCount,
                });
            if (resolvedStatus !== updatedMessage.questionStatus) {
                updatedMessage.questionStatus = resolvedStatus;
                // Server already persists status on vote. Keep author/admin PUT as a best-effort
                // fallback for older API builds only when the response omitted questionStatus.
                if (!serverQuestionStatus) {
                    try {
                        await updateQuestionStatus(messageId, resolvedStatus);
                    } catch (error) {
                        console.error('Failed to update question status:', error);
                    }
                }

                if (resolvedStatus === QuestionStatus.VERIFIED) {
                    if (updatedMessage.sender.id === currentUser.id) {
                        addNotification(`Your question "${updatedMessage.questionStem?.substring(0, 20)}..." has been verified and is now available in tests!`);
                    } else {
                        try {
                            await createNotification({
                                user_id: updatedMessage.sender.id,
                                message: `Your question "${updatedMessage.questionStem?.substring(0, 20)}..." has been verified and is now available in tests!`,
                                link: `/chat/${selectedChat.id}`
                            });
                        } catch (error) {
                            console.error('Failed to create question verification notification:', error);
                        }
                    }
                } else if (resolvedStatus === QuestionStatus.REJECTED) {
                    if (updatedMessage.sender.id === currentUser.id) {
                        addNotification(`Your question "${updatedMessage.questionStem?.substring(0, 20)}..." was rejected by group votes and is not available in tests.`);
                    }
                }
            }
        }
        
        const updatedMessages = [...groupMessages];
        updatedMessages[messageIndex] = updatedMessage;

        updateMessages(prev => ({ ...prev, [selectedChat.id]: updatedMessages }));
        updateUserVotes(prev => ({ ...prev, [messageId]: newUserVote }));
    }, [selectedChat, currentUser, messages, userVotes, groups, updateMessages, updateUserVotes, addNotification]);

    const handleUpvoteDuplicateAndClose = useCallback((existingQuestionId: string) => {
        if (!selectedChat || selectedChat.chatType !== 'group') return;
        
        if (userVotes[existingQuestionId] !== 'up') {
            onVoteQuestion(existingQuestionId, 'up');
        }
        
        if (currentUser) {
            void syncGamificationProgress()
                .then((synced) => {
                    setCurrentUser({
                        ...currentUser,
                        points: synced.points,
                        badges: synced.badges,
                        stats: synced.stats,
                    });
                })
                .catch(error => console.error('Failed to sync duplicate upvote points:', error));
        }
        
        addNotification("Thanks for helping keep things tidy! You've earned 5 points.");
    
        closeModal('duplicateQuestion');
        setDuplicateInfo(null);
    }, [selectedChat, currentUser, userVotes, setCurrentUser, onVoteQuestion, addNotification, closeModal, setDuplicateInfo]);

    const onFlagAsSimilar = useCallback(async (messageId: string, groupId: string) => {
        if (!currentUser) return;

        const group = groups.find(g => g.id === groupId);
        if (!group) return;
        
        const groupMessages = messages[groupId] || [];
        const messageIndex = groupMessages.findIndex(m => m.id === messageId);
        if (messageIndex === -1) return;

        const message = groupMessages[messageIndex];
        const currentFlags = message.flaggedAsSimilarUserIds || [];
        const userHasFlagged = currentFlags.includes(currentUser.id);

        const newFlags = userHasFlagged
            ? currentFlags.filter(id => id !== currentUser.id)
            : [...currentFlags, currentUser.id];
            
        try {
            await updateMessage(messageId, { flagged_as_similar_user_ids: newFlags });
        } catch (error) {
            console.error('Error flagging message:', error);
            alert('Failed to flag message. Please try again.');
            return;
        }

        const updatedMessage = { ...message, flaggedAsSimilarUserIds: newFlags };
        
        const archiveThreshold = Math.ceil((group.members?.length ?? 0) * 0.05);
        if (newFlags.length >= archiveThreshold && !updatedMessage.isArchived) {
            updatedMessage.isArchived = true;
        }

        const updatedMessages = [...groupMessages];
        updatedMessages[messageIndex] = updatedMessage;
        
        updateMessages(prev => ({ ...prev, [groupId]: updatedMessages }));
    }, [currentUser, groups, messages, updateMessages]);

    const onOpenCreateSubGroupModal = useCallback((parentId: string) => {
        setSubgroupParentId(parentId);
        openModal('createGroup');
    }, [setSubgroupParentId, openModal]);

    const handleUpdateGroupDetails = useCallback((groupId: string, name: string, description: string) => {
        updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, name, description } : g));
        if (selectedChat?.id === groupId) {
            setSelectedChat(prev => {
                if (prev?.chatType === 'group') {
                    return { ...prev, name, description };
                }
                return prev;
            });
        }
        alert("Group details updated successfully.");
    }, [selectedChat, updateGroups, setSelectedChat]);

    const handleUpdateGroupAvatar = useCallback(async (groupId: string, avatarDataUrl: string) => {
        try {
            const base64Data = avatarDataUrl.includes(',')
                ? avatarDataUrl.split(',')[1]!
                : avatarDataUrl;
            const mimeMatch = avatarDataUrl.match(/^data:([^;]+);/);
            const contentType = mimeMatch?.[1] || 'image/webp';
            const uploaded = await uploadGroupAvatar(
                groupId,
                contentType === 'image/png' ? 'avatar.png' : 'avatar.webp',
                base64Data,
                contentType
            );
            const avatarUrl = uploaded.avatarUrl;
            updateGroups(prevGroups =>
                prevGroups.map(group =>
                    group.id === groupId ? { ...group, avatarUrl } : group
                )
            );
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return { ...prev, avatarUrl };
                    }
                    return prev;
                });
            }
        } catch (error) {
            console.error('Failed to upload group avatar:', error);
            throw error;
        }
    }, [selectedChat, updateGroups, setSelectedChat]);

    const applyGroupMembersToState = useCallback((groupId: string, mappedMembers: User[]) => {
        updateGroups(prevGroups => prevGroups.map(g =>
            g.id === groupId ? { ...g, members: mappedMembers } : g
        ));
        setSelectedChat(prevSelected => {
            if (prevSelected && prevSelected.id === groupId && prevSelected.chatType === 'group') {
                return { ...prevSelected, members: mappedMembers };
            }
            return prevSelected;
        });
    }, [updateGroups, setSelectedChat]);

    const refreshGroupMembersInState = useCallback(async (groupId: string) => {
        const fetchedMembers = await fetchGroupMembers(groupId, { bustCache: true });
        const mappedMembers = mapApiGroupMembers(fetchedMembers);
        applyGroupMembersToState(groupId, mappedMembers);
        return mappedMembers;
    }, [applyGroupMembersToState]);

    const handleInviteMembers = useCallback(async (groupId: string, userIdsToAdd: string[]) => {
        if (userIdsToAdd.length === 0) {
            closeModal('addMembers');
            return;
        }

        try {
            const result = await addGroupMembersBatch(groupId, userIdsToAdd);
            const invited = result?.invited?.length ? result.invited : (result?.added || []);
            const alreadyPending = result?.alreadyPending || [];

            if (!invited.length && !alreadyPending.length) {
                throw new Error(
                    result?.failed?.length
                        ? 'Failed to send invites. Please try again.'
                        : 'No new invites were sent (they may already be in the group).'
                );
            }

            // Invites are pending until accepted — refresh active members only (do not force-add).
            const mappedMembers = mapApiGroupMembers(
                await fetchGroupMembers(groupId, { bustCache: true })
            );
            applyGroupMembersToState(groupId, mappedMembers);
        } catch (error) {
            console.error('Error inviting members to group:', error);
            throw error;
        }
    }, [applyGroupMembersToState, closeModal]);

    const handleAcceptGroupInvite = useCallback(async (groupId: string) => {
        if (!currentUser) throw new Error('Not signed in');
        const group = await acceptGroupInvite(groupId);
        const [fetchedGroups, fetchedMembers] = await Promise.all([
            fetchGroups(currentUser.id),
            fetchGroupMembers(groupId, { bustCache: true }),
        ]);
        const mappedMembers = mapApiGroupMembers(fetchedMembers);
        setGroups(fetchedGroups.map((g: any) => ({
            id: g.id,
            name: g.name,
            avatarUrl: g.avatar_url || g.avatarUrl,
            description: g.description,
            lastMessage: g.last_message || g.lastMessage,
            lastMessageTime: g.last_message_time || g.lastMessageTime,
            adminIds: g.admin_ids || g.adminIds || [],
            permissions: g.permissions || {},
            parentId: g.parent_id || g.parentId,
            isArchived: g.is_archived ?? g.isArchived ?? false,
            inviteId: g.invite_id || g.inviteId,
            unreadCount: 0,
            pendingMembers: [],
            invitedPhoneNumbers: [],
            members: g.id === groupId ? mappedMembers : (groups.find((x) => x.id === g.id)?.members || []),
        })));
        return group;
    }, [currentUser, groups, setGroups]);

    const handleDeclineGroupInvite = useCallback(async (groupId: string) => {
        await declineGroupInvite(groupId);
    }, []);

    const handleRevokeInvitation = useCallback((groupId: string, email: string) => {
        if (window.confirm(`Are you sure you want to revoke the invitation for ${email}?`)) {
            updateGroups(prev => prev.map(g => {
                if (g.id === groupId) {
                    return { ...g, memberEmails: (g.memberEmails || []).filter(e => e !== email) };
                }
                return g;
            }));
        }
    }, [updateGroups]);

    const handleRevokePhoneInvitation = useCallback((groupId: string, phoneNumber: string) => {
        if (window.confirm(`Are you sure you want to revoke the invitation for ${phoneNumber}?`)) {
            updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, invitedPhoneNumbers: (g.invitedPhoneNumbers || []).filter(p => p !== phoneNumber) } : g));
        }
    }, [updateGroups]);

    const handlePromoteToAdmin = useCallback(async (groupId: string, userId: string) => {
        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);

        try {
            const updatedGroup = await promoteGroupAdmin(groupId, userId);
            if (updatedGroup?.adminIds) {
                updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, adminIds: updatedGroup.adminIds } : g));
                if (selectedChat?.id === groupId && selectedChat?.chatType === 'group') {
                    setSelectedChat(prev => prev?.chatType === 'group' ? { ...prev, adminIds: updatedGroup.adminIds } : prev);
                }
            }
        } catch (error) {
            console.error('Failed to promote admin:', error);
            alert('Failed to promote member to admin.');
            return;
        }

        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `You've been promoted to admin in "${group.name}" by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create promotion notification:', error));
            } catch (error) {
                console.error('Failed to create promotion notification:', error);
            }
        }
    }, [groups, users, currentUser, selectedChat, updateGroups, setSelectedChat]);

    const handleDemoteAdmin = useCallback(async (groupId: string, userId: string) => {
        const groupToUpdate = groups.find(g => g.id === groupId);
        if (!groupToUpdate) return;
    
        if (groupToUpdate.adminIds.length <= 1 && groupToUpdate.adminIds.includes(userId)) {
            alert("Cannot demote the only admin of the group.");
            return;
        }

        try {
            const updatedGroup = await demoteGroupAdmin(groupId, userId);
            const newAdminIds = updatedGroup?.adminIds || groupToUpdate.adminIds.filter(id => id !== userId);
            updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, adminIds: newAdminIds } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => prev?.chatType === 'group' ? { ...prev, adminIds: newAdminIds } : prev);
            }

            const user = users.find(u => u.id === userId);
            if (groupToUpdate && user && currentUser && userId !== currentUser.id) {
                createNotification({
                    user_id: userId,
                    message: `You've been demoted from admin in "${groupToUpdate.name}" by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create demotion notification:', error));
            }
        } catch (error) {
            console.error('Failed to demote admin:', error);
            alert('Failed to demote admin.');
        }
    }, [groups, users, currentUser, selectedChat, updateGroups, setSelectedChat]);

    const handleRemoveGroupMember = useCallback(async (groupId: string, userId: string) => {
        if (!currentUser || userId === currentUser.id) return;
        const group = groups.find((g) => g.id === groupId) ||
          (selectedChat?.chatType === 'group' && selectedChat.id === groupId ? selectedChat : null);
        if (!group) return;

        const member =
          (group.members || []).find((m) => m.id === userId) ||
          users.find((u) => u.id === userId);
        const memberName = member?.name || 'this member';

        if (
          Array.isArray(group.adminIds) &&
          group.adminIds.includes(userId) &&
          group.adminIds.length <= 1
        ) {
          useToastStore.getState().showToast('Cannot remove the only admin of the group.', 'error');
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Remove member',
          message: `Remove ${memberName} from "${group.name}"?`,
          confirmLabel: 'Remove',
          danger: true,
        });
        if (!confirmed) return;

        try {
          await removeGroupMember(groupId, userId);
          const nextMembers = (group.members || []).filter((m) => m.id !== userId);
          const nextAdminIds = (group.adminIds || []).filter((id) => id !== userId);
          updateGroups((prev) =>
            prev.map((g) =>
              g.id === groupId ? { ...g, members: nextMembers, adminIds: nextAdminIds } : g
            )
          );
          if (selectedChat?.chatType === 'group' && selectedChat.id === groupId) {
            setSelectedChat((prev) =>
              prev?.chatType === 'group'
                ? { ...prev, members: nextMembers, adminIds: nextAdminIds }
                : prev
            );
          }
          useToastStore.getState().showToast(`${memberName} was removed from the group.`, 'success');
        } catch (error) {
          console.error('Failed to remove group member:', error);
          useToastStore
            .getState()
            .showToast(
              error instanceof Error ? error.message : 'Failed to remove member.',
              'error'
            );
        }
    }, [currentUser, groups, users, selectedChat, updateGroups, setSelectedChat]);

    const handleLeaveGroup = useCallback(async (groupId: string) => {
        if (!currentUser) return;
        const group = groups.find((g) => g.id === groupId) ||
          (selectedChat?.chatType === 'group' && selectedChat.id === groupId ? selectedChat : null);
        if (!group) return;

        const isSoleAdmin =
          Array.isArray(group.adminIds) &&
          group.adminIds.includes(currentUser.id) &&
          group.adminIds.length <= 1;
        if (isSoleAdmin) {
          useToastStore.getState().showToast(
            'Cannot leave as the only admin. Promote another member first.',
            'error',
          );
          return;
        }

        const confirmed = await confirmDialog({
          title: 'Leave group',
          message: `Leave "${group.name}"? You will lose access until someone invites you again.`,
          confirmLabel: 'Leave',
          danger: true,
        });
        if (!confirmed) return;

        try {
          await leaveGroup(groupId);
          updateGroups((prev) => prev.filter((g) => g.id !== groupId));
          updateMessages((prev) => {
            const next = { ...prev };
            delete next[groupId];
            return next;
          });
          if (selectedChat?.chatType === 'group' && selectedChat.id === groupId) {
            setSelectedChat(null);
          }
          closeModal('groupInfo');
          useToastStore.getState().showToast(`You left "${group.name}".`, 'success');
        } catch (error) {
          console.error('Failed to leave group:', error);
          useToastStore
            .getState()
            .showToast(
              error instanceof Error ? error.message : 'Failed to leave group.',
              'error',
            );
        }
    }, [currentUser, groups, selectedChat, updateGroups, updateMessages, setSelectedChat, closeModal]);

    const getAllSubgroupIDs = useCallback((parentId: string, allGroups: Group[]): string[] => {
        const subgroupIDs: string[] = [];
        const directSubgroups = allGroups.filter(g => g.parentId === parentId);
        for (const subgroup of directSubgroups) {
            subgroupIDs.push(subgroup.id);
            subgroupIDs.push(...getAllSubgroupIDs(subgroup.id, allGroups));
        }
        return subgroupIDs;
    }, []);

    const handleDeleteGroup = useCallback(async (groupId: string) => {
        if (window.confirm("Are you sure you want to permanently delete this group and all its sub-groups? This cannot be undone. Past test scores stay in your history, but they won’t appear under Group performance after the group is gone.")) {
            const group = groups.find(g => g.id === groupId);
            const idsToDelete = [groupId, ...getAllSubgroupIDs(groupId, groups)];
            
            try {
                for (const id of idsToDelete) {
                    await deleteGroup(id);
                }
                
                if (group && currentUser) {
                    group.members.forEach(async (member) => {
                        if (member.id !== currentUser.id) {
                            try {
                                await createNotification({
                                    user_id: member.id,
                                    message: `The group "${group.name}" has been permanently deleted by ${formatActorLabel(currentUser)}`,
                                    link: `/dashboard`
                                });
                            } catch (error) {
                                console.error('Failed to create deletion notification:', error);
                            }
                        }
                    });
                }
                
                updateGroups(prevGroups => prevGroups.filter(g => !idsToDelete.includes(g.id)));
                
                updateMessages(prevMessages => {
                    const newMessages = { ...prevMessages };
                    idsToDelete.forEach(id => {
                        delete newMessages[id];
                    });
                    return newMessages;
                });
                
                if (selectedChat && idsToDelete.includes(selectedChat.id)) {
                    setSelectedChat(null);
                }
                closeModal('groupInfo');
            } catch (error) {
                console.error('Error deleting group:', error);
                alert('Failed to delete group. Please try again.');
            }
        }
    }, [groups, currentUser, selectedChat, getAllSubgroupIDs, updateGroups, updateMessages, setSelectedChat, closeModal]);

    const handleToggleArchiveGroup = useCallback(async (groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        if (!group) return;

        const isArchiving = !group.isArchived;
        
        try {
            await updateGroup(groupId, { isArchived: isArchiving });
            
            updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, isArchived: isArchiving } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return { ...prev, isArchived: isArchiving };
                    }
                    return prev;
                });
            }

            if (currentUser) {
                group.members.forEach(async (member) => {
                    if (member.id !== currentUser.id) {
                        try {
                            await createNotification({
                                user_id: member.id,
                                message: `The group "${group.name}" has been ${isArchiving ? 'archived' : 'unarchived'} by ${formatActorLabel(currentUser)}`,
                                link: `/chat/${groupId}`
                            });
                        } catch (error) {
                            console.error('Failed to create archive notification:', error);
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Error toggling archive status:', error);
            alert('Failed to update group archive status. Please try again.');
        }
    }, [groups, currentUser, selectedChat, updateGroups, setSelectedChat]);

    const handleApproveMember = useCallback((groupId: string, userId: string) => {
        updateGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                const memberToApprove = g.pendingMembers?.find(m => m.id === userId);
                if (!memberToApprove) return g;
                return {
                    ...g,
                    pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId),
                    members: [...g.members, memberToApprove]
                };
            }
            return g;
        }));

        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);
        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `Your request to join "${group.name}" has been approved by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create approval notification:', error));
            } catch (error) {
                console.error('Failed to create approval notification:', error);
            }
        }
    }, [groups, users, currentUser, updateGroups]);

    const handleRejectMember = useCallback((groupId: string, userId: string) => {
        updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, pendingMembers: (g.pendingMembers || []).filter(m => m.id !== userId) } : g));

        const group = groups.find(g => g.id === groupId);
        const user = users.find(u => u.id === userId);
        if (group && user && currentUser && userId !== currentUser.id) {
            try {
                createNotification({
                    user_id: userId,
                    message: `Your request to join "${group.name}" has been declined by ${formatActorLabel(currentUser)}`,
                    link: `/chat/${groupId}`
                }).catch(error => console.error('Failed to create rejection notification:', error));
            } catch (error) {
                console.error('Failed to create rejection notification:', error);
            }
        }
    }, [groups, users, currentUser, updateGroups]);

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

    const handleLoadMoreMessages = useCallback(async (groupId: string) => {
        const currentMsgs = messages[groupId] || [];
        if (currentMsgs.length === 0) return 0;
        
        const oldestRealMessage = currentMsgs.find(m => !m.id.startsWith('optimistic-'));
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
