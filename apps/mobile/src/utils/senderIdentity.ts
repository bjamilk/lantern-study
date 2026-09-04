/**
 * Who a message row belongs to, for display.
 *
 * Three sources, in priority order: the row's embedded `sender`, then the
 * group roster, then — only for the viewer's own row — their signed-in
 * profile.
 *
 * That last fallback is load-bearing rather than cosmetic. A board's roster is
 * never fetched and the board endpoints embed no `sender`, so the viewer's own
 * freshly created post reaches the mapper with nothing from either of the first
 * two sources. `formatChatSenderLabel` then falls through to the literal
 * "Member" (with initials for an avatar), and it stays that way until the app
 * is restarted and the server's copy arrives. The 1.0.43 fix added this rule to
 * the optimistic chat-send path but not to the shared mapper, which is the one
 * the board post path actually uses.
 *
 * Kept pure and free of React Native imports so it is testable: importing the
 * store itself pulls in expo-secure-store, which jest cannot transform.
 */
import { formatChatSenderLabel } from '@lantern/shared/utils';

export interface SenderIdentitySource {
  username?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface ResolvedSenderIdentity {
  name: string;
  avatarUrl?: string;
}

export function resolveSenderIdentity(input: {
  senderId: string;
  /** The row's embedded sender, if the endpoint returned one. */
  sender?: SenderIdentitySource | null;
  /** The group roster entry, if the roster has been loaded. */
  rosterMember?: SenderIdentitySource | null;
  /** The signed-in user. Used ONLY when their id equals senderId. */
  viewer?: (SenderIdentitySource & { id?: string | null }) | null;
}): ResolvedSenderIdentity {
  const { senderId, sender, rosterMember, viewer } = input;

  // Never borrow the viewer's identity for somebody else's row: that would
  // label another student's post with the reader's own name.
  const isOwnRow = !!viewer?.id && !!senderId && viewer.id === senderId;
  const own = isOwnRow ? viewer : null;

  const name = formatChatSenderLabel({
    username: sender?.username || rosterMember?.username || own?.username || null,
    name: sender?.name || rosterMember?.name || own?.name || null,
  });

  const avatarUrl =
    sender?.avatarUrl || rosterMember?.avatarUrl || own?.avatarUrl || undefined;

  return { name, avatarUrl: avatarUrl || undefined };
}
