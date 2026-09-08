import type { User } from '@supabase/supabase-js';
import { scrubEmailFromDisplayName } from '@lantern/shared/utils/displayNames';
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
      // A profiles row created from an address can hold the address itself.
      // This name is what the app writes onto the viewer's own cards before
      // the server's copy arrives, and a board publishes those to everyone.
      displayName: scrubEmailFromDisplayName(profile.name) || resolveFallbackName(user),
      firstName: resolveProfileFirstName(profile, user),
      academic: extractAcademicProfile(profile),
    };
  } catch (error: unknown) {
    if (!isMissingProfileError(error)) {
      throw error;
    }

    const name = resolveFallbackName(user);
    await createUserProfile({ id: user.id, name });
    return {
      displayName: name,
      firstName: resolveProfileFirstName(null, user),
      academic: null,
    };
  }
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

/**
 * The name to show when the profile has none.
 *
 * `user_metadata.name` is whatever the sign-up flow put there, and for an
 * email sign-up that is routinely the address — so it goes through the same
 * scrub as every other candidate. The local part is the deliberate landing
 * place, not a leak: it is the fallback name the rest of the app already uses.
 */
function resolveFallbackName(user: User): string {
  const fromMetadata =
    typeof user.user_metadata?.name === 'string'
      ? scrubEmailFromDisplayName(user.user_metadata.name)
      : null;
  return fromMetadata || user.email?.split('@')[0] || 'User';
}
