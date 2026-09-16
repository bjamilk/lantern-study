/**
 * Chat + group handler barrel for the web app — now a pure COMPOSER: it calls the
 * `hooks/groups/*` hooks in order and re-exports what they return under the names
 * App.tsx and ChatWindow already read. Its return shape is unchanged, so no
 * caller moved.
 *
 * Exports: useGroupHandlers({ users }) — the handler bundle App.tsx spreads into
 *  the chat screens, plus `unreadAnchorAt` (where to draw the "new messages"
 *  divider) and `addNotification` (reused by the test/game handler barrels); and
 *  a re-export of `MessageSendBusyError`, which ChatWindow imports from THIS path
 *  and recognises by identity.
 * Touches: authStore, groupStore (groups, messages, dmThreads, directMessages,
 *  userVotes, notifications) and uiStore (selectedChat, modals, appMode) — read
 *  here once and passed down. It reaches no transport of its own: every endpoint
 *  this family calls is now reached through one of the nine hooks below.
 * Composition order, and why it is this order:
 *  1. `useNotificationHandlers` — produces `addNotification`, which (4), (5), (6)
 *     and (7) all take, so nothing else can come first.
 *  2. `useChatSelection` — `handleSelectChat` / `handleChatBack`. Before (4) and
 *     (5), which take `handleSelectChat`. It registers no effect.
 *  3. `useChatDataSync` — the anchor-clear and chat-load effects, which were the
 *     first two effects this file registered, so it is called before every hook
 *     that registers one. It owns the unread anchor and takes the DM fetch
 *     counter from (2), which both bump on purpose.
 *  4. `useDmHandlers` — DM threads, sending, paging. Produces `handleSendDm`.
 *  5. `useMessageHandlers` — group send/edit/remove/receipts/paging. It FORWARDS
 *     a DM selection to `handleSendDm`, so it must come after (4).
 *  6. `useGroupMutations` — group CRUD, membership, admin. Produces
 *     `refreshGroupMembersInState`.
 *  7. `useBoardHandlers` — posting a question to the board.
 *  8. `useVoteHandlers` — votes and flags on the question board.
 *  9. `useChatModalOpeners` — the five modal openers. Last, because the group-info
 *     opener takes `refreshGroupMembersInState` from (6).
 *  (1) before (4)–(8), (2) before (4)/(5), (3) before every effect, (4) before
 *  (5) and (6) before (9) are the load-bearing edges; the rest keep the reading
 *  order of the file they came from.
 * Gotchas:
 *  - Optimistic sends are keyed by a clientMessageId minted through a
 *    DeliveryIntentRegistry (./groups/deliveryIntents), so a retry of the same
 *    text reuses the same id and the server can dedupe. On failure the error is
 *    classified: an UNCERTAIN delivery error keeps the intent (markUncertain) so
 *    a retry cannot double-post; any other error clears it.
 *  - The in-flight guards are module-level, shared across every mount. The two
 *    SEND locks THROW `MessageSendBusyError` when held — they must never return
 *    silently, because the composer clears its text before awaiting and restores
 *    it only from a rejection (E3 H16).
 *  - Questions are messages: `type` is MessageType.QUESTION and the real kind
 *    lives in `questionType`.
 *
 * The safety nets for this decomposition are
 * `hooks/useGroupHandlers.surface.test.ts` (the parameter keys and all 49
 * returned members with their arities) and `hooks/useGroupHandlers.chatData.test.ts`
 * (what the chat-data load does, which the surface cannot see) — read both before
 * changing anything here.
 */
import { useRef } from 'react';
import { User } from '../types';
import { useAuthStore } from '../stores/authStore';
import { useGroupStore } from '../stores/groupStore';
import { useUIStore } from '../stores/uiStore';

// The in-flight guards and delivery-intent registries live in
// ./groups/deliveryIntents, because the question board and the message composer
// both post into `group:<id>` and must share ONE registry. `MessageSendBusyError`
// is re-exported from this module path: ChatWindow recognises it by identity.
export { MessageSendBusyError } from './groups/deliveryIntents';
import { useNotificationHandlers } from './groups/useNotificationHandlers';
import { useChatSelection } from './groups/useChatSelection';
import { useChatDataSync } from './groups/useChatDataSync';
import { useVoteHandlers } from './groups/useVoteHandlers';
import { useBoardHandlers } from './groups/useBoardHandlers';
import { useDmHandlers } from './groups/useDmHandlers';
import { useMessageHandlers } from './groups/useMessageHandlers';
import { useGroupMutations } from './groups/useGroupMutations';
import { useChatModalOpeners } from './groups/useChatModalOpeners';

interface UseGroupHandlersParams {
    users: User[];
}

export function useGroupHandlers({ users }: UseGroupHandlersParams) {
    // KNOWN ISSUE (tracked, found during M9b): this ref is dead. It was the
    // composer's staging slot for a just-created group before #64 moved
    // handleCreateGroup out; useGroupMutations now declares and uses its own.
    // Left in place rather than deleted, as this refactor deletes nothing.
    const pendingCreatedGroupRef = useRef<any>(null);
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
    // Moved verbatim to hooks/groups/useNotificationHandlers — writing a
    // notification and the three list actions. Called FIRST because
    // `addNotification` is a parameter of four of the hooks below.
    const {
        addNotification,
        handleMarkNotificationAsRead,
        handleMarkAllNotificationsAsRead,
        handleClearAllNotifications,
    } = useNotificationHandlers({
        currentUser,
        updateNotifications,
        setNotifications,
    });

    // ── Chat selection ────────────────────────────────────────────────────────
    // Moved verbatim to hooks/groups/useChatSelection — the one chat-selection
    // path (with its keepSurface rule for community channels) and the chat-list
    // back action. Called before useDmHandlers and useGroupMutations, which take
    // `handleSelectChat`; it registers no effect, so this position cannot
    // reorder anything.
    const { handleSelectChat, handleChatBack, dmFetchSeqRef } = useChatSelection({
        currentUser,
        updateMessages,
        updateUserVotes,
        updateGroups,
        updateDmThreads,
        updateDirectMessages,
        setSelectedChat,
        lowDataMode,
    });

    // ── Chat data for the open conversation ───────────────────────────────────
    // Moved verbatim to hooks/groups/useChatDataSync — the anchor-clear effect and
    // the ~185-line load (messages, votes, mark-as-read, DM history with its
    // three-deep peer resolution). Those were the FIRST two effects this composer
    // registered, so the hook is called here, before all five mutation hooks;
    // none of them reads the anchor state, the seen-chat ref or the fetch counter
    // it owns.
    const { unreadAnchorAt } = useChatDataSync({
        currentUser,
        updateMessages,
        updateUserVotes,
        updateGroups,
        updateDmThreads,
        updateDirectMessages,
        selectedChat,
        lowDataMode,
        dmFetchSeqRef,
    });

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
    // Moved verbatim to hooks/groups/useChatModalOpeners — the question, group
    // info, test, study and challenge openers. Called LAST because the group-info
    // opener takes `refreshGroupMembersInState` from useGroupMutations above.
    const {
        onOpenQuestionModal,
        onOpenGroupInfoModal,
        onOpenTestConfigModal,
        onOpenStudyConfigModal,
        handleChallengeUser,
    } = useChatModalOpeners({
        selectedChat,
        openModal,
        setActiveTestConfigMode,
        setChallengeOpponent,
        refreshGroupMembersInState,
    });

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
