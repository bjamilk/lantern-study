import type { User } from '@supabase/supabase-js';
import type { GameUser } from '../stores/gameStore';

/** Build GameUser for the logged-in player, preferring profiles.name over auth metadata. */
export function buildCurrentGameUser(user: User, profileName?: string | null): GameUser {
  const name =
    profileName?.trim() ||
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name.trim()) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name.trim()) ||
    user.email?.split('@')[0] ||
    'You';

  return {
    id: user.id,
    name,
    avatarUrl: user.user_metadata?.avatar_url as string | undefined,
  };
}
