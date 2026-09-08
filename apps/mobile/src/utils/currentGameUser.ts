import type { User } from '@supabase/supabase-js';
import { profileDisplayName } from '../hooks/profileIdentity';
import type { GameUser } from '../stores/gameStore';

/**
 * Build GameUser for the logged-in player.
 *
 * The name is resolved through the SAME pure planner every mobile surface uses,
 * so a challenge card can never label the player with letters taken from their
 * email address. `profileName` is the ambiguous synced source (the offline
 * stand-in travels on it, so a value equal to the email local part is refused
 * there); a genuine metadata name — including one that equals the local part —
 * survives. When nothing genuine is known the planner returns '', and the
 * neutral self-label 'You' stands in — never the email local part.
 */
export function buildCurrentGameUser(user: User, profileName?: string | null): GameUser {
  const metadataName =
    (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
    null;

  const resolved = profileDisplayName({
    profileName: profileName ?? null,
    metadataName,
    email: user.email ?? null,
  });

  return {
    id: user.id,
    name: resolved || 'You',
    avatarUrl: user.user_metadata?.avatar_url as string | undefined,
  };
}
