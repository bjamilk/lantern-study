/**
 * Label helpers shared by the community hub and the community server view.
 * Kept in their own module so `communityServer.ts` can use them without a
 * circular import through `./index`.
 */
import type { CommunityKind } from './index';

const COMMUNITY_KIND_LABELS: Record<CommunityKind, string> = {
  institution: 'Campus',
  programme: 'Programme',
  level: 'Year',
  course: 'Course',
  topic: 'Interest',
};

export function communityKindLabel(kind: CommunityKind | string): string {
  return COMMUNITY_KIND_LABELS[kind as CommunityKind] ?? 'Community';
}

/** "1,204 members" / "1 member" — used identically on both clients. */
export function memberCountLabel(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${n.toLocaleString()} ${n === 1 ? 'member' : 'members'}`;
}
