/**
 * Display identity resolution — the one place that decides what name a user is
 * shown by, and what an avatar draws when there is no name.
 *
 * The defect this closes: an account with no profile name used to be called by
 * its email's local part (`email.split('@')[0]` → "nimaj22"), and an avatar
 * seeded from that string drew invented initials ("NI") on the person's own
 * cards — the email even reached the avatar's accessibility label. An email
 * address is not a name, and neither is the local part it collapses to, so
 * neither is ever surfaced here; a genuinely nameless account falls back to a
 * neutral placeholder and a neutral avatar mark instead.
 *
 * A real name is allowed to be odd: one that merely *contains* an "@" (a
 * nickname like "DJ @ Night") is kept. Only a strict address is rejected.
 */
import { scrubEmailFromDisplayName } from '@lantern/shared/utils/displayNames';
import { initialsFromName } from '@lantern/shared/design';

/**
 * Neutral display name for an account with no real name. A plain word, never an
 * email address or the local part one would collapse to.
 */
export const NEUTRAL_DISPLAY_NAME = 'User';

/** Neutral avatar mark for a missing name — never invented initials. */
export const NEUTRAL_AVATAR_MARK = '?';

/**
 * A candidate reduced to a *real* name, or null.
 *
 * `scrubEmailFromDisplayName` (shared) leaves a non-email string untouched and
 * collapses a strict email address to its local part. We treat any collapse as
 * a rejection: the shared helper's job elsewhere is "show the handle rather than
 * the raw address", but identity here must not surface the local part at all —
 * so a value the scrubber *changed* was email-shaped and is dropped, while a
 * value it left alone is a genuine name.
 */
function realNameOrNull(candidate: string | null | undefined): string | null {
  const trimmed = candidate?.trim();
  if (!trimmed) return null;
  const scrubbed = scrubEmailFromDisplayName(trimmed);
  return scrubbed === trimmed ? trimmed : null;
}

/**
 * Resolve a display name from ordered candidate sources, most-trusted first
 * (e.g. the server profile name, then a last-known name). The account email is
 * deliberately NOT a candidate — it is not a name source. Returns the neutral
 * placeholder when no candidate is a real name.
 */
export function resolveDisplayName(
  candidates: Array<string | null | undefined>,
  fallback: string = NEUTRAL_DISPLAY_NAME,
): string {
  for (const candidate of candidates) {
    const real = realNameOrNull(candidate);
    if (real) return real;
  }
  return fallback;
}

export interface AvatarIdentity {
  /** Initials for a real name, or the neutral mark when none. */
  initials: string;
  /** Accessible label — the resolved real name, or the neutral placeholder. */
  label: string;
}

/**
 * Resolve the initials AND the accessibility label an avatar draws, from a
 * single name string. A blank or email-shaped name has no initials to invent,
 * so both fall back to neutral values — the mark is drawn, the label reads
 * "User", and the email is never spoken by a screen reader.
 */
export function resolveAvatarIdentity(
  name: string | null | undefined,
): AvatarIdentity {
  const real = realNameOrNull(name);
  if (!real) {
    return { initials: NEUTRAL_AVATAR_MARK, label: NEUTRAL_DISPLAY_NAME };
  }
  return { initials: initialsFromName(real), label: real };
}
