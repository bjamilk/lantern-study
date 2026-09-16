/**
 * The SRS reminder loop: the due-cards badge and the OS "cards due" reminder.
 *
 * Exports: useSrsReminders({ currentUser }) → void.
 * Touches: utils/webNotifications (permission, throttle, claim, show), the
 *  flashcard store's `setDueCardsCount`, and `setAppMode` for the toast's click
 *  handler; reads `lowDataMode` from stores/uiStore.
 * Gotchas:
 *  - Use shared `getCardsDue` ONCE — adding "new" + "date-due" double-counts
 *    Again/new cards.
 *  - Four gates stand before a toast: reminders enabled, permission granted,
 *    throttle window elapsed, and a claim (beginSrsWebReminderSend) that
 *    remount/visibility churn cannot double-fire.
 *  - The card list is read from the store rather than a dependency, so the
 *    callback identity — and therefore the hourly interval — does not churn on
 *    every review.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useCallback, useEffect } from 'react';
import { AppMode } from '../../types';
import type { User } from '../../types';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useUIStore } from '../../stores/uiStore';
import { getNotificationSettings, normalizeUserSettings } from '@lantern/shared/settings';
import { getCardsDue } from '@lantern/shared/utils';
import {
  beginSrsWebReminderSend,
  getWebNotificationPermission,
  markSrsWebReminderSent,
  requestWebNotificationPermission,
  shouldSendSrsWebReminder,
  showWebNotification,
} from '../../utils/webNotifications';

interface UseSrsRemindersParams {
    currentUser: User | null;
}

export function useSrsReminders({ currentUser }: UseSrsRemindersParams): void {
    const { flashcards, setDueCardsCount } = useFlashcardStore();
    const { setAppMode, lowDataMode } = useUIStore();

    // --- SRS Notifications ---
    // Use shared isCardDue once — do not add "new" + "date-due" (double-counts Again/new cards).
    // OS toasts only when the tab is in the background and throttled — studying notes/flashcards
    // must not keep popping "cards due" notifications.
    const srsRemindersEnabled = Boolean(
        currentUser &&
            getNotificationSettings(normalizeUserSettings(currentUser.settings)).srsReminders
    );
    const srsUserId = currentUser?.id ?? null;

    // Reads the card list from the store rather than a dep so the callback identity (and
    // therefore the interval below) does not churn on every review. Four gates before a
    // toast is shown: reminders enabled, permission granted, throttle window elapsed, and a
    // claim (beginSrsWebReminderSend) that remount/visibility churn cannot double-fire.
    const checkForDueCardsAndNotify = useCallback(() => {
        if (!srsUserId || !srsRemindersEnabled) return;
        const cards = useFlashcardStore.getState().flashcards;
        if (!cards.length) return;

        const totalDue = getCardsDue(cards).length;
        if (getWebNotificationPermission() !== 'granted') return;
        if (!shouldSendSrsWebReminder(totalDue, Date.now(), srsUserId)) return;
        // Claim + persist before the async show path so remount / visibility churn cannot spam.
        if (!beginSrsWebReminderSend(srsUserId)) return;
        markSrsWebReminderSent(totalDue, Date.now(), srsUserId);

        void showWebNotification({
            title: 'Flashcard Review Due',
            body: `You have ${totalDue} flashcards ready for review.`,
            icon: '/favicon.ico',
            tag: 'srs-reminder',
            data: { navigate: 'flashcards' },
            onClick: () => {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
            },
        });
    }, [srsUserId, srsRemindersEnabled, setAppMode]);
    // Keep due-count badge in sync without notifying on every card review.
    // Re-runs on currentUser.id and the flashcards array identity (every review rewrites it).
    // FIXED (F9): the early return on an EMPTY card list meant the badge was
    // never reset — after deleting the last deck, or on a user switch that
    // cleared the store, the previous count (the previous STUDENT's count, on a
    // shared browser) stayed on the nav badge until some other write happened
    // to set it. An empty list is a real answer: zero due.
    useEffect(() => {
        if (!currentUser) {
            setDueCardsCount(0);
            return;
        }
        setDueCardsCount(flashcards.length ? getCardsDue(flashcards).length : 0);
    }, [currentUser?.id, flashcards, setDueCardsCount]);

    // SRS reminder scheduler. Re-runs on srsUserId / checkForDueCardsAndNotify / lowDataMode.
    // Two triggers: the tab going HIDDEN (a reminder is only useful in the background) and an
    // hourly interval — which low-data mode skips entirely, keeping only the visibility hook.
    useEffect(() => {
        if (!srsUserId) return;

        // Ask once when permission is still undecided.
        if (getWebNotificationPermission() === 'default') {
            void requestWebNotificationPermission();
        }

        const maybeNotify = () => {
            checkForDueCardsAndNotify();
        };

        // Initial check (no-ops while tab visible).
        maybeNotify();

        const onVisibility = () => {
            // When the user leaves the tab, consider a background reminder.
            if (document.visibilityState === 'hidden') {
                maybeNotify();
            }
        };
        document.addEventListener('visibilitychange', onVisibility);

        if (lowDataMode) {
            return () => document.removeEventListener('visibilitychange', onVisibility);
        }

        const interval = setInterval(maybeNotify, 60 * 60 * 1000);
        return () => {
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [srsUserId, checkForDueCardsAndNotify, lowDataMode]);
}
