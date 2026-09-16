/**
 * The safety net for the `hooks/useGroupHandlers.ts` decomposition.
 *
 * `useGroupHandlers` is App.tsx's chat/group mutation barrel: one 2,354-line
 * function returning 48 handlers plus one value, destructured by name in App.tsx. Splitting
 * it into `hooks/groups/*` modules is only behaviour-preserving if THREE
 * things survive the move:
 *
 *  1. the hook's parameter object keys — App.tsx passes exactly these,
 *  2. the names on the object it returns — App.tsx and ChatWindow read them
 *     by name, so a dropped or renamed key is a silently dead prop,
 *  3. each handler's ARITY. Every one of these is passed straight into a JSX
 *     prop; a body that moves into a new module and quietly loses or gains a
 *     parameter still type-checks at the call site when the prop is typed
 *     loosely, and then misreads its arguments at runtime.
 *
 * Unlike the `useAppEffects` surface snapshot (which reads the source text
 * because that hook cannot be mounted without ~35 mocks), this one RENDERS the
 * hook through `hooks/effects/testing/hookHarness` and reads the object it
 * actually produced. That is the stronger assertion available here: it proves
 * the composed hook, not the way the composer happens to be written, and it
 * catches a handler that stops being re-exported by the composer even though
 * its `const` still exists somewhere.
 *
 * Frozen against the UNTOUCHED 2,538-line file, and must keep passing
 * unchanged after every extraction step.
 *
 * Reading order for a reviewer: this file first, then `hooks/useGroupHandlers.ts`
 * (the composer), then the modules under `hooks/groups/` in the order the
 * composer calls them.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';
import { reactMock } from './effects/testing/hookHarness';
import { storeMock } from './effects/testing/storeFixtures';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSER = path.join(REPO_ROOT, 'hooks/useGroupHandlers.ts');

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Only the modules that reach the network or the DOM are stubbed. Everything
// else (the shared mappers, the merge helpers, the confirm planners) runs for
// real, because those are the parts a move could break invisibly.
vi.mock('react', () => reactMock);

/**
 * Every transport function `useGroupHandlers` imports from `services/supabase`.
 * Listed explicitly rather than auto-generated: importing the real module pulls
 * in the Supabase client and the cookie-mode fetch interceptor at module load.
 */
const TRANSPORT_NAMES = [
    'createGroup', 'fetchGroups', 'fetchGroupMembers', 'addGroupMember', 'addGroupMembersBatch',
    'uploadGroupAvatar', 'acceptGroupInvite', 'declineGroupInvite',
    'sendMessage', 'fetchMessages', 'fetchUserVotesForGroup', 'voteQuestion',
    'removeVote', 'updateMessage', 'updateQuestionStatus', 'createNotification',
    'updateUserProfile', 'deleteGroup', 'updateGroup', 'promoteGroupAdmin', 'demoteGroupAdmin',
    'fetchDirectMessages', 'sendDirectMessage', 'markGroupAsRead', 'markDMAsRead', 'fetchDmThreads',
    'markNotificationAsRead', 'markAllNotificationsAsRead', 'deleteAllNotifications',
    'deleteDmThread', 'archiveDmThread', 'unarchiveDmThread', 'fetchUserProfile',
    'ensureAuthTokenReady', 'editGroupMessage', 'removeGroupMessage', 'editDirectMessage',
    'removeDirectMessage', 'removeGroupMember', 'leaveGroup',
] as const;

vi.mock('../services/supabase', () => {
    const module: Record<string, unknown> = {};
    for (const name of TRANSPORT_NAMES) module[name] = vi.fn(async () => undefined);
    return module;
});

vi.mock('../services/gamificationStreak', () => ({
    syncGamificationProgress: vi.fn(async () => null),
}));

vi.mock('../utils/appNavigation', () => ({
    navigateForAppMode: vi.fn(),
}));

vi.mock('../stores/confirmStore', () => ({
    confirmDialog: vi.fn(async () => false),
}));

const storeState = {
    auth: {
        currentUser: { id: 'user-1', name: 'Ada', stats: {}, settings: {} } as any,
        setCurrentUser: vi.fn(),
    },
    group: {
        groups: [] as any[],
        updateGroups: vi.fn(),
        messages: {} as Record<string, any[]>,
        updateMessages: vi.fn(),
        dmThreads: [] as any[],
        updateDmThreads: vi.fn(),
        directMessages: {} as Record<string, any[]>,
        updateDirectMessages: vi.fn(),
        userVotes: {} as Record<string, unknown>,
        updateUserVotes: vi.fn(),
        notifications: [] as any[],
        updateNotifications: vi.fn(),
        setNotifications: vi.fn(),
    },
    ui: {
        appMode: 'CHAT',
        setAppMode: vi.fn(),
        selectedChat: null as any,
        setSelectedChat: vi.fn(),
        modals: {} as Record<string, boolean>,
        openModal: vi.fn(),
        closeModal: vi.fn(),
        setSubgroupParentId: vi.fn(),
        setDuplicateInfo: vi.fn(),
        setActiveTestConfigMode: vi.fn(),
        setChallengeOpponent: vi.fn(),
        lowDataMode: false,
    },
    toast: { showToast: vi.fn() },
};

