/**
 * Vote and verification mutations for the group question board, extracted
 * verbatim from `hooks/useGroupHandlers.ts`.
 *
 * Exports: useVoteHandlers({ … }) — `onVoteQuestion`, `handleUpvoteDuplicateAndClose`
 *  and `onFlagAsSimilar`, which the composer re-exports unchanged.
 * Touches: services/supabase (`voteQuestion`, `removeVote`, `updateQuestionStatus`,
 *  `updateMessage`, `createNotification`), services/gamificationStreak, and — through
 *  its parameters — the group store's `messages` / `userVotes` and the auth store's
 *  `currentUser`.
 * Gotchas:
 *  - Voting is SERVER-FIRST: no optimistic count. The response's counts win and the
 *    local +/- maths is only a fallback for older API builds.
 *  - `votingMessageIds` is module-level, not per-mount: a remount must not let the
 *    same vote fire twice. It stays module-level here for exactly that reason.
 *  - Both handlers patch the single message by id inside the functional update; the
 *    pre-request snapshot is only ever used to compute new counts (see the F9 · E3 M1
 *    note on `onVoteQuestion`).
 */
import { useCallback } from 'react';
import { User, Message, MessageType, QuestionStatus, ChatItem, Group } from '../../types';
import { resolveQuestionStatusAfterVote } from '@lantern/shared/utils';
import {
    removeVote, voteQuestion, updateMessage, updateQuestionStatus, createNotification,
} from '../../services/supabase';
import { syncGamificationProgress } from '../../services/gamificationStreak';
import { useToastStore } from '../../stores/toastStore';
import type { AddNotification, AuthStoreState, GroupStoreState, UIStoreState } from './types';

// Module-level (not per-mount) in-flight guard: a remount must not let the same
// vote fire twice.
const votingMessageIds = new Set<string>();

export interface UseVoteHandlersParams
    extends Pick<AuthStoreState, 'currentUser' | 'setCurrentUser'>,
        Pick<GroupStoreState, 'groups' | 'messages' | 'userVotes' | 'updateMessages' | 'updateUserVotes'>,
        Pick<UIStoreState, 'selectedChat' | 'closeModal' | 'setDuplicateInfo'> {
    addNotification: AddNotification;
}

export function useVoteHandlers({
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
}: UseVoteHandlersParams) {
    // ── Voting / verification ─────────────────────────────────────────────────
    // Server-first (no optimistic count): tapping the vote you already hold REMOVES it,
    // otherwise it replaces the previous one. The response's counts win; the local +/- maths
    // is only a fallback for older API builds that return no counts. Reaching the verified /
    // rejected threshold notifies the author (self-notifications go through addNotification,
    // others through createNotification), and the PUT to updateQuestionStatus is only a
    // fallback for responses that omit questionStatus — the server already persists it.
    // FIXED (F9 · E3 M1): `groupMessages` is captured from the render-scope
    // store BEFORE the vote round trip, and the whole array used to be written
    // back afterwards — a peer message that arrived over Realtime mid-request
    // was replaced by the pre-vote snapshot and DISAPPEARED from the
    // conversation until the next fetch. Both this handler and onFlagAsSimilar
    // now patch the single message by id inside the functional update, so the
    // snapshot is only ever used to compute the new counts. The `messages` dep
    // stays: the snapshot is still what the counts are derived from.
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
            useToastStore.getState().showToast('Failed to vote. Please try again.', 'error');
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
        
        // Patch the ONE message by id in the list as it stands now. The
        // pre-request snapshot is only used to compute the new counts.
        updateMessages(prev => ({
            ...prev,
            [selectedChat.id]: (prev[selectedChat.id] || []).map(m =>
                m.id === messageId ? updatedMessage : m
            ),
        }));
        updateUserVotes(prev => ({ ...prev, [messageId]: newUserVote }));
    }, [selectedChat, currentUser, messages, userVotes, groups, updateMessages, updateUserVotes, addNotification]);

    // Duplicate-question resolution: upvote the original instead of posting a second copy
    // (skipped if this user already upvoted it), then re-sync the server-owned points.
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

    // "Flag as similar" toggle. The flag list is persisted first; once it reaches 5% of the
    // roster (rounded up) the message is auto-archived LOCALLY — the archive flag itself is
    // not written back, so it does not survive a refetch.
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
            useToastStore.getState().showToast('Failed to flag message. Please try again.', 'error');
            return;
        }

        const updatedMessage = { ...message, flaggedAsSimilarUserIds: newFlags };
        
        const archiveThreshold = Math.ceil((group.members?.length ?? 0) * 0.05);
        if (newFlags.length >= archiveThreshold && !updatedMessage.isArchived) {
            updatedMessage.isArchived = true;
        }

        // Patch by id against the CURRENT list (see onVoteQuestion).
        updateMessages(prev => ({
            ...prev,
            [groupId]: (prev[groupId] || []).map(m => (m.id === messageId ? updatedMessage : m)),
        }));
    }, [currentUser, groups, messages, updateMessages]);

    return {
        onVoteQuestion,
        handleUpvoteDuplicateAndClose,
        onFlagAsSimilar,
    };
}
