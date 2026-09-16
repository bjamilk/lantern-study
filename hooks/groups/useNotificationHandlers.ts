/**
 * The notification handlers, extracted verbatim from `hooks/useGroupHandlers.ts`.
 *
 * Exports: useNotificationHandlers({ … }) — `addNotification` (write one for the
 *  current user), plus the three list actions the notifications sheet calls:
 *  `handleMarkNotificationAsRead`, `handleMarkAllNotificationsAsRead` and
 *  `handleClearAllNotifications`.
 * Touches: services/supabase (`createNotification`, `markNotificationAsRead`,
 *  `markAllNotificationsAsRead`, `deleteAllNotifications`) and the group store's
 *  `updateNotifications` / `setNotifications`.
 * Composition position, and why: called FIRST in the composer, before every
 *  other groups hook, because `addNotification` is a parameter of
 *  useMessageHandlers, useGroupMutations, useBoardHandlers and useVoteHandlers —
 *  it was the first thing the composer defined for exactly that reason. It
 *  registers no effect, so the position is free.
 * Gotchas:
 *  - `addNotification` swallows its failures and never rejects. A notification
 *    that could not be written must not fail the action that triggered it, and
 *    every caller awaits it inside a success path.
 *  - Single-read is OPTIMISTIC (the badge has to drop instantly). Mark-all and
 *    clear-all are SERVER-FIRST: the list is only emptied once the server
 *    agrees, because emptying it wrongly loses the student's unread items with
 *    no way back.
 */
import { useCallback } from 'react';
import {
    createNotification,
    markNotificationAsRead, markAllNotificationsAsRead, deleteAllNotifications,
} from '../../services/supabase';
import type { AuthStoreState, GroupStoreState } from './types';

export interface UseNotificationHandlersParams
    extends Pick<AuthStoreState, 'currentUser'>,
        Pick<GroupStoreState, 'updateNotifications' | 'setNotifications'> {}

export function useNotificationHandlers({
    currentUser,
    updateNotifications,
    setNotifications,
}: UseNotificationHandlersParams) {
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

    return {
        addNotification,
        handleMarkNotificationAsRead,
        handleMarkAllNotificationsAsRead,
        handleClearAllNotifications,
    };
}
