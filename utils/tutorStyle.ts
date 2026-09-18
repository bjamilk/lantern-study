/**
 * The account half of the companion's tutor-style picker.
 *
 * Exports: `currentTutorStyleId` (what the header and the picker read) and
 * `setTutorStyle` (the one call the picker makes).
 * Touches: `useAuthStore.currentUser.settings` (the in-memory profile) and
 *  `saveUserSettingsDetailed` (a `tutorStyle`-only settings patch, the same
 *  shape `featureTipStore` sends for `featureTips` and `onboardingVisited.ts`
 *  sends for the checklist flags).
 *
 * Why it is here and not in the panel: `AICompanionPanel` is a 2100-line
 * component that cannot be mounted in a test; a preference that is written from
 * inside it is a preference with no proving test. This module is pure except
 * for the one fire-and-forget save, and `tutorStyle.test.ts` drives it directly.
 *
 * Gotchas:
 *  - WRITE-THROUGH, not write-behind. The in-memory profile is updated
 *    synchronously so the header chip and the next send both see the new style
 *    immediately; the network save follows and is not awaited. A failed save is
 *    logged, not toasted — the student has nothing to act on, the style is
 *    already in effect on this device, and the next pick re-sends.
 *  - It applies to the NEXT message, never to one already sent. Nothing
 *    rewrites a reply that has already been written.
 *  - Category patch only (`{ tutorStyle }`), so a concurrent theme or checklist
 *    save is not clobbered — the server deep-merges.
 *  - Signed out, `setTutorStyle` does nothing rather than throwing: the picker
 *    is reachable from a rail that can render before the profile lands.
 */
import {
  DEFAULT_TUTOR_STYLE_ID,
  normalizeTutorStyleId,
  type TutorStyleId,
} from '@lantern/shared/ai';
import { saveUserSettingsDetailed } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

/**
 * The style this account is on, read off the profile in memory.
 *
 * Takes the settings blob rather than reading the store itself, so the panel
 * can subscribe to `currentUser.settings` and re-render when it changes.
 */
export function currentTutorStyleId(settings: unknown): TutorStyleId {
  if (!settings || typeof settings !== 'object') return DEFAULT_TUTOR_STYLE_ID;
  return normalizeTutorStyleId((settings as { tutorStyle?: unknown }).tutorStyle);
}

/**
 * Pick a style: update the profile in memory, then send the patch.
 *
 * Returns the id that was actually applied, so a caller that passed junk (or
 * nothing) is told what the student is now on rather than assuming.
 */
export function setTutorStyle(styleId: unknown): TutorStyleId {
  const next = normalizeTutorStyleId(styleId);
  const user = useAuthStore.getState().currentUser;
  if (!user?.id) return next;

  const settings =
    user.settings && typeof user.settings === 'object'
      ? (user.settings as unknown as Record<string, unknown>)
      : {};
  // Only this key changes. The rest of the blob is carried forward untouched so
  // an unrelated preference held in memory is not dropped on the way past.
  useAuthStore.getState().setCurrentUser({
    ...user,
    settings: {
      ...settings,
      tutorStyle: next,
      updatedAt: new Date().toISOString(),
    },
  } as typeof user);

  void saveUserSettingsDetailed(user.id, { tutorStyle: next }).then((result) => {
    if (!result.ok) {
      // Not surfaced: the style is already in effect on this device and the
      // next pick re-sends. Nothing for the student to do about it.
      console.warn('Failed to save tutor style preference');
    }
  });

  return next;
}
