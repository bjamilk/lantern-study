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
import { User, Group, Message, MessageType, QuestionType, QuestionOption, AppMode, DMThread, DirectMessage, AppNotification, GroupPermissions, QuestionStatus, ChatItem, MatchingItem, DiagramLabel } from '../types';
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
    DeliveryIntentRegistry,
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

// Module-level (not per-mount) in-flight guards: a remount must not let the same send,
// question submit or vote fire twice. The two DeliveryIntentRegistry instances hold the
// clientMessageId minted for each distinct payload so a retry reuses it instead of posting
// a second copy.
const sendingGroupIds = new Set<string>();
const sendingThreadIds = new Set<string>();

/**
 * Thrown when a send is refused because one is already in flight for the same
 * group or DM thread (E3 H16). The composer catches it, restores the text the
 * student typed and shows this sentence — silence used to eat the message.
 */
export class MessageSendBusyError extends Error {
    constructor(message = 'Still sending your last message — your text was kept, try again in a moment.') {
        super(message);
        this.name = 'MessageSendBusyError';
    }
}
const submittingQuestionGroupIds = new Set<string>();
const groupDeliveryIntents = new DeliveryIntentRegistry();
const dmDeliveryIntents = new DeliveryIntentRegistry();

interface UseGroupHandlersParams {
    users: User[];
}

// ── Normalisers ───────────────────────────────────────────────────────────────
// Roster rows come back in mixed camel/snake case depending on the endpoint —
// `mapGroupMemberRow` (@lantern/shared/groups) owns that, and the same call
// runs on mobile.
function mapApiGroupMembers(fetchedMembers: any[], adminIds: readonly string[] = []): User[] {
    return (fetchedMembers || []).map((m: any) => mapGroupMemberRow(m, adminIds));
}

// Maps a page of API messages, dropping (not throwing on) any row mapMessageFromApi rejects
// — one malformed message must not blank the whole conversation.
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

