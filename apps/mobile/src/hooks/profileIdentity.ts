/**
 * The signed-in student's display identity, resolved in ONE place.
 *
 * Pure and dependency-free so it can be tested directly; `useProfileIdentity`
 * is the React wrapper that feeds it the session and the persisted copy.
 *
 * On device the same account wore several names at once — "Benjamin Amadi" on
 * Me and every chat row, but "NI" on the top app bar — because the top bar
 * regressed to an EMAIL-DERIVED identity the moment the profile row had not
 * loaded, which is every offline cold boot. The email local part "nimaj22"
 * became an "NI" chip that looked exactly like a real person's initials, right
 * next to surfaces that said "BA".
 *
 * Two rules make the identity honest:
 *  1. every surface resolves through THIS function, so a name can only be wrong
 *     in one place; and
 *  2. an identity that is merely NOT LOADED YET is never dressed up as a name
 *     invented from the email address. The email stand-in that the auth layer
 *     synthesises offline (authStore.displayNameFromUser derives the same local
 *     part) is recognised and dropped, the last known profile name (persisted,
 *     so a cold offline boot still knows who the student is) is preferred, and
 *     the final fallback is '' — which `ResolvedAvatar` draws as a neutral '?'
 *     placeholder, never letters from an address.
 */
export interface ProfileNameSources {
  /** `profiles.name`, as synced into authStore at sign-in. */
  profileName?: string | null;
  /** `user_metadata.name`, the copy EditProfile writes back. */
  metadataName?: string | null;
  email?: string | null;
  /**
   * The name from the last SUCCESSFUL server profile read, persisted per user
   * so a cold offline boot restores "Benjamin Amadi" instead of degrading to
   * the email stand-in. Only ever a genuine name — see {@link nextStoredIdentity}.
   */
  lastKnownName?: string | null;
}

const EMAIL_SHAPED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The display name used before any profile has been resolved.
 *
 * A GENUINE ABSENCE, not a stand-in: every avatar seeds from `name || '?'`, so
 * '' draws the neutral '?' placeholder, while a fake name like 'Your profile'
 * would draw invented initials ('YP') for the frame before the real profile
 * lands — the same class of defect as the 'NI' from an email. The chrome
 * defaults (TopBar and MeScreen both read the one published name) use this so
 * the pre-profile frame is silent rather than wrong.
 */
export const NO_PROFILE_NAME = '';

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * True when a string is itself a literal email address.
 *
 * An address is NEVER a display name, from ANY source: showing it hands an
 * avatar letters from an address and leaks the account's email onto a board.
 * This is the floor that survives even for a name the student genuinely saved.
 */
export function isLiteralEmailAddress(name: string | null | undefined): boolean {
  return EMAIL_SHAPED.test(clean(name));
}

/** The local part of an email, or '' when there is none. */
export function emailLocalPart(email: string | null | undefined): string {
  const e = clean(email);
  if (!e.includes('@')) return e === '' ? '' : e;
  return e.split('@')[0] ?? '';
}

/**
 * True when a candidate "name" is nothing but the account's email dressed up.
 *
 * The auth layer, offline, has no profile row to read and falls back to the
 * email's local part (authStore.displayNameFromUser). That value then travels
 * as `profileName`, and a literal address can travel as `metadataName`. Either
 * way it is NOT a real name: presenting it hands an avatar letters from an
 * address ("nimaj22" → "NI") for an account whose real name is "Benjamin
 * Amadi". Recognise it so the resolver can skip it.
 */
export function isEmailDerivedName(name: string, localPart: string): boolean {
  if (!name) return false;
  if (isLiteralEmailAddress(name)) return true; // a literal address
  return localPart.length > 0 && name === localPart; // the local-part stand-in
}

export function profileDisplayName(sources: ProfileNameSources): string {
  const localPart = emailLocalPart(sources.email);

  // `profileName` is the ONE ambiguous source: online it is the synced
  // `profiles` row, but offline `authStore.displayNameFromUser` synthesises the
  // bare email local part and passes it HERE. We cannot tell 'nimaj22' the
  // stand-in from 'nimaj22' the saved name by its value, so this source is
  // refused whenever it merely looks email-derived — the top-bar 'NI'
  // regression this planner exists to kill.
  const synced = clean(sources.profileName);
  if (synced && !isEmailDerivedName(synced, localPart)) return synced;

  // `lastKnownName` (persisted only from a successful server read) and
  // `metadataName` (what EditProfile wrote) are GENUINE saved names: the
  // offline email stand-in never reaches either. A name the student actually
  // saved is theirs even when it equals the email local part ('ada' for
  // ada@uni.edu) — only a literal address is still refused. This is the
  // distinction between "derived from the email because we had nothing else"
  // and "came from the profile row and merely resembles the address".
  for (const raw of [sources.lastKnownName, sources.metadataName]) {
    const name = clean(raw);
    if (name && !isLiteralEmailAddress(name)) return name;
  }

  // Never the email local part: an unknown name is an honest '?', not "NI".
  return NO_PROFILE_NAME;
}

/**
 * The persisted last-known identity: the name and avatar from the most recent
 * successful server profile read. Restored on a cold offline boot so the top
 * bar and every other surface know who the student is before the network does.
 */
export interface StoredIdentity {
  name: string | null;
  avatarUrl: string | null;
}

/** AsyncStorage key for one user's last-known identity. */
export function storedIdentityKey(userId: string): string {
  return `lantern.profileIdentity.${userId}`;
}

export function serializeStoredIdentity(identity: StoredIdentity): string {
  return JSON.stringify({
    name: identity.name ?? null,
    avatarUrl: identity.avatarUrl ?? null,
  });
}

/** A corrupt or absent cache is the same as no cache: null, never a throw. */
export function parseStoredIdentity(raw: string | null | undefined): StoredIdentity | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { name?: unknown; avatarUrl?: unknown };
    if (obj && typeof obj === 'object') {
      return {
        name: typeof obj.name === 'string' ? obj.name : null,
        avatarUrl: typeof obj.avatarUrl === 'string' ? obj.avatarUrl : null,
      };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * What to persist after a profile read, merged over what was already stored.
 *
 * The `fetched.name` here is ALWAYS a genuine saved name — the server profile
 * row on a successful read, or the auth metadata copy on a failed one. The
 * offline email stand-in (the bare local part) is synthesised in `authStore`
 * and travels as `profileName`; it never reaches this function. So a name that
 * equals the email local part ('ada' for ada@uni.edu) is the student's real
 * name and IS persisted — only a literal address is dropped, so a later offline
 * boot can never RESTORE the account's own email as letters on an avatar. A
 * genuine name (or a fresh avatar) replaces the stored copy; a missing field
 * keeps the previous one, so a read that returns an avatar but no name does not
 * erase a name we already knew.
 */
export function nextStoredIdentity(
  previous: StoredIdentity | null,
  fetched: { name?: string | null; avatarUrl?: string | null; email?: string | null }
): StoredIdentity {
  const fetchedName = clean(fetched.name);
  const genuineName = fetchedName && !isLiteralEmailAddress(fetchedName) ? fetchedName : null;
  const fetchedAvatar =
    typeof fetched.avatarUrl === 'string' && fetched.avatarUrl ? fetched.avatarUrl : null;
  return {
    name: genuineName ?? previous?.name ?? null,
    avatarUrl: fetchedAvatar ?? previous?.avatarUrl ?? null,
  };
}
