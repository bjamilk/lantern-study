/**
 * "Remember what I picked last time" for the generation sheet.
 *
 * Stored under `settings.flashcardGeneration` — the shared category — so the
 * preference travels with every other setting instead of becoming a private
 * AsyncStorage island, and so web and mobile remember the same thing.
 *
 * Only `count` and `typeMix` live there. Difficulty and answer style are
 * per-run steers, not preferences: a student who wanted a detailed run once
 * has not asked for every future run to be detailed.
 *
 * THE MIRROR
 * ----------
 * The sync round trip drops this category today — the server's settings PUT
 * filters through a hardcoded allowlist that the deployed build does not have
 * `flashcardGeneration` in, and the store then takes the server's reply as
 * authoritative — so the choice reverted to 20 + "A mix" within seconds of
 * being made. The device therefore also keeps its own copy under one
 * AsyncStorage key, and `resolveRememberedGeneration` decides which of the two
 * to open on: settings still wins whenever it carries a real choice. When the
 * server learns the category the mirror simply stops being the one consulted;
 * nothing has to be unwound.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_FLASHCARD_GENERATION_OPTIONS,
  type FlashcardGenerationOptions,
} from '@lantern/shared/flashcards/generationOptions';
import { useSettingsStore } from '../../stores/settingsStore';
import { resolveRememberedGeneration } from './rememberedGenerationRule';

export const REMEMBERED_GENERATION_KEY = 'lantern.flashcards.lastGeneration';

/** The device mirror, once read. `undefined` means "not read yet". */
let mirror: FlashcardGenerationOptions | undefined;

function storedGeneration(): unknown {
  try {
    return useSettingsStore.getState().settings.flashcardGeneration;
  } catch {
    // A settings store that has not loaded is not a reason to block the sheet.
    return undefined;
  }
}

/**
 * Last used options, sanitised, falling back to the shared defaults.
 *
 * Synchronous, so the sheet can paint its chips on the first frame. On a cold
 * start the mirror may not be loaded yet — {@link hydrateRememberedGeneration}
 * is how a caller waits for it.
 */
export function readRememberedGeneration(): FlashcardGenerationOptions {
  try {
    return resolveRememberedGeneration({ stored: storedGeneration(), mirrored: mirror });
  } catch {
    return DEFAULT_FLASHCARD_GENERATION_OPTIONS;
  }
}

/**
 * Read the device mirror off disk (once), then resolve.
 *
 * Never rejects: a sheet must open whatever storage does.
 */
export async function hydrateRememberedGeneration(): Promise<FlashcardGenerationOptions> {
  if (mirror === undefined) {
    try {
      const raw = await AsyncStorage.getItem(REMEMBERED_GENERATION_KEY);
      if (raw) mirror = JSON.parse(raw) as FlashcardGenerationOptions;
    } catch {
      // Unreadable or absent: the settings store answers on its own.
    }
  }
  return readRememberedGeneration();
}

/**
 * Remember this run's choices.
 *
 * Never awaited and never thrown from: storing a preference must not be able
 * to fail a generation the student has already paid for.
 */
export function rememberGeneration(options: FlashcardGenerationOptions): void {
  const remembered = { count: options.count, typeMix: options.typeMix };
  mirror = { ...remembered };
  try {
    void AsyncStorage.setItem(REMEMBERED_GENERATION_KEY, JSON.stringify(remembered)).catch(
      () => {}
    );
  } catch {
    // As above.
  }
  try {
    void useSettingsStore
      .getState()
      .updateSettings('flashcardGeneration', remembered)
      .catch(() => {});
  } catch {
    // As above.
  }
}

/** Test seam: forget what this module has read from disk. */
export function __resetRememberedGenerationMirror(): void {
  mirror = undefined;
}
