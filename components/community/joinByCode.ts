import { INVITE_REFUSAL_COPY, normalizeInviteCode } from '@lantern/shared/network';

/**
 * Join by code — the pure part.
 *
 * Two different things arrive in this box and they resolve two different ways:
 *
 *  1. A real INVITE CODE (`/join/ABCD2345`, or the eight characters typed by
 *     hand). Redeemed through `joinCommunityByCode`, which is the ONLY way
 *     into a private community. `normalizeInviteCode` is the shared reader —
 *     it upper-cases, drops the spaces and dashes a human types, and refuses
 *     anything that could never be a code, so a guess never becomes a request.
 *  2. A public SHARE LINK (`/discover/c/<slug>`), which is what the community
 *     page's Copy-invite button has always minted and what is already sitting
 *     in a hundred WhatsApp threads. It is not a code and there is no code to
 *     make from it: it resolves by slug, exactly as before.
 *
 * Which of the two a paste is decides which request the modal makes, so this
 * answers with a tagged result rather than a bare string.
 */

/** Slugs are lowercase words joined by dashes — the shape `slugifyCommunity` mints. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

/** `/join/` FIRST: an invite path must never be read as a community slug. */
const CODE_MARKERS = ['/discover/join/', '/join/'];
const SLUG_MARKERS = ['/discover/c/', '/c/'];

function segmentAfter(input: string, markers: readonly string[]): string | null {
  const value = input.split('#')[0].split('?')[0];
  for (const marker of markers) {
    const at = value.toLowerCase().lastIndexOf(marker);
    if (at >= 0) {
      // A pasted link can carry a deeper path (`/ch/<groupId>`); the community
      // is still the first segment after the marker.
      const [first] = value.slice(at + marker.length).split('/').filter(Boolean);
      return (first ?? '').trim();
    }
  }
  return null;
}

function decode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A stray `%` in the paste — keep the raw text rather than losing the code.
    return raw;
  }
}

export type JoinTarget =
  /** An eight-character invite code, normalised. Redeem it. */
  | { kind: 'code'; code: string }
  /** A public community share link. Resolve it by slug. */
  | { kind: 'slug'; slug: string }
  /** Not a Lantern link at all. */
  | { kind: 'unknown' };

/**
 * What this paste is. Never throws — it is fed clipboard contents.
 *
 * A code wins over a slug whenever the input can be read as one: the codes are
 * minted from an alphabet with no O/0 and no I/1/L precisely so that they are
 * unambiguous, and an eight-character upper-case string is not a slug anybody
 * ever generated.
 */
export function parseJoinTarget(input: string | null | undefined): JoinTarget {
  if (typeof input !== 'string' || !input.trim()) return { kind: 'unknown' };
  const trimmed = input.trim();

  const codeSegment = segmentAfter(trimmed, CODE_MARKERS);
  if (codeSegment !== null) {
    const code = normalizeInviteCode(decode(codeSegment));
    if (code) return { kind: 'code', code };
    // A `/join/` link whose tail is not a code is a stale share link from the
    // days when this route carried slugs. Fall through and try it as one.
    const slug = decode(codeSegment).trim().toLowerCase();
    return SLUG_RE.test(slug) ? { kind: 'slug', slug } : { kind: 'unknown' };
  }

  const slugSegment = segmentAfter(trimmed, SLUG_MARKERS);
  if (slugSegment !== null) {
    const slug = decode(slugSegment).trim().toLowerCase();
    return SLUG_RE.test(slug) ? { kind: 'slug', slug } : { kind: 'unknown' };
  }

  // Typed by hand, with no link around it.
  const bare = decode(trimmed);
  const code = normalizeInviteCode(bare);
  if (code) return { kind: 'code', code };
  const slug = bare.trim().toLowerCase();
  return SLUG_RE.test(slug) ? { kind: 'slug', slug } : { kind: 'unknown' };
}

/**
 * The legacy reader: the community slug a paste names, or null.
 *
 * Kept because the routes `/discover/c/:slug` and `/discover/join/:code` both
 * still exist, and callers that only ever wanted a slug should not have to
 * learn the tagged shape.
 */
export function parseCommunityCode(input: string | null | undefined): string | null {
  const target = parseJoinTarget(input);
  return target.kind === 'slug' ? target.slug : null;
}

export const JOIN_BY_CODE_HINT =
  'Paste the invite link a friend sent you, or type the code from it.';

export const JOIN_BY_CODE_INVALID =
  'That does not look like a Lantern invite. Paste the whole link if you can.';

/**
 * Every refusal an invite can give — unknown, expired, all used up, revoked —
 * answers this ONE sentence, and so does this screen. Explaining which of the
 * four it was would tell a stranger which codes are real.
 */
export const JOIN_BY_CODE_REFUSED = INVITE_REFUSAL_COPY;

export const JOIN_BY_CODE_NOT_FOUND =
  'We could not find that community. The link may be old, or the community may be private.';
