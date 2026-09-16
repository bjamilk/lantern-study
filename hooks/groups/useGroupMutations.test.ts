/**
 * Contract test for `hooks/groups/useGroupMutations`.
 *
 * What the hook promises, and what this file pins:
 *  - each callback hits its own transport function with the expected arguments:
 *    `updateGroup`, `uploadGroupAvatar`, `promoteGroupAdmin`, `demoteGroupAdmin`,
 *    `removeGroupMember`, `leaveGroup`, `deleteGroup`, `acceptGroupInvite`,
 *    `declineGroupInvite`, `fetchGroupMembers`.
 *  - the two rules that protect a group from being left unusable: the SOLE admin
 *    can neither be demoted nor leave, and neither path reaches the server.
 *  - every destructive path is CONFIRMED first, and a declined confirm writes
 *    nothing.
 *  - deleting a parent cascades to its subgroups (`getAllSubgroupIDs`), which
 *    archive deliberately does not.
 *  - a mutation patches BOTH the list row and the open selection, so a group the
 *    student is looking at does not keep rendering its old row.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    createGroup: vi.fn(async (..._args: unknown[]) => ({ id: 'group-new' }) as any),
    fetchGroups: vi.fn(async (..._args: unknown[]) => [] as any),
    fetchGroupMembers: vi.fn(async (..._args: unknown[]) => [] as any),
    addGroupMember: vi.fn(async (..._args: unknown[]) => undefined as any),
    addGroupMembersBatch: vi.fn(async (..._args: unknown[]) => undefined as any),
    uploadGroupAvatar: vi.fn(async (..._args: unknown[]) => 'https://cdn/avatar.png' as any),
    acceptGroupInvite: vi.fn(async (..._args: unknown[]) => ({ id: 'group-1' }) as any),
    declineGroupInvite: vi.fn(async (..._args: unknown[]) => undefined as any),
    createNotification: vi.fn(async (..._args: unknown[]) => undefined as any),
    updateUserProfile: vi.fn(async (..._args: unknown[]) => undefined as any),
    deleteGroup: vi.fn(async (..._args: unknown[]) => undefined as any),
    updateGroup: vi.fn(async (..._args: unknown[]) => undefined as any),
    promoteGroupAdmin: vi.fn(async (..._args: unknown[]) => ({ adminIds: ['user-1', 'user-2'] }) as any),
    demoteGroupAdmin: vi.fn(async (..._args: unknown[]) => ({ adminIds: ['user-1'] }) as any),
    removeGroupMember: vi.fn(async (..._args: unknown[]) => undefined as any),
    leaveGroup: vi.fn(async (..._args: unknown[]) => undefined as any),
    fetchUserVotesForGroup: vi.fn(async (..._args: unknown[]) => ({}) as any),
    fetchMessages: vi.fn(async (..._args: unknown[]) => [] as any),
    markGroupAsRead: vi.fn(async (..._args: unknown[]) => undefined as any),
}));

const deps = vi.hoisted(() => ({
    confirmDialog: vi.fn(async (..._args: unknown[]) => true),
    syncGamificationProgress: vi.fn(async () => ({ points: 0, badges: [], stats: {}, awardedBadges: [] }) as any),
    navigateForAppMode: vi.fn(),
    showToast: vi.fn(),
}));

vi.mock('../../services/supabase', () => ({ ...tx }));
vi.mock('../../stores/confirmStore', () => ({ confirmDialog: deps.confirmDialog }));
vi.mock('../../services/gamificationStreak', () => ({
    syncGamificationProgress: deps.syncGamificationProgress,
}));
vi.mock('../../utils/appNavigation', () => ({ navigateForAppMode: deps.navigateForAppMode }));
vi.mock('../../stores/toastStore', () => {
    const state = { showToast: deps.showToast };
    const hook = (() => state) as (() => typeof state) & { getState: () => typeof state };
    hook.getState = () => state;
    return { useToastStore: hook };
});
vi.mock('../../stores/groupStore', () => {
    const state = { groups: [] as any[], messages: {} as Record<string, any[]> };
    const hook = (() => state) as (() => typeof state) & { getState: () => typeof state };
    hook.getState = () => state;
    return { useGroupStore: hook };
});
vi.mock('../../stores/uiStore', () => {
    const state = { selectedChat: null as any };
    const hook = (() => state) as (() => typeof state) & { getState: () => typeof state };
    hook.getState = () => state;
    return { useUIStore: hook };
});

const { renderHook } = await import('../effects/testing/hookHarness');
const { useGroupMutations } = await import('./useGroupMutations');

// Several failure paths report through the browser's blocking alert(); plain Node has none.
(globalThis as { alert?: (message?: unknown) => void }).alert = () => {};

const CURRENT_USER = { id: 'user-1', name: 'Ada', stats: {}, points: 0, badges: [] } as any;

const group = (overrides: Record<string, unknown> = {}) =>
    ({
        id: 'group-1',
        name: 'Organic Chem',
        description: 'Week 4',
        adminIds: ['user-1', 'user-2'],
        members: [{ id: 'user-1' }, { id: 'user-2' }],
        isArchived: false,
        ...overrides,
    }) as any;

function mount(options: { groups?: any[]; selectedChat?: any } = {}) {
    const state = {
        groups: options.groups ?? [group()],
        messages: { 'group-1': [{ id: 'msg-1' }] } as Record<string, any[]>,
    };
    const setSelectedChat = vi.fn();
    const closeModal = vi.fn();

    const harness = renderHook(() =>
        useGroupMutations({
            currentUser: CURRENT_USER,
            setCurrentUser: vi.fn() as any,
            users: [{ id: 'user-2', name: 'Grace' }] as any,
            groups: state.groups as any,
            updateGroups: ((updater: any) => {
                state.groups = updater(state.groups);
            }) as any,
            updateMessages: ((updater: any) => {
                state.messages = updater(state.messages);
            }) as any,
            selectedChat:
                options.selectedChat !== undefined
                    ? options.selectedChat
                    : ({ ...group(), chatType: 'group' } as any),
            setSelectedChat: setSelectedChat as any,
            setAppMode: vi.fn() as any,
            openModal: vi.fn() as any,
            closeModal: closeModal as any,
            setSubgroupParentId: vi.fn() as any,
            handleSelectChat: vi.fn(),
            addNotification: vi.fn(async () => undefined),
        }),
    );

    return { harness, state, setSelectedChat, closeModal };
}

beforeEach(() => {
    for (const fn of Object.values(tx)) fn.mockClear();
    deps.confirmDialog.mockClear().mockResolvedValue(true);
    deps.showToast.mockClear();
});

describe('useGroupMutations', () => {
    it('returns every group handler the composer re-exports, in order', () => {
        expect(Object.keys(mount().harness.result)).toEqual([
            'handleCloseCreateGroupModal',
            'handleCreateSubGroup',
            'handleCreateGroup',
            'handleEnterCreatedGroup',
            'onOpenCreateSubGroupModal',
            'handleUpdateGroupDetails',
            'handleUpdateGroupAvatar',
            'refreshGroupMembersInState',
            'handleInviteMembers',
            'handleAcceptGroupInvite',
            'handleDeclineGroupInvite',
            'handleRevokeInvitation',
            'handleRevokePhoneInvitation',
            'handlePromoteToAdmin',
            'handleDemoteAdmin',
            'handleRemoveGroupMember',
            'handleLeaveGroup',
            'getAllSubgroupIDs',
            'handleDeleteGroup',
            'handleToggleArchiveGroup',
            'handleApproveMember',
            'handleRejectMember',
        ]);
    });

    it('updates details through updateGroup and patches both the row and the open chat', async () => {
        const { harness, state, setSelectedChat } = mount();
        await harness.result.handleUpdateGroupDetails('group-1', 'Physical Chem', 'Week 5');

        expect(tx.updateGroup).toHaveBeenCalledWith('group-1', {
            name: 'Physical Chem',
            description: 'Week 5',
        });
        expect(state.groups[0]).toMatchObject({ name: 'Physical Chem', description: 'Week 5' });
        expect(setSelectedChat).toHaveBeenCalled();
    });

    it('uploads an avatar through uploadGroupAvatar', async () => {
        const { harness } = mount();
        await harness.result.handleUpdateGroupAvatar('group-1', 'data:image/png;base64,AAA');
        expect(tx.uploadGroupAvatar).toHaveBeenCalled();
        expect((tx.uploadGroupAvatar.mock.calls[0] as any[])[0]).toBe('group-1');
    });

    it('promotes and demotes through their own endpoints', async () => {
        const { harness } = mount();
        await harness.result.handlePromoteToAdmin('group-1', 'user-2');
        await harness.result.handleDemoteAdmin('group-1', 'user-2');

        expect(tx.promoteGroupAdmin).toHaveBeenCalledWith('group-1', 'user-2');
        expect(tx.demoteGroupAdmin).toHaveBeenCalledWith('group-1', 'user-2');
    });

    it('refuses to demote the only admin, without reaching the server', async () => {
        const { harness } = mount({ groups: [group({ adminIds: ['user-2'] })] });
        await harness.result.handleDemoteAdmin('group-1', 'user-2');
        expect(tx.demoteGroupAdmin).not.toHaveBeenCalled();
    });

    it('refuses to let the only admin leave, without reaching the server', async () => {
        const { harness } = mount({ groups: [group({ adminIds: ['user-1'] })] });
        await harness.result.handleLeaveGroup('group-1');

        expect(tx.leaveGroup).not.toHaveBeenCalled();
        expect(deps.showToast).toHaveBeenCalledWith(expect.stringContaining('only admin'), 'error');
    });

    it('confirms before leaving, and writes nothing when the student declines', async () => {
        const { harness, state } = mount();
        deps.confirmDialog.mockResolvedValueOnce(false);
        await harness.result.handleLeaveGroup('group-1');

        expect(deps.confirmDialog).toHaveBeenCalled();
        expect(tx.leaveGroup).not.toHaveBeenCalled();
        expect(state.groups).toHaveLength(1);
    });

    it('leaves through leaveGroup and drops the group and its cached messages', async () => {
        const { harness, state, closeModal } = mount();
        await harness.result.handleLeaveGroup('group-1');

        expect(tx.leaveGroup).toHaveBeenCalledWith('group-1');
        expect(state.groups).toHaveLength(0);
        expect(state.messages['group-1']).toBeUndefined();
        expect(closeModal).toHaveBeenCalledWith('groupInfo');
    });

    it('removes a member through removeGroupMember but never the student themselves', async () => {
        const { harness } = mount();
        await harness.result.handleRemoveGroupMember('group-1', 'user-1');
        expect(tx.removeGroupMember).not.toHaveBeenCalled();

        await harness.result.handleRemoveGroupMember('group-1', 'user-2');
        expect(tx.removeGroupMember).toHaveBeenCalledWith('group-1', 'user-2');
    });

    it('cascades a delete to every subgroup of the deleted parent', async () => {
        const { harness, state } = mount({
            groups: [group(), group({ id: 'group-2', parentId: 'group-1', adminIds: ['user-1'] })],
        });
        expect(harness.result.getAllSubgroupIDs('group-1', state.groups as any)).toEqual(['group-2']);

        await harness.result.handleDeleteGroup('group-1');
        expect(tx.deleteGroup).toHaveBeenCalledWith('group-1');
        expect(tx.deleteGroup).toHaveBeenCalledWith('group-2');
        expect(state.groups).toHaveLength(0);
    });

    it('archives WITHOUT cascading to subgroups', async () => {
        const { harness, state } = mount({
            groups: [group(), group({ id: 'group-2', parentId: 'group-1' })],
        });
        await harness.result.handleToggleArchiveGroup('group-1');

        expect(tx.updateGroup).toHaveBeenCalledWith('group-1', { isArchived: true });
        expect(state.groups[1]).toMatchObject({ id: 'group-2', isArchived: false });
    });

    it('accepts and declines an invite through their own endpoints', async () => {
        const { harness } = mount();
        await harness.result.handleAcceptGroupInvite('group-1');
        await harness.result.handleDeclineGroupInvite('group-1');

        expect(tx.acceptGroupInvite).toHaveBeenCalledWith('group-1');
        expect(tx.declineGroupInvite).toHaveBeenCalledWith('group-1');
    });

    it('busts the roster cache by refetching members', async () => {
        const { harness } = mount();
        await harness.result.refreshGroupMembersInState('group-1');
        expect(tx.fetchGroupMembers).toHaveBeenCalledWith('group-1', { bustCache: true });
    });
});
