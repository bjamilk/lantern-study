/** Display label for group chat — prefers real name, then @username. */
export function formatChatSenderLabel(user: {
  username?: string | null;
  name?: string | null;
}): string {
  const name = user.name?.trim();
  if (name) return name;
  const raw = user.username?.trim();
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