// DM normaliser. Reads every field in both cases, unwraps the sender whether it arrives as
// `sender`, `profiles`, or a one-element array, and blanks the text of a removed message so
// no client can render deleted content from a cached payload.
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
        clientMessageId: raw.clientMessageId || raw.client_message_id,
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

    const handleCloseCreateGroupModal = useCallback(() => {
        closeModal('createGroup');
        setSubgroupParentId(undefined);
    }, [closeModal, setSubgroupParentId]);

    // ── Group creation ────────────────────────────────────────────────────────
    // Subgroup: created with no members (the creator only), appended locally and opened right
    // away; the emails string is kept as `memberEmails` for the invite UI, not sent as members.
    const handleCreateSubGroup = useCallback(async (name: string, description: string, memberEmailsStr: string, parentId?: string, courseId?: string | null) => {
        if (!currentUser) return;
      
        try {
            const groupData = {
                name,
                description,
                avatar_url: undefined,
                permissions: {},
                invite_id: uuidv4().substring(0, 8),
                parent_id: parentId,
                ...(courseId !== undefined ? { courseId } : {}),
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
                courseId: newGroup.courseId ?? newGroup.course_id ?? courseId ?? null,
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

    // Full group creation. Avatar upload is best-effort and never fails the create (the group
    // already exists by then). Afterwards the whole groups list is refetched and remapped —
    // field-for-field the same mapping as the bootstrap and membership-realtime paths — and
    // navigation is DEFERRED into pendingCreatedGroupRef so the create screen can show its
    // invite-link step before handleEnterCreatedGroup opens the chat.
    const handleCreateGroup = useCallback(async (details: { name: string; description: string; avatarFile: File | null; memberIds: string[]; permissions: GroupPermissions; courseId?: string | null; visibility?: 'private' | 'community' | 'public'; communityId?: string | null; communitySurface?: 'board' | 'study_group' }) => {
        if (!currentUser) return;

        try {
            const groupData = {
                name: details.name,
                description: details.description,
                avatar_url: undefined as string | undefined,
                permissions: details.permissions,
                invite_id: uuidv4().substring(0, 8),
                parent_id: undefined,
                ...(details.courseId !== undefined ? { courseId: details.courseId } : {}),
                ...(details.visibility ? { visibility: details.visibility } : {}),
                ...(details.communityId !== undefined ? { communityId: details.communityId } : {}),
                // Board vs study group (spec §3.7). Ignored server-side without
                // a communityId; 'study_group' 503s pre-migration.
                ...(details.communitySurface ? { communitySurface: details.communitySurface } : {}),
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

            // The row → `Group` mapping is `mapGroupRows` (@lantern/shared/groups);
            // only the merge with local state (unread, pending members, an
            // already-loaded roster) belongs here.
            updateGroups((prev) => {
                const prevById = new Map(prev.map((g) => [g.id, g]));
                return mapGroupRows(fetchedGroups).map((g) => {
                    const existing = prevById.get(g.id);
                    return {
                        ...g,
                        unreadCount: existing?.unreadCount || 0,
                        pendingMembers: existing?.pendingMembers || [],
                        invitedPhoneNumbers: existing?.invitedPhoneNumbers || [],
                        members: g.id === newGroup.id
                            ? mappedMembers
                            : (existing?.members?.length ? existing.members : []),
                    };
                });
            });
            
            // What the creator just asked for is the fallback for anything the
            // create response omits (a pre-migration server answers without
            // `community_surface`, and the row is written before we see it).
            const mappedNewGroup = {
                ...mapGroupRow(newGroup, {
                    viewerId: currentUser.id,
                    fallback: {
                        adminIds: [currentUser.id],
                        courseId: details.courseId ?? null,
                        visibility: details.visibility,
                        communityId: details.communityId ?? null,
                        communitySurface: details.communitySurface ?? null,
                    },
                }),
                unreadCount: 0,
                pendingMembers: [],
                invitedPhoneNumbers: [],
                members: mappedMembers,
                chatType: 'group' as const
            };

            // Defer navigation so CreateGroupScreen can show invite link success step
            updateMessages(prev => ({ ...prev, [newGroup.id]: [] }));
            pendingCreatedGroupRef.current = mappedNewGroup;

            // Gamification is server-owned: syncGamificationProgress returns the authoritative
            // points/badges/stats and any newly awarded badges to announce. `updatedStats`
            // below is a leftover local projection and is not used.
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

    // Second half of the deferred navigation: prefers the fully-mapped group stashed by
    // handleCreateGroup, and falls back to a minimal shell if the ref was already consumed
    // (e.g. a reload between the two steps).
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

    // ── Questions ─────────────────────────────────────────────────────────────
    // Posts a question as a chat message. A question is a Message whose `type` is
    // MessageType.QUESTION; the actual kind (MCQ, matching, diagram, …) rides in
    // `questionType` and every downstream reader must use that field, not `type`.
    // Before sending, the group's loaded messages are scanned for a case-insensitive stem
    // match — a hit diverts to the duplicate modal instead of posting. Unlike text sends this
    // is server-first (no optimistic bubble); the delivery intent still guards a retry.
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

    const onOpenCreateSubGroupModal = useCallback((parentId: string) => {
        setSubgroupParentId(parentId);
        openModal('createGroup');
    }, [setSubgroupParentId, openModal]);

    // ── Group settings ────────────────────────────────────────────────────────
    // Server-first, then patch both the list row and the open selection. `communityId` uses
    // an `'communityId' in discovery` check rather than a truthiness test so an explicit null
    // (detach from community) is sent, while an absent key leaves it unchanged.
    const handleUpdateGroupDetails = useCallback(async (
        groupId: string,
        name: string,
        description: string,
        discovery?: { visibility?: 'private' | 'community' | 'public'; communityId?: string | null }
    ) => {
        try {
            await updateGroup(groupId, {
                name,
                description,
                ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            });
            updateGroups(prev => prev.map(g => g.id === groupId ? {
                ...g,
                name,
                description,
                ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
            } : g));
            if (selectedChat?.id === groupId) {
                setSelectedChat(prev => {
                    if (prev?.chatType === 'group') {
                        return {
                            ...prev,
                            name,
                            description,
                            ...(discovery?.visibility ? { visibility: discovery.visibility } : {}),
                            ...(discovery && 'communityId' in discovery ? { communityId: discovery.communityId ?? null } : {}),
                        };
                    }
                    return prev;
                });
            }
            useToastStore.getState().showToast('Group details updated.', 'success');
        } catch (error) {
            useToastStore.getState().showToast(
                error instanceof Error ? error.message : 'Could not update group details.',
                'error'
            );
        }
    }, [selectedChat, updateGroups, setSelectedChat]);

    // Strips the data-URL prefix and uploads the raw base64 with its real content type; the
    // stored value is always the returned URL, never the data URL. Rethrows so the picker can
    // show the failure.
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

    // ── Membership & admin ────────────────────────────────────────────────────
    // Roster writes always go to BOTH the groups list and the open selection, which hold
    // separate copies; updating only one leaves @mentions or the member sheet stale.
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

    // Batch invite. Invites are PENDING until accepted, so the roster is refetched rather
    // than optimistically extended — an invitee must not appear as a member. A response with
    // neither invited nor already-pending entries is treated as a failure and rethrown.
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

    // Accepting an invite refetches the whole list and folds it into the one on
    // screen, then overwrites the roster of the group just joined.
    // FIXED (F9): this used to be a hand-written full REPLACE (`setGroups`) of a
    // sixth inline copy of the group mapper, with `unreadCount: 0` hardcoded on
    // every row — so accepting one invite wiped the unread badge on every OTHER
    // group until the next unread-count fetch, and dropped `communitySurface`
    // the way the two copies R2 deleted did. It now goes through the shared
    // `mergeFetchedGroups`, carrying each group's existing unread count over
    // rather than issuing a second request for counts that have not changed.
    const handleAcceptGroupInvite = useCallback(async (groupId: string) => {
        if (!currentUser) throw new Error('Not signed in');
        const group = await acceptGroupInvite(groupId);
        const [fetchedGroups, fetchedMembers] = await Promise.all([
            fetchGroups(currentUser.id),
            fetchGroupMembers(groupId, { bustCache: true }),
        ]);
        const mappedMembers = mapApiGroupMembers(fetchedMembers);
        updateGroups((prev) => {
            const carriedUnread = Object.fromEntries(
                prev.map((g) => [g.id, g.unreadCount || 0])
            ) as Record<string, number>;
            return mergeFetchedGroups(fetchedGroups, prev, carriedUnread).map((g) =>
                g.id === groupId ? { ...g, members: mappedMembers } : g
            );
        });
        return group;
    }, [currentUser, updateGroups]);

    const handleDeclineGroupInvite = useCallback(async (groupId: string) => {
        await declineGroupInvite(groupId);
    }, []);

    // KNOWN ISSUE (tracked, deferred F9: needs a schema change — the API has no
    // group-invite revoke endpoint at all. `routes/groups.ts` exposes create /
    // accept / decline and nothing that cancels a pending invite, and the email
    // and phone invitations are not even stored as rows a client could address.
    // Communities have `revokeInvite` (routes/communities.ts:207); groups have
    // no equivalent to call): both revoke handlers only filter the invitee out
    // of local state after the confirm — there is no server call, so the
    // invitation is still live and the entry reappears on the next groups fetch.
    const handleRevokeInvitation = useCallback(async (groupId: string, email: string) => {
        if (!(await confirmDialog(planRevokeInvitationConfirm({ invitee: email })))) return;
        updateGroups(prev => prev.map(g => {
            if (g.id === groupId) {
                return { ...g, memberEmails: (g.memberEmails || []).filter(e => e !== email) };
            }
            return g;
        }));
    }, [updateGroups]);

    const handleRevokePhoneInvitation = useCallback(async (groupId: string, phoneNumber: string) => {
        if (!(await confirmDialog(planRevokeInvitationConfirm({ invitee: phoneNumber })))) return;
        updateGroups(prev => prev.map(g => g.id === groupId ? { ...g, invitedPhoneNumbers: (g.invitedPhoneNumbers || []).filter(p => p !== phoneNumber) } : g));
    }, [updateGroups]);

    // Promote / demote: server-first, and local state is only patched from the adminIds the
    // server returns. Demote refuses to remove the last admin (the same rule the leave and
    // remove-member handlers enforce), and notifies the affected user unless it is self.
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

    // Remove member: never self, never the last admin, always confirmed. Server-first; on
    // success the member is dropped from both the roster and adminIds locally.
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

    // Leave: blocked for the sole admin (a group must never be left adminless), confirmed,
    // then server-first. On success the group and its cached messages are dropped and the
    // chat is deselected if it was open.
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

    // ── Group deletion / archive ──────────────────────────────────────────────
    // Recursive descendant walk — deleting a group must take its whole subgroup subtree, not
    // just its direct children. Also used by the test launcher to gather source groups.
    const getAllSubgroupIDs = useCallback((parentId: string, allGroups: Group[]): string[] => {
        const subgroupIDs: string[] = [];
        const directSubgroups = allGroups.filter(g => g.parentId === parentId);
        for (const subgroup of directSubgroups) {
            subgroupIDs.push(subgroup.id);
            subgroupIDs.push(...getAllSubgroupIDs(subgroup.id, allGroups));
        }
        return subgroupIDs;
    }, []);

    // Deletes the group and every descendant, sequentially so a failure part-way leaves the
    // rest intact and the local state untouched (the store is only pruned after the loop).
    // Member notifications are fire-and-forget and each is individually caught.
    const handleDeleteGroup = useCallback(async (groupId: string) => {
        const group = groups.find(g => g.id === groupId);
        if (!(await confirmDialog(planDeleteGroupConfirm({ name: group?.name })))) return;
        {
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

    // Archive toggle: server-first, then patch the list and the open selection. Unlike
    // delete, this does not cascade to subgroups.
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

    // Join-request approve / reject.
    // KNOWN ISSUE (tracked, deferred F9 · E3 M2: needs a schema change AND a
    // product decision. There is no group join-request table or endpoint — the
    // API has no join-request route, and `pendingMembers` is hardcoded `[]` by
    // every group mapper, so the GroupInfoModal section these drive can never
    // render. E3 M2's own advice is "wire to real endpoints, or delete the
    // handlers, props and the modal section": which of those happens is a
    // product call about whether private groups get a join-request flow at all,
    // and both halves reach outside this lane's files): both handlers move the
    // pending member around in LOCAL state only and send a notification — there
    // is no membership API call, so an approved member is not actually added to
    // the group and the pending row returns on the next groups fetch.
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
