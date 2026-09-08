/**
 * Label helpers shared by the community hub and the community server view.
 * Kept in their own module so `communityServer.ts` can use them without a
 * circular import through `./index`.
 */
import { communityKindMeta, isCommunityKind, type CommunityKind } from './communityGovernance';

/**
 * One label per kind, taken from `communityKindMeta` so the label a card shows
 * and the label a filter chip shows can never drift. Unknown kinds (a row
 * written by a newer API than this client) read 'Community'.
 */
export function communityKindLabel(kind: CommunityKind | string): string {
  return isCommunityKind(kind) ? communityKindMeta(kind).label : 'Community';
}

/** "1,204 members" / "1 member" — used identically on both clients. */
export function memberCountLabel(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;
}

/**
 * The name to SHOW for a community row.
 *
 * Derived course communities are minted by `ensure_scope_community` as
 * `code || ' — ' || title` (migration 20260824120000). When a course's title
 * is just its code again — a very common way to add a course — that produces
 * "PHARM 212 — PHARM 212", which is what students actually see on Campus.
 *
 * The stored name is left alone: it is the row's identity, other rows point at
 * it, and a migration cannot reach a name a student types tomorrow. This
 * collapses the duplicate at the moment of display, on every surface, on both
 * platforms.
 */
export function communityDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return '';
  // Em dash only: the separator the derivation uses. A hyphen is ordinary
  // punctuation in a real community name ("Ben&Peace - study") and must not
  // be touched.
  const parts = trimmed.split('—');
  if (parts.length !== 2) return trimmed;
  const left = (parts[0] ?? '').trim();
  const right = (parts[1] ?? '').trim();
  if (!left || !right) return trimmed;
  return left.toLowerCase() === right.toLowerCase() ? left : trimmed;
}
