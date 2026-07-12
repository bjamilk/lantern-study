import type { User } from '@supabase/supabase-js';
import { createUserProfile, fetchUserProfile } from './api';

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
}> {
  try {
    const profile = await fetchUserProfile(user.id);
    return {
      displayName: profile.name?.trim() || resolveFallbackName(user),
      firstName: resolveProfileFirstName(profile, user),
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

function resolveFallbackName(user: User): string {
  return (
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    user.email?.split('@')[0] ||
    'User'
  );
}
