/** Display label for group chat — username only. */
export function formatChatSenderLabel(user: {
  username?: string | null;
}): string {
  const raw = user.username?.trim();
  if (!raw) return '@member';
  return raw.startsWith('@') ? raw : `@${raw}`;
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

type ChatMemberRef = { id: string; username?: string | null };

type ChatAvatarMemberRef = {
  id?: string;
  userId?: string;
  avatarUrl?: string | null;
};

/** Resolve @username for group chat from sender profile and/or loaded group members. */
export function resolveGroupChatSenderLabel(
  sender: { id?: string; username?: string | null },
  members?: ChatMemberRef[] | null
): string {
  if (sender.username?.trim()) {
    return formatChatSenderLabel(sender);
  }
  if (sender.id && members?.length) {
    const member = members.find((m) => m.id === sender.id);
    if (member?.username?.trim()) {
      return formatChatSenderLabel(member);
    }
  }
  return '@member';
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

/** Short actor label for notifications (prefers @username). */
export function formatActorLabel(user: {
  username?: string | null;
  name?: string | null;
}): string {
  const raw = user.username?.trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return user.name?.trim() || 'Someone';
}
