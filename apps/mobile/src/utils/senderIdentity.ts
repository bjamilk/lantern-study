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
import { isLiteralEmailAddress } from '../hooks/profileIdentity';

/**
 * The first candidate that is a real display value, or null.
 *
 * A literal email address is NOT one: the shared label helpers reduce it to its
 * local part ('nimaj22@x.com' → 'nimaj22'), which paints an address's local
 * part on a chat row or board card and leaks the account's email to everyone
 * who can read it. Dropping an address here lets resolution fall through to the
 * next source — a genuine name, an @username, or finally 'Member' — so the
 * address (and the local part it collapses to) is never surfaced, while the
 * ordinary priority between real names is preserved.
 */
export function firstNonEmailValue(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && !isLiteralEmailAddress(trimmed)) return trimmed;
  }
  return null;
}

/**
 * A roster/sender entry with any email-shaped `name`/`username` dropped, so it
 * can be handed to the shared roster-aware label helpers
 * (`resolveGroupChatSenderLabel`) without them collapsing an address to its
 * local part. Non-identity fields (id, userId, avatarUrl) are preserved.
 */
export function withEmailSafeName<
  T extends { name?: string | null; username?: string | null }
>(entry: T): Omit<T, 'name' | 'username'> & { name: string | null; username: string | null } {
  return {
    ...entry,
    name: firstNonEmailValue(entry.name),
    username: firstNonEmailValue(entry.username),
  };
}

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

  // Pick the first REAL value per field across the sources, in priority order,
  // skipping any that is a literal email address — so a legacy `profiles.name`
  // holding an address never reaches the label helper to be reduced to its
  // local part.
  const name = formatChatSenderLabel({
    username: firstNonEmailValue(sender?.username, rosterMember?.username, own?.username),
    name: firstNonEmailValue(sender?.name, rosterMember?.name, own?.name),
  });

  const avatarUrl =
    sender?.avatarUrl || rosterMember?.avatarUrl || own?.avatarUrl || undefined;

  return { name, avatarUrl: avatarUrl || undefined };
}
