/**
 * The chat-screen modal openers, extracted verbatim from
 * `hooks/useGroupHandlers.ts`.
 *
 * Exports: useChatModalOpeners({ … }) — `onOpenQuestionModal`,
 *  `onOpenGroupInfoModal`, `onOpenTestConfigModal`, `onOpenStudyConfigModal` and
 *  `handleChallengeUser`.
 * Touches: the UI store's `openModal`, `setActiveTestConfigMode` and
 *  `setChallengeOpponent` (all passed in), and `refreshGroupMembersInState` from
 *  ./useGroupMutations.
 * Composition position, and why: called LAST in the composer, after
 *  useGroupMutations, because `onOpenGroupInfoModal` takes that hook's
 *  `refreshGroupMembersInState`. It registers no effect and nothing reads what it
 *  returns except the composer's own return object, so last is the safe place.
 * Gotchas:
 *  - Group info is the only non-trivial one: it BUSTS the roster cache as it
 *    opens, so the member sheet is never showing a stale list, and it opens the
 *    modal whether or not that refresh succeeds.
 *  - The test / study / challenge openers differ only in the mode they stamp
 *    before opening the one shared config sheet; the mode is what the sheet
 *    reads to decide what it is configuring.
 */
import { useCallback } from 'react';
import { User } from '../../types';
import type { UIStoreState } from './types';

export interface UseChatModalOpenersParams
    extends Pick<
        UIStoreState,
        'selectedChat' | 'openModal' | 'setActiveTestConfigMode' | 'setChallengeOpponent'
    > {
    refreshGroupMembersInState: (groupId: string) => Promise<unknown>;
}

export function useChatModalOpeners({
    selectedChat,
    openModal,
    setActiveTestConfigMode,
    setChallengeOpponent,
    refreshGroupMembersInState,
}: UseChatModalOpenersParams) {
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

    return {
        onOpenQuestionModal,
        onOpenGroupInfoModal,
        onOpenTestConfigModal,
        onOpenStudyConfigModal,
        handleChallengeUser,
    };
}
