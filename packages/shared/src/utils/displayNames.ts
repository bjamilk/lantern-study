/** Display label for group chat — username only. */
export function formatChatSenderLabel(user: {
  username?: string | null;
}): string {
  const raw = user.username?.trim();
  if (!raw) return '@member';
  return raw.startsWith('@') ? raw : `@${raw}`;
}

type ChatMemberRef = { id: string; username?: string | null };

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

/** Short actor label for notifications (prefers @username). */
export function formatActorLabel(user: {
  username?: string | null;
  name?: string | null;
}): string {
  const raw = user.username?.trim();
  if (raw) return raw.startsWith('@') ? raw : `@${raw}`;
  return user.name?.trim() || 'Someone';
}
