/**
 * Whose name and face a board card shows — and, on a REMOVED post, why the
 * payload does not get the last word.
 *
 * A live card's identity is resolved by the store from three sources it
 * already trusts (`utils/senderIdentity.ts`): the row's embedded sender, the
 * group roster, and — only for the reader's own row — their own profile. A
 * tombstone arrives by a different path. `DELETE /communities/:id/posts/:id`
 * answers a moderation shape, realtime re-delivers the row with its body
 * blanked, and neither is the board's author-profile join. Whatever identity
 * rides along on THAT payload is what the card drew, so the same student could
 * be "Benjamin Amadi" on one card and something else entirely on the tombstone
 * one row below.
 *
 * Two rules fix it:
 *
 *  1. On a removed post, the identity the client ALREADY HAS for that author
 *     wins. It came from the roster or from that author's live cards, which is
 *     the source the rest of the board agrees on.
 *  2. An email address is NEVER a display name — on any card, removed or not.
 *     `formatChatSenderLabel` returns `name` verbatim, so one row that carries
 *     an address in `profiles.name` publishes it to everyone who can read the
 *     board. This is the defensive half: the client refuses to render it even
 *     when the server sends it.
 *
 * Pure and import-free so mobile jest (node env, `*.test.ts` only) can reach
 * it.
 */

/** The literal `formatChatSenderLabel` falls back to; kept identical. */
export const BOARD_AUTHOR_FALLBACK = 'Member';

export interface BoardAuthorCandidate {
  name?: string | null;
  avatarUrl?: string | null;
}

export interface BoardAuthorIdentity {
  name: string;
  avatarUrl?: string;
}

/**
 * Whether a string carries an email address.
 *
 * A containment test, not an exact match: "Ben (ben@uni.edu.ng)" leaks the
 * address just as surely as the bare one. `@username` handles are safe — the
 * pattern needs at least one non-`@` character BEFORE the `@`, and a dot
 * after it, which a handle has neither of.
 */
export function looksLikeEmail(value?: string | null): boolean {
  if (!value) return false;
  return /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value);
}

/** A name we are willing to draw: present, and not an address. */
function usableName(candidate?: BoardAuthorCandidate | null): string | undefined {
  const name = candidate?.name?.trim();
  if (!name) return undefined;
  if (looksLikeEmail(name)) return undefined;
  // A row that resolved to nothing already says "Member"; treat it as absent
  // so the OTHER source still gets a turn.
  if (name === BOARD_AUTHOR_FALLBACK) return undefined;
  return name;
}

function usableAvatar(candidate?: BoardAuthorCandidate | null): string | undefined {
  const url = candidate?.avatarUrl?.trim();
  return url || undefined;
}

export function resolveBoardAuthorIdentity(input: {
  /** The identity carried by the row being drawn. */
  payload: BoardAuthorCandidate;
  /** What the client already holds for this author — roster, or a live card. */
  known?: BoardAuthorCandidate | null;
  /** The row is a tombstone. */
  isRemoved: boolean;
}): BoardAuthorIdentity {
  const { payload, known, isRemoved } = input;

  // Removed: the client's own copy leads. Live: the row leads, because it is
  // the fresher of the two (a rename lands on the row before the roster).
  const order = isRemoved ? [known, payload] : [payload, known];

  const name = order.map(usableName).find(Boolean) ?? BOARD_AUTHOR_FALLBACK;
  const avatarUrl = order.map(usableAvatar).find(Boolean);

  return { name, avatarUrl };
}