vi.mock('../stores/authStore', () => ({ useAuthStore: storeMock(storeState.auth) }));
vi.mock('../stores/groupStore', () => ({ useGroupStore: storeMock(storeState.group) }));
vi.mock('../stores/uiStore', () => ({ useUIStore: storeMock(storeState.ui) }));
vi.mock('../stores/toastStore', () => ({ useToastStore: storeMock(storeState.toast) }));

const { renderHook } = await import('./effects/testing/hookHarness');
const { useGroupHandlers } = await import('./useGroupHandlers');

const read = (file: string) => fs.readFileSync(file, 'utf8');

/** The destructured parameter names in `useGroupHandlers({ … })`. */
function parameterKeys(): string[] {
    const source = read(COMPOSER);
    const start = source.indexOf('export function useGroupHandlers({');
    const end = source.indexOf('}: UseGroupHandlersParams', start);
    return source
        .slice(start + 'export function useGroupHandlers({'.length, end)
        .split(',')
        .map((entry) => entry.replace(/\/\/[^\n]*/g, '').trim())
        .filter(Boolean)
        .map((entry) => (entry.split(/[:=]/)[0] ?? '').trim());
}

/**
 * Render the hook and describe what it returned: `name/arity` for a function,
 * `name=<value>` for the one non-function member (`unreadAnchorAt`).
 */
function renderedSurface(): string[] {
    const harness = renderHook(() => useGroupHandlers({ users: [] }));
    return Object.entries(harness.result as Record<string, unknown>).map(([name, value]) =>
        typeof value === 'function' ? `${name}/${(value as (...args: never[]) => unknown).length}` : `${name}=${String(value)}`,
    );
}

/** Frozen against the untouched file — App.tsx passes exactly this. */
const FROZEN_PARAMETER_KEYS = ['users'];

/**
 * The 49 members of the returned object, in the order the untouched file
 * returned them, each with the arity it had. Extraction may move a body into
 * another module; it may not change this list, its order, or any arity.
 *
 * `unreadAnchorAt` is a value, not a handler: with no chat selected it is
 * `null` (the tri-state documented on it — `undefined` means the mark-as-read
 * round trip has not answered yet, `null` means nothing unread).
 */
const FROZEN_SURFACE = [
    'addNotification/1',
    'handleLoadMoreMessages/1',
    'handleLoadMoreDirectMessages/1',
    'handleChatBack/0',
    'unreadAnchorAt=null',
    'handleSelectChat/2',
    'handleInitiateDm/1',
    'handleSendDm/3',
    'handleDeleteDmThread/1',
    'handleArchiveDmThread/1',
    'handleUnarchiveDmThread/1',
    'handleDmThreadStatusChange/2',
    'handleCloseCreateGroupModal/0',
    'handleCreateSubGroup/5',
    'handleCreateGroup/1',
    'handleEnterCreatedGroup/1',
    'handleQuestionSubmit/12',
    'onSendMessage/2',
    'handleEditChatMessage/2',
    'handleRemoveChatMessage/1',
    'onPeerChatRead/1',
    'onVoteQuestion/2',
    'handleUpvoteDuplicateAndClose/1',
    'onFlagAsSimilar/2',
    'onOpenCreateSubGroupModal/1',
    'handleUpdateGroupDetails/4',
    'handleUpdateGroupAvatar/2',
    'handleInviteMembers/2',
    'handleAcceptGroupInvite/1',
    'handleDeclineGroupInvite/1',
    'handleRevokeInvitation/2',
    'handleRevokePhoneInvitation/2',
    'handlePromoteToAdmin/2',
    'handleDemoteAdmin/2',
    'handleRemoveGroupMember/2',
    'handleLeaveGroup/1',
    'getAllSubgroupIDs/2',
    'handleDeleteGroup/1',
    'handleToggleArchiveGroup/1',
    'handleApproveMember/2',
    'handleRejectMember/2',
    'onOpenQuestionModal/0',
    'onOpenGroupInfoModal/0',
    'onOpenTestConfigModal/0',
    'onOpenStudyConfigModal/0',
    'handleChallengeUser/1',
    'handleMarkNotificationAsRead/1',
    'handleMarkAllNotificationsAsRead/0',
    'handleClearAllNotifications/0',
];

describe('useGroupHandlers surface', () => {
    it('takes exactly the parameters App.tsx passes', () => {
        expect(parameterKeys()).toEqual(FROZEN_PARAMETER_KEYS);
    });

    it('returns every handler App.tsx and ChatWindow read, with its arity', () => {
        expect(renderedSurface()).toEqual(FROZEN_SURFACE);
    });

    it('still exports MessageSendBusyError from this module path', async () => {
        // The composer clears the student's text before awaiting and restores it
        // only from a rejection, so ChatWindow has to be able to recognise this
        // class by identity (E3 H16). Re-exporting it is not optional.
        const module = await import('./useGroupHandlers');
        expect(typeof module.MessageSendBusyError).toBe('function');
        expect(new module.MessageSendBusyError().name).toBe('MessageSendBusyError');
    });
});
