/**
 * Contract test for `hooks/groups/useNotificationHandlers`.
 *
 * What the hook promises, and what this file pins:
 *  - `addNotification` writes `{ user_id, message }` through `createNotification`
 *    and appends the SERVER row locally, so the item shows without waiting for
 *    the Realtime INSERT,
 *  - it never rejects: a notification that could not be written must not fail the
 *    action that triggered it, and four of the mutation hooks await it inside
 *    their success paths,
 *  - marking one read is OPTIMISTIC — the badge drops before the round trip —
 *    while mark-all and clear-all are SERVER-FIRST, so a failure leaves the
 *    student's unread items in place instead of silently emptying the list,
 *  - nothing here runs without a current user.
 *
 * Rendered through `hooks/effects/testing/hookHarness` (the web suite runs in
 * plain Node, with no jsdom).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactMock } from '../effects/testing/hookHarness';

vi.mock('react', () => reactMock);

const tx = vi.hoisted(() => ({
    createNotification: vi.fn(async (..._args: unknown[]) => ({ id: 'n-1', message: 'hi', read: false }) as any),
    markNotificationAsRead: vi.fn(async (..._args: unknown[]) => undefined),
    markAllNotificationsAsRead: vi.fn(async (..._args: unknown[]) => undefined),
    deleteAllNotifications: vi.fn(async (..._args: unknown[]) => undefined),
}));
vi.mock('../../services/supabase', () => ({ ...tx }));

const { renderHook } = await import('../effects/testing/hookHarness');
const { useNotificationHandlers } = await import('./useNotificationHandlers');

const CURRENT_USER = { id: 'user-1', name: 'Ada' } as any;

const flush = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

function mount(currentUser: any = CURRENT_USER) {
    const state = { notifications: [{ id: 'n-0', read: false }] as any[] };
    const setNotifications = vi.fn((next: any[]) => {
        state.notifications = next;
    });
    const harness = renderHook(() =>
        useNotificationHandlers({
            currentUser,
            updateNotifications: ((updater: any) => {
                state.notifications = updater(state.notifications);
            }) as any,
            setNotifications: setNotifications as any,
        }),
    );
    return { harness, state, setNotifications };
}

beforeEach(() => {
    vi.clearAllMocks();
    tx.createNotification.mockResolvedValue({ id: 'n-1', message: 'hi', read: false });
    tx.markNotificationAsRead.mockResolvedValue(undefined);
    tx.markAllNotificationsAsRead.mockResolvedValue(undefined);
    tx.deleteAllNotifications.mockResolvedValue(undefined);
});

describe('useNotificationHandlers', () => {
    it('returns the writer and the three list actions', () => {
        expect(Object.keys(mount().harness.result)).toEqual([
            'addNotification',
            'handleMarkNotificationAsRead',
            'handleMarkAllNotificationsAsRead',
            'handleClearAllNotifications',
        ]);
    });

    it('writes the notification for the current user and appends the server row', async () => {
        const { harness, state } = mount();
        await harness.result.addNotification('Bo joined Chem 101');

        expect(tx.createNotification).toHaveBeenCalledWith({
            user_id: 'user-1',
            message: 'Bo joined Chem 101',
        });
        expect(state.notifications.map((n) => n.id)).toEqual(['n-0', 'n-1']);
    });

    it('never rejects when the write fails, and appends nothing', async () => {
        tx.createNotification.mockRejectedValue(new Error('offline'));
        const { harness, state } = mount();

        await expect(harness.result.addNotification('anything')).resolves.toBeUndefined();
        expect(state.notifications.map((n) => n.id)).toEqual(['n-0']);
    });

    it('marks one read optimistically, before the round trip answers', async () => {
        let resolveCall: () => void = () => {};
        tx.markNotificationAsRead.mockImplementation(
            () => new Promise<undefined>((resolve) => { resolveCall = () => resolve(undefined); }),
        );
        const { harness, state } = mount();
        const pending = harness.result.handleMarkNotificationAsRead('n-0');
        await flush();

        expect(state.notifications[0].read).toBe(true);
        resolveCall();
        await pending;
    });

    it('mark-all and clear-all are server-first: a failure leaves the list intact', async () => {
        tx.markAllNotificationsAsRead.mockRejectedValue(new Error('offline'));
        tx.deleteAllNotifications.mockRejectedValue(new Error('offline'));
        const { harness, state, setNotifications } = mount();

        await harness.result.handleMarkAllNotificationsAsRead();
        expect(state.notifications[0].read).toBe(false);

        await harness.result.handleClearAllNotifications();
        expect(setNotifications).not.toHaveBeenCalled();
    });

    it('clears the list only once the server agrees', async () => {
        const { harness, setNotifications } = mount();
        await harness.result.handleClearAllNotifications();

        expect(tx.deleteAllNotifications).toHaveBeenCalledWith('user-1');
        expect(setNotifications).toHaveBeenCalledWith([]);
    });

    it('does nothing at all without a signed-in user', async () => {
        const { harness } = mount(null);
        await harness.result.addNotification('hi');
        await harness.result.handleMarkNotificationAsRead('n-0');
        await harness.result.handleMarkAllNotificationsAsRead();
        await harness.result.handleClearAllNotifications();

        expect(tx.createNotification).not.toHaveBeenCalled();
        expect(tx.markNotificationAsRead).not.toHaveBeenCalled();
        expect(tx.markAllNotificationsAsRead).not.toHaveBeenCalled();
        expect(tx.deleteAllNotifications).not.toHaveBeenCalled();
    });
});
