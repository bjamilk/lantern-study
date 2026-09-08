import type { User } from '@supabase/supabase-js';
import { profileDisplayName } from '../hooks/profileIdentity';
import { createUserProfile, fetchUserProfile } from './api';
import { extractAcademicProfile, type AcademicProfile } from '../utils/academicProfile';

function isMissingProfileError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('404') ||
    message.includes('not found') ||
    message.includes('Not Found') ||
    message.includes('User not found')
  );
}

/** Ensures a profiles row exists so deck/flashcard API calls can succeed. */
export async function ensureUserProfile(user: User): Promise<{
  displayName: string;
  firstName?: string;
  /** Academic identity from the same GET /users/:id round-trip (null when just created). */
  academic: AcademicProfile | null;
}> {
  try {
    const profile = await fetchUserProfile(user.id);
    return {
      // The one honest name for the signed-in student, resolved in the SAME
      // pure planner every mobile surface uses. `profile.name` came from a
      // successful server read, so it is a GENUINE source (mapped to
      // lastKnownName, not the ambiguous offline profileName slot): a real name
      // that merely equals the email local part — 'ada' for ada@uni.edu —
      // survives, while a literal address in the row is dropped. The email
      // local part is NEVER a name here, so this value cannot stamp an
      // email-derived identity onto the viewer's own cards or a board.
      displayName: resolveDisplayName(profile.name, user),
      firstName: resolveProfileFirstName(profile, user),
      academic: extractAcademicProfile(profile),
    };
  } catch (error: unknown) {
    if (!isMissingProfileError(error)) {
      throw error;
    }

    // The WRITE. This name is persisted into profiles.name — exactly what the
    // server trigger was just stopped from deriving from the email address, so
    // it must never be email-derived either. The planner returns '' when the
    // account has no genuine name (no metadata name, or only the address), and
    // '' is what we write: a fresh mobile signup leaves NO email-derived name
    // in the database, and the profile resolver renders the neutral '?' mark
    // for it rather than inventing initials from the address.
    const name = resolveCreatedName(user);
    await createUserProfile({ id: user.id, name });
    return {
      displayName: name,
      firstName: resolveProfileFirstName(null, user),
      academic: null,
    };
  }
}

/**
 * The display name for an EXISTING profile row.
 *
 * `profile.name` is a genuine server value on this path, so it rides the
 * lastKnownName slot (genuine names, only literal addresses refused) rather
 * than the ambiguous profileName slot the offline stand-in travels on.
 */
function resolveDisplayName(profileName: string | null | undefined, user: User): string {
  return profileDisplayName({
    lastKnownName: profileName ?? null,
    metadataName: metadataName(user),
    email: user.email ?? null,
  });
}

/**
 * The name WRITTEN when no profile row exists yet.
 *
 * Only the sign-up metadata name and the email are known here. The planner
 * keeps a genuine metadata name (including one that equals the email local
 * part) and returns '' for a bare or address-only account — never the email
 * local part.
 */
function resolveCreatedName(user: User): string {
  return profileDisplayName({
    metadataName: metadataName(user),
    email: user.email ?? null,
  });
}

function metadataName(user: User): string | null {
  return typeof user.user_metadata?.name === 'string' ? user.user_metadata.name : null;
}

function resolveProfileFirstName(
  profile: { first_name?: string; firstName?: string } | null,
  user: User
): string | undefined {
  const fromProfile = profile?.first_name || profile?.firstName;
  if (typeof fromProfile === 'string' && fromProfile.trim()) {
    return fromProfile.trim();
  }
  const fromMeta = user.user_metadata?.first_name;
  if (typeof fromMeta === 'string' && fromMeta.trim()) {
    return fromMeta.trim();
  }
  return undefined;
}
