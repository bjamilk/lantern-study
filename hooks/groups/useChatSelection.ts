/**
 * The one chat-selection path, extracted verbatim from `hooks/useGroupHandlers.ts`.
 *
 * Exports: useChatSelection({ … }) — `handleSelectChat` (open a group or DM),
 *  `handleChatBack` (return to the chat list), and `dmFetchSeqRef`, the DM fetch
 *  sequence counter it shares with the chat-data sync.
 * Touches: services/supabase (`fetchUserVotesForGroup`, `fetchGroupMembers`,
 *  `markDMAsRead`, `fetchDirectMessages`), `navigateForAppMode`, the group store
 *  (`updateGroups`, `updateUserVotes`, `updateDmThreads`, `updateDirectMessages`)
 *  and the UI store's `setSelectedChat` / `setActiveCommunity`.
 * Composition position, and why: this hook is called FIRST in the composer,
 *  before the chat-data sync and before all five mutation hooks, because
 *  `handleSelectChat` is a parameter of `useDmHandlers` and `useGroupMutations`.
 *  It registers NO effect, so calling it first cannot reorder anything: the
 *  chat-data sync's two effects are still the first two the composer registers.
 * Gotchas:
 *  - `keepSurface` is for a channel opened from INSIDE its community (founder
 *    rule: the community owns its chat). The group is selected exactly as from
 *    the chats list, but the app stays where it is and the caller navigates.
 *  - Mark-as-read for a GROUP is deliberately NOT done here — the chat-data sync
 *    owns it, so deep links and list taps take one path and cannot race. A DM
 *    selection does mark itself read here, as it always has.
 *  - `dmFetchSeqRef` is returned rather than kept private because the chat-data
 *    sync bumps the SAME counter: a tap and a deep-link load must be able to
 *    cancel each other, which two separate counters could not do.
 *  - The `useCallback` dependency list carries `updateMessages` and `lowDataMode`
 *    although the body reads neither. Kept verbatim: dropping them would change
 *    when `handleSelectChat`'s identity churns, and that identity feeds the
 *    dependency arrays of the hooks downstream.
 */
import { useCallback, useRef } from 'react';
import { AppMode, ChatItem, DMThread, DirectMessage } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { mergeChatMessagesById } from '@lantern/shared/utils';
import {
    fetchGroupMembers, fetchUserVotesForGroup, fetchDirectMessages, markDMAsRead,
} from '../../services/supabase';
import { navigateForAppMode } from '../../utils/appNavigation';
import { mapApiGroupMembers, mapDirectMessageFromApi } from './normalisers';
import type { AuthStoreState, GroupStoreState, UIStoreState } from './types';

export interface UseChatSelectionParams
    extends Pick<AuthStoreState, 'currentUser'>,
        Pick<
            GroupStoreState,
            'updateMessages' | 'updateUserVotes' | 'updateGroups' | 'updateDmThreads' | 'updateDirectMessages'
        >,
        Pick<UIStoreState, 'setSelectedChat' | 'lowDataMode'> {}

export function useChatSelection({
    currentUser,
    updateMessages,
    updateUserVotes,
    updateGroups,
    updateDmThreads,
    updateDirectMessages,
    setSelectedChat,
    lowDataMode,
}: UseChatSelectionParams) {
    const dmFetchSeqRef = useRef(0);

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

    return { handleSelectChat, handleChatBack, dmFetchSeqRef };
}
