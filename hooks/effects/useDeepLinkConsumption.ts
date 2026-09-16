/**
 * Consumes an entry into the app that came from outside it.
 *
 * Today that is exactly one source: a click on an OS notification, including
 * one the service worker delivered while the tab was closed. The click carries
 * a `navigate` intent, and this hook is what turns it into an AppMode — without
 * it the click focuses a window that then shows whatever was last on screen.
 *
 * Exports: useDeepLinkConsumption() → void.
 * Touches: utils/webNotifications' click channel, `window.focus()`, and
 *  `setAppMode` on stores/uiStore.
 * Gotcha: the handler is registered once and torn down through the unsubscribe
 *  the channel returns — re-registering per render would deliver one click
 *  several times.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effect registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import { AppMode } from '../../types';
import { useUIStore } from '../../stores/uiStore';
import { onWebNotificationClick } from '../../utils/webNotifications';

export function useDeepLinkConsumption(): void {
    const { setAppMode } = useUIStore();

    // Routes a click on an OS notification (including one delivered by the service worker
    // while the tab was closed) into the app. Re-runs only if setAppMode changes identity.
    useEffect(() => {
        return onWebNotificationClick((data) => {
            if (data.navigate === 'flashcards') {
                window.focus();
                setAppMode(AppMode.FLASHCARDS);
            }
        });
    }, [setAppMode]);
}
