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

/** Ensures a profiles row exists so deck/flashcard API calls can succeed. Returns profile display name. */
export async function ensureUserProfile(user: User): Promise<string> {
  try {
    const profile = await fetchUserProfile(user.id);
    return profile.name?.trim() || resolveFallbackName(user);
  } catch (error: unknown) {
    if (!isMissingProfileError(error)) {
      throw error;
    }

    const name = resolveFallbackName(user);
    await createUserProfile({ id: user.id, name });
    return name;
  }
}

function resolveFallbackName(user: User): string {
  return (
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    user.email?.split('@')[0] ||
    'User'
  );
}
