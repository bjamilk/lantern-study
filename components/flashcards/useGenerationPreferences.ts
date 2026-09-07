/**
 * The options sheet's memory.
 *
 * The choices live in the student's own settings (`flashcardGeneration`, added
 * to the shared schema alongside this sheet), so a count picked on the laptop
 * is the count the phone opens with. The write goes through the same
 * category-patch endpoint every other setting uses; the read comes off the
 * auth store, which is where web keeps the signed-in profile.
 *
 * Signed out — or offline, or with the save rejected — the sheet still
 * remembers, in this browser only. Losing a remembered count is not worth a
 * failed generation or an error toast, so every path here is quiet.
 */
import { useCallback, useState } from 'react';
import {
  normalizeGenerationOptions,
  type FlashcardGenerationOptions,
} from '@lantern/shared/flashcards';
import { normalizeUserSettings } from '@lantern/shared/settings';
import { useAuthStore } from '../../stores/authStore';
import { saveUserSettingsDetailed } from '../../services/supabase';
import { clampToServerCount } from './generationOptions';

/** Mirror of the account setting, for signed-out use and first paint. */
export const LOCAL_GENERATION_OPTIONS_KEY = 'lantern.flashcardGeneration.v1';

function readLocal(): Partial<FlashcardGenerationOptions> | null {
  try {
    const raw = window.localStorage.getItem(LOCAL_GENERATION_OPTIONS_KEY);
    return raw ? (JSON.parse(raw) as Partial<FlashcardGenerationOptions>) : null;
  } catch {
    return null;
  }
}

function writeLocal(options: FlashcardGenerationOptions): void {
  try {
    window.localStorage.setItem(LOCAL_GENERATION_OPTIONS_KEY, JSON.stringify(options));
  } catch {
    // A blocked or full storage is not a reason to lose the generation.
  }
}

/**
 * Resolve the remembered options, whatever is available.
 *
 * Exported for the sheet's own tests: it is pure given its inputs.
 */
export function resolveRememberedOptions(
  fromSettings: unknown,
  fromLocal: unknown
): FlashcardGenerationOptions {
  const source =
    fromSettings && typeof fromSettings === 'object' ? fromSettings : (fromLocal ?? undefined);
  const normalized = normalizeGenerationOptions(source as Partial<FlashcardGenerationOptions>);
  // The count is clamped a second time against what THIS server honours, so a
  // 30 remembered from a future release cannot silently return 20 cards.
  return { ...normalized, count: clampToServerCount(normalized.count) };
}

export function useGenerationPreferences(): {
  options: FlashcardGenerationOptions;
  setOptions: (next: FlashcardGenerationOptions) => void;
  remember: (next: FlashcardGenerationOptions) => void;
} {
  const currentUser = useAuthStore((s) => s.currentUser);
  const setCurrentUser = useAuthStore((s) => s.setCurrentUser);
  const [options, setOptions] = useState<FlashcardGenerationOptions>(() =>
    resolveRememberedOptions(
      normalizeUserSettings(useAuthStore.getState().currentUser?.settings).flashcardGeneration,
      readLocal()
    )
  );

  const remember = useCallback(
    (next: FlashcardGenerationOptions) => {
      const normalized = resolveRememberedOptions(next, null);
      setOptions(normalized);
      writeLocal(normalized);
      if (!currentUser) return;
      const settings = normalizeUserSettings(currentUser.settings);
      // Optimistic, like every other settings write on web: the sheet closes
      // on the generation, not on the round trip.
      setCurrentUser({
        ...currentUser,
        settings: { ...settings, flashcardGeneration: normalized },
      });
      void saveUserSettingsDetailed(currentUser.id, { flashcardGeneration: normalized }).catch(
        () => {
          // The local mirror already holds it; a failed preference save is not
          // worth an error in front of a student who asked for flashcards.
        }
      );
    },
    [currentUser, setCurrentUser]
  );

  return { options, setOptions, remember };
}
