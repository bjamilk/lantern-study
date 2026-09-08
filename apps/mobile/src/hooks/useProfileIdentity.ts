import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthStore } from '../stores/authStore';
import { fetchUserProfile } from '../services/api';
import {
  nextStoredIdentity,
  parseStoredIdentity,
  profileDisplayName,
  serializeStoredIdentity,
  storedIdentityKey,
  type StoredIdentity,
} from './profileIdentity';

/**
 * The ONE answer to "who is signed in, and what do they look like".
 *
 * Every surface that draws the signed-in student reads this hook — the top app
 * bar, the Me tab, Settings, the community board composer — so a name or an
 * avatar can only be wrong in ONE place. Before this, the top bar regressed to
 * an email-derived identity ("NI", from the local part of "nimaj22@…") whenever
 * the profile row had not loaded, while every other surface showed the real
 * "Benjamin Amadi".
 *
 * The offline case is now HONEST. The identity is resolved from, in order:
 *  1. `authStore.profileName`, the `profiles` row synced at sign-in;
 *  2. the last known profile name, PERSISTED from the most recent successful
 *     server read, so a cold offline boot still knows who the student is;
 *  3. the auth metadata copy EditProfile keeps in step;
 *  4. '' — never the email local part, because an avatar turns it into a fake
 *     set of initials. The email stand-in that the auth layer synthesises
 *     offline is recognised and skipped (see profileIdentity).
 *
 * The avatar and the persisted name both come from the same profile read and
 * are cached per user id for the life of the process, so several mounted
 * surfaces cost one request rather than several, and a cold boot restores the
 * last known face and name from disk before the network answers.
 */
export interface ProfileIdentity {
  /** '' when nothing is known yet — render '?' from it, never a stand-in. */
  displayName: string;
  avatarUrl: string | null;
  email: string | null;
}

/** Resolved identity per user id: one fetch serves every mounted surface. */
const identityCache = new Map<string, StoredIdentity>();
const inFlight = new Map<string, Promise<StoredIdentity>>();

function metadataAvatar(user: { user_metadata?: { avatar_url?: unknown } } | null): string | null {
  const url = user?.user_metadata?.avatar_url;
  return typeof url === 'string' && url ? url : null;
}

/** Read the persisted last-known identity for a user, or null. Never throws. */
async function loadStoredIdentity(userId: string): Promise<StoredIdentity | null> {
  try {
    return parseStoredIdentity(await AsyncStorage.getItem(storedIdentityKey(userId)));
  } catch {
    return null;
  }
}

async function persistIdentity(userId: string, identity: StoredIdentity): Promise<void> {
  try {
    await AsyncStorage.setItem(storedIdentityKey(userId), serializeStoredIdentity(identity));
  } catch {
    // A cold offline boot still has the in-memory cache; a failed write only
    // costs the NEXT cold boot a name, never this session.
  }
}

/**
 * Fetch the profile row, merge its name and avatar over what we already knew,
 * cache and persist the result. A failed read must NOT blank an identity the
 * session already has: it falls back to the cached-or-persisted copy, then to
 * the auth metadata, rather than to nothing.
 */
async function resolveIdentity(
  userId: string,
  metaName: string,
  metaAvatar: string | null,
  email: string | null
): Promise<StoredIdentity> {
  const cached = inFlight.get(userId);
  if (cached) return cached;
  const task = (async () => {
    const previous = identityCache.get(userId) ?? (await loadStoredIdentity(userId));
    try {
      const profile = await fetchUserProfile(userId);
      const next = nextStoredIdentity(previous, {
        name: (profile as { name?: string } | null)?.name ?? null,
        avatarUrl:
          (profile as { avatar_url?: string } | null)?.avatar_url ||
          (profile as { avatarUrl?: string } | null)?.avatarUrl ||
          metaAvatar ||
          null,
        email,
      });
      identityCache.set(userId, next);
      void persistIdentity(userId, next);
      return next;
    } catch {
      // Offline or a failed read: keep the last known identity, filling only
      // the gaps from the auth metadata (never the email, never a stand-in).
      const fallback = nextStoredIdentity(previous, { name: metaName, avatarUrl: metaAvatar, email });
      identityCache.set(userId, fallback);
      return fallback;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, task);
  return task;
}

/** Drop the cached identity for a user, so the next mount refetches it. */
export function forgetProfileAvatar(userId?: string | null): void {
  if (userId) {
    identityCache.delete(userId);
    inFlight.delete(userId);
    return;
  }
  identityCache.clear();
  inFlight.clear();
}

export function useProfileIdentity(): ProfileIdentity {
  const user = useAuthStore((s) => s.user);
  const profileName = useAuthStore((s) => s.profileName);
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  const metaAvatar = metadataAvatar(user ?? null);
  const metaName =
    typeof user?.user_metadata?.name === 'string' ? (user.user_metadata.name as string) : '';

  const [identity, setIdentity] = useState<StoredIdentity>(() =>
    userId ? identityCache.get(userId) ?? { name: null, avatarUrl: metaAvatar } : { name: null, avatarUrl: null }
  );

  useEffect(() => {
    if (!userId) {
      setIdentity({ name: null, avatarUrl: null });
      return;
    }
    let cancelled = false;
    // Paint the last known identity immediately so a remount never flashes
    // initials over a photo — or the email stand-in over the real name.
    const seed = identityCache.get(userId);
    setIdentity(seed ?? { name: null, avatarUrl: metaAvatar });

    // On a cold boot the cache is empty; restore the persisted copy from disk
    // (name AND face) before the network answers, so an offline student sees
    // "Benjamin Amadi", not "NI".
    if (!seed) {
      void loadStoredIdentity(userId).then((stored) => {
        if (cancelled || !stored) return;
        identityCache.set(userId, stored);
        setIdentity((current) =>
          // Do not clobber a fresher fetch that already landed.
          identityCache.get(userId) === stored ? stored : current
        );
      });
    }

    void resolveIdentity(userId, metaName, metaAvatar, email).then((resolved) => {
      if (!cancelled) setIdentity(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, metaName, metaAvatar, email]);

  return {
    displayName: profileDisplayName({
      profileName,
      metadataName: metaName,
      email,
      lastKnownName: identity.name,
    }),
    avatarUrl: identity.avatarUrl ?? metaAvatar,
    email,
  };
}

export default useProfileIdentity;
