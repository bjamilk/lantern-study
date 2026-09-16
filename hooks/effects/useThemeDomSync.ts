/**
 * Applies the resolved theme to the document.
 *
 * Exports: useThemeDomSync({ currentUser }) → void.
 * Touches: the `dark` class on <html> and the localStorage 'theme' key; reads
 *  `theme` from stores/uiStore.
 * Gotcha: toggling the `dark` class IS the whole theme switch — every colour
 *  value lives in index.css. Signed-out visitors are forced to light WITHOUT
 *  writing storage, so the landing and auth screens cannot overwrite a signed-in
 *  student's saved preference.
 *
 * Extracted verbatim from hooks/useAppEffects.ts; the composer calls this in the
 * same position the effect ran in (see apps/web/src/useAppEffects.surface.test.ts).
 */
import { useEffect } from 'react';
import type { User } from '../../types';
import { useUIStore } from '../../stores/uiStore';

interface UseThemeDomSyncParams {
    currentUser: User | null;
}

export function useThemeDomSync({ currentUser }: UseThemeDomSyncParams): void {
    const { theme } = useUIStore();

    // --- Theme sync to DOM (signed-out visitors always see light — landing & auth) ---
    // Re-runs on theme / currentUser. Toggling the `dark` class IS the whole theme switch;
    // nothing here writes colour values. The stored 'theme' key is only updated while signed
    // in, so forcing light for a visitor does not overwrite their saved preference.
    useEffect(() => {
        const effectiveTheme = currentUser ? theme : 'light';
        if (effectiveTheme === 'dark') {
            document.documentElement.classList.add('dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            if (currentUser) {
                localStorage.setItem('theme', 'light');
            }
        }
    }, [theme, currentUser]);
}
