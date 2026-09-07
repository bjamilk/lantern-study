/**
 * Join with a code — the pure part.
 *
 * There are now TWO things a student can paste, and this file tells them
 * apart:
 *
 *  1. A one-time INVITE CODE — 8 characters from the shared unambiguous
 *     alphabet (`normalizeInviteCode`), minted by
 *     `POST /communities/:id/invites` and redeemed by
 *     `POST /communities/join-by-code`. This is the ONLY way into a private
 *     community, and redeeming it JOINS: that is what the person who sent the
 *     code meant.
 *  2. A community LINK — `/discover/c/<slug>` in every shape it survives a
 *     trip through WhatsApp: the whole URL, the bare path, a trailing slash, a
 *     query string, a `#` fragment, the app's own
 *     `lanternstudy://discover/join/<code>` deep link, or the slug alone. A
 *     link RESOLVES to a public community and the caller opens it; joining
 *     stays the community page's own decision.
 *
 * `abcd2345` is legally both, and no rule of shape can separate them. The CODE
 * is tried first now that redemption is real — a code is the only door into a
 * private room, while a slug that looks like a code can still be reached by
 * the link — and the sheet falls back to the slug lookup when the redemption
 * is refused.
 *
 * Word-for-word the same rules as web's `components/community/joinByCode.ts`:
 * the same link pasted into the two apps must resolve to the same room.
 */
import { INVITE_REFUSAL_COPY, normalizeInviteCode } from '@lantern/shared/network';
// The typed pre-migration failure lives with the endpoint wrappers that mint
// it, not with the governance rules.
import { COMMUNITY_NOT_ENABLED_COPY, isNotEnabledError } from '@lantern/shared/api';

/** Slugs are lowercase words joined by dashes — the shape the server mints. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

const PATH_MARKERS = ['/discover/c/', '/discover/join/', '/c/', '/join/'];

function tail(input: string): string {
  let value = input.trim();
  // Drop the fragment and query first: `?utm_source=…` is the usual way a
  // pasted link arrives, and it is not part of anyone's slug.
  value = value.split('#')[0].split('?')[0];
  // The app's own scheme has no host, so `lanternstudy://discover/join/x` is
  // reduced to the same path the markers below match.
  value = value.replace(/^lanternstudy:\/{1,3}/i, '/');
  for (const marker of PATH_MARKERS) {
    const at = value.toLowerCase().lastIndexOf(marker);
    if (at >= 0) {
      value = value.slice(at + marker.length);
      break;
    }
  }
  // A pasted link can carry a deeper path (`/ch/<groupId>`); the community is
  // still the first segment, and landing on the community is right — the
  // reader can open the board from there.
  const [first] = value.split('/').filter(Boolean);
  return (first ?? '').trim();
}

function decoded(candidate: string): string {
  try {
    return decodeURIComponent(candidate);
  } catch {
    // A stray `%` in the paste — keep the raw text rather than losing the code.
    return candidate;
  }
}

/**
 * The community slug named by an invite link or a typed code, or null when the
 * input is not one at all. Never throws: it is fed clipboard contents.
 */
export function parseCommunityCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const candidate = decoded(tail(input)).trim().toLowerCase();
  if (!candidate) return null;
  return SLUG_RE.test(candidate) ? candidate : null;
}

/**
 * The one-time INVITE CODE inside whatever was pasted, normalised to the
 * alphabet the server mints — or null when there is none. Accepts the bare
 * code, `lanternstudy://discover/join/<code>` and `https://…/join/<code>`,
 * which is how a code reaches the app from a share sheet.
 */
export function parseInviteCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  return normalizeInviteCode(decoded(tail(input)));
}

/**
 * True when the input could be a real one-time INVITE code.
 *
 * Deliberately NOT exclusive with `parseCommunityCode` — see the header.
 */
export function looksLikeInviteCode(input: string | null | undefined): boolean {
  if (typeof input !== 'string') return false;
  // A bare code has no scheme, host or path; a link is handled by
  // `parseInviteCode` instead.
  if (/[/:]/.test(input)) return false;
  return normalizeInviteCode(input) !== null;
}

export interface JoinByCodePlan {
  /** Redeem this first, when present. */
  code: string | null;
  /** Fall back to resolving this public community. */
  slug: string | null;
  /** Set when the input can never be either — nothing is worth requesting. */
  error: string | null;
}

/**
 * What to do with what the student typed, decided before a single request
 * leaves the device. A plan with an `error` never becomes a network call.
 */
export function planJoinByCode(input: string | null | undefined): JoinByCodePlan {
  const code = parseInviteCode(input);
  const slug = parseCommunityCode(input);
  if (!code && !slug) return { code: null, slug: null, error: JOIN_BY_CODE_INVALID };
  return { code, slug, error: null };
}

/**
 * The sentence a failed attempt shows.
 *
 * A 503 from a pre-migration API is "not switched on for this campus yet" —
 * the student did nothing wrong and retyping will not help. EVERY other
 * refusal answers the one shared string: the API deliberately gives unknown,
 * expired, exhausted and revoked codes the same 404 so this screen cannot
 * become an oracle for which codes are real, and explaining which one it was
 * would undo that on the client.
 */
export function joinByCodeFailureCopy(error: unknown, hadCode: boolean): string {
  if (isNotEnabledError(error)) return COMMUNITY_NOT_ENABLED_COPY;
  return hadCode ? INVITE_REFUSAL_COPY : JOIN_BY_CODE_NOT_FOUND;
}

export const JOIN_BY_CODE_TITLE = 'Join with a code';

export const JOIN_BY_CODE_HINT =
  'Paste the invite link a friend sent you, or type the 8-character code from it.';

export const JOIN_BY_CODE_INVALID =
  'That does not look like a Lantern invite. Paste the whole link if you can.';

export const JOIN_BY_CODE_NOT_FOUND =
  'We could not find that community. The link may be old, or the community may be private.';

/** The refusal every bad code shares — re-exported so screens import one name. */
export { INVITE_REFUSAL_COPY };
