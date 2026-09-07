/**
 * Which remembered generation options the sheet opens on.
 *
 * WHY A RULE AND NOT JUST A READ
 * ------------------------------
 * `settings.flashcardGeneration` is the right home for the preference — it
 * syncs, so web and mobile remember the same thing. But the settings PUT is
 * filtered server-side by a hardcoded category allowlist
 * (`apps/api-server/src/utils/sanitizeSettings.ts`, `SETTINGS_CATEGORY_KEYS`),
 * and the deployed build of that list does not contain `flashcardGeneration`.
 * The category is therefore dropped on the way in, the server's authoritative
 * reply comes back without it, and `resolveSettingsAfterSync` overwrites the
 * local store with that reply — so a choice of 10 + Questions reverts to the
 * defaults (20 + A mix) seconds after it was made, silently. That is exactly
 * what the device showed.
 *
 * So the device also keeps its own last-used copy, and this rule decides which
 * of the two the sheet believes. The settings store still wins whenever it
 * carries information: the mirror only speaks when the stored value is absent
 * or is the untouched default — which is both "nobody has ever chosen" and
 * "a server that does not keep this category handed us the default back".
 *
 * Deliberately imports only the shared model, so mobile jest (node env) can
 * reach it.
 */
import {
  DEFAULT_FLASHCARD_GENERATION_OPTIONS,
  normalizeGenerationOptions,
  type FlashcardGenerationOptions,
} from '@lantern/shared/flashcards/generationOptions';

/** Same remembered choice? Difficulty is a per-run steer and is not compared. */
export function sameGeneration(
  a: FlashcardGenerationOptions | null | undefined,
  b: FlashcardGenerationOptions | null | undefined
): boolean {
  if (!a || !b) return a === b;
  return a.count === b.count && a.typeMix === b.typeMix;
}

/** True when the value carries no choice: it is the shipped default. */
export function isDefaultGeneration(options: FlashcardGenerationOptions): boolean {
  return sameGeneration(options, DEFAULT_FLASHCARD_GENERATION_OPTIONS);
}

export interface RememberedGenerationSources {
  /** `settings.flashcardGeneration`, whatever shape it arrived in. */
  stored?: unknown;
  /** The device's own last-used copy, whatever shape it arrived in. */
  mirrored?: unknown;
}

/**
 * The options the sheet opens on.
 *
 * - No mirror: the stored value (or the default), as before.
 * - Stored absent, or stored is the untouched default: the mirror.
 * - Otherwise: the stored value, so a real choice made on another device
 *   still wins over this device's older one.
 */
export function resolveRememberedGeneration(
  sources: RememberedGenerationSources
): FlashcardGenerationOptions {
  const hasStored =
    sources.stored != null && typeof sources.stored === 'object' && !Array.isArray(sources.stored);
  const hasMirror =
    sources.mirrored != null &&
    typeof sources.mirrored === 'object' &&
    !Array.isArray(sources.mirrored);

  const stored = hasStored
    ? normalizeGenerationOptions(sources.stored as Record<string, unknown>)
    : null;
  const mirrored = hasMirror
    ? normalizeGenerationOptions(sources.mirrored as Record<string, unknown>)
    : null;

  if (!mirrored) return stored ?? DEFAULT_FLASHCARD_GENERATION_OPTIONS;
  if (!stored || isDefaultGeneration(stored)) return mirrored;
  return stored;
}
