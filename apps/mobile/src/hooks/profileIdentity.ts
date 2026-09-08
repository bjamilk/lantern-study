/**
 * The signed-in student's display name, resolved in ONE place.
 *
 * Pure and dependency-free so it can be tested directly; `useProfileIdentity`
 * is the React wrapper that feeds it the session.
 *
 * On device the same account wore three names at once — "Benjamin Amadi" on
 * Me, "User" in Settings, "You" on the community board composer — because
 * each screen picked its own source and its own stand-in. The stand-ins were
 * the worst part: an avatar renders initials from whatever it is handed, so
 * "You" became a "YO" chip that looked exactly like a real person's.
 *
 * Order: the synced profile row, then the auth metadata copy EditProfile keeps
 * in step, then the account email's local part, then '' — never a placeholder.
 */
export interface ProfileNameSources {
  /** `profiles.name`, as synced into authStore at sign-in. */
  profileName?: string | null;
  /** `user_metadata.name`, the copy EditProfile writes back. */
  metadataName?: string | null;
  email?: string | null;
}

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function profileDisplayName(sources: ProfileNameSources): string {
  const fromProfile = clean(sources.profileName);
  if (fromProfile) return fromProfile;
  // `user_metadata.name` is whatever sign-up wrote, and for an email sign-up
  // that is routinely the address itself. Never show it: reduce it to the
  // local part, the same stand-in the email fallback below produces.
  const fromMetadata = clean(sources.metadataName);
  if (fromMetadata) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromMetadata)
      ? fromMetadata.split('@')[0] || fromMetadata
      : fromMetadata;
  }
  const email = clean(sources.email);
  const localPart = email.includes('@') ? email.split('@')[0] : email;
  return localPart;
}
