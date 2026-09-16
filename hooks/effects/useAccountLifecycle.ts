/**
 * Everything the app has to do when the signed-in account changes.
 *
 * Four effects, in the order they must keep: purge another account's offline
 * queues, apply this account's appearance settings to the DOM, reconcile its
 * canonical settings with the server, and — once onboarding is out of the way —
 * ask for anything the profile is still missing.
 *
 * Exports: useAccountLifecycle({ currentUser, authTokenReady, setCurrentUser }) → void.
 * Touches: services/offlineQueueOwner, the test and flashcard stores' queues,
 *  utils/applyUserSettingsToDom, fetchUserSettings (services/supabase),
 *  `openModal`/`setTheme`/`setLowDataMode` on stores/uiStore, the localStorage
 *  'theme' key and the onboarding flag.
 * Gotchas:
 *  - The purge runs on `currentUser.id` ONLY and must stay that way: it has to
 *    land before the persist/sync effects observe the queue, and it clears
 *    through getState() rather than the render-scope arrays, which are the
 *    PRE-purge snapshot on that same commit.
 *  - The appearance effect depends on the appearance/accessibility SUB-OBJECTS,
 *    not on the whole settings object — depending on the whole thing re-applies
 *    the DOM on every privacy/study keystroke while Settings is open.
 *  - The settings sync re-reads the store after its await and id-checks it, so a
 *    slow response cannot write one account's settings into another's session.
 *
 * Extracted verbatim from hooks/useAppEffects.ts, comments included; the composer
 * calls this where the effects registered (apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import type { User } from '../../types';
import { useAuthStore } from '../../stores/authStore';
import { useFlashcardStore } from '../../stores/flashcardStore';
import { useTestStore } from '../../stores/testStore';
import { useUIStore } from '../../stores/uiStore';
import { fetchUserSettings } from '../../services/supabase';
import { ensureOfflineQueueOwner } from '../../services/offlineQueueOwner';
import {
    ONBOARDING_COMPLETE_STORAGE_KEY,
    isOnboardingCompleteFlag,
    normalizeUserSettings,
} from '@lantern/shared/settings';
import { applyUserSettingsToDom } from '../../utils/applyUserSettingsToDom';
import { shouldOpenAcademicSetup, readAcademicSetupDismissed } from '../../utils/academicSetup';

/**
 * Onboarding has not been finished or skipped yet — the same flag App.tsx
 * seeds `showOnboarding` from. Read live rather than passed in, because the
 * profile-setup effect runs long before App has a value to hand down.
 *
 * A browser that refuses localStorage answers "not pending", so a student in a
 * locked-down browser still gets asked for a missing username.
 */
function isOnboardingPending(): boolean {
    try {
        return !isOnboardingCompleteFlag(localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY));
    } catch {
        return false;
    }
}

interface UseAccountLifecycleParams {
    currentUser: User | null;
    authTokenReady: boolean;
    setCurrentUser: (user: User | null) => void;
}

export function useAccountLifecycle({
    currentUser,
    authTokenReady,
    setCurrentUser,
}: UseAccountLifecycleParams): void {
    const { setTheme, setLowDataMode, openModal } = useUIStore();

    // Cross-account guard: the offline queues live under fixed localStorage
    // keys and survive logout — before this, signing in as another user on the
    // same browser replayed the previous user's queued test results, flashcard
    // reviews, and qbank scores INTO the new account. Purge foreign queues
    // (storage AND the already-hydrated store copies) before any sync runs.
    // Re-runs on currentUser.id ONLY, and must stay that way: it has to land before the
    // sync/persist effects below observe the queue. It clears through getState() rather than
    // the render-scope arrays, which are the pre-purge snapshot on this same commit.
    useEffect(() => {
        if (!currentUser?.id) return;
        if (ensureOfflineQueueOwner(currentUser.id)) {
            useTestStore.getState().setPendingSyncResults([]);
            useFlashcardStore.getState().clearPendingReviews();
        }
    }, [currentUser?.id]);

    // --- Theme / appearance DOM sync (not privacy/study — avoids re-render storms while Settings is open) ---
    // Re-runs on currentUser.id plus the appearance/accessibility SUB-OBJECTS only —
    // depending on the whole settings object would re-apply the DOM on every privacy/study
    // keystroke while the Settings screen is open. Signed out (or settings not loaded yet)
    // it falls back to the localStorage 'theme' value, toggling the `dark` class and nothing
    // else; colour values themselves stay in index.css.
    const appearanceSettings = currentUser?.settings?.appearance;
    const accessibilitySettings = currentUser?.settings?.accessibility;
    useEffect(() => {
        if (currentUser?.settings) {
            applyUserSettingsToDom(normalizeUserSettings(currentUser.settings), {
                setTheme,
                setLowDataMode,
            });
            return;
        }

        const storedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
        if (storedTheme) {
            setTheme(storedTheme);
            document.documentElement.classList.toggle('dark', storedTheme === 'dark');
        } else {
            setTheme('light');
            document.documentElement.classList.remove('dark');
        }
    }, [currentUser?.id, appearanceSettings, accessibilitySettings, setTheme, setLowDataMode]);

    // --- Sync canonical settings from API (cross-device) ---
    // Re-runs on currentUser.id + authTokenReady (one fetch per signed-in session, not per
    // settings edit). Last-write-wins by `updatedAt`, ties going to the server. The store is
    // re-read after the await and id-checked, so a slow response cannot write another
    // account's settings; `cancelled` covers unmount/user-switch mid-flight.
    useEffect(() => {
        if (!currentUser?.id || !authTokenReady) return;

        let cancelled = false;

        void (async () => {
            const remote = await fetchUserSettings(currentUser.id);
            if (cancelled || !remote) return;

            const user = useAuthStore.getState().currentUser;
            if (!user || user.id !== currentUser.id) return;

            const local = normalizeUserSettings(user.settings);
            const localTime = Date.parse(local.updatedAt || '') || 0;
            const remoteTime = Date.parse(remote.updatedAt || '') || 0;
            // Prefer remote when timestamps are equal/newer; local only wins if clearly newer.
            const merged = remoteTime >= localTime ? remote : local;

            if (JSON.stringify(merged) !== JSON.stringify(local)) {
                setCurrentUser({ ...user, settings: merged });
            }
            applyUserSettingsToDom(merged, { setTheme, setLowDataMode });
        })();

        return () => {
            cancelled = true;
        };
    }, [currentUser?.id, authTokenReady]);

    // --- Profile setup check (username, and academic identity once per dismissal) ---
    // Re-runs on currentUser.id / .username / .institutionId — i.e. exactly the fields that
    // can satisfy the check, so completing setup closes the prompt without a reload.
    // The onboarding flag is read live from localStorage, not from a dep.
    useEffect(() => {
        if (!currentUser) return;
        // A brand-new account used to meet TWO setup forms back to back: the
        // skippable "Set up your profile" modal, and then onboarding's required
        // academic step asking for the same institution. Onboarding goes first
        // and asks for everything it needs; App.tsx re-runs this check the
        // moment onboarding finishes, so anything still missing (a username, on
        // an account that never had one) is asked for exactly once, afterwards.
        if (isOnboardingPending()) return;
        if (typeof window !== 'undefined' && window.location.pathname.startsWith('/teach')) {
            if (!currentUser.username) openModal('usernameRequired');
            return;
        }
        if (shouldOpenAcademicSetup(currentUser, readAcademicSetupDismissed(currentUser.id))) {
            openModal('usernameRequired');
        }
    }, [currentUser?.id, currentUser?.username, currentUser?.institutionId]);
}
