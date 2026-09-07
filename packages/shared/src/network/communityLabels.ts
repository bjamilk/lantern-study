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
