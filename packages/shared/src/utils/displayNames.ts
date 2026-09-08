/**
 * An email address is never a display name.
 *
 * A profile whose `name` column holds the address it was created from, a
 * signed-in fallback that reached for `user_metadata.name`, an optimistic card
 * drawn before the server's copy arrives — any of these can put
 * `someone@example.com` where a person's name belongs, and a community board
 * publishes it to everyone who can read the board. That happened: a removed
 * post's tombstone carried the author's full address, initials and all, beside
 * live cards showing the same person's real name.
 *
 * The address is reduced to its local part rather than dropped, because the
 * local part is the fallback name the rest of the app already uses ("nimaj22"),
 * and a card reading "Member" tells a reader less than one reading a handle.
 * Only a strict address is treated this way: a name is allowed to be odd, and
 * mangling one that merely contains an "@" would be a worse bug than the one
 * this fixes.
 */
const EMAIL_SHAPED = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function scrubEmailFromDisplayName(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!EMAIL_SHAPED.test(trimmed)) return trimmed;
  const localPart = trimmed.split('@')[0]?.trim();
  return localPart || null;
}

/**
 * Display label for group chat — prefers real name, then @username.
 * Never an email address: see scrubEmailFromDisplayName.
 */
export function formatChatSenderLabel(user: {
  username?: string | null;
  name?: string | null;
}): string {
  const name = scrubEmailFromDisplayName(user.name);
  if (name) return name;
  const raw = scrubEmailFromDisplayName(user.username);
  if (raw) {
    const withoutAt = raw.startsWith('@') ? raw.slice(1).trim() : raw;
    if (withoutAt) return `@${withoutAt}`;
  }
  return 'Member';
}

/** @username handle for composer inserts (no leading @). */
export function formatChatMentionUsername(user: {
  username?: string | null;
}): string | null {
  const raw = user.username?.trim();
  if (!raw) return null;
  const withoutAt = raw.startsWith('@') ? raw.slice(1).trim() : raw;
  return withoutAt || null;
}

export interface DashboardNameInput {
  firstName?: string | null;
  first_name?: string | null;
  name?: string | null;
  username?: string | null;
}

/** First name for dashboard greeting — never uses @username. */
export function getDashboardFirstName(
  user: DashboardNameInput,
  fallback = 'Student'
): string {
  const explicitFirst = (user.firstName || user.first_name)?.trim();
  if (explicitFirst) {
    return explicitFirst.split(/\s+/)[0] || fallback;
  }

  const fullName = user.name?.trim();
  if (fullName) {
    const username = user.username?.trim().toLowerCase();
    const normalizedName = fullName.toLowerCase();
    const looksLikeUsername =
      Boolean(username) &&
      (normalizedName === username || normalizedName === `@${username}`);
    const looksLikeEmailLocal =
      fullName.includes('@') ||
      (fullName.length > 20 && !/\s/.test(fullName) && fullName.includes('.'));

    if (!looksLikeUsername && !looksLikeEmailLocal) {
      const firstWord = fullName.split(/\s+/)[0];
      if (firstWord) return firstWord;
    }
  }

  return fallback;
}

type ChatMemberRef = {
  id?: string;
  userId?: string;
  username?: string | null;
  name?: string | null;
};

type ChatAvatarMemberRef = {
  id?: string;
  userId?: string;
  avatarUrl?: string | null;
};

function findChatMember(
  senderId: string | undefined,
  members?: ChatMemberRef[] | null
): ChatMemberRef | undefined {
  if (!senderId || !members?.length) return undefined;
  return members.find(
    (candidate) => candidate.id === senderId || candidate.userId === senderId
  );
}

/** Resolve author display name for group chat from sender profile and/or roster. */
export function resolveGroupChatSenderLabel(
  sender: { id?: string; username?: string | null; name?: string | null },
  members?: ChatMemberRef[] | null
): string {
  const direct = formatChatSenderLabel(sender);
  if (direct !== 'Member') return direct;

  const member = findChatMember(sender.id, members);
  if (member) {
    const fromMember = formatChatSenderLabel(member);
    if (fromMember !== 'Member') return fromMember;
  }
  return 'Member';
}

/** Resolve @username handle for inserting a mention from a displayed author. */
export function resolveGroupChatMentionUsername(
  sender: { id?: string; username?: string | null },
  members?: ChatMemberRef[] | null
): string | null {
  const direct = formatChatMentionUsername(sender);
  if (direct) return direct;
  const member = findChatMember(sender.id, members);
  return member ? formatChatMentionUsername(member) : null;
}

/**
 * Resolve a group-message avatar from the live roster before the message
 * snapshot. Profile avatar uploads use versioned paths, so an older message
 * can otherwise keep pointing at an avatar object that has been replaced.
 */
export function resolveGroupChatAvatarUrl(
  sender: { id?: string; avatarUrl?: string | null },
  members?: ChatAvatarMemberRef[] | null
): string | null | undefined {
  if (sender.id && members?.length) {
    const member = members.find(
      (candidate) => candidate.id === sender.id || candidate.userId === sender.id
    );
    if (member) return member.avatarUrl;
  }
  return sender.avatarUrl;
}

/**
 * Avatar image source, or null when the initials placeholder should be used.
 * `ui-avatars.com` URLs are generated placeholders stored on older groups —
 * rendering them costs a network round trip to draw the initials we already
 * draw locally, so they are treated as "no image".
 */
export function resolveAvatarSrc(
  src?: string | null,
  localOnly = false
): string | null {
  if (localOnly || !src) return null;
  if (src.includes('ui-avatars.com')) return null;
  return src;
}

/** Short actor label for notifications (prefers @username). */
export function formatActorLabel(user: {
  username?: string | null;
  name?: string | null;
}): string {
  const raw = user.username?.trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return user.name?.trim() || 'Someone';
}
