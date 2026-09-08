import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { fetchUserProfile } from '../services/api';
import { profileDisplayName } from './profileIdentity';

/**
 * The ONE answer to "who is signed in, and what do they look like".
 *
 * On device the same account wore three faces at once: the Me tab said
 * "Benjamin Amadi" with the profile photo, Settings said "User" with orange
 * "NI" initials (it read `user_metadata.name` and nothing else), and the
 * community board composer said "YO" (it fell back to the literal string
 * "You"). Three screens each resolved the identity their own way, so each one
 * failed differently when a source was missing.
 *
 * Every surface that draws the signed-in student now reads this hook, so a
 * name or an avatar can only be wrong in ONE place.
 *
 * Resolution order — the same order the app has always used, written down once:
 *  1. `authStore.profileName`, the `profiles` row synced at sign-in;
 *  2. the auth metadata copy EditProfile keeps in step;
 *  3. the account email's local part — the stand-in authStore itself uses;
 *  4. '' — never a placeholder like "You" or "Your profile", because an
 *     avatar turns a placeholder into a fake set of initials ("YO", "YP").
 *
 * The avatar is fetched from the `profiles` row (auth metadata is the
 * fallback) and cached per user id for the life of the process, so three
 * mounted surfaces cost one request rather than three.
 */
export interface ProfileIdentity {
  /** '' when nothing is known yet — render initials from it, never a stand-in. */
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
}

/** Resolved avatar per user id: one fetch serves every mounted surface. */
const avatarCache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | null>>();

function metadataAvatar(user: { user_metadata?: { avatar_url?: unknown } } | null): string | null {
  const url = user?.user_metadata?.avatar_url;
  return typeof url === 'string' && url ? url : null;
}

async function resolveAvatar(
  userId: string,
  metadataFallback: string | null
): Promise<string | null> {
  const cached = inFlight.get(userId);
  if (cached) return cached;
  const task = (async () => {
    try {
      const profile = await fetchUserProfile(userId);
      const url =
        (profile as { avatar_url?: string } | null)?.avatar_url ||
        (profile as { avatarUrl?: string } | null)?.avatarUrl ||
        metadataFallback ||
        null;
      avatarCache.set(userId, url);
      return url;
    } catch {
      // A failed profile read must not blank an avatar the session already
      // knows about: fall back to the metadata copy rather than to nothing.
      avatarCache.set(userId, metadataFallback);
      return metadataFallback;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, task);
  return task;
}

/** Drop the cached avatar for a user, so the next mount refetches it. */
export function forgetProfileAvatar(userId?: string | null): void {
  if (userId) {
    avatarCache.delete(userId);
    inFlight.delete(userId);
    return;
  }
  avatarCache.clear();
  inFlight.clear();
}

export function useProfileIdentity(): ProfileIdentity {
  const user = useAuthStore((s) => s.user);
  const profileName = useAuthStore((s) => s.profileName);
  const userId = user?.id ?? null;
  const metaAvatar = metadataAvatar(user ?? null);
  const metaName =
    typeof user?.user_metadata?.name === 'string' ? (user.user_metadata.name as string) : '';

  const [avatarUrl, setAvatarUrl] = useState<string | null>(() =>
    userId ? avatarCache.get(userId) ?? metaAvatar : null
  );

  useEffect(() => {
    if (!userId) {
      setAvatarUrl(null);
      return;
    }
    let cancelled = false;
    // Paint the last known face immediately so a remount never flashes
    // initials over a photo, then confirm it against the profile row.
    setAvatarUrl(avatarCache.has(userId) ? avatarCache.get(userId) ?? null : metaAvatar);
    void resolveAvatar(userId, metaAvatar).then((url) => {
      if (!cancelled) setAvatarUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, metaAvatar]);

  return {
    displayName: profileDisplayName({
      profileName,
      metadataName: metaName,
      email: user?.email ?? null,
    }),
    avatarUrl,
    email: user?.email ?? null,
  };
}

export default useProfileIdentity;
