/**
 * Every Supabase Realtime channel the signed-in app keeps open, plus the
 * recovery path for the events a sleeping tab never received.
 *
 * Six channels — notifications, dm_threads, dm_messages, messages, notes +
 * note_collaborators, profiles, group_members — and two window/document
 * listeners, in the order they must register.
 *
 * Exports: useRealtimeSubscriptions({ currentUser, authTokenReady,
 *  refreshDmThreadsForUser, onChallengeNotification }) → void.
 * Touches: supabase Realtime, the group/ui/notes stores, and the REST fetchers
 *  used to refill a surface after a gap (fetchMessages, fetchDirectMessages,
 *  fetchGroups, fetchGroupUnreadCounts).
 * Gotchas:
 *  - Everything gates on `authTokenReady`, not just `currentUser`: a channel
 *    subscribed without a live JWT passes RLS filters that drop every event.
 *  - `realtimeEpoch` is part of every channel name. Bumping it (tab focus,
 *    CHANNEL_ERROR, TIMED_OUT) is how channels are recreated with a fresh
 *    token, and `bumpRealtimeEpoch` is rate-limited so a persistently failing
 *    channel cannot spin a recreate loop.
 *  - `mergeChatMessagesById(cached, serverList)` is INCOMING-WINS, so it is
 *    server-wins only in that argument order. Swapping the arguments lets the
 *    persisted cache clobber fresh server rows — reactions and edits vanish
 *    after a cold start.
 *  - The thread-id and group-id sets live in refs so the message channels are
 *    not torn down and resubscribed every time a list changes; an EMPTY set
 *    means "do not filter", so the first message of a brand-new thread is not
 *    dropped before the list has loaded.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DirectMessage, User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useGroupStore } from '../../stores/groupStore';
import { useNotesStore } from '../../stores/notesStore';
import { useUIStore } from '../../stores/uiStore';
import {
    supabase,
    fetchGroups,
    fetchGroupUnreadCounts,
    fetchMessages,
    fetchDirectMessages,
} from '../../services/supabase';
import { initialUserStats } from '../../utils/helpers';
import { normalizeUserSettings } from '@lantern/shared/settings';
import {
    mapMessageFromApi,
    mergeChatMessagesById,
    matchesClientMessageId,
} from '@lantern/shared/utils';
import { mapUserStatsFromApi } from '@lantern/shared/utils/apiMappers';
import { mergeFetchedGroups } from '../../utils/groupListMerge';

interface UseRealtimeSubscriptionsParams {
    currentUser: User | null;
    authTokenReady: boolean;
    refreshDmThreadsForUser: (userId: string) => Promise<void>;
    onChallengeNotification?: (type: string, challengeId: string) => void;
}

export function useRealtimeSubscriptions({
    currentUser,
    authTokenReady,
    refreshDmThreadsForUser,
    onChallengeNotification,
}: UseRealtimeSubscriptionsParams): void {
    const {
        groups, updateGroups,
        dmThreads, updateDmThreads,
        updateMessages,
        updateDirectMessages,
        updateNotifications,
    } = useGroupStore();
    const { openModal, lowDataMode } = useUIStore();
    const { setCurrentUser } = useAuthStore();

    /** Bumped on tab focus / channel errors so Realtime resubscribes with a live JWT. */
    const [realtimeEpoch, setRealtimeEpoch] = useState(0);
    const lastRealtimeBumpRef = useRef(0);
    const bumpRealtimeEpoch = useCallback(() => {
        const now = Date.now();
        // Avoid tight CHANNEL_ERROR → recreate loops.
        if (now - lastRealtimeBumpRef.current < 5000) return;
        lastRealtimeBumpRef.current = now;
        setRealtimeEpoch((value) => value + 1);
    }, []);

    // --- Real-time notifications subscription ---
    // Always on — duel/challenge alerts must work even in low-data mode.
    // Wait for authTokenReady so the Realtime socket has a JWT (RLS filters otherwise drop all events).
    // Re-runs on currentUser.id / authTokenReady / realtimeEpoch — the epoch is in the channel
    // name, so bumping it tears the old channel down and resubscribes with a fresh token.
    // INSERT dedupes by id (the same notification can arrive twice across a resubscribe);
    // challenge notifications are routed to the challenge handler, DM-ish ones trigger a
    // thread refresh so the chat list badge matches.
    useEffect(() => {
        if (!currentUser || !authTokenReady) return;

        const notificationsSubscription = supabase
            .channel(`notifications:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: 'INSERT',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    if (import.meta.env.DEV) {
                      console.log('Real-time notification received');
                    }
                    const notifType = payload.new.type as string | undefined;
                    const newNotification = {
                        id: payload.new.id,
                        message: payload.new.message,
                        date: payload.new.date,
                        read: payload.new.read,
                        link: payload.new.link,
                        type: notifType,
                        data: payload.new.data ?? {},
                    };
                    updateNotifications(prev => {
                        if (prev.some(n => n.id === newNotification.id)) return prev;
                        return [newNotification, ...prev];
                    });
                    if (notifType?.startsWith('challenge')) {
                        const challengeId = (payload.new.data as { challengeId?: string } | null)?.challengeId;
                        if (challengeId && onChallengeNotification) {
                            onChallengeNotification(notifType, challengeId);
                        } else {
                            openModal('challenges');
                        }
                    } else if (
                        notifType === 'dm_message' ||
                        notifType === 'marketplace_inquiry' ||
                        (payload.new.link as string | undefined)?.startsWith('dm:')
                    ) {
                        // New DMs and marketplace contact-seller both need the chat list refreshed.
                        void refreshDmThreadsForUser(currentUser.id);
                    }
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    const updated = payload.new;
                    updateNotifications(prev => prev.map(n =>
                        n.id === updated.id
                            ? {
                                ...n,
                                read: updated.read,
                                message: updated.message,
                                link: updated.link,
                                type: updated.type,
                                data: updated.data ?? {},
                            }
                            : n
                    ));
                }
            )
            .on(
                'postgres_changes',
                {
                    event: 'DELETE',
                    schema: 'public',
                    table: 'notifications',
                    filter: `user_id=eq.${currentUser.id}`
                },
                (payload) => {
                    const deletedId = payload.old.id as string;
                    updateNotifications(prev => prev.filter(n => n.id !== deletedId));
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(notificationsSubscription);
        };
    }, [currentUser?.id, authTokenReady, realtimeEpoch, updateNotifications, openModal, onChallengeNotification, refreshDmThreadsForUser, bumpRealtimeEpoch]);

    // Manual refresh hook (e.g. after contact-seller creates a DM thread)
    // Re-runs on currentUser.id; the window event is the escape hatch for code that creates
    // a thread through the API and cannot wait for the Realtime INSERT to arrive.
    useEffect(() => {
        if (!currentUser?.id) return;
        const onRefresh = () => {
            void refreshDmThreadsForUser(currentUser.id);
        };
        window.addEventListener('lantern:refresh-dm-threads', onRefresh);
        return () => window.removeEventListener('lantern:refresh-dm-threads', onRefresh);
    }, [currentUser?.id, refreshDmThreadsForUser]);

    // New / updated DM threads (contact-seller, first message, message requests).
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch — low-data
    // mode skips this channel entirely (notifications above stay on regardless).
    // The subscription is unfiltered, so membership is checked client-side against
    // participant_ids; both INSERT and UPDATE just trigger a full thread refetch.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const channel = supabase
            .channel(`dm-threads:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'dm_threads' },
                (payload) => {
                    const row = payload.new as { participant_ids?: unknown };
                    const participants = Array.isArray(row.participant_ids)
                        ? row.participant_ids.map(String)
                        : [];
                    if (!participants.includes(currentUser.id)) return;
                    void refreshDmThreadsForUser(currentUser.id);
                }
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'dm_threads' },
                (payload) => {
                    const row = payload.new as { participant_ids?: unknown };
                    const participants = Array.isArray(row.participant_ids)
                        ? row.participant_ids.map(String)
                        : [];
                    if (!participants.includes(currentUser.id)) return;
                    void refreshDmThreadsForUser(currentUser.id);
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, refreshDmThreadsForUser, bumpRealtimeEpoch]);

    // Stable key for membership filtering (does not recreate the DM channel).
    // The ref is what the message handler reads, so the thread list can change without
    // tearing down and resubscribing the channel. Re-runs on the joined id string only.
    const dmThreadIdsKey = dmThreads.map((t) => t.id).sort().join(',');
    const dmThreadIdsRef = useRef(new Set<string>());
    useEffect(() => {
        dmThreadIdsRef.current = new Set(dmThreadIdsKey ? dmThreadIdsKey.split(',') : []);
    }, [dmThreadIdsKey]);

    // --- Real-time DM messages: one channel for all threads (RLS + client filter) ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Thread
    // membership is filtered through dmThreadIdsRef (a ref, so the channel is not recreated
    // per thread), and an EMPTY set is treated as "don't filter" — otherwise the first
    // message of a brand-new thread would be dropped before the list has loaded.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        // Reconciliation order for an INSERT, first match wins:
        //  1. same id already present → ignore (duplicate delivery across a resubscribe)
        //  2. a row whose id is this payload's client_message_id → promote it to the server
        //     id in place, so the optimistic bubble does not duplicate
        //  3. self-send with a matching optimistic row and NO client_message_id → ignore
        //  4. otherwise append
        // An UPDATE patches the row in place and also rewrites any reply preview pointing at
        // it, so edits/removals propagate into quoted previews.
        const applyDmChange = (
            payload: { new: Record<string, unknown> },
            isUpdate: boolean
        ) => {
            const raw = payload.new as {
                id: string;
                thread_id: string;
                sender_id: string;
                text: string;
                timestamp: string;
                edited_at?: string;
                removed_at?: string;
                client_message_id?: string;
                reply_to_message_id?: string;
                thread_root_id?: string;
            };
            const threadId = raw.thread_id;
            if (!threadId) return;
            const threadIds = dmThreadIdsRef.current;
            if (threadIds.size > 0 && !threadIds.has(threadId)) return;
            const viewingThisThread =
                useUIStore.getState().selectedChat?.chatType === 'dm' &&
                useUIStore.getState().selectedChat?.id === threadId;
            const message: DirectMessage = {
                id: raw.id,
                threadId,
                senderId: raw.sender_id,
                text: raw.removed_at ? '' : raw.text,
                timestamp: new Date(raw.timestamp),
                editedAt: raw.edited_at,
                removedAt: raw.removed_at,
                isRemoved: !!raw.removed_at,
                clientMessageId: raw.client_message_id,
                replyToMessageId: raw.reply_to_message_id,
                threadRootId: raw.thread_root_id,
                replyCount: 0,
            };
            updateDirectMessages(prev => {
                const existing = prev[threadId] || [];
                if (isUpdate) {
                    return {
                        ...prev,
                        [threadId]: existing.map((item) => {
                            const replyTo = item.replyTo?.id === message.id
                                ? {
                                    ...item.replyTo,
                                    text: message.isRemoved ? undefined : message.text,
                                    isRemoved: !!message.isRemoved,
                                }
                                : item.replyTo;
                            return item.id === message.id
                                ? { ...item, ...message, replyCount: item.replyCount, replyTo }
                                : { ...item, replyTo };
                        }),
                    };
                }
                if (existing.some(m => m.id === message.id)) return prev;
                // `matchesClientMessageId`, not `===`: the echo is the WIRE id (bare
                // UUID) while the optimistic row's id is `temp-<uuid>`.
                if (
                    raw.client_message_id &&
                    existing.some(m => matchesClientMessageId(m.id, raw.client_message_id))
                ) {
                    return {
                        ...prev,
                        [threadId]: existing.map(m =>
                            matchesClientMessageId(m.id, raw.client_message_id)
                                ? { ...m, ...message, id: message.id }
                                : m
                        ),
                    };
                }
                // Self-sends from this device are usually optimistic; still accept other-device echoes.
                if (raw.sender_id === currentUser.id) {
                    const hasOptimistic = existing.some(
                        (m) =>
                            m.senderId === currentUser.id &&
                            m.text === message.text &&
                            (m.id.startsWith('msg-') ||
                              m.id.startsWith('temp-') ||
                              m.id.startsWith('optimistic-') ||
                              m.id.startsWith('local-') ||
                              m.clientMessageId === m.id)
                    );
                    if (hasOptimistic && !raw.client_message_id) return prev;
                }
                return { ...prev, [threadId]: [...existing, message] };
            });

            // Thread-list side effects. An UPDATE re-derives the preview server-side, so it
            // just refetches; an INSERT patches preview/timestamp/unread locally. Unread only
            // increments for an incoming message while that thread is NOT on screen, and any
            // incoming message un-archives the thread.
            if (isUpdate) {
                void refreshDmThreadsForUser(currentUser.id);
                return;
            }
            updateDmThreads(prev => prev.map(t => {
                if (t.id !== threadId) return t;
                const isIncoming = raw.sender_id !== currentUser.id;
                return {
                    ...t,
                    lastMessage: raw.removed_at ? t.lastMessage : raw.text,
                    lastMessageTimestamp: new Date(raw.timestamp),
                    unreadCount:
                        isIncoming && !viewingThisThread
                            ? (t.unreadCount || 0) + 1
                            : t.unreadCount,
                    isArchived: isIncoming ? false : t.isArchived,
                };
            }));
        };

        const channel = supabase
            .channel(`dm-messages-all:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'dm_messages' },
                (payload) => applyDmChange(payload as { new: Record<string, unknown> }, false)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'dm_messages' },
                (payload) => applyDmChange(payload as { new: Record<string, unknown> }, true)
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [
        currentUser?.id,
        authTokenReady,
        lowDataMode,
        realtimeEpoch,
        refreshDmThreadsForUser,
        updateDirectMessages,
        updateDmThreads,
        bumpRealtimeEpoch,
    ]);

    // Same ref pattern as dmThreadIdsRef: joined-group ids for client-side filtering of the
    // unfiltered messages channel, updated without recreating that channel.
    const groupIdsKey = groups.map((g) => g.id).sort().join(',');
    const groupIdsRef = useRef(new Set<string>());
    useEffect(() => {
        groupIdsRef.current = new Set(groupIdsKey ? groupIdsKey.split(',') : []);
    }, [groupIdsKey]);

    // --- Real-time group messages for all joined groups (so chat updates before/with notifications) ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch.
    // Realtime payloads are RAW table rows: no joined profile, so the sender is patched up
    // from the group roster (name/avatar/username only — the id always stays sender_id, an
    // auth user id, never a membership-row id).
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const applyIncoming = (payloadNew: Record<string, unknown>, isUpdate: boolean) => {
            const groupId = String(payloadNew.group_id || '');
            if (!groupId) return;
            const groupIds = groupIdsRef.current;
            if (groupIds.size > 0 && !groupIds.has(groupId)) return;

            const mapped = mapMessageFromApi(payloadNew);
            const raw = payloadNew as {
                sender_id?: string;
                client_message_id?: string;
                content?: string;
                text?: string;
            };
            const rosterMember = useGroupStore
                .getState()
                .groups.find((g) => g.id === groupId)
                ?.members?.find(
                    (m) => m.id === raw.sender_id || (m as { userId?: string }).userId === raw.sender_id
                );
            if (
                rosterMember &&
                (!mapped.sender?.username ||
                    mapped.sender.name === 'Member' ||
                    mapped.sender.name === 'Unknown' ||
                    !mapped.sender?.avatarUrl)
            ) {
                mapped.sender = {
                    ...mapped.sender,
                    ...rosterMember,
                    // Keep auth user id — never replace with a membership-row id from roster.
                    id: raw.sender_id || mapped.sender?.id || rosterMember.id || 'unknown',
                    avatarUrl: mapped.sender?.avatarUrl || rosterMember.avatarUrl,
                    username: mapped.sender?.username || rosterMember.username,
                    name:
                      mapped.sender?.name &&
                      mapped.sender.name !== 'Member' &&
                      mapped.sender.name !== 'Unknown'
                        ? mapped.sender.name
                        : rosterMember.name || mapped.sender?.name || 'Member',
                };
            }
            // Realtime payloads omit nested profiles — still stamp sender.id from sender_id.
            if ((!mapped.sender?.id || mapped.sender.id === 'unknown') && raw.sender_id) {
                mapped.sender = {
                    ...(mapped.sender || {
                        name: 'Member',
                        points: 0,
                        badges: [],
                        stats: {} as any,
                    }),
                    id: raw.sender_id,
                };
            }

            // Question-message normaliser. A realtime row often omits the question payload,
            // so each field is kept from the previous copy when the incoming one is empty.
            // `questionType` is the field that carries the REAL question kind (`type` is just
            // the MessageType, 'QUESTION'); losing it renders a question with no options.
            const mergeQuestionMessage = (prevMsg: typeof mapped, nextMsg: typeof mapped) => {
                const merged = { ...prevMsg, ...nextMsg };
                // Never clobber a full local/question payload with empty remap fields.
                if ((!nextMsg.options || nextMsg.options.length === 0) && prevMsg.options?.length) {
                    merged.options = prevMsg.options;
                }
                if (
                    (!nextMsg.correctAnswerIds || nextMsg.correctAnswerIds.length === 0) &&
                    prevMsg.correctAnswerIds?.length
                ) {
                    merged.correctAnswerIds = prevMsg.correctAnswerIds;
                }
                if (!nextMsg.questionStem && prevMsg.questionStem) {
                    merged.questionStem = prevMsg.questionStem;
                }
                if (!nextMsg.questionType && prevMsg.questionType) {
                    merged.questionType = prevMsg.questionType;
                }
                if (!nextMsg.questionStatus && prevMsg.questionStatus) {
                    merged.questionStatus = prevMsg.questionStatus;
                }
                return merged;
            };

            // Same reconciliation ladder as the DM path: known id → merge; own send matched
            // by client_message_id → promote the optimistic row to the server id; own send
            // matched only by identical text → drop the echo; otherwise append.
            // An UPDATE for an unknown id is ignored rather than appended — a message the
            // cache never had must arrive through a fetch, not an edit event.
            updateMessages((prev) => {
                const existing = prev[groupId] || [];
                if (isUpdate) {
                    const idx = existing.findIndex((m) => m.id === mapped.id);
                    if (idx === -1) return prev;
                    const updated = [...existing];
                    updated[idx] = mergeQuestionMessage(updated[idx], mapped);
                    const withUpdatedPreviews = updated.map((message) =>
                        message.replyTo?.id === mapped.id
                            ? {
                                ...message,
                                replyTo: {
                                    ...message.replyTo,
                                    text: mapped.isRemoved ? undefined : mapped.text,
                                    questionStem: mapped.isRemoved
                                        ? undefined
                                        : mapped.questionStem,
                                    isRemoved: !!mapped.isRemoved,
                                },
                            }
                            : message
                    );
                    return { ...prev, [groupId]: withUpdatedPreviews };
                }
                if (existing.some((m) => m.id === mapped.id)) {
                    return {
                        ...prev,
                        [groupId]: existing.map((m) =>
                            m.id === mapped.id ? mergeQuestionMessage(m, mapped) : m
                        ),
                    };
                }
                if (raw.sender_id === currentUser.id) {
                    const clientMessageId = raw.client_message_id;
                    // `matchesClientMessageId`, not `===`: the echo is the WIRE id
                    // (bare UUID) while the optimistic row's id is `temp-<uuid>`.
                    if (
                        clientMessageId &&
                        existing.some((m) => matchesClientMessageId(m.id, clientMessageId))
                    ) {
                        return {
                            ...prev,
                            [groupId]: existing.map((m) =>
                                matchesClientMessageId(m.id, clientMessageId)
                                    ? {
                                        ...m,
                                        ...mapped,
                                        id: mapped.id,
                                        sender: mapped.sender?.id ? mapped.sender : m.sender,
                                      }
                                    : m
                            ),
                        };
                    }
                    const rawContent = raw.content || raw.text || mapped.text || '';
                    const hasOptimistic = existing.some(
                        (m) =>
                            m.sender?.id === currentUser.id &&
                            m.text === rawContent &&
                            m.id !== mapped.id
                    );
                    if (hasOptimistic) return prev;
                }
                return { ...prev, [groupId]: [...existing, mapped] };
            });

            // Sidebar preview + unread badge. On an UPDATE the preview is re-derived from the
            // newest still-visible message (an edit can be a deletion, which must not leave
            // removed text in the preview); on an INSERT the new message is the preview.
            const latestVisible = isUpdate
                ? [...(useGroupStore.getState().messages[groupId] || [])]
                    .reverse()
                    .find((message) =>
                        !message.isRemoved && !message.removedAt && !message.isArchived
                    )
                : mapped;
            const isIncoming =
                !isUpdate && !!raw.sender_id && raw.sender_id !== currentUser.id;
            const viewingThisGroup =
                useUIStore.getState().selectedChat?.chatType === 'group' &&
                useUIStore.getState().selectedChat?.id === groupId;
            useGroupStore.getState().updateGroups((prev) =>
                prev.map((g) =>
                    g.id === groupId
                        ? {
                            ...g,
                            lastMessage:
                                latestVisible?.text ||
                                latestVisible?.questionStem ||
                                undefined,
                            lastMessageTime:
                                latestVisible?.timestamp instanceof Date
                                    ? latestVisible.timestamp.toISOString()
                                    : latestVisible
                                      ? g.lastMessageTime
                                      : undefined,
                            // Realtime previously only refreshed the preview — badges stayed stale until reload.
                            unreadCount:
                                isIncoming && !viewingThisGroup
                                    ? (g.unreadCount || 0) + 1
                                    : g.unreadCount,
                            isArchived: isIncoming ? false : g.isArchived,
                          }
                        : g
                )
            );
        };

        const channel = supabase
            .channel(`group-messages-all:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'messages' },
                (payload) => applyIncoming(payload.new as Record<string, unknown>, false)
            )
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'messages' },
                (payload) => applyIncoming(payload.new as Record<string, unknown>, true)
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateMessages, bumpRealtimeEpoch]);

    // --- Recover missed chat/note events after tab sleep or reconnect ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode; fires on tab becoming visible
    // and on the browser 'online' event, because a socket that slept has a gap no event will
    // ever fill. Bumps the realtime epoch (fresh channels + JWT), refreshes DM threads and
    // notes, then re-fetches only the chat currently on screen.
    useEffect(() => {
        if (!currentUser || !authTokenReady) return;

        const recoverOpenSurfaces = async () => {
            bumpRealtimeEpoch();
            void refreshDmThreadsForUser(currentUser.id);
            void useNotesStore.getState().loadNotes().catch(() => {});

            const chat = useUIStore.getState().selectedChat;
            if (!chat || lowDataMode) return;

            try {
                if (chat.chatType === 'group') {
                    const limit = lowDataMode ? 20 : 50;
                    const fetched = await fetchMessages(chat.id, undefined, limit);
                    const list = (Array.isArray(fetched) ? fetched : [])
                        .map((item) => {
                            try {
                                return mapMessageFromApi(item);
                            } catch {
                                return null;
                            }
                        })
                        .filter((message): message is NonNullable<typeof message> => message != null)
                        .map((message) => ({
                            ...message,
                            clientMessageId:
                                (message as { clientMessageId?: string }).clientMessageId,
                        }));
                    // mergeChatMessagesById is INCOMING-WINS, so the server list MUST be the
                    // second argument: that makes the refresh server-wins per id while
                    // keeping local-only (pending/failed) rows. Swapping the arguments lets
                    // the cached copy clobber fresh server rows — reactions and edits would
                    // silently disappear after a cold start.
                    updateMessages((prev) => ({
                        ...prev,
                        [chat.id]: mergeChatMessagesById(prev[chat.id] || [], list as any),
                    }));
                } else if (chat.chatType === 'dm') {
                    const otherUserId = Array.isArray((chat as { participantIds?: string[] }).participantIds)
                        ? (chat as { participantIds: string[] }).participantIds.find((id) => id !== currentUser.id)
                        : undefined;
                    if (!otherUserId) return;
                    const fetched = await fetchDirectMessages(currentUser.id, otherUserId);
                    // DM normaliser: the REST payload can come back in either camelCase or
                    // snake_case depending on the endpoint, so every field is read both ways.
                    // Same server-wins merge order as the group branch above.
                    const mapped: DirectMessage[] = (Array.isArray(fetched) ? fetched : []).map((raw: any) => ({
                        id: raw.id,
                        threadId: raw.threadId || raw.thread_id || chat.id,
                        senderId: raw.senderId || raw.sender_id,
                        text: raw.isRemoved || raw.removed_at ? '' : raw.text || '',
                        timestamp: new Date(raw.timestamp),
                        editedAt: raw.editedAt || raw.edited_at,
                        removedAt: raw.removedAt || raw.removed_at,
                        isRemoved: raw.isRemoved || !!raw.removed_at,
                        replyToMessageId: raw.replyToMessageId || raw.reply_to_message_id,
                        threadRootId: raw.threadRootId || raw.thread_root_id,
                        replyCount: typeof raw.replyCount === 'number' ? raw.replyCount : raw.reply_count,
                        clientMessageId: raw.clientMessageId || raw.client_message_id,
                    }));
                    updateDirectMessages((prev) => ({
                        ...prev,
                        [chat.id]: mergeChatMessagesById(prev[chat.id] || [], mapped as any) as DirectMessage[],
                    }));
                }
            } catch (err) {
                console.warn('[Realtime] Foreground chat recovery failed:', err);
            }

            const selectedNote = useNotesStore.getState().selectedNote;
            if (selectedNote?.id) {
                void useNotesStore.getState().loadComments(selectedNote.id).catch(() => {});
                void useNotesStore.getState().loadNote(selectedNote.id).catch(() => {});
            }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                void recoverOpenSurfaces();
            }
        };
        const onOnline = () => {
            void recoverOpenSurfaces();
        };

        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('online', onOnline);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('online', onOnline);
        };
    }, [
        currentUser?.id,
        authTokenReady,
        lowDataMode,
        bumpRealtimeEpoch,
        refreshDmThreadsForUser,
        updateMessages,
        updateDirectMessages,
    ]);

    // Notes list / collaborator content — pick up shares and remote edits without full reload.
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. The channel
    // is wide (every notes / note_collaborators change reaches it, RLS decides what is
    // visible), so handlers do not inspect payloads at all — they schedule one debounced
    // (400 ms) reload of the list plus the open note, collapsing bursts of edits.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        let notesRefreshTimer: ReturnType<typeof setTimeout> | undefined;
        const scheduleNotesRefresh = () => {
            if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
            notesRefreshTimer = setTimeout(() => {
                void useNotesStore.getState().loadNotes().catch(() => {});
                const selected = useNotesStore.getState().selectedNote;
                if (selected?.id) {
                    void useNotesStore.getState().loadNote(selected.id).catch(() => {});
                }
            }, 400);
        };

        const channel = supabase
            .channel(`notes-access:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'notes' },
                () => {
                    scheduleNotesRefresh();
                }
            )
            .on(
                'postgres_changes',
                { event: '*', schema: 'public', table: 'note_collaborators' },
                () => {
                    scheduleNotesRefresh();
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            if (notesRefreshTimer) clearTimeout(notesRefreshTimer);
            void supabase.removeChannel(channel);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]);

    // --- Real-time profile updates subscription ---
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Filtered to
    // this user's own row, so it carries changes made on another device or by the server
    // (points, badges, avatar). The handler re-reads the store and id-checks before writing.
    // FIXED (F9): this path used to write `stats` and `settings` STRAIGHT from
    // the raw DB row, bypassing the `mapUserStatsFromApi` / `normalizeUserSettings`
    // pair every other entry point uses (see the bootstrap at :392). A profile
    // UPDATE therefore replaced the normalised settings with raw snake_case JSON
    // and the mapped stats with unmapped columns — stats read as zero and
    // settings-derived UI fell back to defaults until the next full profile
    // fetch. Both now go through the same mappers the bootstrap does.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const profileSubscription = supabase
            .channel(`profile:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'profiles',
                    filter: `id=eq.${currentUser.id}`
                },
                (payload) => {
                    if (import.meta.env.DEV) {
                      console.log('Real-time profile update received');
                    }
                    const updatedProfile = payload.new;
                    const prev = useAuthStore.getState().currentUser;
                    if (!prev || prev.id !== updatedProfile.id) return;
                    setCurrentUser({
                        ...prev,
                        name: updatedProfile.name,
                        avatarUrl: updatedProfile.avatar_url,
                        phoneNumber: updatedProfile.phone,
                        points: updatedProfile.points || 0,
                        badges: updatedProfile.badges || [],
                        stats: updatedProfile.stats
                            ? mapUserStatsFromApi(updatedProfile.stats)
                            : initialUserStats,
                        settings: normalizeUserSettings(updatedProfile.settings),
                    });
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(profileSubscription);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, bumpRealtimeEpoch]);

    // --- Real-time group membership subscription ---
    // Keeps the groups list in sync when the user is added to / removed from groups
    // without requiring a full page refresh or manual re-fetch.
    // Re-runs on currentUser.id / authTokenReady / lowDataMode / realtimeEpoch. Any change to
    // this user's group_members rows triggers a full groups refetch — the payload alone does
    // not carry enough to patch the list. The row mapping MUST stay field-for-field in step
    // with the bootstrap mapping above, and falls back to the existing row for anything the
    // list endpoint omits.
    useEffect(() => {
        if (!currentUser || !authTokenReady || lowDataMode) return;

        const groupMembershipSubscription = supabase
            .channel(`group_members:${currentUser.id}:e${realtimeEpoch}`)
            .on(
                'postgres_changes',
                {
                    event: '*',
                    schema: 'public',
                    table: 'group_members',
                    filter: `user_id=eq.${currentUser.id}`,
                },
                async () => {
                    // Membership changed — re-fetch the full groups list so the sidebar
                    // reflects the join / leave immediately.
                    try {
                        const [freshGroups, unreadCounts] = await Promise.all([
                            fetchGroups(currentUser.id),
                            fetchGroupUnreadCounts(currentUser.id).catch(
                                () => ({} as Record<string, number>)
                            ),
                        ]);
                        // Same merge as the bootstrap load above — carrying the
                        // community fields over is what stops a refresh from
                        // emptying the community column right after joining a
                        // channel, and `mergeFetchedGroups` now also carries
                        // `communitySurface`, which both inline copies dropped.
                        updateGroups((prev) => mergeFetchedGroups(freshGroups, prev, unreadCounts));
                    } catch (err) {
                        console.error('[Group membership] Real-time refresh failed:', err);
                    }
                }
            )
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    bumpRealtimeEpoch();
                }
            });

        return () => {
            void supabase.removeChannel(groupMembershipSubscription);
        };
    }, [currentUser?.id, authTokenReady, lowDataMode, realtimeEpoch, updateGroups, bumpRealtimeEpoch]);
}
