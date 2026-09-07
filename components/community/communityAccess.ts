import {
  COMMUNITY_GATE_COPY,
  canAccessDiscoverHub,
  hasCompleteAcademicProfile,
} from '@lantern/shared/network';

/**
 * Who may open the Communities surfaces on web.
 *
 * Founder decision (2026-09-07, binding): Communities open to every signed-in
 * student with an academic profile — and members POST, they are not read-only.
 * The rule is the shared `canAccessDiscoverHub` in its OBJECT form: a platform
 * admin always passes; everyone else passes with an institution AND a
 * programme on their profile. The API enforces the same helper on every
 * community write and on discovery, so this is a screen-shaping call and never
 * the gate itself — and it is the same input mobile builds in
 * `screens/campus/communityGate.ts`, so the two clients cannot disagree about
 * who is let in.
 *
 * Never pass the legacy boolean form from a screen: it means "platform admin?"
 * and nothing else, and re-closes the hub for every student.
 */

export { COMMUNITY_GATE_COPY };

/** The signed-in user fields this gate reads. */
export interface CommunityAccessUser {
  institutionId?: string | null;
  programme?: string | null;
}

/** The shared gate's input, built from what the auth store holds. */
export function communityGateInput(input: {
  isPlatformAdmin: boolean;
  user?: CommunityAccessUser | null;
}) {
  return {
    isPlatformAdmin: input.isPlatformAdmin,
    institutionId: input.user?.institutionId ?? null,
    programme: input.user?.programme ?? null,
  };
}

/** Does this profile name the institution and programme the gate needs? */
export function hasAcademicProfile(user: CommunityAccessUser | null | undefined): boolean {
  return hasCompleteAcademicProfile({
    institutionId: user?.institutionId ?? null,
    programme: user?.programme ?? null,
  });
}

export function canOpenCommunities(input: {
  isPlatformAdmin: boolean;
  user?: CommunityAccessUser | null;
}): boolean {
  return canAccessDiscoverHub(communityGateInput(input));
}

/** Why the surface is closed, when it is. `needsProfile` is one profile field away, not a refusal. */
export function communityGateRefusal(input: {
  isPlatformAdmin: boolean;
  user?: CommunityAccessUser | null;
}): 'needsProfile' | null {
  return canOpenCommunities(input) ? null : 'needsProfile';
}
