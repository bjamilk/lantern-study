/**
 * `canAccessDiscoverHub` with the arguments it actually wants.
 *
 * The shared gate takes either a boolean (the legacy "is this a platform
 * admin?" form) or the object form that implements the founder decision —
 * every signed-in student with an institution and a programme is in. Passing
 * the boolean by habit is a silent, total regression: it compiles, it type-
 * checks, and it closes Communities for every student on the platform. So no
 * screen calls the shared helper directly any more; they call this.
 */
import { useAuthStore } from '../stores/authStore';
import { usePlatformAdmin } from './usePlatformAdmin';
import {
  canCreateCommunity,
  canSeeCommunitiesSegment,
  communityGateRefusal,
} from '../screens/campus/communityGate';

export interface CommunityAccess {
  /** May this account open Communities at all? */
  canSee: boolean;
  /** May they start one? */
  canCreate: boolean;
  /** Why not, when not — `needsProfile` is one profile field away, not a refusal. */
  refusal: 'needsProfile' | null;
}

export function useCommunityAccess(): CommunityAccess {
  const isPlatformAdmin = usePlatformAdmin();
  const academicProfile = useAuthStore((s) => s.academicProfile);
  const input = { isPlatformAdmin, academicProfile };
  return {
    canSee: canSeeCommunitiesSegment(input),
    canCreate: canCreateCommunity(input),
    refusal: communityGateRefusal(input),
  };
}
