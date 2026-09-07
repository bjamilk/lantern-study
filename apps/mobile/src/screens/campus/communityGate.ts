/**
 * Who may open Campus → Communities on mobile.
 *
 * Founder decision (2026-09-07, binding): Communities open to every signed-in
 * student with an academic profile, and members POST — it is not a read-only
 * gallery. That rule lives in `packages/shared/src/network/communityGovernance.ts`
 * (`canAccessDiscoverHub`), which takes either the legacy boolean ("is this a
 * platform admin?") or the object form that implements the decision. The
 * server re-checks the same helper, so this is a screen-shaping call and never
 * the gate itself.
 *
 * This file exists to do ONE thing: turn the mobile `AcademicProfile` into the
 * shape the shared gate reads, in one place, so a screen cannot accidentally
 * pass the boolean form and quietly re-close the hub for every student.
 */
import { canAccessDiscoverHub, COMMUNITY_GATE_COPY } from '@lantern/shared/network';
import type { AcademicProfile } from '../../utils/academicProfile';

export { COMMUNITY_GATE_COPY };

export interface CommunityGateInput {
  isPlatformAdmin: boolean;
  academicProfile: AcademicProfile | null;
}

/** The shared gate's input, built from what the auth store holds. */
export function communityGateInput({ isPlatformAdmin, academicProfile }: CommunityGateInput) {
  return {
    isPlatformAdmin,
    institutionId: academicProfile?.institutionId ?? null,
    programme: academicProfile?.programme ?? null,
  };
}

/** May this account see the Communities segment at all? */
export function canSeeCommunitiesSegment(input: CommunityGateInput): boolean {
  return canAccessDiscoverHub(communityGateInput(input));
}

/**
 * May this account START a community?
 *
 * The same gate and nothing more: a student past it has an institution and a
 * programme on file, which is everything the create call needs. Kept separate
 * so the door and the segment cannot drift apart if either rule moves.
 */
export function canCreateCommunity(input: CommunityGateInput): boolean {
  return canSeeCommunitiesSegment(input);
}

/**
 * Why the segment is closed, when it is.
 *
 * A student without an institution or programme is not refused — they are one
 * profile field away, and the copy says so (`COMMUNITY_GATE_COPY`). Returning
 * null means "you are in".
 */
export function communityGateRefusal(input: CommunityGateInput): 'needsProfile' | null {
  return canSeeCommunitiesSegment(input) ? null : 'needsProfile';
}
