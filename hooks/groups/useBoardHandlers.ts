/**
 * The group question-board mutation, extracted verbatim from
 * `hooks/useGroupHandlers.ts`.
 *
 * Exports: useBoardHandlers({ … }) — `handleQuestionSubmit`, which the composer
 *  re-exports unchanged.
 * Touches: services/supabase (`sendMessage`), services/gamificationStreak, the
 *  shared `groupDeliveryIntents` registry and `submittingQuestionGroupIds` guard
 *  in ./deliveryIntents, and — through its parameters — the group store's
 *  `messages` and the auth store's `currentUser`.
 * Gotchas:
 *  - A question IS a message: `type` is MessageType.QUESTION and the real kind
 *    (MCQ, matching, diagram, …) rides in `questionType`. Every downstream reader
 *    must use `questionType`, not `type`.
 *  - It posts through the SAME `groupDeliveryIntents` registry as the text
 *    composer, keyed `group:<id>`, so a retry of either reuses one
 *    clientMessageId and the server can dedupe. That is why the registry lives in
 *    ./deliveryIntents rather than in either hook.
 *  - Unlike a text send this is server-first: no optimistic bubble.
 */
import { useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, MessageType, QuestionType, QuestionOption, QuestionStatus, MatchingItem, DiagramLabel } from '../../types';
import { reconcileDeliveredItem, isUncertainDeliveryError } from '@lantern/shared/utils';
import { BADGE_DEFINITIONS } from '../../gamification';
import { sendMessage } from '../../services/supabase';
import { syncGamificationProgress } from '../../services/gamificationStreak';
import { useToastStore } from '../../stores/toastStore';
import { groupDeliveryIntents, submittingQuestionGroupIds } from './deliveryIntents';
import type { AddNotification, AuthStoreState, GroupStoreState, UIStoreState } from './types';

export interface UseBoardHandlersParams
    extends Pick<AuthStoreState, 'currentUser' | 'setCurrentUser'>,
        Pick<GroupStoreState, 'messages' | 'updateMessages'>,
        Pick<UIStoreState, 'selectedChat' | 'openModal' | 'closeModal' | 'setDuplicateInfo'> {
    addNotification: AddNotification;
}

export function useBoardHandlers({
    currentUser,
    setCurrentUser,
    messages,
    updateMessages,
    selectedChat,
    openModal,
    closeModal,
    setDuplicateInfo,
    addNotification,
}: UseBoardHandlersParams) {
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
            useToastStore.getState().showToast('Failed to submit question. Please try again.', 'error');
        } finally {
            submittingQuestionGroupIds.delete(groupId);
        }
    }, [currentUser, selectedChat, messages, updateMessages, setCurrentUser, openModal, closeModal, setDuplicateInfo, addNotification]);

    return {
        handleQuestionSubmit,
    };
}
